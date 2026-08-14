import { describe, expect, it } from 'vitest';
import { validateManifest } from './validation.js';

function manifestFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'dev.robrolabs.fixture',
    slug: 'fixture',
    name: 'Fixture',
    description: 'Fixture module for manifest validation.',
    icon: 'box',
    category: 'tools',
    version: '1.0.0',
    publisher: 'Robro Labs',
    compatibility: { core: '>=0.2.1 <1.0.0', hostApi: '1.x', uiApi: '1.x' },
    capabilities: [
      { name: 'config.get', reason: 'Read configured destinations.' },
      { name: 'http.request', reason: 'Fetch exact brokered endpoints.' },
    ],
    httpAccess: [
      {
        scheme: 'https',
        hostConfig: 'hosts',
        portConfig: 'api_port',
        path: '/metrics',
        methods: ['GET'],
      },
      {
        scheme: 'http',
        hostConfig: 'hosts',
        port: 80,
        path: '/',
        methods: ['GET'],
      },
    ],
    permissions: [{ action: 'view', label: 'View fixture', risk: 'read' }],
    configSchema: [
      { key: 'hosts', label: 'Hosts', type: 'text', required: true },
      { key: 'api_port', label: 'API port', type: 'number', required: true },
    ],
    entrypoints: {
      summary: {
        method: 'GET',
        kind: 'query',
        permission: 'view',
        handler: 'summary',
        requestSchema: 'schemas/endpoints/summary-input.json',
        responseSchema: 'schemas/endpoints/summary-output.json',
        timeoutClass: 'short',
        maxRequestBytes: 1024,
        maxResponseBytes: 1024,
      },
    },
  };
}

function expectIssue(value: unknown, path: string, message: string): void {
  const result = validateManifest(value);
  expect(result.valid).toBe(false);
  expect(result.issues).toContainEqual({ path, message });
}

describe('httpAccess manifest validation', () => {
  it('accepts exact endpoint scopes using fixed and configured ports', () => {
    expect(validateManifest(manifestFixture())).toMatchObject({ valid: true, issues: [] });
  });

  it('requires scopes for http.request and forbids them without the capability', () => {
    const missing = manifestFixture();
    delete missing.httpAccess;
    expectIssue(
      missing,
      'manifest.httpAccess',
      'must be an array when the http.request capability is declared',
    );

    const empty = manifestFixture();
    empty.httpAccess = [];
    expectIssue(
      empty,
      'manifest.httpAccess',
      'must declare at least one scope for the http.request capability',
    );

    const forbidden = manifestFixture();
    forbidden.capabilities = [{ name: 'config.get', reason: 'Read config.' }];
    expectIssue(
      forbidden,
      'manifest.httpAccess',
      'must be omitted unless the http.request capability is declared',
    );
  });

  it('requires host and port config references with the intended field types', () => {
    const invalid = manifestFixture();
    invalid.configSchema = [
      { key: 'hosts', label: 'Hosts', type: 'secret', required: true },
      { key: 'api_port', label: 'API port', type: 'text', required: true },
    ];

    const result = validateManifest(invalid);
    expect(result.issues).toEqual(expect.arrayContaining([
      {
        path: 'manifest.httpAccess[0].hostConfig',
        message: 'must reference a non-secret text or URL config field',
      },
      {
        path: 'manifest.httpAccess[0].portConfig',
        message: 'must reference a number config field',
      },
    ]));

    const missing = manifestFixture();
    missing.httpAccess = [{
      scheme: 'https',
      hostConfig: 'missing_hosts',
      portConfig: 'missing_port',
      path: '/metrics',
      methods: ['GET'],
    }];
    expect(validateManifest(missing).issues).toEqual(expect.arrayContaining([
      {
        path: 'manifest.httpAccess[0].hostConfig',
        message: 'must reference a declared config field',
      },
      {
        path: 'manifest.httpAccess[0].portConfig',
        message: 'must reference a declared config field',
      },
    ]));
  });

  it('uses exactly one explicit port source unless a URL field supplies it', () => {
    const invalid = manifestFixture();
    invalid.httpAccess = [
      {
        scheme: 'http',
        hostConfig: 'hosts',
        port: 80,
        portConfig: 'api_port',
        path: '/',
        methods: ['GET'],
      },
      {
        scheme: 'http',
        hostConfig: 'hosts',
        path: '/metrics',
        methods: ['GET'],
      },
      {
        scheme: 'http',
        hostConfig: 'hosts',
        port: 65_536,
        path: '/health',
        methods: ['GET'],
      },
    ];

    const result = validateManifest(invalid);
    expect(result.issues).toEqual(expect.arrayContaining([
      { path: 'manifest.httpAccess[0]', message: 'must not declare both port and portConfig' },
      { path: 'manifest.httpAccess[1]', message: 'may derive the port only when hostConfig references a URL field' },
      { path: 'manifest.httpAccess[2].port', message: 'must be between 1 and 65535' },
    ]));

    const urlDerived = manifestFixture();
    urlDerived.configSchema = [
      { key: 'api_url', label: 'API URL', type: 'url', required: true },
      { key: 'api_port', label: 'API port', type: 'number', required: true },
    ];
    urlDerived.httpAccess = [{
      scheme: 'https',
      hostConfig: 'api_url',
      path: '/api2/json/nodes',
      methods: ['GET'],
    }];
    expect(validateManifest(urlDerived)).toMatchObject({ valid: true, issues: [] });
  });

  it('validates secret injection, signed read effects, query keys, and path placeholders', () => {
    const valid = manifestFixture();
    valid.configSchema = [
      { key: 'api_url', label: 'API URL', type: 'url', required: true },
      { key: 'token_id', label: 'Token ID', type: 'text', required: true },
      { key: 'token_secret', label: 'Token secret', type: 'secret', required: true },
      { key: 'verify_ssl', label: 'Verify TLS', type: 'boolean', required: false, defaultValue: true },
    ];
    valid.httpAccess = [{
      scheme: 'https',
      hostConfig: 'api_url',
      path: '/api2/json/nodes/{node}/qemu/{vmid}/status/start',
      methods: ['POST'],
      effect: 'write',
      queryParameters: ['wait'],
      pathParameters: { node: 'segment', vmid: 'integer' },
      credential: {
        config: 'token_secret',
        location: 'header',
        name: 'Authorization',
        prefix: 'PVEAPIToken=',
        publicConfig: 'token_id',
        separator: '=',
      },
      tlsVerifyConfig: 'verify_ssl',
    }];
    expect(validateManifest(valid)).toMatchObject({ valid: true, issues: [] });

    const invalid = structuredClone(valid);
    invalid.httpAccess = [{
      ...(invalid.httpAccess as Array<Record<string, unknown>>)[0],
      effect: 'read',
      pathParameters: { unused: 'segment' },
      credential: { config: 'token_id', location: 'header', name: 'Authorization' },
      tlsVerifyConfig: 'token_id',
    }];
    expect(validateManifest(invalid).issues).toEqual(expect.arrayContaining([
      { path: 'manifest.httpAccess[0].pathParameters', message: 'must declare {node}' },
      { path: 'manifest.httpAccess[0].pathParameters', message: 'must declare {vmid}' },
      { path: 'manifest.httpAccess[0].pathParameters.unused', message: 'is not used by path' },
      { path: 'manifest.httpAccess[0].credential.config', message: 'must reference a secret config field' },
      { path: 'manifest.httpAccess[0].tlsVerifyConfig', message: 'must reference a boolean config field' },
    ]));
  });

  it('requires an enforceable body policy for read-effect POST and DELETE scopes', () => {
    const graphql = manifestFixture();
    graphql.configSchema = [
      { key: 'host', label: 'Host', type: 'text', required: true },
      { key: 'api_key', label: 'API key', type: 'secret', required: true },
    ];
    graphql.httpAccess = [{
      scheme: 'https',
      hostConfig: 'host',
      port: 443,
      path: '/graphql',
      methods: ['POST'],
      effect: 'read',
      requestBodyPolicy: 'graphql-query',
      credential: { config: 'api_key', location: 'header', name: 'x-api-key' },
    }];
    expect(validateManifest(graphql)).toMatchObject({ valid: true, issues: [] });

    const missing = structuredClone(graphql);
    delete (missing.httpAccess as Array<Record<string, unknown>>)[0]?.requestBodyPolicy;
    expectIssue(
      missing,
      'manifest.httpAccess[0].requestBodyPolicy',
      'read-effect POST scopes require graphql-query or credential-only',
    );

    const cleanup = structuredClone(graphql);
    cleanup.httpAccess = [{
      scheme: 'https', hostConfig: 'host', port: 443, path: '/api/auth', methods: ['DELETE'], effect: 'read',
    }];
    expectIssue(
      cleanup,
      'manifest.httpAccess[0].requestBodyPolicy',
      'read-effect DELETE scopes require session-cleanup',
    );
  });

  it('keeps transport, forwarding, cookies, and authentication headers broker-controlled', () => {
    const invalid = manifestFixture();
    invalid.configSchema = [
      { key: 'hosts', label: 'Hosts', type: 'text', required: true },
      { key: 'api_key', label: 'API key', type: 'secret', required: true },
    ];
    invalid.httpAccess = [{
      scheme: 'https',
      hostConfig: 'hosts',
      port: 443,
      path: '/api',
      methods: ['GET'],
      allowedHeaders: ['Authorization', 'X-Forwarded-For'],
      credential: { config: 'api_key', location: 'header', name: 'Host' },
    }];

    expect(validateManifest(invalid).issues).toEqual(expect.arrayContaining([
      { path: 'manifest.httpAccess[0].allowedHeaders[0]', message: 'is a broker-controlled or unsafe header' },
      { path: 'manifest.httpAccess[0].allowedHeaders[1]', message: 'is a broker-controlled or unsafe header' },
      { path: 'manifest.httpAccess[0].credential.name', message: 'is a broker-controlled or unsafe header' },
    ]));
  });

  it('rejects non-exact paths and empty or repeated methods', () => {
    const invalid = manifestFixture();
    invalid.httpAccess = [
      {
        scheme: 'https',
        hostConfig: 'hosts',
        port: 443,
        path: 'metrics?full=true#cpu',
        methods: [],
      },
      {
        scheme: 'https',
        hostConfig: 'hosts',
        port: 443,
        path: '/metrics',
        methods: ['GET', 'GET'],
      },
    ];

    const result = validateManifest(invalid);
    expect(result.issues).toEqual(expect.arrayContaining([
      { path: 'manifest.httpAccess[0].path', message: 'must begin with /' },
      { path: 'manifest.httpAccess[0].path', message: 'must not contain a query string or fragment' },
      { path: 'manifest.httpAccess[0].methods', message: 'must be a non-empty array' },
      { path: 'manifest.httpAccess[1].methods[1]', message: 'must be unique within the scope' },
    ]));
  });

  it('bounds scopes and detects duplicates regardless of method order', () => {
    const tooMany = manifestFixture();
    tooMany.httpAccess = Array.from({ length: 33 }, (_, index) => ({
      scheme: 'http',
      hostConfig: 'hosts',
      port: 80,
      path: `/endpoint/${index}`,
      methods: ['GET'],
    }));
    expectIssue(tooMany, 'manifest.httpAccess', 'must declare no more than 32 scopes');

    const duplicate = manifestFixture();
    duplicate.httpAccess = [
      {
        scheme: 'https',
        hostConfig: 'hosts',
        port: 443,
        path: '/resource',
        methods: ['GET', 'POST'],
      },
      {
        scheme: 'https',
        hostConfig: 'hosts',
        port: 443,
        path: '/resource',
        methods: ['POST', 'GET'],
      },
    ];
    expectIssue(duplicate, 'manifest.httpAccess[1]', 'must be unique');
  });
});

describe('canonical manifest behavior', () => {
  it('rejects GET mutations and requires their audit action', () => {
    const invalid = manifestFixture();
    invalid.entrypoints = {
      mutate: {
        method: 'GET',
        kind: 'mutation',
        permission: 'view',
        handler: 'mutate',
        requestSchema: 'schemas/endpoints/summary-input.json',
        responseSchema: 'schemas/endpoints/summary-output.json',
        timeoutClass: 'action',
        maxRequestBytes: 1024,
        maxResponseBytes: 1024,
      },
    };

    expect(validateManifest(invalid).issues).toEqual(expect.arrayContaining([
      { path: 'manifest.entrypoints.mutate.method', message: 'mutations must not use GET' },
      { path: 'manifest.entrypoints.mutate.auditAction', message: 'is required for mutations' },
    ]));
  });

  it('accepts bounded declarative config and storage migrations', () => {
    const manifest = manifestFixture();
    manifest.dataMigrations = [{
      fromVersion: '0.9.0',
      toVersion: '1.0.0',
      config: [
        { op: 'rename', from: 'old_hosts', to: 'hosts' },
        { op: 'setDefault', key: 'api_port', value: 443 },
      ],
      storage: [
        { op: 'rename', from: 'lastCheck', to: 'last-check' },
        { op: 'setDefault', key: 'attempts', value: 0 },
        { op: 'delete', key: 'legacy' },
      ],
    }];

    expect(validateManifest(manifest)).toMatchObject({ valid: true, issues: [] });
  });

  it('rejects migration routes that cannot safely produce the new manifest state', () => {
    const manifest = manifestFixture();
    manifest.configSchema = [
      ...(manifest.configSchema as unknown[]),
      { key: 'api_secret', label: 'API secret', type: 'secret', required: false },
    ];
    manifest.dataMigrations = [{
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      config: [
        { op: 'rename', from: 'hosts', to: 'missing' },
        { op: 'setDefault', key: 'api_secret', value: 'must-not-embed' },
      ],
    }];

    expect(validateManifest(manifest).issues).toEqual(expect.arrayContaining([
      { path: 'manifest.dataMigrations[0].toVersion', message: 'must equal manifest.version' },
      { path: 'manifest.dataMigrations[0].config[0].to', message: 'must reference a field in the new config schema' },
      { path: 'manifest.dataMigrations[0].config[1]', message: 'must not embed a secret default' },
    ]));
  });
});
