#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['devkit', 'plugins', 'policies'];
const textExtensions = new Set(['.ts', '.js', '.json', '.md', '.mjs']);
const failures = [];

function extname(path) {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
}

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(path);
      continue;
    }
    if (!textExtensions.has(extname(path))) continue;
    const content = readFileSync(path, 'utf8');
    if (content.includes('\t')) failures.push(`${path}: contains a tab character`);
    if (content.includes('\r')) failures.push(`${path}: contains CRLF line endings`);
    if (!content.endsWith('\n')) failures.push(`${path}: missing trailing newline`);
  }
}

for (const root of roots) {
  try {
    walk(root);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
