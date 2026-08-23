import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertValidPackageManifestV2,
  assertValidSurfacesV2,
  type PackageManifestV2,
} from '@nad/sdk';
import { createFakeHostV2 } from './fake-host-v2.js';

export interface DevScenarioV2Profile {
  id: string;
  name: string;
  values: Record<string, unknown>;
}

export interface DevScenarioV2 {
  schemaVersion: 2;
  name: string;
  profiles: DevScenarioV2Profile[];
  selectedProfileId: string;
  roles: Record<string, { grants: string[] }>;
  defaultRole: string;
  appOperations?: Record<string, unknown>;
}

export interface DevPreviewOperationV2 {
  status: 'ok' | 'denied' | 'error';
  response?: unknown;
  error?: string;
}

export interface DevPreviewV2 {
  schemaVersion: 2;
  package: Pick<PackageManifestV2, 'id' | 'slug' | 'name' | 'version' | 'kind'>;
  scenario: string;
  role: string;
  profile: Pick<DevScenarioV2Profile, 'id' | 'name'>;
  operations: Record<string, DevPreviewOperationV2>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function previewConnectionValues(values: Record<string, unknown>): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') output[key] = value;
  }
  return output;
}

export async function loadDevScenarioV2(packageDir: string, name = 'default.v2.json'): Promise<DevScenarioV2> {
  const path = join(resolve(packageDir), 'fixtures', 'scenarios', name);
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(value) || value.schemaVersion !== 2 || typeof value.name !== 'string') {
    throw new Error(`${path} must contain a schemaVersion 2 scenario.`);
  }
  if (!Array.isArray(value.profiles) || value.profiles.length === 0 || typeof value.selectedProfileId !== 'string') {
    throw new Error(`${path} must declare named profiles and selectedProfileId.`);
  }
  const profiles = value.profiles.filter(isRecord);
  if (!profiles.some((profile) => profile.id === value.selectedProfileId)) {
    throw new Error(`${path} selectedProfileId must reference a declared profile.`);
  }
  if (!isRecord(value.roles) || typeof value.defaultRole !== 'string' || !Object.hasOwn(value.roles, value.defaultRole)) {
    throw new Error(`${path} must declare a valid default role.`);
  }
  return value as unknown as DevScenarioV2;
}

export async function listDevScenariosV2(packageDir: string): Promise<string[]> {
  const directory = join(resolve(packageDir), 'fixtures', 'scenarios');
  return (await readdir(directory))
    .filter((name) => name.endsWith('.v2.json'))
    .sort((left, right) => left.localeCompare(right));
}

function scenarioFileName(name: string | undefined): string {
  if (!name) return 'default.v2.json';
  return name.endsWith('.json') ? name : `${name}.v2.json`;
}

export function resolveDevProfileV2(scenario: DevScenarioV2, profileId?: string): DevScenarioV2Profile {
  const resolved = scenario.profiles.find((profile) => profile.id === (profileId ?? scenario.selectedProfileId));
  if (!resolved) throw new Error('CONNECTION_PROFILE_UNAVAILABLE');
  return JSON.parse(JSON.stringify(resolved)) as DevScenarioV2Profile;
}

export function requireDevPermissionV2(scenario: DevScenarioV2, permission: string, role = scenario.defaultRole): void {
  const grants = scenario.roles[role]?.grants ?? [];
  if (!grants.includes('*') && !grants.includes(permission)) throw new Error('SURFACE_ACCESS_DENIED');
}

/**
 * Execute a bounded, fixture-only schema-v2 preview. This intentionally does
 * not emulate the NAD browser bridge: it proves a generated package's App
 * operation or Add-on binding without making network requests or reading a
 * real connection secret. Browser/sandbox behaviour is proven against core.
 */
export async function runDevPreviewV2(options: {
  packageDir: string;
  scenario?: string;
  role?: string;
  operation?: string;
}): Promise<DevPreviewV2> {
  const packageDir = resolve(options.packageDir);
  const manifest = assertValidPackageManifestV2(JSON.parse(await readFile(join(packageDir, 'manifest.json'), 'utf8')));
  const surfaces = assertValidSurfacesV2(JSON.parse(await readFile(join(packageDir, 'ui', 'surfaces.json'), 'utf8')), manifest);
  const scenarioName = scenarioFileName(options.scenario);
  const scenario = await loadDevScenarioV2(packageDir, scenarioName);
  const role = options.role ?? scenario.defaultRole;
  const profile = resolveDevProfileV2(scenario);
  const operations: Record<string, DevPreviewOperationV2> = {};

  if (manifest.kind === 'app') {
    const selected = options.operation ?? Object.keys(manifest.operations ?? {})[0];
    if (!selected || !manifest.operations?.[selected]) throw new Error('APP_OPERATION_UNAVAILABLE');
    const operation = manifest.operations[selected];
    try {
      requireDevPermissionV2(scenario, operation.permission, role);
      const module = await import(pathToFileURL(join(packageDir, 'dist', 'server', 'server.js')).href) as Record<string, unknown>;
      const handler = module[operation.handler];
      if (typeof handler !== 'function') throw new Error('APP_OPERATION_HANDLER_UNAVAILABLE');
      const host = createFakeHostV2({
        connection: { id: profile.id, name: profile.name },
        values: previewConnectionValues(profile.values),
      });
      operations[selected] = {
        status: 'ok',
        response: await handler({ body: {} }, host),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      operations[selected] = {
        status: message === 'SURFACE_ACCESS_DENIED' ? 'denied' : 'error',
        error: message,
      };
    }
  } else {
    const host = createFakeHostV2({
      connection: { id: profile.id, name: profile.name },
      values: previewConnectionValues(profile.values),
      appOperations: scenario.appOperations,
    });
    for (const surface of surfaces.surfaces) {
      for (const [bindingId, binding] of Object.entries(surface.bindings)) {
        try {
          requireDevPermissionV2(scenario, surface.permissions[0] ?? 'view', role);
          operations[`${surface.id}.${bindingId}`] = {
            status: 'ok',
            response: await host.apps.invoke({
              dependency: binding.target,
              operation: binding.operation,
              connectionProfileId: profile.id,
              input: {},
            }),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          operations[`${surface.id}.${bindingId}`] = {
            status: message === 'SURFACE_ACCESS_DENIED' ? 'denied' : 'error',
            error: message,
          };
        }
      }
    }
  }

  return {
    schemaVersion: 2,
    package: {
      id: manifest.id,
      slug: manifest.slug,
      name: manifest.name,
      version: manifest.version,
      kind: manifest.kind,
    },
    scenario: scenario.name,
    role,
    profile: { id: profile.id, name: profile.name },
    operations,
  };
}
