#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { compileFromFile } from 'json-schema-to-typescript';

const root = resolve(import.meta.dirname, '..', '..');
const schemaRoot = join(root, 'devkit', 'schemas');
const schemaV2Root = join(schemaRoot, 'v2');
const communitySchemaRoot = join(schemaRoot, 'community', 'v1');
const localOutput = join(root, 'devkit', 'packages', 'sdk', 'src', 'generated', 'v1');
const localOutputV2 = join(root, 'devkit', 'packages', 'sdk', 'src', 'generated', 'v2');
const localOutputCommunity = join(root, 'devkit', 'packages', 'sdk', 'src', 'generated', 'community', 'v1');
const checkOnly = process.argv.includes('--check');

function optionValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const consumerRoots = [
  optionValue('--core') && join(resolve(optionValue('--core')), 'src', 'lib', 'modules', 'contracts'),
  optionValue('--marketplace') && join(resolve(optionValue('--marketplace')), 'lib', 'contracts'),
].filter(Boolean);
const consumers = consumerRoots.map((directory) => join(directory, 'v1'));
const consumersV2 = consumerRoots.map((directory) => join(directory, 'v2'));
const marketplaceRoot = optionValue('--marketplace')
  ? join(resolve(optionValue('--marketplace')), 'lib', 'contracts', 'community', 'v1')
  : undefined;

const documents = [
  ['manifest.schema.json', 'manifest.generated.ts'],
  ['data-migration.v1.schema.json', 'data-migration.generated.ts'],
  ['http-access.v1.schema.json', 'http-access.generated.ts'],
  ['ui-pages.schema.json', 'pages.generated.ts'],
  ['ui-widgets.schema.json', 'widgets.generated.ts'],
  ['ui-element.v1.schema.json', 'ui-element.generated.ts'],
  ['endpoint-schema.v1.schema.json', 'endpoint-schema.generated.ts'],
  ['host-call.schema.json', 'host-call.generated.ts'],
  ['host-http-response.schema.json', 'host-http-response.generated.ts'],
  ['secret-reference.schema.json', 'secret-reference.generated.ts'],
  ['module-request.schema.json', 'module-request.generated.ts'],
  ['checksums.schema.json', 'checksums.generated.ts'],
  ['signature-envelope.schema.json', 'signature-envelope.generated.ts'],
  ['signature.schema.json', 'signature.generated.ts'],
  ['release-metadata.schema.json', 'release-metadata.generated.ts'],
  ['release-record.schema.json', 'release-record.generated.ts'],
];

const documentsV2 = [
  ['manifest.v2.schema.json', 'manifest.generated.ts'],
  ['operation.v2.schema.json', 'operation.generated.ts'],
  ['connection-schema.v2.schema.json', 'connection-schema.generated.ts'],
  ['http-access.v2.schema.json', 'http-access.generated.ts'],
  ['ui-surfaces.v2.schema.json', 'ui-surfaces.generated.ts'],
  ['ui-bridge-connect.v2.schema.json', 'ui-bridge-connect.generated.ts'],
  ['ui-bridge-message.v2.schema.json', 'ui-bridge-message.generated.ts'],
  ['invocation-request.v2.schema.json', 'invocation-request.generated.ts'],
  ['host-call.v2.schema.json', 'host-call.generated.ts'],
  ['host-response.v2.schema.json', 'host-response.generated.ts'],
  ['release-record.v2.schema.json', 'release-record.generated.ts'],
  ['review-attestation.v1.schema.json', 'review-attestation.generated.ts'],
  ['collection.v1.schema.json', 'collection.generated.ts'],
];

const communityDocuments = [
  ['catalog.v1.schema.json', 'catalog.generated.ts'],
  ['submission.v1.schema.json', 'submission.generated.ts'],
  ['validation-evidence.v1.schema.json', 'validation-evidence.generated.ts'],
  ['review-decision.v1.schema.json', 'review-decision.generated.ts'],
  ['release.v1.schema.json', 'release.generated.ts'],
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function canonicalSchemas() {
  const names = (await readdir(schemaRoot))
    .filter((name) => name.endsWith('.schema.json'))
    .sort((left, right) => left.localeCompare(right));
  const entries = await Promise.all(names.map(async (name) => [name, await readFile(join(schemaRoot, name))]));
  const files = Object.fromEntries(entries.map(([name, bytes]) => [name, sha256(bytes)]));
  const envelope = Buffer.concat(entries.flatMap(([name, bytes]) => [Buffer.from(`${name}\0`), bytes, Buffer.from('\0')]));
  return { digest: sha256(envelope), files, entries };
}

async function canonicalV2Schemas() {
  const names = (await readdir(schemaV2Root))
    .filter((name) => name.endsWith('.schema.json'))
    .sort((left, right) => left.localeCompare(right));
  const entries = await Promise.all(names.map(async (name) => [name, await readFile(join(schemaV2Root, name))]));
  const files = Object.fromEntries(entries.map(([name, bytes]) => [name, sha256(bytes)]));
  const envelope = Buffer.concat(entries.flatMap(([name, bytes]) => [Buffer.from(`${name}\0`), bytes, Buffer.from('\0')]));
  return { digest: sha256(envelope), files, entries };
}

async function canonicalCommunitySchemas() {
  const names = (await readdir(communitySchemaRoot))
    .filter((name) => name.endsWith('.schema.json'))
    .sort((left, right) => left.localeCompare(right));
  const entries = await Promise.all(names.map(async (name) => [name, await readFile(join(communitySchemaRoot, name))]));
  const files = Object.fromEntries(entries.map(([name, bytes]) => [name, sha256(bytes)]));
  const envelope = Buffer.concat(entries.flatMap(([name, bytes]) => [Buffer.from(`${name}\0`), bytes, Buffer.from('\0')]));
  return { digest: sha256(envelope), files, entries };
}

async function compileDocuments(contractDigest) {
  const generated = new Map();
  for (const [schemaName, outputName] of documents) {
    const output = await compileFromFile(join(schemaRoot, schemaName), {
      bannerComment: [
        '/**',
        ' * Generated from the canonical NAD v1 JSON Schemas.',
        ` * Contract SHA-256: ${contractDigest}`,
        ' * Run `pnpm contracts:generate`; do not edit this file.',
        ' */',
      ].join('\n'),
      cwd: schemaRoot,
      ignoreMinAndMaxItems: true,
      style: { bracketSpacing: true, singleQuote: true, semi: true, trailingComma: 'all' },
      unreachableDefinitions: true,
    });
    generated.set(outputName, output);
  }
  generated.set('index.ts', [
    "export type { ModuleManifestDocument } from './manifest.generated.js';",
    "export type { ModuleDataMigrationDocument } from './data-migration.generated.js';",
    "export type { ModuleHttpAccessScopeDocument } from './http-access.generated.js';",
    "export type { ModulePagesDocument } from './pages.generated.js';",
    "export type { ModuleWidgetsDocument } from './widgets.generated.js';",
    "export type { ModuleUiElementDocument } from './ui-element.generated.js';",
    "export type { ModuleEndpointSchemaDocument } from './endpoint-schema.generated.js';",
    "export type { ModuleHostCallDocument, ModuleAuditMetadata, ModuleHostHttpRequest, ModuleHostNotification } from './host-call.generated.js';",
    "export type { ModuleHostHttpResponse } from './host-http-response.generated.js';",
    "export type { ModuleSecretReference } from './secret-reference.generated.js';",
    "export type { ModuleInvocationRequestDocument } from './module-request.generated.js';",
    "export type { ModuleChecksumsDocument } from './checksums.generated.js';",
    "export type { NADModuleSignatureEnvelope } from './signature-envelope.generated.js';",
    "export type { ModuleSignatureDocument } from './signature.generated.js';",
    "export type { ModuleReleaseMetadataDocument } from './release-metadata.generated.js';",
    "export type { ModuleReleaseRecordDocument } from './release-record.generated.js';",
    "export { CONTRACT_SHA256, contractLock, contractSchemas } from './schemas.generated.js';",
    '',
  ].join('\n'));
  return generated;
}

async function compileV2Documents(contractDigest) {
  const generated = new Map();
  for (const [schemaName, outputName] of documentsV2) {
    const output = await compileFromFile(join(schemaV2Root, schemaName), {
      bannerComment: [
        '/**',
        ' * Generated from the canonical NAD v2 JSON Schemas.',
        ` * Contract SHA-256: ${contractDigest}`,
        ' * Run `pnpm contracts:generate`; do not edit this file.',
        ' */',
      ].join('\n'),
      cwd: schemaV2Root,
      ignoreMinAndMaxItems: true,
      style: { bracketSpacing: true, singleQuote: true, semi: true, trailingComma: 'all' },
      unreachableDefinitions: true,
    });
    generated.set(outputName, output);
  }
  generated.set('index.ts', [
    "export type { NADV2AppOrAddOnManifest } from './manifest.generated.js';",
    "export type { NADV2AppOperation } from './operation.generated.js';",
    "export type { NADV2ConnectionProfileSchema } from './connection-schema.generated.js';",
    "export type { NADV2ScopedHTTPAccess } from './http-access.generated.js';",
    "export type { NADUIAPIV2Surfaces } from './ui-surfaces.generated.js';",
    "export type { NADUIAPIV2SurfaceConnectionBootstrap } from './ui-bridge-connect.generated.js';",
    "export type { NADUIAPIV2MessageChannelEnvelope } from './ui-bridge-message.generated.js';",
    "export type { NADHostAPIV2OperationInvocation } from './invocation-request.generated.js';",
    "export type { NADHostAPIV2Call } from './host-call.generated.js';",
    "export type { NADHostAPIV2ResponseEnvelope } from './host-response.generated.js';",
    "export type { NADV2PackageReleaseRecord } from './release-record.generated.js';",
    "export type { NADExactDigestReviewAttestation } from './review-attestation.generated.js';",
    "export type { NADMarketplaceCollection } from './collection.generated.js';",
    "export { CONTRACT_V2_SHA256, contractV2Lock, contractV2Schemas } from './schemas.generated.js';",
    '',
  ].join('\n'));
  return generated;
}

async function compileCommunityDocuments(contractDigest) {
  const generated = new Map();
  for (const [schemaName, outputName] of communityDocuments) {
    const output = await compileFromFile(join(communitySchemaRoot, schemaName), {
      bannerComment: [
        '/**',
        ' * Generated from the canonical NAD community workflow v1 JSON Schemas.',
        ` * Contract SHA-256: ${contractDigest}`,
        ' * Run `pnpm contracts:generate`; do not edit this file.',
        ' */',
      ].join('\n'),
      cwd: communitySchemaRoot,
      ignoreMinAndMaxItems: true,
      style: { bracketSpacing: true, singleQuote: true, semi: true, trailingComma: 'all' },
      unreachableDefinitions: true,
    });
    generated.set(outputName, output);
  }
  generated.set('index.ts', [
    "export type { NADSignedCommunityCatalogueSnapshot } from './catalog.generated.js';",
    "export type { NADCommunitySubmissionEnvelope } from './submission.generated.js';",
    "export type { NADIsolatedCommunityValidationEvidence } from './validation-evidence.generated.js';",
    "export type { NADCommunityReviewDecision } from './review-decision.generated.js';",
    "export type { NADReviewedCommunityReleaseIndexRecord } from './release.generated.js';",
    "export { COMMUNITY_CONTRACT_SHA256, communityContractLock, communityContractSchemas } from './schemas.generated.js';",
    '',
  ].join('\n'));
  return generated;
}

async function expectedOutputs() {
  const contract = await canonicalSchemas();
  const generated = await compileDocuments(contract.digest);
  const schemaObject = Object.fromEntries(contract.entries.map(([name, bytes]) => [name, JSON.parse(bytes.toString('utf8'))]));
  const capabilities = schemaObject['manifest.schema.json']?.properties?.capabilities?.items?.properties?.name?.enum;
  if (!Array.isArray(capabilities) || capabilities.some((name) => typeof name !== 'string')) {
    throw new Error('manifest.schema.json must declare the canonical capability enum.');
  }
  const lock = {
    schemaVersion: 1,
    contractVersion: '1.0',
    packageSchemaVersion: 1,
    hostApiVersion: '1.0',
    hostApiCompatibility: '1.x',
    uiApiVersion: '1.0',
    uiApiCompatibility: '1.x',
    capabilities,
    sha256: contract.digest,
    files: contract.files,
  };
  generated.set('schemas.generated.ts', [
    '/** Generated from the canonical NAD v1 JSON Schemas. Do not edit. */',
    `export const CONTRACT_SHA256 = '${contract.digest}' as const;`,
    `export const contractLock = ${JSON.stringify(lock, null, 2)} as const;`,
    `export const contractSchemas = ${JSON.stringify(schemaObject, null, 2)} as const;`,
    '',
  ].join('\n'));
  generated.set('contract-lock.generated.json', `${JSON.stringify(lock, null, 2)}\n`);
  const generatedLock = {
    schemaVersion: 1,
    contractSha256: contract.digest,
    files: Object.fromEntries(
      [...generated.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, output]) => [name, sha256(output)]),
    ),
  };
  generated.set('generated-lock.generated.json', `${JSON.stringify(generatedLock, null, 2)}\n`);
  return generated;
}

async function expectedV2Outputs() {
  const contract = await canonicalV2Schemas();
  const generated = await compileV2Documents(contract.digest);
  const schemaObject = Object.fromEntries(contract.entries.map(([name, bytes]) => [name, JSON.parse(bytes.toString('utf8'))]));
  const capabilities = schemaObject['manifest.v2.schema.json']?.properties?.capabilities?.items?.properties?.name?.enum;
  if (!Array.isArray(capabilities) || capabilities.some((name) => typeof name !== 'string')) {
    throw new Error('manifest.v2.schema.json must declare the canonical v2 capability enum.');
  }
  const lock = {
    schemaVersion: 2,
    contractVersion: '2.0',
    packageSchemaVersion: 2,
    hostApiVersion: '2.0',
    hostApiCompatibility: '2.x',
    uiApiVersion: '2.0',
    uiApiCompatibility: '2.x',
    capabilities,
    supportedPackageSchemaVersions: [1, 2],
    sha256: contract.digest,
    files: contract.files,
  };
  generated.set('schemas.generated.ts', [
    '/** Generated from the canonical NAD v2 JSON Schemas. Do not edit. */',
    `export const CONTRACT_V2_SHA256 = '${contract.digest}' as const;`,
    `export const contractV2Lock = ${JSON.stringify(lock, null, 2)} as const;`,
    `export const contractV2Schemas = ${JSON.stringify(schemaObject, null, 2)} as const;`,
    '',
  ].join('\n'));
  generated.set('contract-lock.generated.json', `${JSON.stringify(lock, null, 2)}\n`);
  const generatedLock = {
    schemaVersion: 2,
    contractSha256: contract.digest,
    files: Object.fromEntries(
      [...generated.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, output]) => [name, sha256(output)]),
    ),
  };
  generated.set('generated-lock.generated.json', `${JSON.stringify(generatedLock, null, 2)}\n`);
  return generated;
}

async function expectedCommunityOutputs() {
  const contract = await canonicalCommunitySchemas();
  const generated = await compileCommunityDocuments(contract.digest);
  const schemaObject = Object.fromEntries(contract.entries.map(([name, bytes]) => [name, JSON.parse(bytes.toString('utf8'))]));
  const lock = {
    schemaVersion: 1,
    contractVersion: 'community-1.0',
    sha256: contract.digest,
    files: contract.files,
  };
  generated.set('schemas.generated.ts', [
    '/** Generated from the canonical NAD community workflow v1 JSON Schemas. Do not edit. */',
    `export const COMMUNITY_CONTRACT_SHA256 = '${contract.digest}' as const;`,
    `export const communityContractLock = ${JSON.stringify(lock, null, 2)} as const;`,
    `export const communityContractSchemas = ${JSON.stringify(schemaObject, null, 2)} as const;`,
    '',
  ].join('\n'));
  generated.set('contract-lock.generated.json', `${JSON.stringify(lock, null, 2)}\n`);
  const generatedLock = {
    schemaVersion: 1,
    contractSha256: contract.digest,
    files: Object.fromEntries(
      [...generated.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, output]) => [name, sha256(output)]),
    ),
  };
  generated.set('generated-lock.generated.json', `${JSON.stringify(generatedLock, null, 2)}\n`);
  return generated;
}

async function assertCurrent(directory, outputs) {
  for (const [name, expected] of outputs) {
    const path = join(directory, name);
    let actual;
    try {
      actual = await readFile(path, 'utf8');
    } catch {
      throw new Error(`${path} is missing. Run pnpm contracts:generate.`);
    }
    if (actual !== expected) throw new Error(`${path} is stale. Run pnpm contracts:generate.`);
  }
}

async function writeOutputs(directory, outputs) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await Promise.all([...outputs].map(([name, output]) => writeFile(join(directory, name), output, 'utf8')));
}

async function main() {
  const outputs = await expectedOutputs();
  const outputsV2 = await expectedV2Outputs();
  const outputsCommunity = await expectedCommunityOutputs();
  if (checkOnly) {
    await assertCurrent(localOutput, outputs);
    await assertCurrent(localOutputV2, outputsV2);
    await assertCurrent(localOutputCommunity, outputsCommunity);
    for (const consumer of consumers) await assertCurrent(consumer, outputs);
    for (const consumer of consumersV2) await assertCurrent(consumer, outputsV2);
    if (marketplaceRoot) await assertCurrent(marketplaceRoot, outputsCommunity);
    process.stdout.write(`Package contracts v1/v2 and community workflow v1 outputs are current.\n`);
    return;
  }
  await writeOutputs(localOutput, outputs);
  await writeOutputs(localOutputV2, outputsV2);
  await writeOutputs(localOutputCommunity, outputsCommunity);
  for (const consumer of consumers) await writeOutputs(consumer, outputs);
  for (const consumer of consumersV2) await writeOutputs(consumer, outputsV2);
  if (marketplaceRoot) await writeOutputs(marketplaceRoot, outputsCommunity);
  process.stdout.write('Generated NAD package contracts v1/v2 and community workflow v1.\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
