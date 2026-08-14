import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { validatePackageManifestV2, validateSurfacesV2, type PackageManifestV2 } from '@nad/sdk';
import { createV2Scaffold } from './create-v2.js';

const roots: string[] = [];
afterAll(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nad-cli-v2-'));
  roots.push(root);
  return root;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

describe('nad App and Add-on scaffolds', () => {
  it('creates a schema-v2 App with named connections, operations and a sandbox surface', async () => {
    const root = await tempRoot();
    const target = join(root, 'fixture-app');
    await createV2Scaffold('app', ['create', target, '--id', 'dev.robrolabs.fixture-app', '--name', 'Fixture App']);
    const manifest = await json(join(target, 'manifest.json')) as PackageManifestV2;
    expect(validatePackageManifestV2(manifest)).toEqual({ valid: true, issues: [], warnings: [] });
    expect(validateSurfacesV2(await json(join(target, 'ui', 'surfaces.json')), manifest)).toEqual({ valid: true, issues: [], warnings: [] });
    expect(manifest).toMatchObject({ schemaVersion: 2, kind: 'app', connections: { multiple: true } });
  });

  it('creates a deterministic UI-only Add-on bound to the requested App', async () => {
    const root = await tempRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    const args = ['create', first, '--id', 'dev.robrolabs.fixture-addon', '--app', 'dev.robrolabs.fixture-app'];
    await createV2Scaffold('addon', args);
    await createV2Scaffold('addon', [
      'create', second, '--id', 'dev.robrolabs.fixture-addon', '--app', 'dev.robrolabs.fixture-app',
    ]);
    const manifest = await json(join(first, 'manifest.json')) as PackageManifestV2;
    expect(validatePackageManifestV2(manifest)).toEqual({ valid: true, issues: [], warnings: [] });
    expect(manifest).toMatchObject({
      kind: 'addon',
      capabilities: [{ name: 'apps.invoke' }],
      dependencies: [{ alias: 'app', appId: 'dev.robrolabs.fixture-app', operations: { summary: '^1.0.0' } }],
    });
    expect((await readdir(first, { recursive: true })).sort()).toEqual((await readdir(second, { recursive: true })).sort());
    expect(await readFile(join(first, 'ui', 'surfaces', 'app-summary.html')))
      .toEqual(await readFile(join(second, 'ui', 'surfaces', 'app-summary.html')));
  });

  it('requires an immutable App dependency for Add-ons', async () => {
    const root = await tempRoot();
    await expect(createV2Scaffold('addon', [
      'create', join(root, 'bad'), '--id', 'dev.robrolabs.bad-addon', '--app', 'not-an-id',
    ])).rejects.toThrow('--app');
  });
});
