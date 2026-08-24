#!/usr/bin/env node
// Verifies a packed official release without pinning its version or signer.
//
// Both were hardcoded before, so the command drifted out of date the moment a
// plugin was released: it looked for the previous version's file and checked it
// against a superseded trust key.
//
// Usage: verify-official-release.mjs <slug> [--trusted-key <pem> --key-id <id>]

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const [slug, ...passthrough] = process.argv.slice(2);
if (!slug) throw new Error('Usage: verify-official-release.mjs <slug> [verifier flags]');

const manifest = require(resolve(`plugins/official/${slug}/manifest.json`));
const artifact = `dist/${slug}-${manifest.version}.nadmod`;
process.stdout.write(`Verifying ${artifact} (manifest version ${manifest.version})\n`);
execFileSync('node', ['devkit/packages/cli/dist/index.js', 'verify', artifact, ...passthrough], { stdio: 'inherit' });
