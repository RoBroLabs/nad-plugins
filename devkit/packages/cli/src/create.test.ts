import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandCreate } from './create.js';

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nad-cli-create-test-'));
  directories.push(directory);
  return directory;
}

async function readTree(directory: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};

  async function visit(currentDirectory: string): Promise<void> {
    const names = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of names.sort((left, right) => left.name.localeCompare(right.name))) {
      const currentPath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(currentPath);
        continue;
      }
      const relativePath = relative(directory, currentPath);
      entries[relativePath] = Buffer.from(await readFile(currentPath)).toString('base64');
    }
  }

  await visit(directory);
  return entries;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('nad-module create', () => {
  it('creates a deterministic read-only scaffold with substituted values', async () => {
    const root = await tempDirectory();
    const target = join(root, 'sample-module');

    await commandCreate([
      target,
      '--id', 'dev.robrolabs.read-only',
      '--name', 'Read Only Sample',
      '--publisher', 'Robro Labs',
    ]);

    const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      id: 'dev.robrolabs.read-only',
      slug: 'read-only',
      name: 'Read Only Sample',
      publisher: 'Robro Labs',
    });

    const files = Object.keys(await readTree(target)).sort();
    expect(files).toEqual([
      'AGENTS.md',
      'LICENSE',
      'README.md',
      'assets/icon.png',
      'fixtures/config.example.json',
      'fixtures/scenarios/default.v1.json',
      'fixtures/summary-response.json',
      'manifest.json',
      'package.json',
      'schemas/config.json',
      'schemas/endpoints/summary-input.json',
      'schemas/endpoints/summary-output.json',
      'src/server.test.ts',
      'src/server.ts',
      'tsconfig.json',
      'ui/pages.json',
      'ui/widgets.json',
    ]);

    await expect(readFile(join(target, 'src', 'server.ts'), 'utf8')).resolves.toContain('dev.robrolabs.read-only');
    await expect(readFile(join(target, 'src', 'server.test.ts'), 'utf8')).resolves.toContain('Robro Labs');
    await expect(readFile(join(target, 'assets', 'icon.png'))).resolves.not.toHaveLength(0);
  });

  it('derives defaults from the module ID and stays deterministic', async () => {
    const root = await tempDirectory();
    const first = join(root, 'first-module');
    const second = join(root, 'second-module');

    await commandCreate([first, '--id', 'dev.robrolabs.read-only']);
    await commandCreate([second, '--id', 'dev.robrolabs.read-only']);

    const firstManifest = JSON.parse(await readFile(join(first, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(firstManifest).toMatchObject({
      slug: 'read-only',
      name: 'Read Only',
      publisher: 'Example Publisher',
    });

    await expect(readTree(first)).resolves.toEqual(await readTree(second));
  });

  it('rejects missing or invalid immutable module IDs', async () => {
    const root = await tempDirectory();

    await expect(commandCreate([join(root, 'missing-id')])).rejects.toThrow(/requires --id/);
    await expect(commandCreate([join(root, 'bad-id'), '--id', 'BadId'])).rejects.toThrow(/reverse-domain/);
  });

  it('rejects unsafe or non-empty targets', async () => {
    const root = await tempDirectory();
    const nonEmptyTarget = join(root, 'existing-module');
    await writeFile(nonEmptyTarget, 'occupied\n');

    await expect(commandCreate([process.cwd(), '--id', 'dev.robrolabs.safe-target'])).rejects.toThrow(/current working directory/);
    await expect(commandCreate([nonEmptyTarget, '--id', 'dev.robrolabs.safe-target'])).rejects.toThrow(/not a directory/);

    const nonEmptyDirectory = join(root, 'non-empty-directory');
    await commandCreate([nonEmptyDirectory, '--id', 'dev.robrolabs.readable-target']);
    await writeFile(join(nonEmptyDirectory, 'extra.txt'), 'extra\n');

    await expect(commandCreate([nonEmptyDirectory, '--id', 'dev.robrolabs.readable-target'])).rejects.toThrow(/non-empty/);
  });
});
