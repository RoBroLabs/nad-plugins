import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { buildNadPackageV2, checkPackageDirectoryV2, verifyNadPackageV2 } from './package-v2.js';
import type { PackageManifestV2 } from './types-v2.js';

const roots: string[] = [];
afterAll(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

async function fixture(kind: 'app' | 'addon'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `nad-v2-${kind}-`));
  roots.push(directory);
  await Promise.all([
    mkdir(join(directory, 'assets'), { recursive: true }),
    mkdir(join(directory, 'ui', 'surfaces'), { recursive: true }),
    mkdir(join(directory, 'schemas', 'operations'), { recursive: true }),
    mkdir(join(directory, 'dist', 'server'), { recursive: true }),
  ]);
  await writeFile(join(directory, 'README.md'), '# Fixture\n');
  await writeFile(join(directory, 'LICENSE'), 'AGPL-3.0-only\n');
  await writeFile(join(directory, 'assets', 'icon.png'), Buffer.from([137, 80, 78, 71]));
  await writeFile(join(directory, 'ui', 'surfaces', 'summary.html'), '<!doctype html><title>Fixture</title><p>Safe sandbox surface</p>\n');

  const common = {
    schemaVersion: 2 as const,
    id: `dev.robrolabs.fixture-${kind}`,
    slug: `fixture-${kind}`,
    name: `Fixture ${kind}`,
    description: `Fixture schema-v2 ${kind}.`,
    icon: 'plug',
    category: 'tools' as const,
    version: '2.0.0',
    publisher: 'Robro Labs',
    compatibility: { core: '>=0.3.0 <1.0.0', hostApi: '2.x', uiApi: '2.x' },
    permissions: [{ action: 'view', label: 'View', risk: 'read' as const }],
    surfaces: 'ui/surfaces.json' as const,
  };
  const manifest: PackageManifestV2 = kind === 'app' ? {
    ...common,
    kind: 'app',
    capabilities: [{ name: 'connections.get', reason: 'Read selected connection values.' }],
    connections: { schema: 'schemas/connections.json', multiple: true },
    operations: {
      summary: {
        version: '1.0.0', kind: 'query', consumers: ['self', 'addon'], connection: 'required',
        permission: 'view', handler: 'summary', requestSchema: 'schemas/operations/summary-input.json',
        responseSchema: 'schemas/operations/summary-output.json', timeoutClass: 'short',
        maxRequestBytes: 1024, maxResponseBytes: 8192,
      },
    },
  } : {
    ...common,
    kind: 'addon',
    capabilities: [{ name: 'apps.invoke', reason: 'Invoke declared dependency operations through NAD core.' }],
    dependencies: [{
      alias: 'app', appId: 'dev.robrolabs.fixture-app', packageVersion: '>=2.0.0 <3.0.0', operations: { summary: '^1.0.0' },
    }],
  };
  await json(join(directory, 'manifest.json'), manifest);
  await json(join(directory, 'ui', 'surfaces.json'), {
    schemaVersion: 2,
    surfaces: [{
      id: 'summary', kind: 'widget', name: 'Summary', description: 'Fixture summary.',
      entry: 'ui/surfaces/summary.html', bridge: '2.x', permissions: ['view'],
      connectionSlots: [{ slot: 'primary', target: kind === 'app' ? 'self' : 'app', required: true }],
      bindings: { summary: { target: kind === 'app' ? 'self' : 'app', operation: 'summary', connectionSlot: 'primary' } },
      widget: { defaultSize: { w: 4, h: 3 }, chrome: 'standard' },
      execution: { requestedMode: 'sandbox', privileges: ['connection-selection'] },
    }],
  });
  if (kind === 'app') {
    await json(join(directory, 'schemas', 'connections.json'), {
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
      required: ['label'], properties: { label: { type: 'string', title: 'Label', 'x-nad': { control: 'text' } } },
    });
    await json(join(directory, 'schemas', 'operations', 'summary-input.json'), { type: 'object', additionalProperties: false });
    await json(join(directory, 'schemas', 'operations', 'summary-output.json'), { type: 'object', additionalProperties: false });
    await writeFile(join(directory, 'dist', 'server', 'main.js'), 'export async function summary() { return {}; }\n');
  }
  return directory;
}

describe('schema-v2 package lifecycle', () => {
  it('packs Apps deterministically and verifies exact signed bytes', async () => {
    const directory = await fixture('app');
    expect(await checkPackageDirectoryV2(directory)).toMatchObject({ valid: true, issues: [] });
    const firstOut = join(directory, 'first');
    const secondOut = join(directory, 'second');
    const first = await buildNadPackageV2(directory, firstOut);
    const second = await buildNadPackageV2(directory, secondOut);
    expect(await readFile(first.filePath)).toEqual(await readFile(second.filePath));
    await expect(verifyNadPackageV2(first.filePath)).resolves.toMatchObject({
      manifest: { schemaVersion: 2, kind: 'app', id: 'dev.robrolabs.fixture-app' },
      signature: { mode: 'unsigned-dev' },
    });

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = await buildNadPackageV2(directory, join(directory, 'signed'), {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      keyId: 'fixture-v2',
    });
    await expect(verifyNadPackageV2(signed.filePath, {
      trustedKeys: { 'fixture-v2': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      requireTrustedSignature: true,
    })).resolves.toMatchObject({ signatureVerified: true });
  });

  it('packs a UI-only Add-on without a server or connection schema', async () => {
    const directory = await fixture('addon');
    expect(await checkPackageDirectoryV2(directory)).toMatchObject({ valid: true, issues: [] });
    const built = await buildNadPackageV2(directory, join(directory, 'out'));
    const verified = await verifyNadPackageV2(built.filePath);
    expect(verified.entries).not.toContain('server/main.js');
    expect(verified.entries).not.toContain('schemas/connections.json');
    expect(verified.manifest).toMatchObject({ kind: 'addon', dependencies: [{ alias: 'app' }] });
  });

  it('rejects custom UI that attempts an external network resource', async () => {
    const directory = await fixture('addon');
    await writeFile(join(directory, 'ui', 'surfaces', 'summary.html'), '<script src="https://example.test/unsafe.js"></script>\n');
    expect(await checkPackageDirectoryV2(directory)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('self-contained') })]),
    });
  });
});
