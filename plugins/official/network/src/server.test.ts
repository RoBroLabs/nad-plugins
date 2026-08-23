import { describe, expect, it } from 'vitest';
import type { SecretReference } from '@nad/sdk';
import { createFakeHost, type FakeHostOptions } from '@nad/testkit';
import { setBlocking, stats, status, summary } from './server.js';

function secret(key: string): SecretReference {
  return { present: true, secretRef: `secret:dev.robrolabs.network:${key}` };
}

function v6Config(secondary = false): NonNullable<FakeHostOptions['config']> {
  return {
    pihole_url: 'https://primary.pihole.test/admin',
    pihole_api_key: secret('pihole_api_key'),
    pihole_api_version: 'v6',
    ...(secondary
      ? {
          pihole2_url: 'http://secondary.pihole.test/api',
          pihole2_api_key: secret('pihole2_api_key'),
        }
      : {}),
  };
}

function v5Config(secondary = false): NonNullable<FakeHostOptions['config']> {
  return {
    pihole_url: 'https://primary.pihole.test/admin/api.php',
    pihole_api_key: secret('pihole_api_key'),
    pihole_api_version: 'v5',
    ...(secondary
      ? {
          pihole2_url: 'http://secondary.pihole.test',
          pihole2_api_key: secret('pihole2_api_key'),
        }
      : {}),
  };
}

const v6Summary = {
  queries: {
    total: 1_000,
    blocked: 250,
    percent_blocked: 25,
    forwarded: 500,
    cached: 250,
  },
  clients: { active: 12, total: 20 },
  gravity: { domains_being_blocked: 120_000 },
};

const v5Summary = {
  dns_queries_today: '800',
  ads_blocked_today: '200',
  ads_percentage_today: '25',
  domains_being_blocked: '110000',
  unique_clients: '8',
  queries_forwarded: '400',
  queries_cached: '200',
  status: 'enabled',
};

function v6Responses(options: {
  secondary?: boolean;
  primaryState?: 'enabled' | 'disabled';
  secondaryState?: 'enabled' | 'disabled';
  secondaryAuthStatus?: number;
} = {}): NonNullable<FakeHostOptions['responses']> {
  const responses: NonNullable<FakeHostOptions['responses']> = {
    'https://primary.pihole.test/api/auth': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { session: { valid: true, sid: 'primary-session' } },
    },
    'https://primary.pihole.test/api/stats/summary': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: v6Summary,
    },
    'https://primary.pihole.test/api/dns/blocking': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { blocking: options.primaryState ?? 'enabled', timer: null },
    },
  };

  if (options.secondary) {
    responses['http://secondary.pihole.test/api/auth'] = options.secondaryAuthStatus
      ? {
          status: options.secondaryAuthStatus,
          headers: { 'content-type': 'application/json' },
          body: { error: { message: 'secret-bearing upstream detail' } },
        }
      : {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { session: { valid: true, sid: 'secondary-session' } },
        };
    responses['http://secondary.pihole.test/api/stats/summary'] = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        queries: { total: 400, blocked: 40, percent_blocked: 10, forwarded: 300, cached: 60 },
        clients: { active: 4 },
        gravity: { domains_being_blocked: 100_000 },
      },
    };
    responses['http://secondary.pihole.test/api/dns/blocking'] = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { blocking: options.secondaryState ?? 'enabled', timer: null },
    };
  }
  return responses;
}

describe('Network Pi-hole queries', () => {
  it('uses one brokered v6 session for statistics and status without exposing the credential reference', async () => {
    const host = createFakeHost({ config: v6Config(), responses: v6Responses() });

    const result = await stats({ method: 'GET' }, host);

    expect(result).toMatchObject({
      totalQueries: 1_000,
      blockedQueries: 250,
      blockPercentage: 25,
      domainsOnBlocklist: 120_000,
      uniqueClients: 12,
      queriesForwarded: 500,
      queriesCached: 250,
      blockingStatus: 'enabled',
      statusTone: 'ok',
      configuredInstances: 1,
      availableInstances: 1,
    });
    expect(result.instances[0]).toMatchObject({
      id: 'primary',
      available: true,
      blockingStatus: 'enabled',
    });
    expect(host.httpLog.map(({ url, method }) => `${method} ${url}`)).toEqual([
      'POST https://primary.pihole.test/api/auth',
      'GET https://primary.pihole.test/api/stats/summary',
      'GET https://primary.pihole.test/api/dns/blocking',
      'DELETE https://primary.pihole.test/api/auth',
    ]);
    expect(host.httpLog[0]?.body).toEqual({});
    expect(host.httpLog[1]?.headers).toMatchObject({ 'x-ftl-sid': 'primary-session' });
    expect(JSON.stringify(host.httpLog)).not.toContain('secret:dev.robrolabs.network');
    expect(host.configLog).toEqual([
      'pihole_url',
      'pihole_api_key',
      'pihole_api_version',
      'pihole2_url',
      'pihole2_api_key',
    ]);
  });

  it('supports legacy v5 summary data while leaving auth injection to core', async () => {
    const host = createFakeHost({
      config: v5Config(),
      responses: {
        'https://primary.pihole.test/admin/api.php?summaryRaw=': {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: v5Summary,
        },
      },
    });

    const result = await stats({ method: 'GET' }, host);

    expect(result).toMatchObject({
      totalQueries: 800,
      blockedQueries: 200,
      blockPercentage: 25,
      domainsOnBlocklist: 110_000,
      blockingStatus: 'enabled',
    });
    expect(host.httpLog).toHaveLength(1);
    expect(host.httpLog[0]?.url).toBe('https://primary.pihole.test/admin/api.php?summaryRaw=');
    expect(host.httpLog[0]?.url).not.toContain('auth');
    expect(host.httpLog[0]?.headers).not.toHaveProperty('authorization');
  });

  it('returns useful primary data and a safe secondary failure for a partially available pair', async () => {
    const upstreamSecret = 'secondary-application-password-super-secret';
    const responses = v6Responses({ secondary: true, secondaryAuthStatus: 403 });
    responses['http://secondary.pihole.test/api/auth'] = {
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: { error: { message: upstreamSecret } },
    };
    const host = createFakeHost({ config: v6Config(true), responses });

    const result = await stats({ method: 'GET' }, host);

    expect(result).toMatchObject({
      totalQueries: 1_000,
      blockedQueries: 250,
      blockPercentage: 25,
      blockingStatus: 'unknown',
      statusTone: 'warning',
      configuredInstances: 2,
      availableInstances: 1,
      unavailableInstances: ['Secondary Pi-hole'],
    });
    expect(result.instances[1]).toEqual({
      id: 'secondary',
      name: 'Secondary Pi-hole',
      available: false,
      totalQueries: 0,
      blockedQueries: 0,
      blockPercentage: 0,
      domainsOnBlocklist: 0,
      uniqueClients: 0,
      queriesForwarded: 0,
      queriesCached: 0,
      blockingStatus: 'unknown',
      error: 'Secondary Pi-hole rejected the configured credential.',
    });
    expect(JSON.stringify(result)).not.toContain(upstreamSecret);
  });

  it('reports mixed v5 blocking states without hiding either instance', async () => {
    const host = createFakeHost({
      config: v5Config(true),
      responses: {
        'https://primary.pihole.test/admin/api.php?status=': {
          status: 200,
          headers: {},
          body: { status: 'enabled' },
        },
        'http://secondary.pihole.test/admin/api.php?status=': {
          status: 200,
          headers: {},
          body: { status: 'disabled' },
        },
      },
    });

    const result = await status({ method: 'GET' }, host);

    expect(result).toMatchObject({
      blockingStatus: 'mixed',
      statusLabel: 'Mixed blocking state',
      statusTone: 'warning',
      availableInstances: 2,
    });
    expect(result.instances.map(({ blockingStatus }) => blockingStatus)).toEqual(['enabled', 'disabled']);
  });

  it('bounds hostile numeric values and maps malformed responses to a per-target error', async () => {
    const responses = v6Responses();
    responses['https://primary.pihole.test/api/stats/summary'] = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    };
    const host = createFakeHost({ config: v6Config(), responses });

    const result = await stats({ method: 'GET' }, host);

    expect(result).toMatchObject({
      totalQueries: 0,
      blockedQueries: 0,
      blockingStatus: 'unknown',
      availableInstances: 0,
    });
    expect(result.instances[0]?.error).toBe('Primary Pi-hole returned malformed statistics data.');

    responses['https://primary.pihole.test/api/stats/summary'] = {
      status: 200,
      headers: {},
      body: {
        queries: {
          total: Number.POSITIVE_INFINITY,
          blocked: -50,
          percent_blocked: 5_000,
          forwarded: 'not-a-number',
          cached: Number.MAX_VALUE,
        },
        clients: { active: -1 },
        gravity: { domains_being_blocked: Number.MAX_VALUE },
      },
    };
    const bounded = await stats({ method: 'GET' }, createFakeHost({ config: v6Config(), responses }));
    expect(bounded.instances[0]).toMatchObject({
      totalQueries: 0,
      blockedQueries: 0,
      blockPercentage: 100,
      uniqueClients: 0,
      queriesForwarded: 0,
      queriesCached: 9_007_199_254_740_991,
      domainsOnBlocklist: 9_007_199_254_740_991,
    });
  });

  it('does not accept plaintext secret configuration or non-standard target paths', async () => {
    const plaintext = createFakeHost({
      config: {
        ...v6Config(),
        pihole_api_key: 'plaintext-secret-that-module-must-not-read',
      },
    });
    await expect(stats({ method: 'GET' }, plaintext)).rejects.toThrow('credential is not configured');
    expect(plaintext.httpLog).toEqual([]);

    const path = createFakeHost({
      config: {
        ...v6Config(),
        pihole_url: 'https://primary.pihole.test/unapproved/path',
      },
    });
    await expect(stats({ method: 'GET' }, path)).rejects.toThrow('standard admin/API path');
    expect(path.httpLog).toEqual([]);
  });

  it('provides a compact summary without leaking per-target error detail', async () => {
    const host = createFakeHost({
      config: v6Config(true),
      responses: v6Responses({ secondary: true, secondaryAuthStatus: 503 }),
    });

    const result = await summary({ method: 'GET' }, host);

    expect(result).toMatchObject({
      totalQueries: 1_000,
      blockedQueries: 250,
      configuredInstances: 2,
      availableInstances: 1,
      unavailableInstances: 1,
      blockingStatus: 'unknown',
    });
    expect(result).not.toHaveProperty('instances');
  });
});

describe('Network DNS blocking mutations', () => {
  it('rejects malformed actions and duration bounds before any host side effect', async () => {
    const invalidBodies: unknown[] = [
      undefined,
      null,
      {},
      { action: 'restart' },
      { action: 'enable', durationSeconds: 60 },
      { action: 'disable', durationSeconds: 0 },
      { action: 'disable', durationSeconds: 86_401 },
      { action: 'disable', durationSeconds: 1.5 },
      { action: 'disable', durationSeconds: '60' },
      { action: 'disable', unexpected: true },
    ];

    for (const body of invalidBodies) {
      const host = createFakeHost({ config: v6Config(), responses: v6Responses() });
      await expect(setBlocking({ method: 'POST', body }, host)).rejects.toThrow();
      expect(host.httpLog).toEqual([]);
      expect(host.auditLog).toEqual([]);
      expect(host.configLog).toEqual([]);
    }
  });

  it('changes and re-reads a v6 target, then records only safe audit metadata', async () => {
    const host = createFakeHost({
      config: v6Config(),
      responses: v6Responses({ primaryState: 'disabled' }),
    });

    const result = await setBlocking({
      method: 'POST',
      body: { action: 'disable', durationSeconds: 300 },
    }, host);

    expect(result).toMatchObject({
      accepted: true,
      complete: true,
      action: 'disable',
      durationSeconds: 300,
      blockingStatus: 'disabled',
      succeededTargets: 1,
      failedTargets: 0,
      targets: [{
        id: 'primary',
        succeeded: true,
        observedFinalState: 'disabled',
      }],
    });
    const blockingRequests = host.httpLog.filter(({ url }) => url.endsWith('/api/dns/blocking'));
    expect(blockingRequests.map(({ method }) => method)).toEqual(['POST', 'GET']);
    expect(blockingRequests[0]).toMatchObject({
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-ftl-sid': 'primary-session',
      },
      body: { blocking: false, timer: 300 },
    });
    expect(host.auditLog).toEqual([{
      action: 'disable',
      durationSeconds: 300,
      targetId: 'primary',
      targetName: 'Primary Pi-hole',
      succeeded: true,
      observedFinalState: 'disabled',
    }]);
    expect(JSON.stringify(host.httpLog)).not.toContain('pihole_api_key');
    expect(JSON.stringify(host.auditLog)).not.toContain('http');
  });

  it('retains a successful v6 change and returns the failed target in a partial dual-instance result', async () => {
    const upstreamSecret = 'do-not-leak-secondary-password';
    const responses = v6Responses({
      secondary: true,
      primaryState: 'disabled',
      secondaryAuthStatus: 401,
    });
    responses['http://secondary.pihole.test/api/auth'] = {
      status: 401,
      headers: {},
      body: { error: upstreamSecret },
    };
    const host = createFakeHost({ config: v6Config(true), responses });

    const result = await setBlocking({ method: 'POST', body: { action: 'disable' } }, host);

    expect(result).toMatchObject({
      accepted: true,
      complete: false,
      blockingStatus: 'unknown',
      succeededTargets: 1,
      failedTargets: 1,
    });
    expect(result.targets).toEqual([
      {
        id: 'primary',
        name: 'Primary Pi-hole',
        succeeded: true,
        observedFinalState: 'disabled',
      },
      {
        id: 'secondary',
        name: 'Secondary Pi-hole',
        succeeded: false,
        observedFinalState: 'unknown',
        error: 'Secondary Pi-hole rejected the configured credential.',
      },
    ]);
    expect(host.auditLog).toHaveLength(2);
    expect(host.auditLog[1]).toMatchObject({
      targetId: 'secondary',
      succeeded: false,
      observedFinalState: 'unknown',
    });
    expect(JSON.stringify(result)).not.toContain(upstreamSecret);
    expect(JSON.stringify(host.auditLog)).not.toContain(upstreamSecret);
  });

  it('supports a legacy v5 enable command and confirms the observed final state', async () => {
    const host = createFakeHost({
      config: v5Config(),
      responses: {
        'https://primary.pihole.test/admin/api.php?enable=': {
          status: 200,
          headers: {},
          body: { status: 'enabled' },
        },
        'https://primary.pihole.test/admin/api.php?status=': {
          status: 200,
          headers: {},
          body: { status: 'enabled' },
        },
      },
    });

    const result = await setBlocking({ method: 'POST', body: { action: 'enable' } }, host);

    expect(result).toMatchObject({
      accepted: true,
      complete: true,
      blockingStatus: 'enabled',
      targets: [{ observedFinalState: 'enabled' }],
    });
    expect(host.httpLog.map(({ url }) => url)).toEqual([
      'https://primary.pihole.test/admin/api.php?enable=',
      'https://primary.pihole.test/admin/api.php?status=',
    ]);
    expect(host.httpLog.every(({ url }) => !url.includes('auth'))).toBe(true);
  });

  it('reports a non-confirming final state as a failed target and still audits the attempt', async () => {
    const host = createFakeHost({
      config: v5Config(),
      responses: {
        'https://primary.pihole.test/admin/api.php?disable=60': {
          status: 200,
          headers: {},
          body: { status: 'disabled' },
        },
        'https://primary.pihole.test/admin/api.php?status=': {
          status: 200,
          headers: {},
          body: { status: 'enabled' },
        },
      },
    });

    const result = await setBlocking({
      method: 'POST',
      body: { action: 'disable', durationSeconds: 60 },
    }, host);

    expect(result).toMatchObject({
      accepted: false,
      complete: false,
      blockingStatus: 'unknown',
      succeededTargets: 0,
      failedTargets: 1,
      targets: [{
        succeeded: false,
        observedFinalState: 'unknown',
        error: 'Primary Pi-hole did not confirm the requested blocking state.',
      }],
    });
    expect(host.auditLog).toEqual([expect.objectContaining({
      action: 'disable',
      durationSeconds: 60,
      targetId: 'primary',
      succeeded: false,
      observedFinalState: 'unknown',
    })]);
  });

  it('fails safely if the per-target audit annotation cannot be recorded', async () => {
    const host = createFakeHost({
      config: v6Config(),
      responses: v6Responses({ primaryState: 'enabled' }),
    });
    host.audit.annotate = async () => {
      throw new Error('database-internal-secret');
    };

    await expect(setBlocking({ method: 'POST', body: { action: 'enable' } }, host))
      .rejects.toThrow('could not record the DNS blocking outcome');
  });
});
