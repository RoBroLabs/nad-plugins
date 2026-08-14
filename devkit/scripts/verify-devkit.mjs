#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readZipEntries } from '../packages/sdk/dist/zip.js';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const repositoryPackage = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
const archiveArgument = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : resolve(repositoryRoot, 'dist', `NAD-Plugin-Devkit-${repositoryPackage.version}.zip`);
const bytes = await readFile(resolve(archiveArgument));
const entries = readZipEntries(bytes);
const roots = new Set(entries.map((entry) => entry.path.split('/')[0]));
if (roots.size !== 1) throw new Error('Devkit ZIP must have exactly one top-level directory.');
const root = [...roots][0];
if (!root?.startsWith('NAD-Plugin-Devkit-')) throw new Error('Unexpected Devkit root directory.');

const forbidden = [
  /(^|\/)plugins\/official\//,
  /(^|\/)plugins\/community\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)keys?\//i,
  /\.nadmod$/,
  /\.map$/,
  /\.test\.(js|d\.ts)$/,
  /\.tsbuildinfo$/,
  /(^|\/)\.env(?:\.|$)/,
];
for (const entry of entries) {
  if (forbidden.some((pattern) => pattern.test(entry.path))) {
    throw new Error(`Forbidden Devkit entry: ${entry.path}`);
  }
}

const byRelativePath = new Map(entries.map((entry) => [entry.path.slice(root.length + 1), entry.data]));
for (const path of ['README-FIRST.md', 'AGENTS.md', 'LICENSE', 'SECURITY.md', 'VERSION', 'devkit-manifest.json', 'SHA256SUMS', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'custom-plugins/README.md', 'scripts/setup.mjs', 'scripts/create-app.mjs', 'scripts/create-addon.mjs', 'scripts/create-widget.mjs', 'scripts/check-all.mjs']) {
  if (!byRelativePath.has(path)) throw new Error(`Required Devkit entry is missing: ${path}`);
}
for (const packageName of ['sdk', 'testkit', 'cli']) {
  if (![...byRelativePath].some(([path]) => new RegExp(`^tooling/nad-${packageName}-[0-9].*\\.tgz$`).test(path))) {
    throw new Error(`Devkit @nad/${packageName} tarball is missing.`);
  }
}

const sums = new TextDecoder().decode(byRelativePath.get('SHA256SUMS')).trim().split('\n');
for (const line of sums) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error(`Malformed SHA256SUMS line: ${line}`);
  const data = byRelativePath.get(match[2]);
  if (!data) throw new Error(`SHA256SUMS references missing file: ${match[2]}`);
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== match[1]) throw new Error(`SHA-256 mismatch for ${match[2]}`);
}

const extractIndex = process.argv.indexOf('--extract');
if (extractIndex !== -1) {
  const destinationArgument = process.argv[extractIndex + 1];
  if (!destinationArgument) throw new Error('--extract requires an empty destination directory.');
  const destination = resolve(destinationArgument);
  for (const entry of entries) {
    const output = resolve(destination, entry.path);
    if (!output.startsWith(`${destination}/`)) throw new Error(`Unsafe extraction path: ${entry.path}`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, entry.data);
  }
}
process.stdout.write(`Verified ${entries.length} Devkit entries under ${root}.\n`);
