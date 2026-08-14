import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandChangelog } from './changelog.js';

function manifest(version = '0.1.0'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'dev.example.clean-room',
    slug: 'clean-room',
    name: 'Clean Room',
    description: 'A clean-room test Module.',
    icon: 'activity',
    category: 'monitoring',
    version,
    publisher: 'Example',
    compatibility: { core: '>=0.2.4 <1.0.0', hostApi: '^1.0.0', uiApi: '^1.0.0' },
    capabilities: [{ name: 'config.get', reason: 'Reads its display text.' }],
    permissions: [{ action: 'view', label: 'View', risk: 'read' }],
    configSchema: [],
    entrypoints: {
      summary: {
        method: 'GET', kind: 'query', permission: 'view', handler: 'summary',
        requestSchema: 'schemas/endpoints/summary-input.json',
        responseSchema: 'schemas/endpoints/summary-output.json',
        timeoutClass: 'short', maxRequestBytes: 0, maxResponseBytes: 4096,
      },
    },
  };
}

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('nad-module changelog', () => {
  it('writes canonical release metadata and a repeatable version section', async () => {
    const moduleDir = await mkdtemp(join(tmpdir(), 'nad-changelog-test-'));
    directories.push(moduleDir);
    await writeFile(join(moduleDir, 'manifest.json'), JSON.stringify(manifest()));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const args = [
      moduleDir,
      '--summary', 'Initial clean-room release.',
      '--entry', 'Adds the read-only summary.',
      '--entry', 'Adds deterministic fixtures.',
      '--preserve', 'module id',
      '--preserve', 'configuration keys',
      '--released-at', '2026-08-11',
      '--source-directory', 'plugins/clean-room',
    ];
    await commandChangelog(args);
    await commandChangelog(args);

    expect(JSON.parse(await readFile(join(moduleDir, 'release-metadata.json'), 'utf8'))).toMatchObject({
      schemaVersion: 1,
      releasedAt: '2026-08-11',
      sourceDirectory: 'plugins/clean-room',
      changelog: { entries: ['Adds the read-only summary.', 'Adds deterministic fixtures.'] },
      hotUpdate: { compatibility: 'compatible', preserves: ['module id', 'configuration keys'] },
    });
    const changelog = await readFile(join(moduleDir, 'CHANGELOG.md'), 'utf8');
    expect(changelog.match(/^## 0\.1\.0/gm)).toHaveLength(1);
  });

  it('requires explicit compatibility preservation claims', async () => {
    const moduleDir = await mkdtemp(join(tmpdir(), 'nad-changelog-test-'));
    directories.push(moduleDir);
    await writeFile(join(moduleDir, 'manifest.json'), JSON.stringify(manifest()));
    await expect(commandChangelog([
      moduleDir,
      '--summary', 'Summary',
      '--entry', 'Entry',
    ])).rejects.toThrow('--preserve');
  });
});
