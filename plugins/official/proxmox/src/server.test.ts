import { describe, expect, it } from 'vitest';
import type { SecretReference } from '@nad/sdk';
import { createFakeHost, type FakeHostOptions } from '@nad/testkit';
import { guestAction, overview, taskLog, testConnection } from './server.js';

function secret(): SecretReference {
  return { present: true, secretRef: 'secret:dev.robrolabs.proxmox:token_secret' };
}

function config(): NonNullable<FakeHostOptions['config']> {
  return {
    api_url: 'https://pve.test:8006/api2/json',
    token_id: 'nad@pve!dashboard',
    token_secret: secret(),
    verify_ssl: 'true',
  };
}

const nodes = {
  data: [
    { id: 'node/pve-a', node: 'pve-a', status: 'online', cpu: 0.25, maxcpu: 8, mem: 8_000, maxmem: 16_000, disk: 20_000, maxdisk: 100_000, uptime: 5000 },
    { id: 'node/pve-b', node: 'pve-b', status: 'offline', cpu: 9, maxcpu: 4, mem: -1, maxmem: 8_000, uptime: 0 },
  ],
};

const guests = {
  data: [
    { id: 'qemu/101', type: 'qemu', vmid: 101, name: 'router', node: 'pve-a', status: 'running', cpu: 0.5, maxcpu: 4, mem: 2_000, maxmem: 4_000, disk: 10_000, maxdisk: 20_000, netin: 100, netout: 200, uptime: 1000 },
    { id: 'lxc/202', type: 'lxc', vmid: 202, name: 'apps', node: 'pve-a', status: 'stopped', template: 0, mem: 0, maxmem: 2_000 },
    { id: 'storage/local', type: 'storage', node: 'pve-a' },
  ],
};

const taskUpid = 'UPID:pve-a:00000001:00000002:00000003:qmstart:101:nad@pve:';
const tasks = {
  data: [
    { upid: taskUpid, node: 'pve-a', type: 'qmstart', user: 'nad@pve', status: 'OK', exitstatus: 'OK', starttime: 100, endtime: 101, id: 101 },
    { upid: 'UPID:pve-a:failed', node: 'pve-a', type: 'vzdump', user: 'root@pam', status: 'ERROR', starttime: 90, endtime: 99 },
  ],
};

function readResponses(): NonNullable<FakeHostOptions['responses']> {
  return {
    'https://pve.test:8006/api2/json/nodes': { status: 200, headers: {}, body: nodes },
    'https://pve.test:8006/api2/json/cluster/resources?type=vm': { status: 200, headers: {}, body: guests },
    'https://pve.test:8006/api2/json/cluster/tasks': { status: 200, headers: {}, body: tasks },
    'https://pve.test:8006/api2/json/cluster/resources?type=storage': {
      status: 200,
      headers: {},
      body: { data: [{ id: 'storage/pve-a/local-zfs', storage: 'local-zfs', node: 'pve-a', plugintype: 'zfspool', status: 'available', disk: 40_000, maxdisk: 100_000, content: 'images,rootdir', shared: 0, type: 'storage' }] },
    },
    'https://pve.test:8006/api2/json/version': { status: 200, headers: {}, body: { data: { version: '9.2.3' } } },
  };
}

describe('Proxmox read endpoints', () => {
  it('returns bounded node, QEMU/LXC guest, storage, and uppercase-OK task data without constructing auth', async () => {
    const host = createFakeHost({ config: config(), responses: readResponses() });

    const result = await overview({ method: 'GET' }, host);

    expect(result).toMatchObject({
      nodeCount: 2,
      onlineNodes: 1,
      guestCount: 2,
      runningGuests: 1,
      storageCount: 1,
      failedTasks: 1,
      cpuPercent: 62.5,
      memoryPercent: 33.33,
      storagePercent: 40,
      statusLabel: 'Partial data',
      statusTone: 'warning',
      degradedSections: 0,
    });
    expect(result.guests.map(({ type }) => type)).toEqual(['qemu', 'lxc']);
    expect(result.tasks.map(({ status }) => status)).toEqual(['success', 'failed']);
    expect(result.nodes[1]).toMatchObject({ cpuPercent: 100, memoryUsed: 0 });
    expect(host.httpLog).toHaveLength(4);
    expect(host.httpLog.every(({ headers }) => !Object.keys(headers).some((name) => name.toLowerCase() === 'authorization'))).toBe(true);
    expect(JSON.stringify(host.httpLog)).not.toContain('secret:dev.robrolabs.proxmox');
  });

  it('keeps healthy sections when the task and cluster storage reads fail', async () => {
    const responses = readResponses();
    responses['https://pve.test:8006/api2/json/cluster/tasks'] = { status: 503, headers: {}, body: { errors: { hidden: 'upstream-secret' } } };
    responses['https://pve.test:8006/api2/json/cluster/resources?type=storage'] = { status: 500, headers: {}, body: { data: null } };
    const host = createFakeHost({ config: config(), responses });

    const result = await overview({ method: 'GET' }, host);

    expect(result).toMatchObject({ nodeCount: 2, guestCount: 2, storageCount: 0, degradedSections: 2, statusTone: 'warning' });
    expect(result.sections.storage).toEqual({ available: false, error: 'Proxmox rejected the storage request with HTTP 500.' });
    expect(result.sections.tasks).toEqual({ available: false, error: 'Proxmox rejected the task request with HTTP 503.' });
    expect(JSON.stringify(result)).not.toContain('upstream-secret');
  });

  it('distinguishes authentication and authorization failures safely', async () => {
    const unauthenticated = createFakeHost({
      config: config(),
      responses: { 'https://pve.test:8006/api2/json/cluster/tasks': { status: 401, headers: {}, body: { data: null } } },
    });
    await expect(taskLog({ method: 'GET' }, unauthenticated)).rejects.toThrow('rejected the configured API token');

    const forbidden = createFakeHost({
      config: config(),
      responses: { 'https://pve.test:8006/api2/json/cluster/tasks': { status: 403, headers: {}, body: { data: null } } },
    });
    await expect(taskLog({ method: 'GET' }, forbidden)).rejects.toThrow('does not have permission');
  });

  it('bounds the unfiltered Proxmox recent-task set to the newest 50 records', async () => {
    const upstreamTasks = Array.from({ length: 75 }, (_, index) => ({
      upid: `UPID:pve-a:${String(index).padStart(8, '0')}`,
      node: 'pve-a',
      type: 'vzdump',
      user: 'nad@pve',
      status: 'OK',
      exitstatus: 'OK',
      starttime: index + 1,
      endtime: index + 2,
    }));
    const host = createFakeHost({
      config: config(),
      responses: {
        'https://pve.test:8006/api2/json/cluster/tasks': {
          status: 200,
          headers: {},
          body: { data: upstreamTasks },
        },
      },
    });

    const result = await taskLog({ method: 'GET' }, host);

    expect(result.tasks).toHaveLength(50);
    expect(result.tasks[0]?.startTime).toBe(75);
    expect(result.tasks[49]?.startTime).toBe(26);
    expect(host.httpLog.map(({ url }) => url)).toEqual(['https://pve.test:8006/api2/json/cluster/tasks']);
  });

  it('uses one cluster storage request and bounds its unfiltered records to 256', async () => {
    const responses = readResponses();
    responses['https://pve.test:8006/api2/json/cluster/resources?type=storage'] = {
      status: 200,
      headers: {},
      body: {
        data: Array.from({ length: 300 }, (_, index) => ({
          id: `storage/pve-a/store-${index}`,
          storage: `store-${index}`,
          node: 'pve-a',
          plugintype: 'zfspool',
          status: 'available',
          disk: index,
          maxdisk: 1_000,
          content: 'images',
          shared: 0,
          type: 'storage',
        })),
      },
    };
    const host = createFakeHost({ config: config(), responses });

    const result = await overview({ method: 'GET' }, host);

    expect(result.storage).toHaveLength(256);
    expect(result.storage[0]).toMatchObject({ storage: 'store-0', used: 0, total: 1_000, available: 1_000 });
    expect(result.storage[255]).toMatchObject({ storage: 'store-255', used: 255, total: 1_000, available: 745 });
    expect(host.httpLog.filter(({ url }) => url.includes('storage'))).toEqual([expect.objectContaining({
      url: 'https://pve.test:8006/api2/json/cluster/resources?type=storage',
      method: 'GET',
    })]);
    expect(host.httpLog.some(({ url }) => url.includes('/nodes/pve-a/storage'))).toBe(false);
  });

  it('requires opaque secret presence and accepts only the root or API path', async () => {
    const plaintext = createFakeHost({ config: { ...config(), token_secret: 'plaintext' } });
    await expect(overview({ method: 'GET' }, plaintext)).rejects.toThrow('secret is not configured');
    expect(plaintext.httpLog).toEqual([]);

    const unsafePath = createFakeHost({ config: { ...config(), api_url: 'https://pve.test:8006/custom/path' } });
    await expect(overview({ method: 'GET' }, unsafePath)).rejects.toThrow('server root or /api2/json');
    expect(unsafePath.httpLog).toEqual([]);
  });

  it('preserves the useful connection test while treating version as optional', async () => {
    const responses = readResponses();
    responses['https://pve.test:8006/api2/json/version'] = { status: 403, headers: {}, body: { data: null } };
    const result = await testConnection({ method: 'GET' }, createFakeHost({ config: config(), responses }));
    expect(result).toEqual({ connected: true, nodeCount: 2, message: 'Connected to Proxmox with 2 visible nodes.' });
  });
});

describe('Proxmox guest mutations', () => {
  it('rejects malformed or console actions before configuration or HTTP side effects', async () => {
    const invalid: unknown[] = [undefined, {}, { action: 'console', node: 'pve-a', type: 'qemu', vmid: 101 }, { action: 'start', node: '../pve', type: 'qemu', vmid: 101 }, { action: 'stop', node: 'pve-a', type: 'vm', vmid: 101 }, { action: 'restart', node: 'pve-a', type: 'lxc', vmid: 99 }, { action: 'start', node: 'pve-a', type: 'qemu', vmid: 101, extra: true }];
    for (const body of invalid) {
      const host = createFakeHost({ config: config() });
      await expect(guestAction({ method: 'POST', body }, host)).rejects.toThrow();
      expect(host.configLog).toEqual([]);
      expect(host.httpLog).toEqual([]);
      expect(host.auditLog).toEqual([]);
    }
  });

  it('records the UPID, polls task and guest state, and audits a confirmed QEMU start', async () => {
    const responses = readResponses();
    responses['https://pve.test:8006/api2/json/nodes/pve-a/qemu/101/status/start'] = { status: 200, headers: {}, body: { data: taskUpid } };
    const host = createFakeHost({ config: config(), responses });

    const result = await guestAction({ method: 'POST', body: { action: 'start', node: 'pve-a', type: 'qemu', vmid: 101 } }, host);

    expect(result).toMatchObject({ accepted: true, complete: true, outcome: 'success', upid: taskUpid, observedState: 'running', taskStatus: 'success' });
    expect(host.httpLog.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST https://pve.test:8006/api2/json/nodes/pve-a/qemu/101/status/start',
      'GET https://pve.test:8006/api2/json/cluster/tasks',
      'GET https://pve.test:8006/api2/json/cluster/resources?type=vm',
    ]);
    expect(host.httpLog[0]?.body).toEqual({});
    expect(host.auditLog).toEqual([{ action: 'start', node: 'pve-a', type: 'qemu', vmid: 101, outcome: 'success', upid: taskUpid, observedState: 'running', taskStatus: 'success', code: null }]);
  });

  it('returns an explicit recoverable indeterminate restart when confirmation is not terminal', async () => {
    const restartUpid = 'UPID:pve-a:restart-pending';
    const responses = readResponses();
    responses['https://pve.test:8006/api2/json/nodes/pve-a/lxc/202/status/reboot'] = { status: 200, headers: {}, body: { data: restartUpid } };
    responses['https://pve.test:8006/api2/json/cluster/tasks'] = { status: 200, headers: {}, body: { data: [{ upid: restartUpid, node: 'pve-a', type: 'vzreboot', starttime: 200 }] } };
    const host = createFakeHost({ config: config(), responses });

    const result = await guestAction({ method: 'POST', body: { action: 'restart', node: 'pve-a', type: 'lxc', vmid: 202 } }, host);

    expect(result).toMatchObject({ accepted: true, complete: false, outcome: 'indeterminate', upid: restartUpid, observedState: 'stopped', taskStatus: 'running' });
    expect(result.message).toContain('final state is not yet known');
    expect(host.auditLog[0]).toMatchObject({ outcome: 'indeterminate', taskStatus: 'running' });
  });

  it('audits safe failure metadata when Proxmox denies an authorized action upstream', async () => {
    const sensitive = 'raw-upstream-secret';
    const host = createFakeHost({
      config: config(),
      responses: { 'https://pve.test:8006/api2/json/nodes/pve-a/qemu/101/status/stop': { status: 403, headers: {}, body: { errors: sensitive } } },
    });

    await expect(guestAction({ method: 'POST', body: { action: 'stop', node: 'pve-a', type: 'qemu', vmid: 101 } }, host)).rejects.toThrow('does not have permission');
    expect(host.auditLog).toEqual([{ action: 'stop', node: 'pve-a', type: 'qemu', vmid: 101, outcome: 'failed', upid: null, observedState: 'unknown', taskStatus: 'unknown', code: 'UPSTREAM_PERMISSION_DENIED' }]);
    expect(JSON.stringify(host.auditLog)).not.toContain(sensitive);
  });
});
