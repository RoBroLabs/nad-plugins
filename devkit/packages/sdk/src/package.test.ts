import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildNadmod, createSignatureEnvelope, verifyNadmod } from './package.js';
import { contractSchemas } from './generated/v1/schemas.generated.js';
import type { ChecksumsFile, ModuleManifest } from './types.js';
import { createDeterministicZip, readZipEntries } from './zip.js';

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nad-sdk-package-test-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function writeFixtureModule(options: { releaseMetadata?: boolean; includeSourceRevision?: boolean } = {}): Promise<string> {
  const directory = await tempDirectory();
  await mkdir(join(directory, 'dist/server'), { recursive: true });
  await mkdir(join(directory, 'ui'), { recursive: true });
  await mkdir(join(directory, 'schemas/endpoints'), { recursive: true });
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'dev.robrolabs.fixture',
    slug: 'fixture',
    name: 'Fixture',
    description: 'Fixture module for package tests.',
    icon: 'box',
    category: 'tools',
    version: '1.0.0',
    publisher: 'Robro Labs',
    compatibility: { core: '>=1.0.0 <2.0.0', hostApi: '1.x', uiApi: '1.x' },
    capabilities: [{ name: 'config.get', reason: 'Read fixture config.' }],
    permissions: [{ action: 'view', label: 'View fixture', risk: 'read' }],
    configSchema: [],
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
  }, null, 2));
  await writeFile(join(directory, 'dist/server/main.js'), 'export async function summary() { return { ok: true }; }\n');
  await writeFile(join(directory, 'ui/widgets.json'), JSON.stringify({
    schemaVersion: 1,
    widgets: [{
      id: 'summary',
      name: 'Summary',
      description: 'Fixture summary.',
      defaultSize: { w: 4, h: 3 },
      source: { endpoint: 'summary' },
      body: [{ type: 'status', label: 'OK', valuePath: 'ok' }],
    }],
  }, null, 2));
  await writeFile(join(directory, 'ui/pages.json'), JSON.stringify({
    schemaVersion: 1,
    pages: [{ path: '/', title: 'Fixture', source: { endpoint: 'summary' }, body: [{ type: 'status', label: 'OK', valuePath: 'ok' }] }],
  }, null, 2));
  await writeFile(join(directory, 'schemas/config.json'), '{"type":"object","additionalProperties":false}\n');
  await writeFile(join(directory, 'schemas/endpoints/summary-input.json'), '{"type":"object","additionalProperties":false}\n');
  await writeFile(join(directory, 'schemas/endpoints/summary-output.json'), '{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}\n');
  await writeFile(join(directory, 'README.md'), '# Fixture\n');
  await writeFile(join(directory, 'LICENSE'), 'AGPL-3.0-only\n');
  await writeFile(join(directory, 'assets/icon.png'), new Uint8Array([137, 80, 78, 71]));
  if (options.releaseMetadata) {
    await writeFile(join(directory, 'release-metadata.json'), JSON.stringify({
      schemaVersion: 1,
      releasedAt: '2026-08-10',
      sourceDirectory: 'plugins/fixture',
      license: 'AGPL-3.0-only',
      repositoryUrl: 'https://github.com/example/nad-plugins',
      sourceUrl: 'https://github.com/example/nad-plugins/tree/fixture-v1.0.0/plugins/fixture',
      sourceTag: 'fixture-v1.0.0',
      ...(options.includeSourceRevision ? { sourceRevision: '9c0ffee' } : {}),
      changelog: {
        summary: 'Adds release metadata generation to the fixture package.',
        entries: [
          'Emit a provider-neutral release record next to the package artifact.',
          'Record trusted-signature and package-verification conformance output.',
        ],
      },
      hotUpdate: {
        compatibility: 'compatible',
        preserves: ['module id', 'slug', 'permission action view'],
      },
    }, null, 2));
  }
  return directory;
}

describe('NAD package verification', () => {
  it('uses the core-compatible canonical signature envelope', () => {
    const manifest = { id: 'dev.robrolabs.fixture', version: '1.2.3' } as ModuleManifest;
    const checksums: ChecksumsFile = {
      schemaVersion: 1,
      algorithm: 'sha256',
      files: {
        'z.txt': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'a.txt': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    };
    const canonicalExample = contractSchemas['signature-envelope.schema.json'].examples[0];

    expect(createSignatureEnvelope(manifest, checksums).toString('utf8')).toBe(JSON.stringify(canonicalExample));
  });

  it('packs identical source bytes deterministically', async () => {
    const firstOut = await tempDirectory();
    const secondOut = await tempDirectory();
    const moduleDir = await writeFixtureModule();

    const first = await buildNadmod(moduleDir, firstOut);
    const second = await buildNadmod(moduleDir, secondOut);

    expect(first.sha256).toBe(second.sha256);
    expect(await readFile(first.filePath)).toEqual(await readFile(second.filePath));
  });

  it('verifies a package built from a module directory', async () => {
    const outDir = await tempDirectory();
    const moduleDir = await writeFixtureModule();
    const result = await buildNadmod(moduleDir, outDir);
    await expect(verifyNadmod(result.filePath)).resolves.toMatchObject({
      manifest: { id: 'dev.robrolabs.fixture', slug: 'fixture' },
      signature: { mode: 'unsigned-dev' },
    });
  });

  it('rejects a package with a tampered checksummed file', async () => {
    const outDir = await tempDirectory();
    const moduleDir = await writeFixtureModule();
    const result = await buildNadmod(moduleDir, outDir);
    const entries = readZipEntries(await import('node:fs/promises').then((fs) => fs.readFile(result.filePath)))
      .map((entry) => entry.path === 'README.md'
        ? { ...entry, data: new TextEncoder().encode('tampered\n') }
        : entry);
    const tamperedPath = join(outDir, 'tampered.nadmod');
    await writeFile(tamperedPath, createDeterministicZip(entries));

    await expect(verifyNadmod(tamperedPath)).rejects.toThrow(/checksum mismatch/);
  });

  it('cryptographically verifies a signed package against its trusted key', async () => {
    const outDir = await tempDirectory();
    const moduleDir = await writeFixtureModule();
    const signingPair = generateKeyPairSync('ed25519');
    const privateKeyPem = signingPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = signingPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const result = await buildNadmod(moduleDir, outDir, { privateKeyPem, keyId: 'fixture-release' });

    await expect(verifyNadmod(result.filePath, {
      trustedKeys: { 'fixture-release': publicKeyPem },
      requireTrustedSignature: true,
    })).resolves.toMatchObject({
      signature: { mode: 'signed', keyId: 'fixture-release' },
      signatureVerified: true,
      warnings: [],
    });

    const wrongPair = generateKeyPairSync('ed25519');
    const wrongPublicKeyPem = wrongPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await expect(verifyNadmod(result.filePath, {
      trustedKeys: { 'fixture-release': wrongPublicKeyPem },
      requireTrustedSignature: true,
    })).rejects.toThrow('Signature verification failed');
  });

  it('verifies schema-v1 packages signed with the legacy envelope', async () => {
    const outDir = await tempDirectory();
    const moduleDir = await writeFixtureModule();
    const signingPair = generateKeyPairSync('ed25519');
    const privateKeyPem = signingPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = signingPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const result = await buildNadmod(moduleDir, outDir, { privateKeyPem, keyId: 'legacy-release' });
    const entries = readZipEntries(await readFile(result.filePath));
    const manifestValue = JSON.parse(new TextDecoder().decode(
      entries.find(({ path }) => path === 'manifest.json')!.data,
    )) as ModuleManifest;
    const checksums = JSON.parse(new TextDecoder().decode(
      entries.find(({ path }) => path === 'checksums.json')!.data,
    )) as ChecksumsFile;
    const signatureFile = JSON.parse(new TextDecoder().decode(
      entries.find(({ path }) => path === 'signature.json')!.data,
    )) as { signature: string };
    const files = Object.fromEntries(Object.entries(checksums.files).sort(([left], [right]) => left.localeCompare(right)));
    signatureFile.signature = sign(
      null,
      Buffer.from(JSON.stringify({ id: manifestValue.id, version: manifestValue.version, files }), 'utf8'),
      signingPair.privateKey,
    ).toString('base64');
    const legacyPath = join(outDir, 'legacy-v1.nadmod');
    await writeFile(legacyPath, createDeterministicZip(entries.map((entry) => entry.path === 'signature.json'
      ? { ...entry, data: new TextEncoder().encode(`${JSON.stringify(signatureFile, null, 2)}\n`) }
      : entry)));

    await expect(verifyNadmod(legacyPath, {
      trustedKeys: { 'legacy-release': publicKeyPem },
      requireTrustedSignature: true,
    })).resolves.toMatchObject({ signatureVerified: true });
  });

  it('emits a provider-neutral release record for a signed release build', async () => {
    const outDir = await tempDirectory();
    const moduleDir = await writeFixtureModule({ releaseMetadata: true });
    const signingPair = generateKeyPairSync('ed25519');
    const privateKeyPem = signingPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const result = await buildNadmod(moduleDir, outDir, {
      privateKeyPem,
      keyId: 'fixture-release',
      generateReleaseRecord: true,
      sourceRevision: '9c0ffee',
    });

    expect(result.releaseRecordPath).toBe(join(outDir, 'fixture-1.0.0.release.json'));
    expect(result.releaseRecord).toMatchObject({
      module: {
        id: 'dev.robrolabs.fixture',
        slug: 'fixture',
        version: '1.0.0',
      },
      provenance: {
        releasedAt: '2026-08-10',
        sourceRevision: '9c0ffee',
        sourceDirectory: 'plugins/fixture',
        license: 'AGPL-3.0-only',
        repositoryUrl: 'https://github.com/example/nad-plugins',
        sourceUrl: 'https://github.com/example/nad-plugins/tree/fixture-v1.0.0/plugins/fixture',
        sourceTag: 'fixture-v1.0.0',
      },
      manifest: {
        compatibility: { core: '>=1.0.0 <2.0.0', hostApi: '1.x', uiApi: '1.x' },
        capabilities: [{ name: 'config.get', reason: 'Read fixture config.' }],
        permissions: [{ action: 'view', label: 'View fixture', risk: 'read' }],
      },
      changelog: {
        entries: expect.arrayContaining(['Emit a provider-neutral release record next to the package artifact.']),
      },
      signature: {
        mode: 'signed',
        keyId: 'fixture-release',
        verified: true,
        warnings: [],
      },
      conformance: {
        checks: expect.arrayContaining([
          expect.objectContaining({ name: 'module-contract', passed: true }),
          expect.objectContaining({ name: 'package-verification', passed: true }),
          expect.objectContaining({ name: 'trusted-signature', passed: true }),
        ]),
      },
    });
    expect(result.releaseRecord?.artifact.fileName).toBe('fixture-1.0.0.nadmod');
    expect(result.releaseRecord?.artifact.entries).toContain('signature.json');
  });

  it('fails release-record generation when sourceRevision is not supplied', async () => {
    const outDir = await tempDirectory();
    const moduleDir = await writeFixtureModule({ releaseMetadata: true });

    await expect(buildNadmod(moduleDir, outDir, {
      generateReleaseRecord: true,
    })).rejects.toThrow('sourceRevision is required to generate a release record');
  });
});
