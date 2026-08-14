import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HostConfigValue, ModuleManifest, ModuleRequest, PagesFile, TimeoutClass, WidgetsFile } from '@nad/sdk';
import { checkModuleDirectory } from '@nad/sdk';
import { createFakeHost, type FakeHost, type FakeHostResponseFixture } from './fake-host.js';

const scenarioFilePattern = /\.v1\.json$/;
const timeoutByClass: Record<TimeoutClass, number> = {
  short: 100,
  standard: 250,
  action: 500,
};

export interface DevScenarioRole {
  label?: string;
  grants: string[];
}

export interface DevScenarioResponseFixture {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  fixture?: string;
  delayMs?: number;
}

export interface DevScenarioRequestFixture {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

export interface DevScenario {
  schemaVersion: 1;
  name: string;
  description?: string;
  defaultRole?: string;
  roles?: Record<string, DevScenarioRole>;
  config?: Record<string, HostConfigValue>;
  requests?: Record<string, DevScenarioRequestFixture>;
  responses?: Record<string, DevScenarioResponseFixture>;
}

export interface LoadedDevScenario {
  filePath: string;
  fileName: string;
  directory: string;
  document: DevScenario;
}

export interface LoadedDevModule {
  moduleDir: string;
  manifest: ModuleManifest;
  pages: PagesFile;
  widgets: WidgetsFile;
  handlers: Record<string, unknown>;
}

export interface DevEndpointResult {
  endpoint: string;
  handler: string;
  permission: string;
  timeoutMs: number;
  request: ModuleRequest;
  access: {
    allowed: boolean;
    role: string;
    grants: string[];
  };
  status: 'ok' | 'denied' | 'error' | 'timeout';
  durationMs: number;
  response?: unknown;
  error?: string;
  sideEffects: {
    notifications: ReturnType<typeof serialiseNotifications>;
    audit: ReturnType<typeof serialiseAudit>;
    storage: {
      snapshot: Record<string, unknown>;
      log: ReturnType<typeof serialiseStorageLog>;
    };
    http: {
      requests: ReturnType<typeof serialiseHttpLog>;
    };
    configReads: string[];
  };
}

export interface DevRunResult {
  schemaVersion: 1;
  module: {
    id: string;
    slug: string;
    name: string;
    version: string;
  };
  scenario: {
    name: string;
    file: string;
    description?: string;
  };
  role: {
    name: string;
    grants: string[];
  };
  config: Record<string, HostConfigValue>;
  pages: PagesFile;
  widgets: WidgetsFile;
  endpoints: Record<string, DevEndpointResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function sanitiseConfig(config: Record<string, HostConfigValue> | undefined): Record<string, HostConfigValue> {
  return Object.fromEntries(
    Object.entries(config ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, cloneJson(value)]),
  );
}

function serialiseNotifications(host: FakeHost): Array<{
  key: string;
  severity: string;
  title: string;
  body: string;
  dedupeKey?: string;
}> {
  return host.notificationsLog.map((entry) => ({ ...entry }));
}

function serialiseAudit(host: FakeHost): Record<string, string | number | boolean | null>[] {
  return host.auditLog.map((entry) => ({ ...entry }));
}

function serialiseStorageLog(host: FakeHost): Array<{ action: 'set' | 'delete'; key: string; value?: unknown }> {
  return host.storageLog.map((entry) => ({ ...entry, value: cloneJson(entry.value) }));
}

function serialiseStorageSnapshot(host: FakeHost): Record<string, unknown> {
  return Object.fromEntries(
    [...host.storageValues.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, cloneJson(value)]),
  );
}

function serialiseHttpLog(host: FakeHost): Array<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}> {
  return host.httpLog.map((entry) => ({
    url: entry.url,
    method: entry.method,
    headers: { ...entry.headers },
    body: cloneJson(entry.body),
  }));
}

function normaliseRole(roleName: string | undefined, scenario: LoadedDevScenario): { name: string; grants: string[] } {
  const roles = scenario.document.roles ?? { viewer: { grants: ['view'] } };
  const resolvedName = roleName ?? scenario.document.defaultRole ?? Object.keys(roles).sort()[0];
  if (!resolvedName) {
    throw new Error(`Scenario ${scenario.fileName} does not declare any roles.`);
  }
  const role = roles[resolvedName];
  if (!role) {
    throw new Error(`Scenario ${scenario.fileName} does not declare a role named ${resolvedName}.`);
  }
  return {
    name: resolvedName,
    grants: [...role.grants].sort(),
  };
}

function validateScenario(value: unknown, filePath: string): DevScenario {
  if (!isRecord(value)) throw new Error(`${filePath} must contain an object.`);
  if (value.schemaVersion !== 1) throw new Error(`${filePath} must use schemaVersion 1.`);
  const name = asString(value.name);
  if (!name) throw new Error(`${filePath} must declare a non-empty name.`);

  const roles = value.roles;
  if (roles !== undefined) {
    if (!isRecord(roles)) throw new Error(`${filePath} roles must be an object.`);
    for (const [roleName, definition] of Object.entries(roles)) {
      if (!isRecord(definition)) throw new Error(`${filePath} roles.${roleName} must be an object.`);
      if (!Array.isArray(definition.grants) || definition.grants.some((grant) => typeof grant !== 'string' || grant.trim() === '')) {
        throw new Error(`${filePath} roles.${roleName}.grants must be a string array.`);
      }
    }
  }

  return cloneJson(value as unknown as DevScenario);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function resolveFixtureBody(scenario: LoadedDevScenario, fixture: string): Promise<unknown> {
  const fixturePath = resolve(scenario.directory, fixture);
  const raw = await readFile(fixturePath, 'utf8');
  if (fixturePath.endsWith('.json')) {
    return JSON.parse(raw) as unknown;
  }
  return raw;
}

async function buildResponseFixtures(scenario: LoadedDevScenario): Promise<Record<string, FakeHostResponseFixture>> {
  const responses = scenario.document.responses ?? {};
  const entries = await Promise.all(
    Object.entries(responses).map(async ([url, response]) => {
      const body = response.fixture ? await resolveFixtureBody(scenario, response.fixture) : cloneJson(response.body);
      return [url, {
        status: response.status,
        headers: { ...(response.headers ?? {}) },
        body,
        delayMs: response.delayMs,
      } satisfies FakeHostResponseFixture] as const;
    }),
  );
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function buildRequest(endpoint: string, manifest: ModuleManifest, scenario: LoadedDevScenario): ModuleRequest {
  const entrypoint = manifest.entrypoints[endpoint];
  if (!entrypoint) throw new Error(`Unknown endpoint ${endpoint}.`);
  const fixture = scenario.document.requests?.[endpoint];
  return {
    method: fixture?.method ?? entrypoint.method,
    ...(fixture?.body !== undefined ? { body: cloneJson(fixture.body) } : {}),
  };
}

function trimError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 400 ? `${message.slice(0, 397)}...` : message;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<
  | { status: 'ok'; value: T; durationMs: number }
  | { status: 'timeout'; durationMs: number }
> {
  const startedAt = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ status: 'timeout'; durationMs: number }>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ status: 'timeout', durationMs: Date.now() - startedAt });
    }, timeoutMs);
  });
  const result = await Promise.race([
    promise.then((value) => ({ status: 'ok' as const, value, durationMs: Date.now() - startedAt })),
    timeoutPromise,
  ]);
  if (timeoutId) clearTimeout(timeoutId);
  return result;
}

function collectSideEffects(host: FakeHost): DevEndpointResult['sideEffects'] {
  return {
    notifications: serialiseNotifications(host),
    audit: serialiseAudit(host),
    storage: {
      snapshot: serialiseStorageSnapshot(host),
      log: serialiseStorageLog(host),
    },
    http: {
      requests: serialiseHttpLog(host),
    },
    configReads: [...host.configLog],
  };
}

export async function listDevScenarios(moduleDir: string): Promise<string[]> {
  const directory = join(resolve(moduleDir), 'fixtures', 'scenarios');
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && scenarioFilePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function loadDevScenario(moduleDir: string, scenarioRef?: string): Promise<LoadedDevScenario> {
  const resolvedModuleDir = resolve(moduleDir);
  const available = await listDevScenarios(resolvedModuleDir);
  const scenarioFile = scenarioRef
    ? resolveScenarioPath(resolvedModuleDir, available, scenarioRef)
    : available.includes('default.v1.json')
      ? join(resolvedModuleDir, 'fixtures', 'scenarios', 'default.v1.json')
      : available[0]
        ? join(resolvedModuleDir, 'fixtures', 'scenarios', available[0])
        : undefined;
  if (!scenarioFile) {
    throw new Error(`No versioned scenario fixtures were found in ${join(resolvedModuleDir, 'fixtures', 'scenarios')}.`);
  }
  const document = validateScenario(await readJsonFile<unknown>(scenarioFile), scenarioFile);
  return {
    filePath: scenarioFile,
    fileName: basename(scenarioFile),
    directory: dirname(scenarioFile),
    document,
  };
}

function resolveScenarioPath(moduleDir: string, available: string[], scenarioRef: string): string {
  if (scenarioRef.includes('/') || scenarioRef.includes('\\') || scenarioRef.endsWith('.json')) {
    return resolve(moduleDir, scenarioRef);
  }
  const matched = available.find((entry) => entry === scenarioRef || entry.replace(/\.v1\.json$/, '') === scenarioRef);
  if (!matched) {
    throw new Error(`Scenario ${scenarioRef} was not found. Available scenarios: ${available.join(', ') || 'none'}.`);
  }
  return join(moduleDir, 'fixtures', 'scenarios', matched);
}

export async function loadDevModule(moduleDir: string): Promise<LoadedDevModule> {
  const resolvedModuleDir = resolve(moduleDir);
  const contract = await checkModuleDirectory(resolvedModuleDir);
  if (!contract.valid) {
    throw new Error(contract.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'));
  }

  const manifest = await readJsonFile<ModuleManifest>(join(resolvedModuleDir, 'manifest.json'));
  const pages = await readJsonFile<PagesFile>(join(resolvedModuleDir, 'ui', 'pages.json'));
  const widgets = await readJsonFile<WidgetsFile>(join(resolvedModuleDir, 'ui', 'widgets.json'));
  const serverPath = await resolveBuiltServerFile(resolvedModuleDir);
  const moduleUrl = `${pathToFileURL(serverPath).href}?preview=${Date.now()}`;
  const handlers = await import(moduleUrl) as Record<string, unknown>;

  return {
    moduleDir: resolvedModuleDir,
    manifest,
    pages,
    widgets,
    handlers,
  };
}

async function resolveBuiltServerFile(moduleDir: string): Promise<string> {
  const preferred = [join(moduleDir, 'dist', 'server', 'main.js'), join(moduleDir, 'dist', 'server', 'server.js')];
  for (const candidate of preferred) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`No built server entrypoint was found in ${join(moduleDir, 'dist', 'server')}. Run the Module build first.`);
}

export async function runDevEndpoint(
  loadedModule: LoadedDevModule,
  scenario: LoadedDevScenario,
  endpoint: string,
  roleName?: string,
): Promise<DevEndpointResult> {
  const entrypoint = loadedModule.manifest.entrypoints[endpoint];
  if (!entrypoint) throw new Error(`Unknown endpoint ${endpoint}.`);

  const role = normaliseRole(roleName, scenario);
  const request = buildRequest(endpoint, loadedModule.manifest, scenario);
  const accessAllowed = role.grants.includes(entrypoint.permission) || role.grants.includes('*');
  if (!accessAllowed) {
    return {
      endpoint,
      handler: entrypoint.handler,
      permission: entrypoint.permission,
      timeoutMs: timeoutByClass[entrypoint.timeoutClass],
      request,
      access: {
        allowed: false,
        role: role.name,
        grants: role.grants,
      },
      status: 'denied',
      durationMs: 0,
      error: `Role ${role.name} does not grant ${entrypoint.permission}.`,
      sideEffects: {
        notifications: [],
        audit: [],
        storage: { snapshot: {}, log: [] },
        http: { requests: [] },
        configReads: [],
      },
    };
  }

  const handler = loadedModule.handlers[entrypoint.handler];
  if (typeof handler !== 'function') {
    throw new Error(`Built server export ${entrypoint.handler} is missing or not a function.`);
  }

  const host = createFakeHost({
    config: sanitiseConfig(scenario.document.config),
    responses: await buildResponseFixtures(scenario),
  });

  const timeoutMs = timeoutByClass[entrypoint.timeoutClass];
  try {
    const outcome = await withTimeout(Promise.resolve((handler as (request: ModuleRequest, host: FakeHost) => unknown)(request, host)), timeoutMs);
    if (outcome.status === 'timeout') {
      return {
        endpoint,
        handler: entrypoint.handler,
        permission: entrypoint.permission,
        timeoutMs,
        request,
        access: {
          allowed: true,
          role: role.name,
          grants: role.grants,
        },
        status: 'timeout',
        durationMs: outcome.durationMs,
        error: `Handler exceeded the ${entrypoint.timeoutClass} timeout budget.`,
        sideEffects: collectSideEffects(host),
      };
    }

    return {
      endpoint,
      handler: entrypoint.handler,
      permission: entrypoint.permission,
      timeoutMs,
      request,
      access: {
        allowed: true,
        role: role.name,
        grants: role.grants,
      },
      status: 'ok',
      durationMs: outcome.durationMs,
      response: cloneJson(outcome.value),
      sideEffects: collectSideEffects(host),
    };
  } catch (error) {
    return {
      endpoint,
      handler: entrypoint.handler,
      permission: entrypoint.permission,
      timeoutMs,
      request,
      access: {
        allowed: true,
        role: role.name,
        grants: role.grants,
      },
      status: 'error',
      durationMs: 0,
      error: trimError(error),
      sideEffects: collectSideEffects(host),
    };
  }
}

export async function runDevSession(options: {
  moduleDir: string;
  scenario?: string;
  role?: string;
  endpoint?: string;
}): Promise<DevRunResult> {
  const loadedModule = await loadDevModule(options.moduleDir);
  const scenario = await loadDevScenario(options.moduleDir, options.scenario);
  const role = normaliseRole(options.role, scenario);
  const endpointNames = options.endpoint
    ? [options.endpoint]
    : Object.keys(loadedModule.manifest.entrypoints).sort((left, right) => left.localeCompare(right));

  const endpointEntries = await Promise.all(
    endpointNames.map(async (endpoint) => [endpoint, await runDevEndpoint(loadedModule, scenario, endpoint, role.name)] as const),
  );

  return {
    schemaVersion: 1,
    module: {
      id: loadedModule.manifest.id,
      slug: loadedModule.manifest.slug,
      name: loadedModule.manifest.name,
      version: loadedModule.manifest.version,
    },
    scenario: {
      name: scenario.document.name,
      file: scenario.fileName,
      ...(scenario.document.description ? { description: scenario.document.description } : {}),
    },
    role,
    config: sanitiseConfig(scenario.document.config),
    pages: cloneJson(loadedModule.pages),
    widgets: cloneJson(loadedModule.widgets),
    endpoints: Object.fromEntries(endpointEntries.sort(([left], [right]) => left.localeCompare(right))),
  };
}
