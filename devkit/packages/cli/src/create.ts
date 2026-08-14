import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleIdPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
function resolveTemplateRoot(): URL {
  const packaged = new URL('../templates/read-only/', import.meta.url);
  if (existsSync(fileURLToPath(packaged))) return packaged;
  const workbench = new URL('../../../templates/read-only/', import.meta.url);
  if (existsSync(fileURLToPath(workbench))) return workbench;
  throw new Error('NAD read-only scaffold template is missing from this CLI installation.');
}

interface CreateCommandOptions {
  id: string;
  name: string;
  publisher: string;
  slug: string;
  targetDir: string;
}

interface TemplateEntry {
  outputPath: string;
  data: Uint8Array;
}

function createUsage(): string {
  return '  nad-module create <target-dir> --id <reverse.domain.id> [--name <name>] [--publisher <publisher>]';
}

function defaultNameFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function requireFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.\n${createUsage()}`);
  }
  return value;
}

function parseCreateArgs(args: string[]): CreateCommandOptions {
  const positionals: string[] = [];
  let id: string | undefined;
  let name: string | undefined;
  let publisher: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--id') {
      id = requireFlagValue(args, index, '--id');
      index += 1;
      continue;
    }
    if (arg === '--name') {
      name = requireFlagValue(args, index, '--name');
      index += 1;
      continue;
    }
    if (arg === '--publisher') {
      publisher = requireFlagValue(args, index, '--publisher');
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown flag ${arg}.\n${createUsage()}`);
    }
    positionals.push(arg);
  }

  const targetArg = positionals[0];
  if (positionals.length !== 1 || targetArg === undefined) {
    throw new Error(`Create requires exactly one target directory.\n${createUsage()}`);
  }
  if (!id) {
    throw new Error(`The create command requires --id <reverse.domain.id>.\n${createUsage()}`);
  }
  if (!moduleIdPattern.test(id)) {
    throw new Error(`Module IDs must use an immutable reverse-domain format such as dev.example.my-module. Received ${id}.`);
  }

  const slug = id.split('.').at(-1) ?? '';
  if (!slugPattern.test(slug)) {
    throw new Error(`The derived slug ${slug} is invalid. Use a final ID segment that matches ${slugPattern.source}.`);
  }

  const resolvedName = (name ?? defaultNameFromSlug(slug)).trim();
  const resolvedPublisher = (publisher ?? 'Example Publisher').trim();
  if (!resolvedName) throw new Error('--name must be a non-empty string.');
  if (!resolvedPublisher) throw new Error('--publisher must be a non-empty string.');

  return {
    id,
    name: resolvedName,
    publisher: resolvedPublisher,
    slug,
    targetDir: resolve(targetArg),
  };
}

async function assertSafeTargetDirectory(targetDir: string): Promise<void> {
  const root = parse(targetDir).root;
  if (targetDir === root) {
    throw new Error(`Refusing to scaffold into ${targetDir}. Choose a dedicated module directory instead.`);
  }

  const cwd = resolve(process.cwd());
  if (targetDir === cwd) {
    throw new Error('Refusing to scaffold into the current working directory. Choose a new or empty directory instead.');
  }

  const targetName = basename(targetDir);
  if (!targetName || targetName === '.' || targetName === '..') {
    throw new Error(`Refusing unsafe target directory ${targetDir}.`);
  }

  try {
    const targetStat = await stat(targetDir);
    if (!targetStat.isDirectory()) {
      throw new Error(`Target ${targetDir} already exists and is not a directory.`);
    }
    const entries = await readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target ${targetDir} already exists and is non-empty.`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }

  const relativeTarget = relative(cwd, targetDir);
  if (relativeTarget === '') {
    throw new Error('Refusing unsafe target directory.');
  }
}

function replaceTemplateTokens(source: string, options: CreateCommandOptions): string {
  return source
    .replaceAll('__MODULE_ID__', options.id)
    .replaceAll('__MODULE_NAME__', options.name)
    .replaceAll('__MODULE_PUBLISHER__', options.publisher)
    .replaceAll('__MODULE_SLUG__', options.slug);
}

async function readTemplateEntries(
  directory: URL,
  options: CreateCommandOptions,
  prefix = '',
): Promise<TemplateEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: TemplateEntry[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryUrl = new URL(entry.name, directory);
    const outputName = entry.name.endsWith('.base64') ? entry.name.slice(0, -'.base64'.length) : entry.name;
    const outputPath = prefix ? join(prefix, outputName) : outputName;
    if (entry.isDirectory()) {
      results.push(...await readTemplateEntries(new URL(`${entry.name}/`, directory), options, outputPath));
      continue;
    }

    if (entry.name.endsWith('.base64')) {
      const encoded = (await readFile(entryUrl, 'utf8')).replace(/\s+/g, '');
      results.push({ outputPath, data: Buffer.from(encoded, 'base64') });
      continue;
    }

    const content = await readFile(entryUrl, 'utf8');
    results.push({
      outputPath,
      data: Buffer.from(replaceTemplateTokens(content, options), 'utf8'),
    });
  }

  return results;
}

export async function createModuleScaffold(args: string[]): Promise<string> {
  const options = parseCreateArgs(args);
  await assertSafeTargetDirectory(options.targetDir);
  await mkdir(options.targetDir, { recursive: true });

  const entries = await readTemplateEntries(resolveTemplateRoot(), options);
  for (const entry of entries.sort((left, right) => left.outputPath.localeCompare(right.outputPath))) {
    const outputPath = join(options.targetDir, entry.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, entry.data);
  }

  return options.targetDir;
}

export async function commandCreate(args: string[]): Promise<void> {
  const outputPath = await createModuleScaffold(args);
  console.log(`Created read-only Module scaffold at ${outputPath}`);
}
