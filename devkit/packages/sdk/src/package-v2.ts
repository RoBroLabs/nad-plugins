import { createPrivateKey, createPublicKey, sign, verify as verifySignature } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { CONTRACT_V2_SHA256 } from './generated/v2/index.js';
import type { ChecksumsFile, ReleaseMetadata, SignatureFile, ValidationIssue, ValidationResult } from './types.js';
import type { PackageManifestV2, PackageReleaseRecordV2, PackageVerificationV2, SurfacesFileV2 } from './types-v2.js';
import { createDeterministicZip, readZipEntries, sha256Hex, validateZipPath, type ZipEntry } from './zip.js';
import { forbiddenServerImportIssues, validateChecksums, validateEndpointSchema, validateReleaseMetadata, validateSignature } from './validation.js';
import {
  assertValidConnectionProfileSchemaV2,
  assertValidPackageManifestV2,
  assertValidSurfacesV2,
  validateHttpAccessAgainstConnectionSchemaV2,
} from './validation-v2.js';
import { matchesCanonicalV2Schema } from './schema-validation-v2.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const baseRequiredPaths = ['manifest.json', 'ui/surfaces.json', 'README.md', 'LICENSE', 'assets/icon.png'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function readEndpointSchema(path: string, packagePath: string): Promise<Buffer> {
  const data = await readFile(path);
  const validation = validateEndpointSchema(JSON.parse(data.toString('utf8')) as unknown);
  if (!validation.valid) {
    throw new Error(validation.issues.map((issue) => `${packagePath}:${issue.path}: ${issue.message}`).join('\n'));
  }
  return data;
}

function validateSurfaceHtml(source: string, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (source.length === 0) issues.push({ path, message: 'must not be empty' });
  if (source.includes('\0')) issues.push({ path, message: 'must not contain NUL bytes' });
  if (source.length > 512 * 1024) issues.push({ path, message: 'must not exceed 512 KiB' });
  if (/<(?:base|iframe|object|embed|link)\b/i.test(source)) {
    issues.push({ path, message: 'must not embed nested browsing contexts or external resource elements' });
  }
  if (/\b(?:src|href|action)\s*=\s*["']\s*(?:https?:)?\/\//i.test(source) || /\bhttps?:\/\//i.test(source)) {
    issues.push({ path, message: 'must be self-contained and must not reference external network resources' });
  }
  return issues;
}

interface PackagePayloadV2 {
  entries: ZipEntry[];
  manifest: PackageManifestV2;
  surfaces: SurfacesFileV2;
  issues: ValidationIssue[];
  warnings: string[];
}

async function packagePayloadEntriesV2(packageDir: string): Promise<PackagePayloadV2> {
  const issues: ValidationIssue[] = [];
  const warnings: string[] = [];
  const manifestValue = await readJson(join(packageDir, 'manifest.json'));
  let manifest: PackageManifestV2;
  try {
    manifest = assertValidPackageManifestV2(manifestValue);
  } catch (error) {
    return {
      entries: [],
      manifest: manifestValue as PackageManifestV2,
      surfaces: { schemaVersion: 2, surfaces: [] },
      issues: String(error instanceof Error ? error.message : error).split('\n').map((message) => ({ path: 'manifest', message })),
      warnings,
    };
  }

  const surfacesValue = await readJson(join(packageDir, 'ui', 'surfaces.json'));
  let surfaces: SurfacesFileV2;
  try {
    surfaces = assertValidSurfacesV2(surfacesValue, manifest);
  } catch (error) {
    return {
      entries: [],
      manifest,
      surfaces: surfacesValue as SurfacesFileV2,
      issues: String(error instanceof Error ? error.message : error).split('\n').map((message) => ({ path: 'ui/surfaces.json', message })),
      warnings,
    };
  }

  const entries: ZipEntry[] = [
    { path: 'manifest.json', data: encoder.encode(JSON.stringify(manifestValue, null, 2) + '\n') },
    { path: 'ui/surfaces.json', data: await readFile(join(packageDir, 'ui', 'surfaces.json')) },
    { path: 'README.md', data: await readFile(join(packageDir, 'README.md')) },
    { path: 'LICENSE', data: await readFile(join(packageDir, 'LICENSE')) },
    { path: 'assets/icon.png', data: await readFile(join(packageDir, 'assets', 'icon.png')) },
  ];

  if (manifest.connections) {
    const connectionPath = join(packageDir, 'schemas', 'connections.json');
    const connectionValue = await readJson(connectionPath);
    try {
      const connectionSchema = assertValidConnectionProfileSchemaV2(connectionValue);
      const linked = validateHttpAccessAgainstConnectionSchemaV2(manifest, connectionSchema);
      issues.push(...linked.issues);
      entries.push({ path: 'schemas/connections.json', data: await readFile(connectionPath) });
    } catch (error) {
      issues.push(...String(error instanceof Error ? error.message : error).split('\n').map((message) => ({
        path: 'schemas/connections.json',
        message,
      })));
    }
  }

  for (const operation of Object.values(manifest.operations ?? {})) {
    for (const packagePath of [operation.requestSchema, operation.responseSchema]) {
      if (entries.some((entry) => entry.path === packagePath)) continue;
      entries.push({ path: packagePath, data: await readEndpointSchema(join(packageDir, packagePath), packagePath) });
    }
  }

  if (Object.keys(manifest.operations ?? {}).length > 0) {
    const server = await readFile(join(packageDir, 'dist', 'server', 'main.js'), 'utf8')
      .catch(() => readFile(join(packageDir, 'dist', 'server', 'server.js'), 'utf8'));
    issues.push(...forbiddenServerImportIssues(server));
    entries.push({ path: 'server/main.js', data: encoder.encode(server.endsWith('\n') ? server : `${server}\n`) });
  }

  for (const surface of surfaces.surfaces) {
    const data = await readFile(join(packageDir, surface.entry));
    issues.push(...validateSurfaceHtml(decoder.decode(data), surface.entry));
    entries.push({ path: surface.entry, data });
  }

  return {
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
    manifest,
    surfaces,
    issues,
    warnings,
  };
}

export async function checkPackageDirectoryV2(packageDir: string): Promise<ValidationResult> {
  try {
    const payload = await packagePayloadEntriesV2(packageDir);
    const paths = new Set(payload.entries.map((entry) => entry.path));
    for (const required of baseRequiredPaths) {
      if (!paths.has(required)) payload.issues.push({ path: required, message: 'required package file is missing' });
    }
    return { valid: payload.issues.length === 0, issues: payload.issues, warnings: payload.warnings };
  } catch (error) {
    return {
      valid: false,
      issues: [{ path: packageDir, message: error instanceof Error ? error.message : String(error) }],
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

export interface PackageSigningOptionsV2 {
  privateKeyPem?: string;
  keyId?: string;
  generateReleaseRecord?: boolean;
  sourceRevision?: string;
}

export function createSignatureEnvelopeV2(manifest: PackageManifestV2, checksums: ChecksumsFile): Buffer {
  const files = Object.fromEntries(Object.entries(checksums.files).sort(([left], [right]) => left.localeCompare(right)));
  return Buffer.from(JSON.stringify({
    moduleId: manifest.id,
    version: manifest.version,
    digestAlgorithm: checksums.algorithm,
    files,
  }), 'utf8');
}

function buildSignature(manifest: PackageManifestV2, checksums: ChecksumsFile, options: PackageSigningOptionsV2): SignatureFile {
  const signedPayload = {
    moduleId: manifest.id,
    version: manifest.version,
    digestAlgorithm: 'sha256' as const,
    files: checksums.files,
  };
  if (!options.privateKeyPem && !options.keyId) {
    return {
      schemaVersion: 1,
      mode: 'unsigned-dev',
      warning: 'Development package only. NAD core must explicitly permit unsigned packages.',
      signedPayload,
    };
  }
  if (!options.privateKeyPem || !options.keyId) throw new Error('Signing requires both a private key and key ID.');
  const privateKey = createPrivateKey(options.privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Package signing key must be Ed25519.');
  return {
    schemaVersion: 1,
    mode: 'signed',
    algorithm: 'Ed25519',
    keyId: options.keyId,
    signature: sign(null, createSignatureEnvelopeV2(manifest, checksums), privateKey).toString('base64'),
    signedPayload,
  };
}

function expectedPackagePaths(manifest: PackageManifestV2, surfaces: SurfacesFileV2): Set<string> {
  const paths = new Set([...baseRequiredPaths, 'checksums.json', 'signature.json']);
  if (manifest.connections) paths.add('schemas/connections.json');
  if (Object.keys(manifest.operations ?? {}).length > 0) paths.add('server/main.js');
  for (const operation of Object.values(manifest.operations ?? {})) {
    paths.add(operation.requestSchema);
    paths.add(operation.responseSchema);
  }
  for (const surface of surfaces.surfaces) paths.add(surface.entry);
  return paths;
}

function jsonEntry(entries: Map<string, Uint8Array>, path: string): unknown {
  const data = entries.get(path);
  if (!data) throw new Error(`${path} is missing.`);
  return JSON.parse(decoder.decode(data)) as unknown;
}

export interface PackageVerificationOptionsV2 {
  trustedKeys?: Record<string, string>;
  requireTrustedSignature?: boolean;
}

export async function verifyNadPackageV2(
  filePath: string,
  options: PackageVerificationOptionsV2 = {},
): Promise<PackageVerificationV2> {
  const bytes = await readFile(filePath);
  const zipEntries = readZipEntries(bytes);
  if (zipEntries.length > 200) throw new Error('Package contains too many files.');
  const entries = new Map(zipEntries.map(({ path, data }) => [path, data]));
  for (const { path, data } of zipEntries) {
    validateZipPath(path);
    if (data.byteLength > 2 * 1024 * 1024) throw new Error(`${path} is too large.`);
  }

  const manifest = assertValidPackageManifestV2(jsonEntry(entries, 'manifest.json'));
  const surfaces = assertValidSurfacesV2(jsonEntry(entries, 'ui/surfaces.json'), manifest);
  if (manifest.connections) {
    const connectionSchema = assertValidConnectionProfileSchemaV2(jsonEntry(entries, 'schemas/connections.json'));
    const linked = validateHttpAccessAgainstConnectionSchemaV2(manifest, connectionSchema);
    if (!linked.valid) throw new Error(linked.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }
  for (const operation of Object.values(manifest.operations ?? {})) {
    for (const path of [operation.requestSchema, operation.responseSchema]) {
      const validation = validateEndpointSchema(jsonEntry(entries, path));
      if (!validation.valid) throw new Error(`${path} is invalid.`);
    }
  }
  for (const surface of surfaces.surfaces) {
    const source = entries.get(surface.entry);
    if (!source) throw new Error(`${surface.entry} is missing.`);
    const htmlIssues = validateSurfaceHtml(decoder.decode(source), surface.entry);
    if (htmlIssues.length > 0) throw new Error(htmlIssues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }

  const checksumsValue = jsonEntry(entries, 'checksums.json');
  if (!validateChecksums(checksumsValue)) throw new Error('checksums.json is invalid.');
  const signatureValue = jsonEntry(entries, 'signature.json');
  if (!validateSignature(signatureValue)) throw new Error('signature.json is invalid.');
  const checksums = checksumsValue;
  const signature = signatureValue;

  const expectedPaths = expectedPackagePaths(manifest, surfaces);
  const actualPaths = new Set(entries.keys());
  for (const path of expectedPaths) if (!actualPaths.has(path)) throw new Error(`${path} is missing.`);
  for (const path of actualPaths) if (!expectedPaths.has(path)) throw new Error(`${path} is not declared by the package contract.`);
  for (const [path, digest] of Object.entries(checksums.files)) {
    const data = entries.get(path);
    if (!data || sha256Hex(data) !== digest) throw new Error(`${path} checksum mismatch.`);
  }
  for (const path of actualPaths) {
    if (path !== 'checksums.json' && path !== 'signature.json' && !checksums.files[path]) {
      throw new Error(`${path} is missing from checksums.json.`);
    }
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
      signatureVerified = verifySignature(
        null,
        createSignatureEnvelopeV2(manifest, checksums),
        publicKey,
        Buffer.from(signature.signature, 'base64'),
      );
      if (!signatureVerified) throw new Error(`Signature verification failed for trusted key ${signature.keyId}.`);
    } else if (options.requireTrustedSignature) {
      throw new Error(`No trusted public key was supplied for ${signature.keyId}.`);
    }
  } else if (options.requireTrustedSignature) {
    throw new Error('Package is unsigned-dev and cannot satisfy trusted signature verification.');
  }

  const server = entries.get('server/main.js');
  if (server) {
    const serverIssues = forbiddenServerImportIssues(decoder.decode(server));
    if (serverIssues.length > 0) throw new Error(serverIssues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }

  return {
    manifest,
    checksums,
    signature,
    signatureVerified,
    entries: [...actualPaths].sort(),
    warnings: signature.mode === 'unsigned-dev'
      ? [`${basename(filePath)} is unsigned-dev and requires an explicit development policy in NAD core.`]
      : signatureVerified ? [] : [`${basename(filePath)} is signed, but no trusted public key was supplied.`],
  };
}

function releaseMetadata(value: unknown): ReleaseMetadata {
  if (!validateReleaseMetadata(value)) throw new Error('release-metadata.json is invalid.');
  return value;
}

async function generateReleaseRecordV2(
  packageDir: string,
  artifactPath: string,
  outDir: string,
  verification: PackageVerificationV2,
  options: PackageSigningOptionsV2,
): Promise<{ filePath: string; record: PackageReleaseRecordV2 }> {
  const metadata = releaseMetadata(await readJson(join(packageDir, 'release-metadata.json')));
  const sourceRevision = options.sourceRevision ?? metadata.sourceRevision;
  if (!sourceRevision) throw new Error('sourceRevision is required to generate a v2 release record.');
  if (verification.signature.mode !== 'signed' || !verification.signatureVerified) {
    throw new Error('Release records require a trusted signed package.');
  }
  const bytes = await readFile(artifactPath);
  const manifest = verification.manifest;
  const record: PackageReleaseRecordV2 = {
    schemaVersion: 2,
    package: {
      kind: manifest.kind,
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
    contract: {
      packageSchema: 2,
      hostApi: '2.0',
      uiApi: '2.0',
      sha256: CONTRACT_V2_SHA256,
    },
    manifest,
    changelog: metadata.changelog,
    hotUpdate: metadata.hotUpdate,
    artifact: {
      fileName: basename(artifactPath),
      path: basename(artifactPath),
      bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
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
        { name: 'package-contract', passed: true, detail: 'Package passed canonical schema-v2 manifest, operation, connection and surface checks.' },
        { name: 'package-verification', passed: true, detail: `Package verification passed for ${verification.entries.length} immutable entries.` },
        { name: 'trusted-signature', passed: true, detail: `Package signature matches trusted key ${verification.signature.keyId}.` },
        ...(manifest.kind === 'addon'
          ? [{ name: 'dependency-contract' as const, passed: true, detail: 'Add-on bindings are restricted to signed dependency aliases and operation ranges.' }]
          : []),
        { name: 'sandbox-ui', passed: true, detail: 'Every custom UI surface is self-contained and declares UI bridge 2.x execution constraints.' },
      ],
    },
  };
  if (!matchesCanonicalV2Schema('releaseRecord', record)) throw new Error('Generated v2 release record failed its canonical schema.');
  await mkdir(outDir, { recursive: true });
  const filePath = join(outDir, `${manifest.slug}-${manifest.version}.release.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return { filePath, record };
}

export async function buildNadPackageV2(
  packageDir: string,
  outDir: string,
  signing: PackageSigningOptionsV2 = {},
): Promise<{
  filePath: string;
  manifest: PackageManifestV2;
  sha256: string;
  bytes: number;
  warnings: string[];
  releaseRecordPath?: string;
  releaseRecord?: PackageReleaseRecordV2;
}> {
  const check = await checkPackageDirectoryV2(packageDir);
  if (!check.valid) throw new Error(check.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  const payload = await packagePayloadEntriesV2(packageDir);
  const checksums = buildChecksums(payload.entries);
  const signature = buildSignature(payload.manifest, checksums, signing);
  const allEntries: ZipEntry[] = [
    ...payload.entries,
    { path: 'checksums.json', data: encoder.encode(JSON.stringify(checksums, null, 2) + '\n') },
    { path: 'signature.json', data: encoder.encode(JSON.stringify(signature, null, 2) + '\n') },
  ].sort((left, right) => left.path.localeCompare(right.path));
  const zip = createDeterministicZip(allEntries);
  await mkdir(outDir, { recursive: true });
  const filePath = join(outDir, `${payload.manifest.slug}-${payload.manifest.version}.nadmod`);
  await writeFile(filePath, zip);

  let releaseRecordPath: string | undefined;
  let record: PackageReleaseRecordV2 | undefined;
  if (signing.generateReleaseRecord) {
    if (!signing.privateKeyPem || !signing.keyId) throw new Error('Release-record generation requires a signed package.');
    const publicKey = createPublicKey(createPrivateKey(signing.privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString();
    const verification = await verifyNadPackageV2(filePath, {
      trustedKeys: { [signing.keyId]: publicKey },
      requireTrustedSignature: true,
    });
    const generated = await generateReleaseRecordV2(packageDir, filePath, outDir, verification, signing);
    releaseRecordPath = generated.filePath;
    record = generated.record;
  }

  return {
    filePath,
    manifest: payload.manifest,
    sha256: sha256Hex(zip),
    bytes: zip.byteLength,
    warnings: payload.warnings,
    ...(releaseRecordPath ? { releaseRecordPath } : {}),
    ...(record ? { releaseRecord: record } : {}),
  };
}

export async function listPackageSourceFilesV2(packageDir: string): Promise<string[]> {
  const payload = await packagePayloadEntriesV2(packageDir);
  return payload.entries.map((entry) => entry.path);
}
