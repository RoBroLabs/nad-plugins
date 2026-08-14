import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createPrivateKey, createPublicKey, sign, verify as verifySignature } from 'node:crypto';
import {
  assertValidManifest,
  assertValidUiFiles,
  forbiddenServerImportIssues,
  validateChecksums,
  validateEndpointSchema,
  validateManifest,
  validateReleaseRecord,
  validateSignature,
} from './validation.js';
import { canonicalSchemaIssues } from './schema-validation.js';
import type {
  ChecksumsFile,
  ModuleManifest,
  PackageVerification,
  ReleaseMetadata,
  ReleaseRecord,
  SignatureFile,
  ValidationIssue,
  ValidationResult,
} from './types.js';
import {
  createDeterministicZip,
  readZipEntries,
  sha256Hex,
  validateZipPath,
  type ZipEntry,
} from './zip.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const requiredPackagePaths = [
  'manifest.json',
  'server/main.js',
  'ui/pages.json',
  'ui/widgets.json',
  'schemas/config.json',
  'README.md',
  'LICENSE',
  'assets/icon.png',
];

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maximum: number,
): string {
  const field = value[key];
  if (typeof field !== 'string' || field.trim() === '' || field.length > maximum) {
    throw new Error(`${label} must be a non-empty string no longer than ${maximum} characters.`);
  }
  return field;
}

function stringArrayValue(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maximumItems: number,
  maximumLength: number,
): string[] {
  const field = value[key];
  if (!Array.isArray(field) || field.length === 0 || field.length > maximumItems) {
    throw new Error(`${label} must be a non-empty array with at most ${maximumItems} entries.`);
  }
  const result = field.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '' || entry.length > maximumLength) {
      throw new Error(`${label}[${index}] must be a non-empty string no longer than ${maximumLength} characters.`);
    }
    return entry;
  });
  if (new Set(result).size !== result.length) throw new Error(`${label} entries must be unique.`);
  return result;
}

function assertValidReleaseMetadata(value: unknown): ReleaseMetadata {
  const schemaIssues = canonicalSchemaIssues('releaseMetadata', value);
  if (schemaIssues.length > 0) {
    throw new Error(schemaIssues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }
  if (!isRecord(value)) throw new Error('release-metadata.json must be an object.');
  if (value.schemaVersion !== 1) throw new Error('release-metadata.json schemaVersion must be 1.');
  const releasedAt = stringValue(value, 'releasedAt', 'release-metadata.json releasedAt', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releasedAt)) throw new Error('release-metadata.json releasedAt must use YYYY-MM-DD.');
  const sourceDirectory = stringValue(value, 'sourceDirectory', 'release-metadata.json sourceDirectory', 200);
  const license = stringValue(value, 'license', 'release-metadata.json license', 120);
  const optionalUrl = (key: 'repositoryUrl' | 'sourceUrl'): string | null | undefined => {
    const field = value[key];
    if (field === undefined) return undefined;
    if (field === null) return null;
    if (typeof field !== 'string' || field.length > 500) {
      throw new Error(`release-metadata.json ${key} must be null or a string no longer than 500 characters.`);
    }
    return field;
  };
  const optionalString = (key: 'sourceRevision' | 'sourceTag'): string | null | undefined => {
    const field = value[key];
    if (field === undefined) return undefined;
    if (field === null) return null;
    if (typeof field !== 'string' || field.trim() === '' || field.length > 200) {
      throw new Error(`release-metadata.json ${key} must be null or a non-empty string no longer than 200 characters.`);
    }
    return field;
  };

  if (!isRecord(value.changelog)) throw new Error('release-metadata.json changelog must be an object.');
  const changelog = {
    summary: stringValue(value.changelog, 'summary', 'release-metadata.json changelog.summary', 500),
    entries: stringArrayValue(value.changelog, 'entries', 'release-metadata.json changelog.entries', 12, 300),
  };

  if (!isRecord(value.hotUpdate)) throw new Error('release-metadata.json hotUpdate must be an object.');
  if (value.hotUpdate.compatibility !== 'compatible') {
    throw new Error('release-metadata.json hotUpdate.compatibility must be compatible.');
  }
  const hotUpdate = {
    compatibility: 'compatible' as const,
    preserves: stringArrayValue(value.hotUpdate, 'preserves', 'release-metadata.json hotUpdate.preserves', 16, 200),
  };

  return {
    schemaVersion: 1,
    releasedAt,
    sourceRevision: optionalString('sourceRevision'),
    sourceDirectory,
    license,
    repositoryUrl: optionalUrl('repositoryUrl'),
    sourceUrl: optionalUrl('sourceUrl'),
    sourceTag: optionalString('sourceTag'),
    changelog,
    hotUpdate,
  };
}

async function readReleaseMetadata(moduleDir: string): Promise<ReleaseMetadata | undefined> {
  try {
    return assertValidReleaseMetadata(await readJson(join(moduleDir, 'release-metadata.json')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readOptionalEndpointSchemas(moduleDir: string): Promise<ZipEntry[]> {
  const directory = join(moduleDir, 'schemas', 'endpoints');
  const entries: ZipEntry[] = [];
  const names = await readdir(directory);
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const packagePath = `schemas/endpoints/${name}`;
    validateZipPath(packagePath);
    const data = await readFile(join(directory, name));
    const value = JSON.parse(data.toString('utf8')) as unknown;
    const validation = validateEndpointSchema(value);
    if (!validation.valid) {
      throw new Error(validation.issues.map(({ path, message }) => `${packagePath}:${path}: ${message}`).join('\n'));
    }
    entries.push({ path: packagePath, data });
  }
  return entries;
}

async function readConfigSchema(moduleDir: string): Promise<Buffer> {
  const packagePath = 'schemas/config.json';
  const data = await readFile(join(moduleDir, 'schemas', 'config.json'));
  const value = JSON.parse(data.toString('utf8')) as unknown;
  const validation = validateEndpointSchema(value);
  if (!validation.valid) {
    throw new Error(validation.issues.map(({ path, message }) => `${packagePath}:${path}: ${message}`).join('\n'));
  }
  return data;
}

async function packagePayloadEntries(moduleDir: string): Promise<{
  entries: ZipEntry[];
  manifest: ModuleManifest;
  issues: ValidationIssue[];
  warnings: string[];
}> {
  const manifestValue = await readJson(join(moduleDir, 'manifest.json'));
  const manifestResult = validateManifest(manifestValue);
  const manifest = manifestResult.valid ? manifestValue as ModuleManifest : undefined;
  const issues = [...manifestResult.issues];
  const warnings = [...manifestResult.warnings];
  if (!manifest) return { entries: [], manifest: manifestValue as ModuleManifest, issues, warnings };

  const pagesValue = await readJson(join(moduleDir, 'ui', 'pages.json'));
  const widgetsValue = await readJson(join(moduleDir, 'ui', 'widgets.json'));
  try {
    assertValidUiFiles(widgetsValue, pagesValue, manifest);
  } catch (error) {
    issues.push(...String(error instanceof Error ? error.message : error).split('\n').map((message) => ({
      path: 'ui',
      message,
    })));
  }

  const server = await readFile(join(moduleDir, 'dist', 'server', 'main.js'), 'utf8').catch(() => readFile(join(moduleDir, 'dist', 'server', 'server.js'), 'utf8'));
  issues.push(...forbiddenServerImportIssues(server));

  const entries: ZipEntry[] = [
    { path: 'manifest.json', data: encoder.encode(JSON.stringify(manifestValue, null, 2) + '\n') },
    { path: 'server/main.js', data: encoder.encode(server.endsWith('\n') ? server : `${server}\n`) },
    { path: 'ui/pages.json', data: await readFile(join(moduleDir, 'ui', 'pages.json')) },
    { path: 'ui/widgets.json', data: await readFile(join(moduleDir, 'ui', 'widgets.json')) },
    { path: 'schemas/config.json', data: await readConfigSchema(moduleDir) },
    { path: 'README.md', data: await readFile(join(moduleDir, 'README.md')) },
    { path: 'LICENSE', data: await readFile(join(moduleDir, 'LICENSE')) },
    { path: 'assets/icon.png', data: await readFile(join(moduleDir, 'assets', 'icon.png')) },
    ...(await readOptionalEndpointSchemas(moduleDir)),
  ].sort((a, b) => a.path.localeCompare(b.path));

  return { entries, manifest, issues, warnings };
}

export async function checkModuleDirectory(moduleDir: string): Promise<ValidationResult> {
  try {
    const { entries, manifest, issues, warnings } = await packagePayloadEntries(moduleDir);
    if (issues.length === 0) {
      const paths = new Set(entries.map(({ path }) => path));
      for (const required of requiredPackagePaths) {
        if (!paths.has(required)) issues.push({ path: required, message: 'required package file is missing' });
      }
      for (const entrypoint of Object.values(manifest.entrypoints)) {
        if (!paths.has(entrypoint.requestSchema)) issues.push({ path: entrypoint.requestSchema, message: 'request schema file is missing' });
        if (!paths.has(entrypoint.responseSchema)) issues.push({ path: entrypoint.responseSchema, message: 'response schema file is missing' });
      }
    }
    return { valid: issues.length === 0, issues, warnings };
  } catch (error) {
    return {
      valid: false,
      issues: [{ path: moduleDir, message: error instanceof Error ? error.message : String(error) }],
      warnings: [],
    };
  }
}

function buildChecksums(entries: ZipEntry[]): ChecksumsFile {
  return {
    schemaVersion: 1,
    algorithm: 'sha256',
    files: Object.fromEntries(entries.map(({ path, data }) => [path, sha256Hex(data)])),
  };
}

function buildUnsignedDevSignature(manifest: ModuleManifest, checksums: ChecksumsFile): SignatureFile {
  return {
    schemaVersion: 1,
    mode: 'unsigned-dev',
    warning: 'Development package only. NAD core must require NAD_ALLOW_UNSIGNED_MODULES=true before accepting this artifact.',
    signedPayload: {
      moduleId: manifest.id,
      version: manifest.version,
      digestAlgorithm: 'sha256',
      files: checksums.files,
    },
  };
}

export interface PackageSigningOptions {
  privateKeyPem?: string;
  keyId?: string;
  generateReleaseRecord?: boolean;
  sourceRevision?: string;
}

export function createSignatureEnvelope(manifest: ModuleManifest, checksums: ChecksumsFile): Buffer {
  const files = Object.fromEntries(Object.entries(checksums.files).sort(([left], [right]) => left.localeCompare(right)));
  return Buffer.from(JSON.stringify({
    moduleId: manifest.id,
    version: manifest.version,
    digestAlgorithm: checksums.algorithm,
    files,
  }), 'utf8');
}

function createLegacySignatureEnvelopeV1(manifest: ModuleManifest, checksums: ChecksumsFile): Buffer {
  const files = Object.fromEntries(Object.entries(checksums.files).sort(([left], [right]) => left.localeCompare(right)));
  return Buffer.from(JSON.stringify({ id: manifest.id, version: manifest.version, files }), 'utf8');
}

function buildSignature(
  manifest: ModuleManifest,
  checksums: ChecksumsFile,
  options: PackageSigningOptions,
): SignatureFile {
  if (!options.privateKeyPem && !options.keyId) return buildUnsignedDevSignature(manifest, checksums);
  if (!options.privateKeyPem || !options.keyId) throw new Error('Signing requires both a private key and key ID.');
  const privateKey = createPrivateKey(options.privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Module signing key must be Ed25519.');
  return {
    schemaVersion: 1,
    mode: 'signed',
    algorithm: 'Ed25519',
    keyId: options.keyId,
    signature: sign(null, createSignatureEnvelope(manifest, checksums), privateKey).toString('base64'),
    signedPayload: {
      moduleId: manifest.id,
      version: manifest.version,
      digestAlgorithm: 'sha256',
      files: checksums.files,
    },
  };
}

export interface ReleaseRecordGenerationOptions {
  sourceRevision?: string;
  trustedKeys: Record<string, string>;
  expectedKeyId?: string;
}

export async function generateReleaseRecord(
  moduleDir: string,
  filePath: string,
  outDir: string,
  options: ReleaseRecordGenerationOptions,
): Promise<{ filePath: string; record: ReleaseRecord }> {
  const contract = await checkModuleDirectory(moduleDir);
  if (!contract.valid) {
    throw new Error(contract.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }
  const metadata = await readReleaseMetadata(moduleDir);
  if (!metadata) throw new Error(`release-metadata.json is required to generate a release record.`);
  const sourceRevision = options.sourceRevision ?? metadata.sourceRevision;
  if (!sourceRevision) {
    throw new Error('sourceRevision is required to generate a release record. Pass --source-revision or NAD_MODULE_SOURCE_REVISION.');
  }

  const verification = await verifyNadmod(filePath, {
    trustedKeys: options.trustedKeys,
    requireTrustedSignature: true,
  });
  if (verification.signature.mode !== 'signed' || !verification.signatureVerified) {
    throw new Error('Release records require a cryptographically verified signed package.');
  }
  if (options.expectedKeyId && verification.signature.keyId !== options.expectedKeyId) {
    throw new Error(`Package signer ${verification.signature.keyId} does not match expected key ${options.expectedKeyId}.`);
  }

  const sourceManifest = assertValidManifest(await readJson(join(moduleDir, 'manifest.json')));
  if (sourceManifest.id !== verification.manifest.id || sourceManifest.version !== verification.manifest.version) {
    throw new Error('Package identity does not match the source module manifest.');
  }

  const packageBytes = await readFile(filePath);
  const manifest = verification.manifest;
  const record: ReleaseRecord = {
    schemaVersion: 1,
    module: {
      id: manifest.id,
      slug: manifest.slug,
      name: manifest.name,
      version: manifest.version,
      publisher: manifest.publisher,
    },
    provenance: {
      releasedAt: metadata.releasedAt,
      sourceRevision,
      sourceDirectory: metadata.sourceDirectory,
      license: metadata.license,
      ...(metadata.repositoryUrl === undefined ? {} : { repositoryUrl: metadata.repositoryUrl }),
      ...(metadata.sourceUrl === undefined ? {} : { sourceUrl: metadata.sourceUrl }),
      ...(metadata.sourceTag === undefined ? {} : { sourceTag: metadata.sourceTag }),
    },
    manifest: {
      schemaVersion: manifest.schemaVersion,
      id: manifest.id,
      slug: manifest.slug,
      name: manifest.name,
      description: manifest.description,
      icon: manifest.icon,
      category: manifest.category,
      version: manifest.version,
      publisher: manifest.publisher,
      compatibility: manifest.compatibility,
      capabilities: manifest.capabilities,
      ...(manifest.httpAccess === undefined ? {} : { httpAccess: manifest.httpAccess }),
      permissions: manifest.permissions,
      ...(manifest.dataMigrations === undefined ? {} : { dataMigrations: manifest.dataMigrations }),
    },
    changelog: metadata.changelog,
    hotUpdate: metadata.hotUpdate,
    artifact: {
      fileName: basename(filePath),
      path: basename(filePath),
      bytes: packageBytes.byteLength,
      sha256: sha256Hex(packageBytes),
      entryCount: verification.entries.length,
      entries: verification.entries,
    },
    signature: {
      mode: 'signed',
      keyId: verification.signature.keyId,
      verified: true,
      warnings: verification.warnings,
    },
    conformance: {
      checks: [
        {
          name: 'module-contract',
          passed: true,
          detail: 'Module directory passed manifest, schema, UI, and bundled-server contract checks.',
        },
        {
          name: 'package-verification',
          passed: true,
          detail: `Package verification passed for ${verification.entries.length} declared archive entries.`,
        },
        {
          name: 'trusted-signature',
          passed: true,
          detail: `Package signature matches trusted key ${verification.signature.keyId}.`,
        },
      ],
    },
  };
  if (!validateReleaseRecord(record)) {
    const issues = canonicalSchemaIssues('releaseRecord', record);
    throw new Error(`Generated release record failed the canonical contract:\n${issues.map(({ path, message }) => `${path}: ${message}`).join('\n')}`);
  }
  await mkdir(outDir, { recursive: true });
  const outputPath = join(outDir, `${manifest.slug}-${manifest.version}.release.json`);
  await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return { filePath: outputPath, record };
}

export async function buildNadmod(moduleDir: string, outDir: string, signing: PackageSigningOptions = {}): Promise<{
  filePath: string;
  manifest: ModuleManifest;
  sha256: string;
  bytes: number;
  warnings: string[];
  releaseRecordPath?: string;
  releaseRecord?: ReleaseRecord;
}> {
  const check = await checkModuleDirectory(moduleDir);
  if (!check.valid) {
    throw new Error(check.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }
  const { entries, manifest, warnings } = await packagePayloadEntries(moduleDir);
  const checksums = buildChecksums(entries);
  const signature = buildSignature(manifest, checksums, signing);
  const allEntries: ZipEntry[] = [
    ...entries,
    { path: 'checksums.json', data: encoder.encode(JSON.stringify(checksums, null, 2) + '\n') },
    { path: 'signature.json', data: encoder.encode(JSON.stringify(signature, null, 2) + '\n') },
  ].sort((a, b) => a.path.localeCompare(b.path));
  const zip = createDeterministicZip(allEntries);
  await mkdir(outDir, { recursive: true });
  const filePath = join(outDir, `${manifest.slug}-${manifest.version}.nadmod`);
  await writeFile(filePath, zip);

  let releaseRecordPath: string | undefined;
  let releaseRecord: ReleaseRecord | undefined;
  if (signing.generateReleaseRecord) {
    const trustedKeys = signing.privateKeyPem && signing.keyId
      ? {
          [signing.keyId]: createPublicKey(createPrivateKey(signing.privateKeyPem))
            .export({ type: 'spki', format: 'pem' })
            .toString(),
        }
      : {};
    const generated = await generateReleaseRecord(moduleDir, filePath, outDir, {
      sourceRevision: signing.sourceRevision,
      trustedKeys,
      expectedKeyId: signing.keyId,
    });
    releaseRecordPath = generated.filePath;
    releaseRecord = generated.record;
  }

  return {
    filePath,
    manifest,
    sha256: sha256Hex(zip),
    bytes: zip.byteLength,
    warnings,
    releaseRecordPath,
    releaseRecord,
  };
}

function jsonEntry(entries: Map<string, Uint8Array>, path: string): unknown {
  const data = entries.get(path);
  if (!data) throw new Error(`${path} is missing.`);
  return JSON.parse(decoder.decode(data)) as unknown;
}

function expectedPackagePaths(manifest: ModuleManifest): Set<string> {
  const paths = new Set([...requiredPackagePaths, 'checksums.json', 'signature.json']);
  for (const entrypoint of Object.values(manifest.entrypoints)) {
    paths.add(entrypoint.requestSchema);
    paths.add(entrypoint.responseSchema);
  }
  return paths;
}

export interface PackageVerificationOptions {
  trustedKeys?: Record<string, string>;
  requireTrustedSignature?: boolean;
}

export async function verifyNadmod(
  filePath: string,
  options: PackageVerificationOptions = {},
): Promise<PackageVerification> {
  const bytes = await readFile(filePath);
  const zipEntries = readZipEntries(bytes);
  if (zipEntries.length > 200) throw new Error('Package contains too many files.');
  const entries = new Map(zipEntries.map(({ path, data }) => [path, data]));
  for (const { path, data } of zipEntries) {
    validateZipPath(path);
    if (data.byteLength > 2 * 1024 * 1024) throw new Error(`${path} is too large.`);
  }

  const manifest = assertValidManifest(jsonEntry(entries, 'manifest.json'));
  const widgets = jsonEntry(entries, 'ui/widgets.json');
  const pages = jsonEntry(entries, 'ui/pages.json');
  assertValidUiFiles(widgets, pages, manifest);
  const checksumsValue = jsonEntry(entries, 'checksums.json');
  if (!validateChecksums(checksumsValue)) throw new Error('checksums.json is invalid.');
  const checksums = checksumsValue;
  const signatureValue = jsonEntry(entries, 'signature.json');
  if (!validateSignature(signatureValue)) throw new Error('signature.json is invalid.');
  const signature = signatureValue;

  const expectedPaths = expectedPackagePaths(manifest);
  const actualPaths = new Set(entries.keys());
  for (const path of expectedPaths) {
    if (!actualPaths.has(path)) throw new Error(`${path} is missing.`);
  }
  for (const path of actualPaths) {
    if (!expectedPaths.has(path)) throw new Error(`${path} is not declared by the package contract.`);
  }
  for (const [path, digest] of Object.entries(checksums.files)) {
    const data = entries.get(path);
    if (!data) throw new Error(`${path} is listed in checksums.json but missing.`);
    if (sha256Hex(data) !== digest) throw new Error(`${path} checksum mismatch.`);
  }
  for (const path of actualPaths) {
    if (path === 'checksums.json' || path === 'signature.json') continue;
    if (!checksums.files[path]) throw new Error(`${path} is missing from checksums.json.`);
  }
  if (JSON.stringify(signature.signedPayload.files) !== JSON.stringify(checksums.files)) {
    throw new Error('signature payload does not match checksums.json.');
  }
  if (signature.signedPayload.moduleId !== manifest.id || signature.signedPayload.version !== manifest.version) {
    throw new Error('signature payload does not match manifest identity.');
  }
  let signatureVerified = false;
  if (signature.mode === 'signed') {
    const publicKeyPem = options.trustedKeys?.[signature.keyId];
    if (publicKeyPem) {
      const publicKey = createPublicKey(publicKeyPem);
      if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error(`Trusted key ${signature.keyId} must be Ed25519.`);
      const signatureBytes = Buffer.from(signature.signature, 'base64');
      const canonicalSignatureVerified = verifySignature(
        null,
        createSignatureEnvelope(manifest, checksums),
        publicKey,
        signatureBytes,
      );
      const legacySignatureVerified = manifest.schemaVersion === 1 && verifySignature(
        null,
        createLegacySignatureEnvelopeV1(manifest, checksums),
        publicKey,
        signatureBytes,
      );
      signatureVerified = canonicalSignatureVerified || legacySignatureVerified;
      if (!signatureVerified) throw new Error(`Signature verification failed for trusted key ${signature.keyId}.`);
    } else if (options.requireTrustedSignature) {
      throw new Error(`No trusted public key was supplied for ${signature.keyId}.`);
    }
  } else if (options.requireTrustedSignature) {
    throw new Error('Package is unsigned-dev and cannot satisfy trusted signature verification.');
  }

  const serverSource = decoder.decode(entries.get('server/main.js'));
  const serverIssues = forbiddenServerImportIssues(serverSource);
  if (serverIssues.length > 0) {
    throw new Error(serverIssues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }

  return {
    manifest,
    checksums,
    signature,
    signatureVerified,
    entries: [...actualPaths].sort(),
    warnings: signature.mode === 'unsigned-dev'
      ? [`${basename(filePath)} is unsigned-dev and requires NAD_ALLOW_UNSIGNED_MODULES=true in NAD core.`]
      : signatureVerified ? [] : [`${basename(filePath)} has signed metadata, but no trusted public key was supplied.`],
  };
}
