#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createDeterministicZip } from '../packages/sdk/dist/zip.js';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
const version = rootPackage.version;
const authoringV2SchemaNames = [
  'connection-schema.v2.schema.json',
  'host-call.v2.schema.json',
  'host-response.v2.schema.json',
  'http-access.v2.schema.json',
  'invocation-request.v2.schema.json',
  'manifest.v2.schema.json',
  'operation.v2.schema.json',
  'release-record.v2.schema.json',
  'ui-bridge-connect.v2.schema.json',
  'ui-bridge-message.v2.schema.json',
  'ui-surfaces.v2.schema.json',
];
const archiveRootName = `NAD-Plugin-Devkit-${version}`;
const stagingParent = join(repositoryRoot, '.release-staging', 'devkit');
const stagingRoot = join(stagingParent, archiveRootName);
const outputDirectory = join(repositoryRoot, 'dist');
const outputPath = join(outputDirectory, `${archiveRootName}.zip`);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function copyPath(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter(path) {
      const name = basename(path);
      return !['node_modules', 'dist', '.DS_Store'].includes(name)
        && !name.endsWith('.tsbuildinfo')
        && !name.endsWith('.map')
        && !name.endsWith('.nadmod');
    },
  });
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function stageAuthoringPackage(name) {
  const sourceRoot = join(repositoryRoot, 'devkit', 'packages', name);
  const packageRoot = join(stagingParent, '.npm', name);
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(join(packageRoot, 'dist'), { recursive: true });
  const distRoot = join(sourceRoot, 'dist');
  for (const path of await walk(distRoot)) {
    const relativePath = relative(distRoot, path).split(sep).join('/');
    if (relativePath.endsWith('.map') || relativePath.endsWith('.tsbuildinfo')) continue;
    if (/\.test\.(js|d\.ts)$/.test(relativePath)) continue;
    if (name === 'sdk' && (
      relativePath.startsWith('generated/community/')
      || relativePath.startsWith('schema-validation-community.')
      || relativePath.startsWith('marketplace-types.')
      || relativePath.startsWith('generated/v2/collection.generated.')
      || relativePath.startsWith('generated/v2/review-attestation.generated.')
      || relativePath === 'index.js'
      || relativePath === 'index.d.ts'
    )) continue;
    if (name === 'cli' && (relativePath.startsWith('community.') || relativePath === 'index.js' || relativePath === 'index.d.ts')) continue;
    await copyPath(path, join(packageRoot, 'dist', relativePath));
  }
  if (name === 'sdk') {
    const contractLockPath = join(repositoryRoot, 'devkit', 'packages', 'sdk', 'src', 'generated', 'v2', 'contract-lock.generated.json');
    const fullLock = JSON.parse(await readFile(contractLockPath, 'utf8'));
    const schemas = {};
    const files = {};
    for (const schemaName of authoringV2SchemaNames) {
      const schemaBytes = await readFile(join(repositoryRoot, 'devkit', 'schemas', 'v2', schemaName));
      schemas[schemaName] = JSON.parse(schemaBytes.toString('utf8'));
      files[schemaName] = sha256(schemaBytes);
    }
    const authoringLock = { ...fullLock, files };
    await writeFile(join(packageRoot, 'dist', 'generated', 'v2', 'schemas.generated.js'), [
      '/** Authoring-only subset of the canonical NAD v2 contracts. */',
      `export const CONTRACT_V2_SHA256 = ${JSON.stringify(fullLock.sha256)};`,
      `export const contractV2Lock = ${JSON.stringify(authoringLock, null, 2)};`,
      `export const contractV2Schemas = ${JSON.stringify(schemas, null, 2)};`,
      '',
    ].join('\n'));
    await writeFile(join(packageRoot, 'dist', 'generated', 'v2', 'schemas.generated.d.ts'), [
      `export declare const CONTRACT_V2_SHA256: ${JSON.stringify(fullLock.sha256)};`,
      'export declare const contractV2Lock: { readonly packageSchemaVersion: 2; readonly hostApiCompatibility: "2.x"; readonly uiApiCompatibility: "2.x"; readonly capabilities: readonly string[]; readonly sha256: string; readonly files: Readonly<Record<string, string>> };',
      'export declare const contractV2Schemas: Readonly<Record<string, Record<string, unknown>>>;',
      '',
    ].join('\n'));
    const typeExports = [
      ['NADV2AppOrAddOnManifest', 'manifest.generated.js'],
      ['NADV2AppOperation', 'operation.generated.js'],
      ['NADV2ConnectionProfileSchema', 'connection-schema.generated.js'],
      ['NADV2ScopedHTTPAccess', 'http-access.generated.js'],
      ['NADUIAPIV2Surfaces', 'ui-surfaces.generated.js'],
      ['NADUIAPIV2SurfaceConnectionBootstrap', 'ui-bridge-connect.generated.js'],
      ['NADUIAPIV2MessageChannelEnvelope', 'ui-bridge-message.generated.js'],
      ['NADHostAPIV2OperationInvocation', 'invocation-request.generated.js'],
      ['NADHostAPIV2Call', 'host-call.generated.js'],
      ['NADHostAPIV2ResponseEnvelope', 'host-response.generated.js'],
      ['NADV2PackageReleaseRecord', 'release-record.generated.js'],
    ];
    await writeFile(join(packageRoot, 'dist', 'generated', 'v2', 'index.js'), "export { CONTRACT_V2_SHA256, contractV2Lock, contractV2Schemas } from './schemas.generated.js';\n");
    await writeFile(join(packageRoot, 'dist', 'generated', 'v2', 'index.d.ts'), `${typeExports.map(([typeName, file]) => `export type { ${typeName} } from './${file}';`).join('\n')}\nexport { CONTRACT_V2_SHA256, contractV2Lock, contractV2Schemas } from './schemas.generated.js';\n`);
    for (const extension of ['js', 'd.ts']) {
      const validationPath = join(packageRoot, 'dist', `schema-validation-v2.${extension}`);
      const source = await readFile(validationPath, 'utf8');
      await writeFile(
        validationPath,
        source
          .replace(" | 'reviewAttestation' | 'collection'", '')
          .split('\n')
          .filter((line) => !line.includes('reviewAttestation:') && !line.includes('collection:'))
          .join('\n'),
      );
    }
  }
  const packageDocument = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  packageDocument.files = name === 'cli' ? ['dist', 'templates'] : ['dist'];
  packageDocument.scripts = {};
  for (const field of ['dependencies', 'devDependencies']) {
    if (!packageDocument[field]) continue;
    for (const [dependency, range] of Object.entries(packageDocument[field])) {
      if (range === 'workspace:*') packageDocument[field][dependency] = version;
    }
  }
  if (name === 'sdk') {
    packageDocument.main = 'dist/authoring-index.js';
    packageDocument.types = 'dist/authoring-index.d.ts';
    packageDocument.exports = { '.': { types: './dist/authoring-index.d.ts', default: './dist/authoring-index.js' } };
  }
  if (name === 'cli') {
    packageDocument.main = 'dist/authoring-cli.js';
    packageDocument.types = 'dist/authoring-cli.d.ts';
    packageDocument.bin = { nad: './dist/authoring-cli.js', 'nad-module': './dist/authoring-cli.js' };
    await copyPath(join(repositoryRoot, 'devkit', 'templates'), join(packageRoot, 'templates'));
  }
  await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(packageDocument, null, 2)}\n`);
  return packageRoot;
}

await rm(stagingParent, { recursive: true, force: true });
await mkdir(join(stagingRoot, 'tooling'), { recursive: true });

for (const name of ['README-FIRST.md', 'AGENTS.md', 'custom-plugins', 'scripts']) {
  await copyPath(join(repositoryRoot, 'devkit', 'distribution', name), join(stagingRoot, name));
}
for (const name of ['LICENSE', 'SECURITY.md']) {
  await copyPath(join(repositoryRoot, name), join(stagingRoot, name));
}
for (const name of ['README.md', 'APP_SPEC_V2.md', 'MODULE_SPEC.md', 'CLEAN_ROOM.md', 'CODEX_GUIDE.md', 'COMPATIBILITY.md', 'TESTING.md', 'TOOLCHAIN.md']) {
  await copyPath(join(repositoryRoot, 'devkit', 'docs', name), join(stagingRoot, 'docs', name));
}
const appSpecPath = join(stagingRoot, 'docs', 'APP_SPEC_V2.md');
await writeFile(
  appSpecPath,
  (await readFile(appSpecPath, 'utf8')).replaceAll('../schemas/v2/', '../contracts/v2/'),
);
const moduleSpecPath = join(stagingRoot, 'docs', 'MODULE_SPEC.md');
await writeFile(
  moduleSpecPath,
  (await readFile(moduleSpecPath, 'utf8')).replace(
    'the versioned JSON Schema bundle in [`devkit/schemas/`](../schemas/)',
    'the versioned JSON Schema bundle compiled into `@nad/sdk`',
  ),
);
for (const name of authoringV2SchemaNames) {
  await copyPath(
    join(repositoryRoot, 'devkit', 'schemas', 'v2', name),
    join(stagingRoot, 'contracts', 'v2', name),
  );
}
await copyPath(join(repositoryRoot, 'devkit', 'templates'), join(stagingRoot, 'templates'));

for (const name of ['sdk', 'testkit', 'cli']) {
  const packageRoot = await stageAuthoringPackage(name);
  execFileSync('pnpm', ['pack', '--pack-destination', join(stagingRoot, 'tooling')], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
}

const packageNames = Object.fromEntries(
  (await readdir(join(stagingRoot, 'tooling')))
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => [name.match(/^nad-(sdk|testkit|cli)-/)?.[1], name]),
);
for (const name of ['sdk', 'testkit', 'cli']) {
  if (!packageNames[name]) throw new Error(`Missing packed @nad/${name} tarball.`);
}

const packageDocument = {
  name: 'nad-custom-plugins',
  version,
  private: true,
  type: 'module',
  license: 'AGPL-3.0-only',
  packageManager: rootPackage.packageManager,
  engines: rootPackage.engines,
  scripts: {
    setup: 'node scripts/setup.mjs',
    'create:app': 'node scripts/create-app.mjs',
    'create:addon': 'node scripts/create-addon.mjs',
    'create:widget': 'node scripts/create-widget.mjs',
    'create:page': 'node scripts/create-page.mjs',
    'check:all': 'node scripts/check-all.mjs',
  },
  devDependencies: {
    '@nad/cli': `file:tooling/${packageNames.cli}`,
    '@nad/sdk': `file:tooling/${packageNames.sdk}`,
    '@nad/testkit': `file:tooling/${packageNames.testkit}`,
  },
  pnpm: {
    overrides: {
      '@nad/cli': `file:tooling/${packageNames.cli}`,
      '@nad/sdk': `file:tooling/${packageNames.sdk}`,
      '@nad/testkit': `file:tooling/${packageNames.testkit}`,
    },
  },
};
await writeFile(join(stagingRoot, 'package.json'), `${JSON.stringify(packageDocument, null, 2)}\n`);
await writeFile(join(stagingRoot, 'pnpm-workspace.yaml'), 'packages:\n  - "custom-plugins/*"\n');
await writeFile(join(stagingRoot, 'VERSION'), [
  `devkit=${version}`,
  `node=${rootPackage.engines.node}`,
  `pnpm=${rootPackage.engines.pnpm}`,
  'packageSchema=2',
  'hostApi=2.x',
  'uiApi=2.x',
  '',
].join('\n'));

execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts', '--offline'], {
  cwd: stagingRoot,
  stdio: 'inherit',
});
await rm(join(stagingRoot, 'node_modules'), { recursive: true, force: true });

const filesBeforeManifest = await walk(stagingRoot);
const manifestFiles = [];
for (const path of filesBeforeManifest) {
  const bytes = await readFile(path);
  manifestFiles.push({
    path: relative(stagingRoot, path).split(sep).join('/'),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}
const manifest = {
  schemaVersion: 1,
  name: 'NAD Plugin Devkit',
  version,
  architecture: 'any',
  packageSchemaVersions: [1, 2],
  hostApi: '2.x',
  uiApi: '2.x',
  containsFirstPartyPlugins: false,
  files: manifestFiles,
};
await writeFile(join(stagingRoot, 'devkit-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const filesBeforeSums = await walk(stagingRoot);
const sums = [];
for (const path of filesBeforeSums) {
  const bytes = await readFile(path);
  sums.push(`${sha256(bytes)}  ${relative(stagingRoot, path).split(sep).join('/')}`);
}
await writeFile(join(stagingRoot, 'SHA256SUMS'), `${sums.join('\n')}\n`);

const entries = [];
for (const path of await walk(stagingRoot)) {
  entries.push({
    path: `${archiveRootName}/${relative(stagingRoot, path).split(sep).join('/')}`,
    data: await readFile(path),
  });
}
const archive = createDeterministicZip(entries);
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, archive);
await writeFile(`${outputPath}.sha256`, `${sha256(archive)}  ${basename(outputPath)}\n`);
process.stdout.write(`Wrote ${outputPath}\nSHA-256 ${sha256(archive)}\nBytes ${archive.byteLength}\n`);
