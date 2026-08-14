import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

export function resolveDevProfileV2(scenario: DevScenarioV2, profileId?: string): DevScenarioV2Profile {
  const resolved = scenario.profiles.find((profile) => profile.id === (profileId ?? scenario.selectedProfileId));
  if (!resolved) throw new Error('CONNECTION_PROFILE_UNAVAILABLE');
  return JSON.parse(JSON.stringify(resolved)) as DevScenarioV2Profile;
}

export function requireDevPermissionV2(scenario: DevScenarioV2, permission: string, role = scenario.defaultRole): void {
  const grants = scenario.roles[role]?.grants ?? [];
  if (!grants.includes('*') && !grants.includes(permission)) throw new Error('SURFACE_ACCESS_DENIED');
}
