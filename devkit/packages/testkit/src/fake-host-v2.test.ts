import { describe, expect, it } from 'vitest';
import { assertNoSecretMaterial } from './bridge-harness.js';
import { createFakeHostV2 } from './fake-host-v2.js';

describe('Host API v2 fake', () => {
  it('binds reads to one profile and keeps secrets opaque', async () => {
    const host = createFakeHostV2({
      connection: { id: 'fixture_profile_0001', name: 'Lab' },
      values: {
        hostname: 'lab.internal',
        token: { secretRef: 'profile/fixture/token', present: true },
      },
    });
    await expect(host.connections.current()).resolves.toEqual({ id: 'fixture_profile_0001', name: 'Lab' });
    await expect(host.connections.get('hostname')).resolves.toBe('lab.internal');
    await expect(host.connections.get('token')).resolves.toEqual({ secretRef: 'profile/fixture/token', present: true });
    expect(host.connectionReads).toEqual(['hostname', 'token']);
    const profile = await host.connections.current();
    expect(() => assertNoSecretMaterial({ profile }, ['plaintext-token'])).not.toThrow();
  });

  it('invokes only configured dependency operations without passing connection values', async () => {
    const host = createFakeHostV2({
      appOperations: {
        'proxmox.guests': (_input: unknown, profileId: string) => ({ profileId, guests: [{ id: 100 }] }),
      },
    });
    await expect(host.apps.invoke({
      dependency: 'proxmox',
      operation: 'guests',
      connectionProfileId: 'fixture_profile_0001',
      input: {},
    })).resolves.toEqual({ profileId: 'fixture_profile_0001', guests: [{ id: 100 }] });
    expect(host.appInvocationLog[0]).toEqual({
      dependency: 'proxmox', operation: 'guests', connectionProfileId: 'fixture_profile_0001', input: {},
    });
  });
});
