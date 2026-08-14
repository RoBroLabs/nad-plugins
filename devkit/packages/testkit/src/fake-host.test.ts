import { describe, expect, it } from 'vitest';
import { createFakeHost } from './fake-host.js';

describe('createFakeHost', () => {
  it('captures host calls without external side effects', async () => {
    const host = createFakeHost({
      config: { target_url: 'http://example.test' },
      responses: {
        'http://example.test/metrics': { status: 200, headers: {}, body: { ok: true } },
      },
    });

    await expect(host.config.get('target_url')).resolves.toBe('http://example.test');
    await expect(host.http.request({ url: 'http://example.test/metrics' })).resolves.toMatchObject({ status: 200 });
    await host.storage.set('seen', true);
    await expect(host.storage.get('seen')).resolves.toBe(true);
    await host.notifications.emit({ key: 'test', severity: 'info', title: 'Title', body: 'Body' });
    await host.audit.annotate({ safe: true });

    expect(host.notificationsLog).toHaveLength(1);
    expect(host.auditLog).toEqual([{ safe: true }]);
  });
});
