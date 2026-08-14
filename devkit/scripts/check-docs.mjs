#!/usr/bin/env node
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const ignoredDirectories = new Set(['.git', '.public-export', '.release-staging', 'dist', 'node_modules']);

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

const failures = [];
for (const file of await markdownFiles(root)) {
  const source = await readFile(file, 'utf8');
  if (source.includes('ned.robrolabs.com')) failures.push(`${file}: stale ned.robrolabs.com reference`);
  const links = source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g);
  for (const match of links) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || rawTarget.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) continue;
    const target = rawTarget.split('#', 1)[0]?.replace(/^<|>$/g, '');
    if (!target) continue;
    try {
      await access(resolve(dirname(file), decodeURIComponent(target)));
    } catch {
      failures.push(`${file}: missing local link ${rawTarget}`);
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Markdown links and stale host references are current.\n');
}
