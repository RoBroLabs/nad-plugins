import { describe, expect, it } from 'vitest';
import {
  validateConnectionProfileSchemaV2,
  validateHttpAccessAgainstConnectionSchemaV2,
  validatePackageManifestV2,
  validateSurfacesV2,
} from './validation-v2.js';
import type { PackageManifestV2 } from './types-v2.js';

function appManifest(): PackageManifestV2 {
  return {
    schemaVersion: 2,
    kind: 'app',
    id: 'dev.robrolabs.fixture-app',
    slug: 'fixture-app',
    name: 'Fixture App',
    description: 'Fixture schema-v2 App.',
    icon: 'plug',
    category: 'tools',
    version: '2.0.0',
    publisher: 'Robro Labs',
    compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
    capabilities: [
      { name: 'connections.current', reason: 'Read selected profile metadata.' },
      { name: 'connections.get', reason: 'Read selected profile values.' },
    ],
    permissions: [{ action: 'view', label: 'View fixture', risk: 'read' }],
    connections: { schema: 'schemas/connections.json', multiple: true, testOperation: 'summary' },
    operations: {
      summary: {
        version: '1.0.0',
        kind: 'query',
        consumers: ['self', 'addon'],
        connection: 'required',
        permission: 'view',
        handler: 'summary',
        requestSchema: 'schemas/operations/summary-input.json',
        responseSchema: 'schemas/operations/summary-output.json',
        timeoutClass: 'short',
        maxRequestBytes: 1024,
        maxResponseBytes: 8192,
      },
    },
    surfaces: 'ui/surfaces.json',
  };
}

describe('schema-v2 package validation', () => {
  it('accepts an App with versioned operations and multiple named connections', () => {
    expect(validatePackageManifestV2(appManifest())).toEqual({ valid: true, issues: [], warnings: [] });
  });

  it('rejects Add-on-owned credentials and undeclared App operations', () => {
    const addon = {
      ...appManifest(),
      kind: 'addon',
      id: 'dev.robrolabs.fixture-addon',
      slug: 'fixture-addon',
      capabilities: [] as PackageManifestV2['capabilities'],
      dependencies: [{
        alias: 'fixture',
        appId: 'dev.robrolabs.fixture-app',
        packageVersion: '>=2.0.0 <3.0.0',
        operations: { summary: '^1.0.0' },
      }],
    } as unknown as PackageManifestV2;
    expect(validatePackageManifestV2(addon).valid).toBe(false);
  });

  it('requires Add-ons to request apps.invoke explicitly', () => {
    const addon = {
      schemaVersion: 2,
      kind: 'addon',
      id: 'dev.robrolabs.fixture-addon',
      slug: 'fixture-addon',
      name: 'Fixture Add-on',
      description: 'Fixture schema-v2 Add-on.',
      icon: 'layout-panel-top',
      category: 'tools',
      version: '1.0.0',
      publisher: 'Robro Labs',
      compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
      capabilities: [] as PackageManifestV2['capabilities'],
      permissions: [{ action: 'view', label: 'View fixture', risk: 'read' }],
      dependencies: [{
        alias: 'fixture',
        appId: 'dev.robrolabs.fixture-app',
        packageVersion: '>=2.0.0 <3.0.0',
        operations: { summary: '^1.0.0' },
      }],
      surfaces: 'ui/surfaces.json',
    };
    expect(validatePackageManifestV2(addon).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'manifest.capabilities', message: expect.stringContaining('apps.invoke') }),
    ]));
    addon.capabilities.push({ name: 'apps.invoke', reason: 'Invoke declared App operations.' });
    expect(validatePackageManifestV2(addon)).toEqual({ valid: true, issues: [], warnings: [] });
  });

  it('forbids secret defaults and validates connection control types', () => {
    const connection = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      properties: {
        token: { type: 'string', title: 'Token', default: 'unsafe', 'x-nad': { control: 'secret' } },
        verify: { type: 'string', title: 'Verify', 'x-nad': { control: 'boolean' } },
      },
    };
    expect(validateConnectionProfileSchemaV2(connection).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'connectionSchema.properties.token.default', message: expect.stringContaining('must not') }),
      expect.objectContaining({ path: 'connectionSchema.properties.verify.type', message: expect.stringContaining('boolean') }),
    ]));
  });

  it('links every signed HTTP field to a compatible connection field', () => {
    const manifest = appManifest();
    manifest.capabilities.push({ name: 'http.request', reason: 'Call one signed upstream scope.' });
    manifest.httpAccess = [{
      id: 'summary', scheme: 'https', hostField: 'api_url', path: '/api/status', methods: ['GET'], effect: 'read',
      portField: 'api_port', tlsVerifyField: 'verify_ssl',
      credential: { field: 'token', location: 'header', name: 'Authorization', publicField: 'token_id' },
    }];
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema' as const,
      type: 'object' as const,
      additionalProperties: false as const,
      required: ['api_url', 'token'],
      properties: {
        api_url: { type: 'string' as const, title: 'API URL', 'x-nad': { control: 'url' as const } },
        api_port: { type: 'integer' as const, title: 'Port', 'x-nad': { control: 'number' as const } },
        verify_ssl: { type: 'boolean' as const, title: 'TLS', 'x-nad': { control: 'boolean' as const } },
        token: { type: 'string' as const, title: 'Token', 'x-nad': { control: 'secret' as const } },
        token_id: { type: 'string' as const, title: 'Token ID', 'x-nad': { control: 'text' as const } },
      },
    };
    expect(validateHttpAccessAgainstConnectionSchemaV2(manifest, schema)).toEqual({ valid: true, issues: [], warnings: [] });
    schema.properties.api_url['x-nad'].control = 'secret' as 'url';
    schema.properties.api_port.type = 'string' as 'integer';
    schema.properties.verify_ssl.type = 'string' as 'boolean';
    schema.properties.token['x-nad'].control = 'text' as 'secret';
    schema.properties.token_id['x-nad'].control = 'secret' as 'text';
    expect(validateHttpAccessAgainstConnectionSchemaV2(manifest, schema).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'manifest.httpAccess[0].hostField' }),
      expect.objectContaining({ path: 'manifest.httpAccess[0].portField' }),
      expect.objectContaining({ path: 'manifest.httpAccess[0].tlsVerifyField' }),
      expect.objectContaining({ path: 'manifest.httpAccess[0].credential.field' }),
      expect.objectContaining({ path: 'manifest.httpAccess[0].credential.publicField' }),
    ]));
  });

  it('binds surfaces only to declared permissions, operations and slots', () => {
    const surfaces = {
      schemaVersion: 2,
      surfaces: [{
        id: 'summary',
        kind: 'widget',
        name: 'Summary',
        description: 'Fixture summary.',
        entry: 'ui/surfaces/summary.html',
        bridge: '2.x',
        permissions: ['view'],
        connectionSlots: [{ slot: 'primary', target: 'self', required: true }],
        bindings: { summary: { target: 'self', operation: 'summary', connectionSlot: 'primary' } },
        widget: { defaultSize: { w: 4, h: 3 }, chrome: 'standard' },
        execution: { requestedMode: 'sandbox', privileges: ['connection-selection'] },
      }],
    };
    expect(validateSurfacesV2(surfaces, appManifest())).toEqual({ valid: true, issues: [], warnings: [] });
    const invalid = structuredClone(surfaces);
    invalid.surfaces[0]!.bindings.summary.operation = 'raw-secret';
    expect(validateSurfacesV2(invalid, appManifest()).valid).toBe(false);
  });

  it('enforces self consumers, operation permissions and connection slots on surfaces', () => {
    const manifest = appManifest();
    const surfaces = {
      schemaVersion: 2,
      surfaces: [{
        id: 'summary', kind: 'widget', name: 'Summary', description: 'Fixture summary.',
        entry: 'ui/surfaces/summary.html', bridge: '2.x', permissions: ['view'],
        connectionSlots: [{ slot: 'primary', target: 'self', required: true }],
        bindings: { summary: { target: 'self', operation: 'summary', connectionSlot: 'primary' } },
        widget: { defaultSize: { w: 4, h: 3 }, chrome: 'standard' },
        execution: { requestedMode: 'sandbox', privileges: ['connection-selection'] },
      }],
    };
    manifest.operations!.summary!.consumers = ['addon'];
    expect(validateSurfacesV2(surfaces, manifest).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('self consumer') }),
    ]));
    manifest.operations!.summary!.consumers = ['self'];
    surfaces.surfaces[0]!.permissions = [];
    delete (surfaces.surfaces[0]!.bindings.summary as { connectionSlot?: string }).connectionSlot;
    expect(validateSurfacesV2(surfaces, manifest).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('permission required') }),
      expect.objectContaining({ message: expect.stringContaining('required by the selected operation') }),
    ]));
  });
});
