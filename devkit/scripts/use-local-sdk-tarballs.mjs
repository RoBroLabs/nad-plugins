#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [packageFileArgument, packDirectoryArgument] = process.argv.slice(2);
if (!packageFileArgument || !packDirectoryArgument) {
  throw new Error('Usage: use-local-sdk-tarballs.mjs <package.json> <pack-directory>');
}

const packageFile = resolve(packageFileArgument);
const packDirectory = resolve(packDirectoryArgument);
const document = JSON.parse(await readFile(packageFile, 'utf8'));
const files = await readdir(packDirectory);
function packed(name) {
  const matches = files.filter((file) => file.startsWith(`nad-${name}-`) && file.endsWith('.tgz'));
  if (matches.length !== 1) throw new Error(`Expected one packed @nad/${name} tarball, found ${matches.length}.`);
  return `file:${join(packDirectory, matches[0])}`;
}
const packages = { '@nad/cli': packed('cli'), '@nad/sdk': packed('sdk'), '@nad/testkit': packed('testkit') };

document.devDependencies = { ...document.devDependencies, ...packages };
document.pnpm = {
  ...(document.pnpm ?? {}),
  overrides: { ...(document.pnpm?.overrides ?? {}), ...packages },
};
await writeFile(packageFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
