import { describe, expect, it } from 'vitest';
import type { SecretReference } from '@nad/sdk';
import { createFakeHost, type FakeHostOptions } from '@nad/testkit';
import { overview, storage, summary, workloads } from './server.js';

function secret(): SecretReference {
  return { present: true, secretRef: 'secret:dev.robrolabs.unraid:api_key' };
}

function config(overrides: NonNullable<FakeHostOptions['config']> = {}): NonNullable<FakeHostOptions['config']> {
  return {
    server_host: 'tower.test',
    scheme: 'https',
    port: '443',
    api_key: secret(),
    ...overrides,
  };
}

function response(body: unknown, status = 200): NonNullable<FakeHostOptions['responses']> {
  return {
    'https://tower.test/graphql': {
      status,
      headers: { 'content-type': 'application/json' },
      body,
    },
  };
}

const hostData = {
  info: {
    os: {
      hostname: 'tower',
      release: '7.2.0',
      kernel: '6.12.0',
      uptime: '2026-08-10T12:00:00.000Z',
    },
    cpu: { brand: 'Example CPU', cores: 8, threads: 16 },
    versions: { core: { unraid: '7.2.0', api: '4.32.3', kernel: '6.12.0' } },
  },
  metrics: {
    cpu: { percentTotal: 17.125 },
    memory: {
      total: '34359738368',
      used: '12884901888',
      available: '21474836480',
      percentTotal: 37.5,
    },
  },
};

const arrayData = {
  state: 'STARTED',
  capacity: {
    kilobytes: {
      total: '2000000000',
      used: '1250000000',
      free: '750000000',
    },
  },
  parityCheckStatus: {
    status: 'COMPLETED',
    progress: 100,
    errors: 0,
    running: false,
    paused: false,
  },
};

const workloadData = {
  docker: {
    containers: [
      { id: 'server:container-1', names: ['Plex'], image: 'plex:latest', state: 'RUNNING', status: 'Up 3 days', autoStart: true },
      { id: 'server:container-2', names: ['Backup'], image: 'backup:latest', state: 'EXITED', status: 'Exited', autoStart: false },
    ],
  },
  vms: {
    domains: [
      { id: 'server:vm-1', name: 'Home Assistant', state: 'RUNNING' },
      { id: 'server:vm-2', name: 'Lab', state: 'PAUSED' },
    ],
  },
};

describe('Unraid read-only GraphQL queries', () => {
  it('collects a bounded host overview through the exact brokered GraphQL scope', async () => {
    const host = createFakeHost({
      config: config(),
      responses: response({ data: { ...hostData, array: arrayData, ...workloadData } }),
    });

    const result = await overview({ method: 'GET' }, host);

    expect(result).toMatchObject({
      statusLabel: 'Online',
      statusTone: 'ok',
      hostname: 'tower',
      unraidVersion: '7.2.0',
      apiVersion: '4.32.3',
      cpuBrand: 'Example CPU',
      cpuCores: 8,
      cpuThreads: 16,
      cpuUsagePercent: 17.13,
      memoryTotalBytes: 34_359_738_368,
      memoryUsagePercent: 37.5,
      arrayState: 'STARTED',
      capacity: {
        totalBytes: 2_048_000_000_000,
        usedBytes: 1_280_000_000_000,
        freeBytes: 768_000_000_000,
        usagePercent: 62.5,
      },
      dockerTotal: 2,
      dockerRunning: 1,
      vmTotal: 2,
      vmRunning: 1,
      partial: false,
      errors: [],
    });
    expect(host.configLog).toEqual(['server_host', 'scheme', 'port', 'api_key']);
    expect(host.httpLog).toHaveLength(1);
    expect(host.httpLog[0]).toMatchObject({
      url: 'https://tower.test/graphql',
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
    expect(host.httpLog[0]?.headers).not.toHaveProperty('x-api-key');
    expect(Object.keys(host.httpLog[0]?.body as object)).toEqual(['query']);
    expect(String((host.httpLog[0]?.body as { query: string }).query)).toContain('query NadUnraidOverview');
    expect(String((host.httpLog[0]?.body as { query: string }).query)).not.toContain('mutation');
    expect(JSON.stringify(host.httpLog)).not.toContain('secret:dev.robrolabs.unraid');
  });

  it('keeps usable GraphQL data and sanitizes sibling field errors', async () => {
    const upstreamSecret = 'api-key-was-secret-value';
    const host = createFakeHost({
      config: config(),
      responses: response({
        data: {
          ...hostData,
          metrics: { ...hostData.metrics, cpu: null },
          array: arrayData,
          ...workloadData,
        },
        errors: [{ message: `resolver exposed ${upstreamSecret}`, path: ['metrics', 'cpu'] }],
      }),
    });

    const result = await overview({ method: 'GET' }, host);

    expect(result).toMatchObject({
      hostname: 'tower',
      statusLabel: 'Partially available',
      statusTone: 'warning',
      cpuUsagePercent: 0,
      memoryUsagePercent: 37.5,
      partial: true,
      errors: [{ path: 'metrics.cpu', message: 'Unraid API could not resolve metrics.cpu.' }],
    });
    expect(JSON.stringify(result)).not.toContain(upstreamSecret);
  });

  it('returns strict storage tables for parity, data, cache, and shares', async () => {
    const host = createFakeHost({
      config: config({ scheme: 'http', port: '8080' }),
      responses: {
        'http://tower.test:8080/graphql': {
          status: 200,
          headers: {},
          body: {
            data: {
              array: {
                ...arrayData,
                parities: [{ name: 'parity', type: 'PARITY', status: 'DISK_OK', temp: 35, size: '1000000', numErrors: '0', isSpinning: true }],
                disks: [{ name: 'disk1', type: 'DATA', status: 'DISK_OK', temp: null, size: '900000', fsSize: '850000', fsUsed: '500000', fsFree: '350000', numErrors: 2, isSpinning: false }],
                caches: [],
              },
              shares: [
                { name: 'media', size: '800000', used: '400000', free: '400000', cache: true },
                { name: null, size: null, used: -10, free: 'not-a-number', cache: null },
              ],
            },
          },
        },
      },
    });

    const result = await storage({ method: 'GET' }, host);

    expect(result).toMatchObject({
      arrayState: 'STARTED',
      diskCount: 2,
      parityCount: 1,
      dataDiskCount: 1,
      cacheDiskCount: 0,
      shareCount: 2,
      partial: false,
    });
    expect((result.disks as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'parity', type: 'PARITY', totalBytes: 1_024_000_000, usedBytes: 0, errorCount: 0,
    });
    expect((result.disks as Array<Record<string, unknown>>)[1]).toMatchObject({
      name: 'disk1', type: 'DATA', temperatureC: null, totalBytes: 870_400_000, usedBytes: 512_000_000,
    });
    expect((result.shares as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'media', totalBytes: 819_200_000, usagePercent: 50, cached: true,
    });
    expect((result.shares as Array<Record<string, unknown>>)[1]).toMatchObject({
      name: 'Unknown', totalBytes: 0, usedBytes: 0, freeBytes: 0, cached: null,
    });
  });

  it('bounds large numbers and collection sizes without rejecting empty lists', async () => {
    const containers = Array.from({ length: 300 }, (_, index) => ({
      id: `id-${index}`,
      names: index % 3 === 0 ? [] : [`container-${index}`],
      image: '',
      state: index % 2 === 0 ? 'RUNNING' : 'SOMETHING_NEW',
      status: '',
      autoStart: index % 2 === 0,
    }));
    const workloadHost = createFakeHost({
      config: config(),
      responses: response({ data: { docker: { containers }, vms: { domains: [] } } }),
    });
    const workloadResult = await workloads({ method: 'GET' }, workloadHost);
    expect(workloadResult).toMatchObject({ dockerTotal: 256, dockerRunning: 128, vmTotal: 0, partial: false });
    expect((workloadResult.containers as unknown[])).toHaveLength(256);

    const storageHost = createFakeHost({
      config: config(),
      responses: response({
        data: {
          array: {
            state: 'FUTURE_STATE',
            capacity: { kilobytes: { total: '1e1000', used: Number.MAX_VALUE, free: -1 } },
            parityCheckStatus: { status: null, progress: 999, errors: '1e1000', running: false, paused: false },
            parities: [], disks: [], caches: [],
          },
          shares: [],
        },
      }),
    });
    const storageResult = await storage({ method: 'GET' }, storageHost);
    expect(storageResult).toMatchObject({
      arrayState: 'FUTURE_STATE',
      diskCount: 0,
      shareCount: 0,
      capacity: { totalBytes: 0, usedBytes: 9_007_199_254_740_991, freeBytes: 0, usagePercent: 0 },
      parity: { status: 'Unknown', progressPercent: 100, errors: 0 },
    });
  });

  it('provides the stable compact summary surface', async () => {
    const host = createFakeHost({
      config: config(),
      responses: response({ data: { ...hostData, array: arrayData, ...workloadData } }),
    });
    const result = await summary({ method: 'GET' }, host);
    expect(result).toMatchObject({
      statusLabel: 'Online',
      hostname: 'tower',
      arrayUsagePercent: 62.5,
      dockerTotal: 2,
      dockerRunning: 1,
      vmTotal: 2,
      vmRunning: 1,
      errorCount: 0,
      partial: false,
    });
    expect(result).not.toHaveProperty('containers');
    expect(result).not.toHaveProperty('vms');
  });

  it('rejects plaintext credentials and malformed targets before any HTTP request', async () => {
    const plaintext = createFakeHost({ config: config({ api_key: 'plaintext-api-key' }) });
    await expect(summary({ method: 'GET' }, plaintext)).rejects.toThrow('API key is not configured');
    expect(plaintext.httpLog).toEqual([]);

    const invalidHosts = [
      'https://tower.test',
      'tower.test:443',
      'user@tower.test',
      'tower.test/graphql',
      'tower.test?query=1',
    ];
    for (const serverHost of invalidHosts) {
      const invalid = createFakeHost({ config: config({ server_host: serverHost }) });
      await expect(summary({ method: 'GET' }, invalid)).rejects.toThrow('without a scheme, port, path, or credentials');
      expect(invalid.httpLog).toEqual([]);
    }
  });

  it('maps authentication, malformed JSON, and data-less GraphQL failures to safe errors', async () => {
    const credential = createFakeHost({
      config: config(),
      responses: response({ error: 'secret-bearing detail' }, 403),
    });
    await expect(workloads({ method: 'GET' }, credential)).rejects.toThrow('rejected the configured API key');

    const malformed = createFakeHost({
      config: config(),
      responses: response('{not-json'),
    });
    await expect(workloads({ method: 'GET' }, malformed)).rejects.toThrow('malformed JSON');

    const failed = createFakeHost({
      config: config(),
      responses: response({ data: null, errors: [{ message: 'private resolver detail', path: ['docker'] }] }),
    });
    await expect(workloads({ method: 'GET' }, failed)).rejects.toThrow('failed without usable data');
  });
});
