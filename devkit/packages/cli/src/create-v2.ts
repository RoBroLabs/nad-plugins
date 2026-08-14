import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageIdPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
function templateRoot(name: 'app-v2' | 'addon-v2'): URL {
  const packaged = new URL(`../templates/${name}/`, import.meta.url);
  if (existsSync(fileURLToPath(packaged))) return packaged;
  const workbench = new URL(`../../../templates/${name}/`, import.meta.url);
  if (existsSync(fileURLToPath(workbench))) return workbench;
  throw new Error(`NAD scaffold template ${name} is missing from this CLI installation.`);
}

const templateRoots = { app: 'app-v2', addon: 'addon-v2' } as const;

type PackageKind = keyof typeof templateRoots;

interface CreateV2Options {
  kind: PackageKind;
  targetDir: string;
  id: string;
  slug: string;
  name: string;
  publisher: string;
  appId?: string;
  appVersion: string;
}

function usage(kind: PackageKind): string {
  return kind === 'app'
    ? '  nad app create <target-dir> --id <reverse.domain.id> [--name <name>] [--publisher <publisher>]'
    : '  nad addon create <target-dir> --id <reverse.domain.id> --app <app-id> [--app-version <range>] [--name <name>] [--publisher <publisher>]';
}

function defaultName(slug: string): string {
  return slug.split('-').filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ');
}

function parseOptions(kind: PackageKind, args: string[]): CreateV2Options {
  if (args[0] !== 'create') throw new Error(usage(kind));
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.\n${usage(kind)}`);
      if (!['--id', '--name', '--publisher', '--app', '--app-version'].includes(arg)) {
        throw new Error(`Unknown flag ${arg}.\n${usage(kind)}`);
      }
      flags.set(arg, value);
      index += 1;
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== 1 || !positionals[0]) throw new Error(usage(kind));
  const id = flags.get('--id');
  if (!id || !packageIdPattern.test(id)) throw new Error(`--id must be an immutable reverse-domain package ID.\n${usage(kind)}`);
  const appId = flags.get('--app');
  if (kind === 'addon' && (!appId || !packageIdPattern.test(appId))) {
    throw new Error(`--app must name the immutable reverse-domain ID of the owning App.\n${usage(kind)}`);
  }
  if (kind === 'app' && (appId || flags.has('--app-version'))) throw new Error(`App scaffolds do not accept --app.\n${usage(kind)}`);
  const slug = id.split('.').at(-1) ?? '';
  return {
    kind,
    targetDir: resolve(positionals[0]),
    id,
    slug,
    name: flags.get('--name')?.trim() || defaultName(slug),
    publisher: flags.get('--publisher')?.trim() || 'Example Publisher',
    ...(appId ? { appId } : {}),
    appVersion: flags.get('--app-version')?.trim() || '>=2.0.0 <3.0.0',
  };
}

async function assertSafeTarget(targetDir: string): Promise<void> {
  if (targetDir === parse(targetDir).root || targetDir === resolve(process.cwd()) || !basename(targetDir)) {
    throw new Error(`Refusing unsafe scaffold target ${targetDir}.`);
  }
  try {
    const target = await stat(targetDir);
    if (!target.isDirectory()) throw new Error(`Target ${targetDir} is not a directory.`);
    if ((await readdir(targetDir)).length > 0) throw new Error(`Target ${targetDir} is non-empty.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function replaceTokens(source: string, options: CreateV2Options): string {
  return source
    .replaceAll('__PACKAGE_ID__', options.id)
    .replaceAll('__PACKAGE_SLUG__', options.slug)
    .replaceAll('__PACKAGE_NAME__', options.name)
    .replaceAll('__PACKAGE_PUBLISHER__', options.publisher)
    .replaceAll('__APP_ID__', options.appId ?? options.id)
    .replaceAll('__APP_VERSION__', options.appVersion);
}

async function copyTemplate(directory: URL, outputRoot: string, options: CreateV2Options, prefix = ''): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const source = new URL(entry.name, directory);
    const outputName = entry.name.endsWith('.base64') ? entry.name.slice(0, -'.base64'.length) : entry.name;
    const relativePath = prefix ? join(prefix, outputName) : outputName;
    if (entry.isDirectory()) {
      await copyTemplate(new URL(`${entry.name}/`, directory), outputRoot, options, relativePath);
      continue;
    }
    const outputPath = join(outputRoot, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    if (entry.name.endsWith('.base64')) {
      const encoded = (await readFile(source, 'utf8')).replace(/\s+/g, '');
      await writeFile(outputPath, Buffer.from(encoded, 'base64'));
    } else {
      await writeFile(outputPath, replaceTokens(await readFile(source, 'utf8'), options), 'utf8');
    }
  }
}

export async function createV2Scaffold(kind: PackageKind, args: string[]): Promise<string> {
  const options = parseOptions(kind, args);
  await assertSafeTarget(options.targetDir);
  await mkdir(options.targetDir, { recursive: true });
  await copyTemplate(templateRoot(templateRoots[kind]), options.targetDir, options);
  return options.targetDir;
}

export async function commandCreateV2(kind: PackageKind, args: string[]): Promise<void> {
  const output = await createV2Scaffold(kind, args);
  console.log(`Created NAD ${kind === 'app' ? 'App' : 'Add-on'} scaffold at ${output}`);
}
