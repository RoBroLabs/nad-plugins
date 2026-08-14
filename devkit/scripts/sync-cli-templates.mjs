#!/usr/bin/env node
import { cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const source = resolve(repositoryRoot, 'devkit', 'templates');
const destination = resolve(repositoryRoot, 'devkit', 'packages', 'cli', 'templates');

await rm(destination, { recursive: true, force: true });
if (!process.argv.includes('--clean')) {
  await cp(source, destination, { recursive: true, force: true });
}
