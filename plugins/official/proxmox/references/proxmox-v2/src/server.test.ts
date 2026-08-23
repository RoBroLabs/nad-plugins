import { describe, expect, it } from 'vitest';
import { createFakeHostV2 } from '@nad/testkit';
import { guestAction, overview } from './server.js';

const token = { secretRef: 'profile/proxmox/token', present: true } as const;
const nodes = { status: 200, body: { data: [{ node: 'pve1', status: 'online', cpu: 0.25, mem: 4, maxmem: 8 }] } };
const guests = { status: 200, body: { data: [{ id: 'qemu/100', vmid: 100, name: 'Media', node: 'pve1', type: 'qemu', status: 'running' }] } };

function host(name: string) {
  return createFakeHostV2({
    connection: { id: `fixture_${name.toLowerCase()}_0001`, name },
    values: { api_url: 'https://pve.internal:8006', token_id: 'nad@pve!dashboard', token_secret: token, verify_ssl: true },
    responses: { nodes, guests, 'qemu-restart': { status: 200, body: { data: 'UPID:pve1:fixture' } } },
  });
}

describe('Proxmox schema-v2 App', () => {
  it('keeps otherwise identical named connections distinct', async () => {
    const lab = await overview({ operation: 'overview', context: { caller: { kind: 'core', packageId: 'dev.robrolabs.proxmox' }, connectionProfile: { id: 'fixture_lab_0001', name: 'Lab' } } }, host('Lab'));
    const remote = await overview({ operation: 'overview', context: { caller: { kind: 'addon', packageId: 'dev.robrolabs.proxmox-guest-controls' }, connectionProfile: { id: 'fixture_remote_0001', name: 'Remote' } } }, host('Remote'));
    expect(lab).toMatchObject({ profile: 'Lab', nodeCount: 1, guestCount: 1 });
    expect(remote).toMatchObject({ profile: 'Remote', nodeCount: 1, guestCount: 1 });
  });

  it('uses an exact scoped mutation and emits only safe audit metadata', async () => {
    const fake = host('Lab');
    await expect(guestAction({
      operation: 'guest-action',
      body: { action: 'restart', node: 'pve1', type: 'qemu', vmid: 100 },
      context: { caller: { kind: 'addon', packageId: 'dev.robrolabs.proxmox-guest-controls' }, connectionProfile: { id: 'fixture_lab_0001', name: 'Lab' } },
    }, fake)).resolves.toMatchObject({ accepted: true, profile: 'Lab', upid: 'UPID:pve1:fixture' });
    expect(fake.httpLog.at(-1)).toMatchObject({ scope: 'qemu-restart', pathParameters: { node: 'pve1', vmid: 100 } });
    expect(JSON.stringify(fake.auditLog)).not.toContain('profile/proxmox/token');
  });

  it('treats hostile upstream guest names as data for text-only surface rendering', async () => {
    const fake = host('Lab');
    fake.http.request = async (request) => request.scope === 'nodes'
      ? { ...nodes, headers: {} }
      : { status: 200, headers: {}, body: { data: [{
        id: 'qemu/100', vmid: 100,
        name: '<img src=x onerror="globalThis.__nadPwned=true">',
        node: '<script>globalThis.__nadPwned=true</script>', type: 'qemu', status: 'running',
      }] } };
    const result = await overview({
      operation: 'overview',
      context: { caller: { kind: 'core', packageId: 'dev.robrolabs.proxmox' }, connectionProfile: { id: 'fixture_lab_0001', name: 'Lab' } },
    }, fake);
    expect(result.guests[0]).toMatchObject({
      name: '<img src=x onerror="globalThis.__nadPwned=true">',
      node: '<script>globalThis.__nadPwned=true</script>',
    });
  });
});
