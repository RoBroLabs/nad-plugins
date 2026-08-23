import type { HostApi, HostHttpResponse, ModuleRequest, SecretReference } from '@nad/sdk';

type ApiVersion = 'v5' | 'v6';
type InstanceId = 'primary' | 'secondary';
type BlockingState = 'enabled' | 'disabled' | 'unknown';
type AggregateBlockingState = BlockingState | 'mixed';
type Tone = 'ok' | 'warning' | 'critical';
type BlockingAction = 'enable' | 'disable';

interface PiholeInstance {
  id: InstanceId;
  name: string;
  origin: string;
  apiVersion: ApiVersion;
}

interface PiholeStats {
  id: InstanceId;
  name: string;
  available: boolean;
  totalQueries: number;
  blockedQueries: number;
  blockPercentage: number;
  domainsOnBlocklist: number;
  uniqueClients: number;
  queriesForwarded: number;
  queriesCached: number;
  blockingStatus: BlockingState;
  error?: string;
}

interface PiholeStatus {
  id: InstanceId;
  name: string;
  available: boolean;
  blockingStatus: BlockingState;
  error?: string;
}

interface StatsResponse {
  totalQueries: number;
  blockedQueries: number;
  blockPercentage: number;
  domainsOnBlocklist: number;
  uniqueClients: number;
  queriesForwarded: number;
  queriesCached: number;
  blockingStatus: AggregateBlockingState;
  statusLabel: string;
  statusTone: Tone;
  configuredInstances: number;
  availableInstances: number;
  instances: PiholeStats[];
  unavailableInstances: string[];
  refreshedAt: string;
}

interface StatusResponse {
  blockingStatus: AggregateBlockingState;
  statusLabel: string;
  statusTone: Tone;
  configuredInstances: number;
  availableInstances: number;
  instances: PiholeStatus[];
  refreshedAt: string;
}

interface SummaryResponse {
  totalQueries: number;
  blockedQueries: number;
  blockPercentage: number;
  domainsOnBlocklist: number;
  blockingStatus: AggregateBlockingState;
  statusLabel: string;
  statusTone: Tone;
  configuredInstances: number;
  availableInstances: number;
  unavailableInstances: number;
  refreshedAt: string;
}

interface BlockingInput {
  action: BlockingAction;
  durationSeconds?: number;
}

interface BlockingTargetResult {
  id: InstanceId;
  name: string;
  succeeded: boolean;
  observedFinalState: BlockingState;
  error?: string;
}

interface BlockingResponse {
  accepted: boolean;
  complete: boolean;
  action: BlockingAction;
  durationSeconds?: number;
  blockingStatus: AggregateBlockingState;
  statusLabel: string;
  statusTone: Tone;
  succeededTargets: number;
  failedTargets: number;
  targets: BlockingTargetResult[];
  message: string;
}

const MAX_DISABLE_SECONDS = 86_400;
const MAX_URL_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 256;
const MAX_SAFE_METRIC = 9_007_199_254_740_991;

class NetworkModuleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NetworkModuleError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicConfigValue(value: string | SecretReference | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasSecret(value: string | SecretReference | undefined): boolean {
  return isRecord(value)
    && value.present === true
    && typeof value.secretRef === 'string'
    && value.secretRef.length > 0;
}

function normalizeOrigin(value: string, name: string): string {
  if (!value || value.length > MAX_URL_LENGTH) {
    throw new NetworkModuleError(`${name} URL is missing or too long.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NetworkModuleError(`${name} URL is invalid.`);
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new NetworkModuleError(`${name} URL must be a normal HTTP or HTTPS URL without credentials.`);
  }
  if (url.search || url.hash) {
    throw new NetworkModuleError(`${name} URL must not contain a query string or fragment.`);
  }

  const configuredPath = url.pathname.replace(/\/+$/, '') || '/';
  if (!['/', '/admin', '/admin/api.php', '/api'].includes(configuredPath)) {
    throw new NetworkModuleError(`${name} URL must point to the Pi-hole root or its standard admin/API path.`);
  }

  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.origin;
}

async function loadInstances(host: HostApi): Promise<PiholeInstance[]> {
  const [primaryUrlValue, primarySecret, versionValue, secondaryUrlValue, secondarySecret] = await Promise.all([
    host.config.get('pihole_url'),
    host.config.get('pihole_api_key'),
    host.config.get('pihole_api_version'),
    host.config.get('pihole2_url'),
    host.config.get('pihole2_api_key'),
  ]);

  const primaryUrl = publicConfigValue(primaryUrlValue);
  const apiVersionValue = publicConfigValue(versionValue) || 'v6';
  if (apiVersionValue !== 'v5' && apiVersionValue !== 'v6') {
    throw new NetworkModuleError('Pi-hole API version must be v5 or v6.');
  }
  if (!hasSecret(primarySecret)) {
    throw new NetworkModuleError('The primary Pi-hole credential is not configured.');
  }

  const instances: PiholeInstance[] = [{
    id: 'primary',
    name: 'Primary Pi-hole',
    origin: normalizeOrigin(primaryUrl, 'Primary Pi-hole'),
    apiVersion: apiVersionValue,
  }];

  const secondaryUrl = publicConfigValue(secondaryUrlValue);
  const secondaryConfigured = hasSecret(secondarySecret);
  if (Boolean(secondaryUrl) !== secondaryConfigured) {
    throw new NetworkModuleError('The secondary Pi-hole URL and credential must be configured together.');
  }
  if (secondaryUrl) {
    instances.push({
      id: 'secondary',
      name: 'Secondary Pi-hole',
      origin: normalizeOrigin(secondaryUrl, 'Secondary Pi-hole'),
      apiVersion: apiVersionValue,
    });
  }

  return instances;
}

function endpointUrl(instance: PiholeInstance, path: string): string {
  return new URL(path, `${instance.origin}/`).toString();
}

function v5CommandUrl(instance: PiholeInstance, command: string, value = ''): string {
  const url = new URL('/admin/api.php', `${instance.origin}/`);
  url.searchParams.set(command, value);
  return url.toString();
}

function safeFailure(instance: PiholeInstance, error: unknown): string {
  return error instanceof NetworkModuleError
    ? error.message
    : `${instance.name} could not be reached.`;
}

function responseRecord(response: HostHttpResponse, instance: PiholeInstance, operation: string): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) {
    const credentialFailure = response.status === 401 || response.status === 403;
    throw new NetworkModuleError(
      credentialFailure
        ? `${instance.name} rejected the configured credential.`
        : `${instance.name} rejected the ${operation} request with HTTP ${response.status}.`,
    );
  }

  let value: unknown = response.body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new NetworkModuleError(`${instance.name} returned malformed ${operation} data.`);
    }
  }
  if (!isRecord(value)) {
    throw new NetworkModuleError(`${instance.name} returned malformed ${operation} data.`);
  }
  if (
    (typeof value.error === 'string' && value.error.length > 0)
    || isRecord(value.error)
  ) {
    throw new NetworkModuleError(`${instance.name} rejected the ${operation} request.`);
  }
  return value;
}

async function requestRecord(
  instance: PiholeInstance,
  host: HostApi,
  operation: string,
  request: Parameters<HostApi['http']['request']>[0],
): Promise<Record<string, unknown>> {
  try {
    return responseRecord(await host.http.request(request), instance, operation);
  } catch (error) {
    if (error instanceof NetworkModuleError) throw error;
    throw new NetworkModuleError(`${instance.name} could not be reached.`);
  }
}

function sessionId(value: Record<string, unknown>, instance: PiholeInstance): string {
  const session = isRecord(value.session) ? value.session : null;
  const sid = session && session.valid === true && typeof session.sid === 'string'
    ? session.sid
    : '';
  if (
    !sid
    || sid.length > MAX_SESSION_ID_LENGTH
    || !/^[A-Za-z0-9._~-]+$/.test(sid)
  ) {
    throw new NetworkModuleError(`${instance.name} did not create a valid API session.`);
  }
  return sid;
}

async function withV6Session<T>(
  instance: PiholeInstance,
  host: HostApi,
  operation: (sid: string) => Promise<T>,
): Promise<T> {
  const authUrl = endpointUrl(instance, '/api/auth');
  const auth = await requestRecord(instance, host, 'authentication', {
    url: authUrl,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: {},
  });
  const sid = sessionId(auth, instance);

  try {
    return await operation(sid);
  } finally {
    try {
      await host.http.request({
        url: authUrl,
        method: 'DELETE',
        headers: {
          accept: 'application/json',
          'x-ftl-sid': sid,
        },
      });
    } catch {
      // Pi-hole expires short-lived sessions when explicit cleanup is unavailable.
    }
  }
}

function boundedNumber(value: unknown, maximum = MAX_SAFE_METRIC): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(maximum, Math.max(0, parsed));
}

function fieldNumber(record: Record<string, unknown> | null, key: string, maximum = MAX_SAFE_METRIC): number {
  return record ? boundedNumber(record[key], maximum) : 0;
}

function blockingState(value: unknown): BlockingState {
  return value === 'enabled' || value === 'disabled' ? value : 'unknown';
}

function parseStatsPayload(instance: PiholeInstance, value: Record<string, unknown>): Omit<PiholeStats, 'id' | 'name' | 'available'> {
  const queries = isRecord(value.queries) ? value.queries : null;
  const clients = isRecord(value.clients) ? value.clients : null;
  const gravity = isRecord(value.gravity) ? value.gravity : null;
  return {
    totalQueries: queries ? fieldNumber(queries, 'total') : fieldNumber(value, 'dns_queries_today'),
    blockedQueries: queries ? fieldNumber(queries, 'blocked') : fieldNumber(value, 'ads_blocked_today'),
    blockPercentage: queries
      ? fieldNumber(queries, 'percent_blocked', 100)
      : fieldNumber(value, 'ads_percentage_today', 100),
    domainsOnBlocklist: gravity
      ? fieldNumber(gravity, 'domains_being_blocked')
      : fieldNumber(value, 'domains_being_blocked'),
    uniqueClients: clients ? fieldNumber(clients, 'active') : fieldNumber(value, 'unique_clients'),
    queriesForwarded: queries ? fieldNumber(queries, 'forwarded') : fieldNumber(value, 'queries_forwarded'),
    queriesCached: queries ? fieldNumber(queries, 'cached') : fieldNumber(value, 'queries_cached'),
    blockingStatus: blockingState(value.blocking ?? value.status),
  };
}

function parseStatusPayload(instance: PiholeInstance, value: Record<string, unknown>): BlockingState {
  const state = blockingState(value.blocking ?? value.status);
  if (state === 'unknown') {
    throw new NetworkModuleError(`${instance.name} returned an unknown blocking state.`);
  }
  return state;
}

async function readV5Status(instance: PiholeInstance, host: HostApi): Promise<BlockingState> {
  const value = await requestRecord(instance, host, 'blocking status', {
    url: v5CommandUrl(instance, 'status'),
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return parseStatusPayload(instance, value);
}

async function readV6Status(instance: PiholeInstance, host: HostApi, sid: string): Promise<BlockingState> {
  const value = await requestRecord(instance, host, 'blocking status', {
    url: endpointUrl(instance, '/api/dns/blocking'),
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-ftl-sid': sid,
    },
  });
  return parseStatusPayload(instance, value);
}

async function readInstanceStats(instance: PiholeInstance, host: HostApi): Promise<PiholeStats> {
  if (instance.apiVersion === 'v5') {
    const rawStats = await requestRecord(instance, host, 'statistics', {
      url: v5CommandUrl(instance, 'summaryRaw'),
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const parsed = parseStatsPayload(instance, rawStats);
    const status = parsed.blockingStatus === 'unknown' ? await readV5Status(instance, host) : parsed.blockingStatus;
    return { id: instance.id, name: instance.name, available: true, ...parsed, blockingStatus: status };
  }

  return withV6Session(instance, host, async (sid) => {
    const rawStats = await requestRecord(instance, host, 'statistics', {
      url: endpointUrl(instance, '/api/stats/summary'),
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-ftl-sid': sid,
      },
    });
    const parsed = parseStatsPayload(instance, rawStats);
    const status = await readV6Status(instance, host, sid);
    return { id: instance.id, name: instance.name, available: true, ...parsed, blockingStatus: status };
  });
}

async function readInstanceStatus(instance: PiholeInstance, host: HostApi): Promise<BlockingState> {
  return instance.apiVersion === 'v5'
    ? readV5Status(instance, host)
    : withV6Session(instance, host, (sid) => readV6Status(instance, host, sid));
}

function aggregateBlockingStatus(states: BlockingState[], incomplete = false): AggregateBlockingState {
  if (incomplete || states.length === 0 || states.includes('unknown')) return 'unknown';
  return states.every((state) => state === states[0]) ? states[0] as 'enabled' | 'disabled' : 'mixed';
}

function statusPresentation(state: AggregateBlockingState): { statusLabel: string; statusTone: Tone } {
  if (state === 'enabled') return { statusLabel: 'Blocking enabled', statusTone: 'ok' };
  if (state === 'disabled') return { statusLabel: 'Blocking disabled', statusTone: 'critical' };
  if (state === 'mixed') return { statusLabel: 'Mixed blocking state', statusTone: 'warning' };
  return { statusLabel: 'Blocking state unavailable', statusTone: 'warning' };
}

function unavailableStats(instance: PiholeInstance, error: unknown): PiholeStats {
  return {
    id: instance.id,
    name: instance.name,
    available: false,
    totalQueries: 0,
    blockedQueries: 0,
    blockPercentage: 0,
    domainsOnBlocklist: 0,
    uniqueClients: 0,
    queriesForwarded: 0,
    queriesCached: 0,
    blockingStatus: 'unknown',
    error: safeFailure(instance, error),
  };
}

async function collectStats(instances: PiholeInstance[], host: HostApi): Promise<PiholeStats[]> {
  const results = await Promise.allSettled(instances.map((instance) => readInstanceStats(instance, host)));
  return results.map((result, index) => {
    const instance = instances[index];
    if (!instance) throw new NetworkModuleError('Configured Pi-hole inventory changed unexpectedly.');
    return result.status === 'fulfilled' ? result.value : unavailableStats(instance, result.reason);
  });
}

function boundedSum(values: number[]): number {
  return values.reduce((sum, value) => Math.min(MAX_SAFE_METRIC, sum + value), 0);
}

function summariseStats(instances: PiholeStats[]): StatsResponse {
  const available = instances.filter((instance) => instance.available);
  const totalQueries = boundedSum(available.map((instance) => instance.totalQueries));
  const blockedQueries = boundedSum(available.map((instance) => instance.blockedQueries));
  const state = aggregateBlockingStatus(
    available.map((instance) => instance.blockingStatus),
    available.length !== instances.length,
  );
  return {
    totalQueries,
    blockedQueries,
    blockPercentage: totalQueries > 0
      ? Math.min(100, Math.round((blockedQueries / totalQueries) * 10_000) / 100)
      : 0,
    domainsOnBlocklist: boundedSum(available.map((instance) => instance.domainsOnBlocklist)),
    uniqueClients: boundedSum(available.map((instance) => instance.uniqueClients)),
    queriesForwarded: boundedSum(available.map((instance) => instance.queriesForwarded)),
    queriesCached: boundedSum(available.map((instance) => instance.queriesCached)),
    blockingStatus: state,
    ...statusPresentation(state),
    configuredInstances: instances.length,
    availableInstances: available.length,
    instances,
    unavailableInstances: instances.filter((instance) => !instance.available).map((instance) => instance.name),
    refreshedAt: new Date().toISOString(),
  };
}

export async function stats(_request: ModuleRequest, host: HostApi): Promise<StatsResponse> {
  const instances = await loadInstances(host);
  return summariseStats(await collectStats(instances, host));
}

export async function summary(request: ModuleRequest, host: HostApi): Promise<SummaryResponse> {
  const result = await stats(request, host);
  return {
    totalQueries: result.totalQueries,
    blockedQueries: result.blockedQueries,
    blockPercentage: result.blockPercentage,
    domainsOnBlocklist: result.domainsOnBlocklist,
    blockingStatus: result.blockingStatus,
    statusLabel: result.statusLabel,
    statusTone: result.statusTone,
    configuredInstances: result.configuredInstances,
    availableInstances: result.availableInstances,
    unavailableInstances: result.configuredInstances - result.availableInstances,
    refreshedAt: result.refreshedAt,
  };
}

export async function status(_request: ModuleRequest, host: HostApi): Promise<StatusResponse> {
  const configured = await loadInstances(host);
  const results = await Promise.allSettled(configured.map((instance) => readInstanceStatus(instance, host)));
  const instances: PiholeStatus[] = results.map((result, index) => {
    const instance = configured[index];
    if (!instance) throw new NetworkModuleError('Configured Pi-hole inventory changed unexpectedly.');
    return result.status === 'fulfilled'
      ? {
          id: instance.id,
          name: instance.name,
          available: true,
          blockingStatus: result.value,
        }
      : {
          id: instance.id,
          name: instance.name,
          available: false,
          blockingStatus: 'unknown',
          error: safeFailure(instance, result.reason),
        };
  });
  const available = instances.filter((instance) => instance.available);
  const state = aggregateBlockingStatus(
    available.map((instance) => instance.blockingStatus),
    available.length !== instances.length,
  );
  return {
    blockingStatus: state,
    ...statusPresentation(state),
    configuredInstances: instances.length,
    availableInstances: available.length,
    instances,
    refreshedAt: new Date().toISOString(),
  };
}

function parseBlockingInput(value: unknown): BlockingInput {
  if (!isRecord(value)) {
    throw new NetworkModuleError('Choose enable or disable.');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'action' && key !== 'durationSeconds')) {
    throw new NetworkModuleError('The blocking request contains unsupported fields.');
  }
  if (value.action !== 'enable' && value.action !== 'disable') {
    throw new NetworkModuleError('Choose enable or disable.');
  }
  if (value.durationSeconds !== undefined) {
    if (
      value.action !== 'disable'
      || typeof value.durationSeconds !== 'number'
      || !Number.isInteger(value.durationSeconds)
      || value.durationSeconds < 1
      || value.durationSeconds > MAX_DISABLE_SECONDS
    ) {
      throw new NetworkModuleError('A disable duration must be a whole number from 1 to 86400 seconds.');
    }
    return { action: 'disable', durationSeconds: value.durationSeconds };
  }
  return { action: value.action };
}

async function applyV5Blocking(
  instance: PiholeInstance,
  host: HostApi,
  input: BlockingInput,
): Promise<BlockingState> {
  const commandValue = input.action === 'disable' && input.durationSeconds !== undefined
    ? String(input.durationSeconds)
    : '';
  await requestRecord(instance, host, 'blocking change', {
    url: v5CommandUrl(instance, input.action, commandValue),
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  return readV5Status(instance, host);
}

async function applyV6Blocking(
  instance: PiholeInstance,
  host: HostApi,
  input: BlockingInput,
): Promise<BlockingState> {
  return withV6Session(instance, host, async (sid) => {
    await requestRecord(instance, host, 'blocking change', {
      url: endpointUrl(instance, '/api/dns/blocking'),
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-ftl-sid': sid,
      },
      body: {
        blocking: input.action === 'enable',
        timer: input.action === 'disable' && input.durationSeconds !== undefined
          ? input.durationSeconds
          : null,
      },
    });
    return readV6Status(instance, host, sid);
  });
}

async function applyBlocking(
  instance: PiholeInstance,
  host: HostApi,
  input: BlockingInput,
): Promise<BlockingState> {
  const observed = instance.apiVersion === 'v5'
    ? await applyV5Blocking(instance, host, input)
    : await applyV6Blocking(instance, host, input);
  const expected = input.action === 'enable' ? 'enabled' : 'disabled';
  if (observed !== expected) {
    throw new NetworkModuleError(`${instance.name} did not confirm the requested blocking state.`);
  }
  return observed;
}

function blockingMessage(input: BlockingInput, succeeded: number, failed: number): string {
  const desired = input.action === 'enable' ? 'enabled' : 'disabled';
  if (failed === 0) {
    if (input.action === 'disable' && input.durationSeconds !== undefined) {
      return `DNS blocking was disabled for ${input.durationSeconds} seconds on every configured Pi-hole.`;
    }
    return `DNS blocking was ${desired} on every configured Pi-hole.`;
  }
  if (succeeded === 0) {
    return `DNS blocking could not be confirmed as ${desired} on any configured Pi-hole.`;
  }
  return `DNS blocking was ${desired} on ${succeeded} configured Pi-hole${succeeded === 1 ? '' : 's'}; ${failed} target${failed === 1 ? '' : 's'} failed.`;
}

export async function setBlocking(request: ModuleRequest, host: HostApi): Promise<BlockingResponse> {
  const input = parseBlockingInput(request.body);
  const instances = await loadInstances(host);
  const results = await Promise.allSettled(instances.map((instance) => applyBlocking(instance, host, input)));
  const targets: BlockingTargetResult[] = results.map((result, index) => {
    const instance = instances[index];
    if (!instance) throw new NetworkModuleError('Configured Pi-hole inventory changed unexpectedly.');
    return result.status === 'fulfilled'
      ? {
          id: instance.id,
          name: instance.name,
          succeeded: true,
          observedFinalState: result.value,
        }
      : {
          id: instance.id,
          name: instance.name,
          succeeded: false,
          observedFinalState: 'unknown',
          error: safeFailure(instance, result.reason),
        };
  });

  try {
    await Promise.all(targets.map((target) => host.audit.annotate({
      action: input.action,
      durationSeconds: input.durationSeconds ?? null,
      targetId: target.id,
      targetName: target.name,
      succeeded: target.succeeded,
      observedFinalState: target.observedFinalState,
    })));
  } catch {
    throw new NetworkModuleError('NAD could not record the DNS blocking outcome in the audit log.');
  }

  const succeededTargets = targets.filter((target) => target.succeeded).length;
  const failedTargets = targets.length - succeededTargets;
  const state = aggregateBlockingStatus(
    targets.filter((target) => target.succeeded).map((target) => target.observedFinalState),
    failedTargets > 0,
  );
  return {
    accepted: succeededTargets > 0,
    complete: failedTargets === 0,
    action: input.action,
    ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
    blockingStatus: state,
    ...statusPresentation(state),
    succeededTargets,
    failedTargets,
    targets,
    message: blockingMessage(input, succeededTargets, failedTargets),
  };
}
