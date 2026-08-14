import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '@nad/sdk';
import { createFakeHost } from '@nad/testkit';
import { acknowledgeIncident } from './server.js';

describe('safe Host API mutation example', () => {
  it('stores an idempotency marker, annotates audit and asks core to notify', async () => {
    const host = createFakeHost();
    const request = { method: 'POST' as const, body: { incidentId: 'inc-42', requestId: 'req-1' } };

    await expect(acknowledgeIncident(request, host)).resolves.toEqual({ acknowledged: true, duplicate: false });
    await expect(acknowledgeIncident(request, host)).resolves.toEqual({ acknowledged: true, duplicate: true });

    expect(host.storageLog).toHaveLength(1);
    expect(host.notificationsLog).toHaveLength(1);
    expect(host.auditLog).toEqual([
      { incidentId: 'inc-42', outcome: 'acknowledged' },
      { incidentId: 'inc-42', outcome: 'duplicate' },
    ]);
  });

  it('rejects hostile identifiers before producing side effects', async () => {
    const host = createFakeHost();
    await expect(acknowledgeIncident({
      method: 'POST',
      body: { incidentId: '../secret', requestId: 'req-1' },
    }, host)).rejects.toThrow('safe identifier');
    expect(host.storageLog).toEqual([]);
    expect(host.notificationsLog).toEqual([]);
    expect(host.auditLog).toEqual([]);
  });

  it('keeps the capability and data-migration example inside contract v1', async () => {
    const manifest = JSON.parse(await readFile(join(import.meta.dirname, 'manifest.json'), 'utf8')) as unknown;
    expect(validateManifest(manifest)).toMatchObject({ valid: true, issues: [] });
  });
});
