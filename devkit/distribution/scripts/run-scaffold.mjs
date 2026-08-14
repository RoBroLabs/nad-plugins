#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export function runScaffold(kind, args) {
  const root = resolve(import.meta.dirname, '..');
  const forwarded = args[0] === '--' ? args.slice(1) : args;
  const result = spawnSync('pnpm', ['exec', 'nad', kind, 'create', ...forwarded], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
