#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const customRoot = join(root, 'custom-plugins');
const entries = await readdir(customRoot, { withFileTypes: true });
let checked = 0;
for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isDirectory()) continue;
  const directory = join(customRoot, entry.name);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  for (const command of ['typecheck', 'test', 'build', 'check']) {
    if (!manifest.scripts?.[command]) continue;
    const result = spawnSync('pnpm', ['--dir', directory, 'run', command], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  checked += 1;
}
if (checked === 0) throw new Error('No custom plugin package was found. Create one before running check:all.');
process.stdout.write(`Checked ${checked} custom plugin package(s).\n`);
