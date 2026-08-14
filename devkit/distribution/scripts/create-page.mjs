#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runScaffold } from './run-scaffold.mjs';

const received = process.argv.slice(2);
const args = received[0] === '--' ? received.slice(1) : received;
const target = args.find((argument) => !argument.startsWith('--'));
if (!target) throw new Error('Usage: create-page.mjs <target-dir> --id <id> [scaffold options]');
runScaffold('app', args);

const surfacesPath = resolve(target, 'ui', 'surfaces.json');
const document = JSON.parse(await readFile(surfacesPath, 'utf8'));
const surface = document.surfaces?.[0];
if (!surface) throw new Error('Generated App has no surface to convert.');
surface.kind = 'page';
delete surface.widget;
surface.page = { path: `/${surface.id}`, pinEligible: true };
surface.execution.privileges = [...new Set([...surface.execution.privileges, 'navigation'])];
await writeFile(surfacesPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
process.stdout.write(`Converted ${surface.id} to a full-page surface.\n`);
