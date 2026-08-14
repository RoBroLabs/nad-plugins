import { describe, expect, it } from 'vitest';
import { createFakeHostV2 } from '@nad/testkit';
import { summary } from './server.js';

describe('__PACKAGE_NAME__ App', () => {
  it('uses only the selected named connection', async () => {
    const host = createFakeHostV2({
      connection: { id: 'fixture_profile_0001', name: 'Lab' },
      values: { headline: 'Lab status', status_message: 'Healthy' },
    });
    await expect(summary({
      operation: 'summary',
      context: { caller: { kind: 'core', packageId: '__PACKAGE_ID__' }, connectionProfile: { id: 'fixture_profile_0001', name: 'Lab' } },
    }, host)).resolves.toEqual({ profile: 'Lab', headline: 'Lab status', status: 'Healthy' });
  });
});
