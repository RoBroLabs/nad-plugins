import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDevPreviewV2 } from './dev-v2.js';

const directories: string[] = [];

async function fixturePackage(kind: 'app' | 'addon'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `nad-v2-preview-${kind}-`));
  directories.push(directory);
  await mkdir(join(directory, 'ui', 'surfaces'), { recursive: true });
  await mkdir(join(directory, 'fixtures', 'scenarios'), { recursive: true });
  await mkdir(join(directory, 'dist', 'server'), { recursive: true });
  const isApp = kind === 'app';
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 2,
    kind,
    id: `dev.robrolabs.preview-${kind}`,
    slug: `preview-${kind}`,
    name: `Preview ${kind}`,
    description: 'Fixture-only preview.',
    icon: 'plug',
    category: 'tools',
    version: '0.1.0',
    publisher: 'Robro Labs',
    compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
    capabilities: [{ name: isApp ? 'connections.current' : 'apps.invoke', reason: 'Preview fixture.' }],
    permissions: [{ action: 'view', label: 'View', risk: 'read', description: 'View preview.' }],
    ...(isApp ? {
      connections: { schema: 'schemas/connections.json', multiple: true },
      operations: {
        summary: {
          version: '1.0.0', kind: 'query', consumers: ['self', 'addon'], connection: 'required', permission: 'view',
          handler: 'summary', requestSchema: 'schemas/operations/summary-input.json', responseSchema: 'schemas/operations/summary-output.json',
          timeoutClass: 'short', maxRequestBytes: 1024, maxResponseBytes: 1024,
        },
      },
    } : {
      dependencies: [{ alias: 'app', appId: 'dev.robrolabs.preview-app', packageVersion: '0.1.0', operations: { summary: '^1.0.0' } }],
    }),
    surfaces: 'ui/surfaces.json',
  }, null, 2));
  await writeFile(join(directory, 'ui', 'surfaces.json'), JSON.stringify({
    schemaVersion: 2,
    surfaces: [{
      id: 'summary', kind: 'widget', name: 'Summary', description: 'Preview.', entry: 'ui/surfaces/summary.html', bridge: '2.x', permissions: ['view'],
      connectionSlots: [{ slot: 'primary', target: isApp ? 'self' : 'app', required: true }],
      bindings: { summary: { target: isApp ? 'self' : 'app', operation: 'summary', connectionSlot: 'primary' } },
      widget: { defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 2 }, maxSize: { w: 8, h: 6 }, chrome: 'standard' },
      execution: { requestedMode: 'sandbox', privileges: [] },
    }],
  }, null, 2));
  await writeFile(join(directory, 'ui', 'surfaces', 'summary.html'), '<!doctype html><title>Preview</title>\n');
  await writeFile(join(directory, 'fixtures', 'scenarios', 'default.v2.json'), JSON.stringify({
    schemaVersion: 2, name: 'Default', profiles: [{ id: 'fixture_profile_0001', name: 'Lab', values: { headline: 'Healthy' } }],
    selectedProfileId: 'fixture_profile_0001', roles: { viewer: { grants: ['view'] }, denied: { grants: [] } }, defaultRole: 'viewer',
    ...(!isApp ? { appOperations: { 'app.summary': { headline: 'Healthy' } } } : {}),
  }, null, 2));
  if (isApp) {
    await mkdir(join(directory, 'schemas', 'operations'), { recursive: true });
    await writeFile(join(directory, 'schemas', 'connections.json'), '{"type":"object","additionalProperties":false,"properties":{"headline":{"type":"string"}}}\n');
    await writeFile(join(directory, 'schemas', 'operations', 'summary-input.json'), '{"type":"object","additionalProperties":false}\n');
    await writeFile(join(directory, 'schemas', 'operations', 'summary-output.json'), '{"type":"object","additionalProperties":true}\n');
    await writeFile(join(directory, 'dist', 'server', 'server.js'), 'export async function summary(_request, host) { return { headline: await host.connections.get("headline") }; }\n');
  }
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) => {
    await (await import('node:fs/promises')).rm(directory, { recursive: true, force: true });
  }));
});

describe('schema-v2 fixture preview', () => {
  it('runs an App operation with its selected named profile and denies a missing grant', async () => {
    const directory = await fixturePackage('app');
    await expect(runDevPreviewV2({ packageDir: directory })).resolves.toMatchObject({
      profile: { id: 'fixture_profile_0001', name: 'Lab' },
      operations: { summary: { status: 'ok', response: { headline: 'Healthy' } } },
    });
    await expect(runDevPreviewV2({ packageDir: directory, role: 'denied' })).resolves.toMatchObject({
      operations: { summary: { status: 'denied', error: 'SURFACE_ACCESS_DENIED' } },
    });
  });

  it('checks an Add-on binding through the declared App fixture only', async () => {
    const directory = await fixturePackage('addon');
    await expect(runDevPreviewV2({ packageDir: directory })).resolves.toMatchObject({
      package: { kind: 'addon' },
      operations: { 'summary.summary': { status: 'ok', response: { headline: 'Healthy' } } },
    });
  });
});
