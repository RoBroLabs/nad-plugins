import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readZipEntries } from './zip.js';
import { buildNadmod, checkModuleDirectory, verifyNadmod, type PackageSigningOptions, type PackageVerificationOptions } from './package.js';
import { buildNadPackageV2, checkPackageDirectoryV2, verifyNadPackageV2 } from './package-v2.js';

async function directorySchemaVersion(directory: string): Promise<number> {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as { schemaVersion?: unknown };
  return typeof manifest.schemaVersion === 'number' ? manifest.schemaVersion : 0;
}

async function archiveSchemaVersion(filePath: string): Promise<number> {
  const bytes = await readFile(filePath);
  const manifestEntry = readZipEntries(bytes).find((entry) => entry.path === 'manifest.json');
  if (!manifestEntry) throw new Error('manifest.json is missing.');
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data)) as { schemaVersion?: unknown };
  return typeof manifest.schemaVersion === 'number' ? manifest.schemaVersion : 0;
}

export async function checkPackageDirectory(directory: string) {
  try {
    const version = await directorySchemaVersion(directory);
    if (version === 1) return checkModuleDirectory(directory);
    if (version === 2) return checkPackageDirectoryV2(directory);
    return {
      valid: false,
      issues: [{ path: join(directory, 'manifest.json'), message: `Unsupported package schema version ${version}.` }],
      warnings: [],
    };
  } catch (error) {
    return {
      valid: false,
      issues: [{ path: directory, message: error instanceof Error ? error.message : String(error) }],
      warnings: [],
    };
  }
}

export async function buildNadPackage(directory: string, outDir: string, options: PackageSigningOptions = {}) {
  const version = await directorySchemaVersion(directory);
  if (version === 1) return buildNadmod(directory, outDir, options);
  if (version === 2) return buildNadPackageV2(directory, outDir, options);
  throw new Error(`Unsupported package schema version ${version}.`);
}

export async function verifyNadPackage(filePath: string, options: PackageVerificationOptions = {}) {
  const version = await archiveSchemaVersion(filePath);
  if (version === 1) return verifyNadmod(filePath, options);
  if (version === 2) return verifyNadPackageV2(filePath, options);
  throw new Error(`Unsupported package schema version ${version}.`);
}
