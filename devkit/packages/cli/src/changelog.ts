import { readFile, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { validateManifest, validateReleaseMetadata, type ModuleManifest, type ReleaseMetadata } from '@nad/sdk';

function valuesAfter(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1] as string);
  }
  return values;
}

function valueAfter(args: string[], flag: string): string | undefined {
  return valuesAfter(args, flag)[0];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function existingMetadata(moduleDir: string): Promise<ReleaseMetadata | undefined> {
  try {
    const value = await readJson(resolve(moduleDir, 'release-metadata.json'));
    if (!validateReleaseMetadata(value)) throw new Error('Existing release-metadata.json does not match contract v1.');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function commandChangelog(args: string[]): Promise<void> {
  const moduleArg = args[0];
  if (!moduleArg) {
    throw new Error('Usage: nad-module changelog <module-dir> --summary <text> --entry <text> [--entry <text> ...] --preserve <contract> [--released-at YYYY-MM-DD]');
  }
  const moduleDir = resolve(moduleArg);
  const manifestValue = await readJson(resolve(moduleDir, 'manifest.json'));
  const manifestValidation = validateManifest(manifestValue);
  if (!manifestValidation.valid) {
    throw new Error(`manifest.json is invalid:\n${manifestValidation.issues.map(({ path, message }) => `${path}: ${message}`).join('\n')}`);
  }
  const manifest = manifestValue as ModuleManifest;
  const summary = valueAfter(args, '--summary')?.trim();
  const entries = valuesAfter(args, '--entry').map((entry) => entry.trim()).filter(Boolean);
  const preserves = valuesAfter(args, '--preserve').map((entry) => entry.trim()).filter(Boolean);
  if (!summary || entries.length === 0 || preserves.length === 0) {
    throw new Error('Changelog generation requires --summary, at least one --entry, and at least one --preserve value.');
  }
  const previous = await existingMetadata(moduleDir);
  const releasedAt = valueAfter(args, '--released-at') ?? today();
  const sourceDirectory = valueAfter(args, '--source-directory')
    ?? previous?.sourceDirectory
    ?? relative(process.cwd(), moduleDir).replaceAll('\\', '/')
    ?? basename(moduleDir);
  const license = valueAfter(args, '--license') ?? previous?.license ?? 'AGPL-3.0-only';
  const metadata: ReleaseMetadata = {
    schemaVersion: 1,
    releasedAt,
    sourceDirectory: sourceDirectory || basename(moduleDir),
    license,
    ...(previous?.repositoryUrl === undefined ? {} : { repositoryUrl: previous.repositoryUrl }),
    ...(previous?.sourceUrl === undefined ? {} : { sourceUrl: previous.sourceUrl }),
    ...(previous?.sourceTag === undefined ? {} : { sourceTag: previous.sourceTag }),
    changelog: { summary, entries },
    hotUpdate: { compatibility: 'compatible', preserves },
  };
  if (!validateReleaseMetadata(metadata)) throw new Error('Generated release metadata does not match contract v1.');

  await writeFile(resolve(moduleDir, 'release-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  const changelogPath = resolve(moduleDir, 'CHANGELOG.md');
  let existing = '';
  try {
    existing = await readFile(changelogPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const heading = '# Changelog\n\n';
  const priorBody = existing.startsWith(heading) ? existing.slice(heading.length) : existing;
  const section = `## ${manifest.version} — ${releasedAt}\n\n${summary}\n\n${entries.map((entry) => `- ${entry}`).join('\n')}\n\n`;
  const withoutSameVersion = priorBody.replace(new RegExp(`^## ${manifest.version.replaceAll('.', '\\.')} — [^\\n]+\\n[\\s\\S]*?(?=^## |$)`, 'm'), '');
  await writeFile(changelogPath, `${heading}${section}${withoutSameVersion.trimStart()}`, 'utf8');
  console.log(`Updated ${resolve(moduleDir, 'release-metadata.json')}`);
  console.log(`Updated ${changelogPath}`);
}
