import { describe, expect, it } from 'vitest';
import { createFakeHost } from '@nad/testkit';
import { summary } from './server.js';

describe('__MODULE_SLUG__ summary handler', () => {
  it('returns read-only data from administrator-managed config', async () => {
    const host = createFakeHost({
      config: {
        headline: 'Operations Summary',
        status_message: 'All monitored systems are healthy.',
      },
    });

    await expect(summary({ method: 'GET' }, host)).resolves.toEqual({
      moduleId: '__MODULE_ID__',
      publisher: '__MODULE_PUBLISHER__',
      headline: 'Operations Summary',
      statusMessage: 'All monitored systems are healthy.',
      statusTone: 'ok',
      mode: 'read-only',
    });
  });
});
