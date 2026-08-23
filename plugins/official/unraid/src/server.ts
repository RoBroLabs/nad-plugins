import type { HostApi, HostHttpResponse, ModuleRequest, SecretReference } from '@nad/sdk';

type Tone = 'ok' | 'warning' | 'critical';

interface ApiError {
  path: string;
  message: string;
}

interface Capacity {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
}

interface ParityStatus {
  status: string;
  progressPercent: number;
  errors: number;
  running: boolean;
  paused: boolean;
}

interface DiskRow {
  name: string;
  type: string;
  status: string;
  temperatureC: number | null;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  errorCount: number;
  spinning: boolean | null;
}

interface ShareRow {
  name: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
  cached: boolean | null;
}

interface ContainerRow {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  autoStart: boolean;
}

interface VmRow {
  id: string;
  name: string;
  state: string;
}

interface HostSnapshot {
  hostname: string;
  unraidVersion: string;
  apiVersion: string;
  kernelVersion: string;
  uptimeStartedAt: string;
  uptimeSeconds: number;
  cpuBrand: string;
  cpuCores: number;
  cpuThreads: number;
  cpuUsagePercent: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryAvailableBytes: number;
  memoryUsagePercent: number;
}

interface WorkloadSnapshot {
  containers: ContainerRow[];
  vms: VmRow[];
  dockerTotal: number;
  dockerRunning: number;
  dockerPaused: number;
  vmTotal: number;
  vmRunning: number;
  vmPaused: number;
}

interface GraphqlResult {
  data: Record<string, unknown>;
  errors: ApiError[];
}

const MAX_SAFE_METRIC = Number.MAX_SAFE_INTEGER;
const MAX_COLLECTION_ITEMS = 256;
const MAX_GRAPHQL_ERRORS = 16;
const MAX_STRING_LENGTH = 512;

const OVERVIEW_QUERY = `query NadUnraidOverview {
  info {
    os { hostname release kernel uptime }
    cpu { brand cores threads }
    versions { core { unraid api kernel } }
  }
  metrics {
    cpu { percentTotal }
    memory { total used available percentTotal }
  }
  array {
    state
    capacity { kilobytes { total used free } }
    parityCheckStatus { status progress errors running paused }
  }
  docker { containers { id names image state status autoStart } }
  vms { domains { id name state } }
}`;

const SUMMARY_QUERY = `query NadUnraidSummary {
  info { os { hostname uptime } versions { core { unraid api } } }
  metrics { cpu { percentTotal } memory { percentTotal } }
  array { state capacity { kilobytes { total used free } } }
  docker { containers { state } }
  vms { domains { state } }
}`;

const STORAGE_QUERY = `query NadUnraidStorage {
  array {
    state
    capacity { kilobytes { total used free } }
    parityCheckStatus { status progress errors running paused }
    parities { name type status temp size fsSize fsUsed fsFree numErrors isSpinning }
    disks { name type status temp size fsSize fsUsed fsFree numErrors isSpinning }
    caches { name type status temp size fsSize fsUsed fsFree numErrors isSpinning }
  }
  shares { name size used free cache }
}`;

const WORKLOADS_QUERY = `query NadUnraidWorkloads {
  docker { containers { id names image state status autoStart } }
  vms { domains { id name state } }
}`;

class UnraidModuleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnraidModuleError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordField(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value[key]) ? value[key] : null;
}

function listField(value: unknown, key: string): unknown[] {
  if (!isRecord(value) || !Array.isArray(value[key])) return [];
  return value[key].slice(0, MAX_COLLECTION_ITEMS);
}

function safeString(value: unknown, fallback = 'Unknown', maximum = MAX_STRING_LENGTH): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maximum) : fallback;
}

function optionalString(value: unknown, maximum = MAX_STRING_LENGTH): string {
  return typeof value === 'string' ? safeString(value, '', maximum) : '';
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

function boundedInteger(value: unknown, maximum = MAX_SAFE_METRIC): number {
  return Math.floor(boundedNumber(value, maximum));
}

function boundedPercent(value: unknown): number {
  return Math.round(boundedNumber(value, 100) * 100) / 100;
}

function kilobytesToBytes(value: unknown): number {
  return Math.min(MAX_SAFE_METRIC, boundedNumber(value, MAX_SAFE_METRIC / 1024) * 1024);
}

function percentage(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((used / total) * 10_000) / 100) : 0;
}

function publicConfigString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasSecret(value: unknown): value is SecretReference {
  return isRecord(value)
    && value.present === true
    && typeof value.secretRef === 'string'
    && value.secretRef.length > 0;
}

function parsePort(value: unknown): number {
  const port = typeof value === 'number' ? value : Number(publicConfigString(value));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new UnraidModuleError('The Unraid API port must be a whole number from 1 to 65535.');
  }
  return port;
}

function graphqlUrl(hostnameValue: unknown, schemeValue: unknown, portValue: unknown): string {
  const hostname = publicConfigString(hostnameValue);
  const scheme = publicConfigString(schemeValue);
  const port = parsePort(portValue);
  if (scheme !== 'http' && scheme !== 'https') {
    throw new UnraidModuleError('The Unraid API scheme must be http or https.');
  }
  if (
    !hostname
    || hostname.length > 253
    || /[\s/?#@]/.test(hostname)
    || hostname.includes('://')
    || /^[^:]+:\d+$/.test(hostname)
  ) {
    throw new UnraidModuleError('The Unraid server host must be a hostname or IP address without a scheme, port, path, or credentials.');
  }

  const unwrappedHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const formattedHostname = unwrappedHostname.includes(':') ? `[${unwrappedHostname}]` : unwrappedHostname;
  let url: URL;
  try {
    url = new URL(`${scheme}://${formattedHostname}:${port}/graphql`);
  } catch {
    throw new UnraidModuleError('The Unraid server host is invalid.');
  }
  if (!url.hostname || url.username || url.password || url.pathname !== '/graphql') {
    throw new UnraidModuleError('The Unraid server host is invalid.');
  }
  return url.toString();
}

function responseRecord(response: HostHttpResponse): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 || response.status === 403) {
      throw new UnraidModuleError('The Unraid server rejected the configured API key.');
    }
    throw new UnraidModuleError(`The Unraid GraphQL endpoint returned HTTP ${response.status}.`);
  }

  let value: unknown = response.body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new UnraidModuleError('The Unraid GraphQL endpoint returned malformed JSON.');
    }
  }
  if (!isRecord(value)) {
    throw new UnraidModuleError('The Unraid GraphQL endpoint returned a malformed response.');
  }
  return value;
}

function graphqlErrors(value: unknown): ApiError[] {
  if (!isRecord(value) || !Array.isArray(value.errors)) return [];
  return value.errors.slice(0, MAX_GRAPHQL_ERRORS).map((entry, index) => {
    const rawPath = isRecord(entry) && Array.isArray(entry.path) ? entry.path.slice(0, 8) : [];
    const path = rawPath
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      .map((part) => safeString(String(part), '', 64))
      .filter(Boolean)
      .join('.');
    const safePath = path || `error-${index + 1}`;
    return {
      path: safePath,
      message: `Unraid API could not resolve ${safePath}.`,
    };
  });
}

async function queryUnraid(host: HostApi, query: string): Promise<GraphqlResult> {
  const [hostnameValue, schemeValue, portValue, secretValue] = await Promise.all([
    host.config.get('server_host'),
    host.config.get('scheme'),
    host.config.get('port'),
    host.config.get('api_key'),
  ]);
  if (!hasSecret(secretValue)) {
    throw new UnraidModuleError('The Unraid API key is not configured.');
  }
  const url = graphqlUrl(hostnameValue, schemeValue, portValue);

  let response: HostHttpResponse;
  try {
    response = await host.http.request({
      url,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: { query },
    });
  } catch {
    throw new UnraidModuleError('The Unraid GraphQL endpoint could not be reached.');
  }

  const value = responseRecord(response);
  const errors = graphqlErrors(value);
  if (!isRecord(value.data)) {
    if (errors.length > 0) {
      throw new UnraidModuleError('The Unraid GraphQL query failed without usable data.');
    }
    throw new UnraidModuleError('The Unraid GraphQL response did not contain data.');
  }
  return { data: value.data, errors };
}

function capacityFromArray(array: Record<string, unknown> | null): Capacity {
  const capacity = recordField(array, 'capacity');
  const kilobytes = recordField(capacity, 'kilobytes');
  const totalBytes = kilobytesToBytes(kilobytes?.total);
  const usedBytes = Math.min(totalBytes || MAX_SAFE_METRIC, kilobytesToBytes(kilobytes?.used));
  const reportedFree = kilobytesToBytes(kilobytes?.free);
  const freeBytes = totalBytes > 0 ? Math.min(totalBytes, reportedFree) : reportedFree;
  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usagePercent: percentage(usedBytes, totalBytes),
  };
}

function parityFromArray(array: Record<string, unknown> | null): ParityStatus {
  const parity = recordField(array, 'parityCheckStatus');
  return {
    status: safeString(parity?.status),
    progressPercent: boundedPercent(parity?.progress),
    errors: boundedInteger(parity?.errors),
    running: parity?.running === true,
    paused: parity?.paused === true,
  };
}

function parseHostSnapshot(data: Record<string, unknown>, now: Date): HostSnapshot {
  const info = recordField(data, 'info');
  const os = recordField(info, 'os');
  const cpu = recordField(info, 'cpu');
  const versions = recordField(info, 'versions');
  const coreVersions = recordField(versions, 'core');
  const metrics = recordField(data, 'metrics');
  const cpuMetrics = recordField(metrics, 'cpu');
  const memory = recordField(metrics, 'memory');
  const uptimeStartedAt = optionalString(os?.uptime, 64);
  const bootTime = Date.parse(uptimeStartedAt);
  const uptimeSeconds = Number.isFinite(bootTime) && bootTime <= now.getTime()
    ? Math.min(MAX_SAFE_METRIC, Math.floor((now.getTime() - bootTime) / 1000))
    : 0;
  const memoryTotalBytes = boundedInteger(memory?.total);
  const memoryUsedBytes = Math.min(memoryTotalBytes || MAX_SAFE_METRIC, boundedInteger(memory?.used));
  const memoryAvailableBytes = Math.min(memoryTotalBytes || MAX_SAFE_METRIC, boundedInteger(memory?.available));
  return {
    hostname: safeString(os?.hostname),
    unraidVersion: safeString(coreVersions?.unraid ?? os?.release),
    apiVersion: safeString(coreVersions?.api),
    kernelVersion: safeString(coreVersions?.kernel ?? os?.kernel),
    uptimeStartedAt,
    uptimeSeconds,
    cpuBrand: safeString(cpu?.brand),
    cpuCores: boundedInteger(cpu?.cores, 4096),
    cpuThreads: boundedInteger(cpu?.threads, 8192),
    cpuUsagePercent: boundedPercent(cpuMetrics?.percentTotal),
    memoryTotalBytes,
    memoryUsedBytes,
    memoryAvailableBytes,
    memoryUsagePercent: boundedPercent(memory?.percentTotal),
  };
}

function parseContainer(entry: unknown): ContainerRow | null {
  if (!isRecord(entry)) return null;
  const names = Array.isArray(entry.names) ? entry.names : [];
  return {
    id: safeString(entry.id, 'Unknown', 256),
    name: safeString(names[0]),
    image: safeString(entry.image),
    state: safeString(entry.state).toUpperCase(),
    status: safeString(entry.status),
    autoStart: entry.autoStart === true,
  };
}

function parseVm(entry: unknown): VmRow | null {
  if (!isRecord(entry)) return null;
  return {
    id: safeString(entry.id, 'Unknown', 256),
    name: safeString(entry.name),
    state: safeString(entry.state).toUpperCase(),
  };
}

function parseWorkloadSnapshot(data: Record<string, unknown>): WorkloadSnapshot {
  const docker = recordField(data, 'docker');
  const vmsValue = recordField(data, 'vms');
  const containers = listField(docker, 'containers')
    .map(parseContainer)
    .filter((value): value is ContainerRow => value !== null);
  const vms = listField(vmsValue, 'domains')
    .map(parseVm)
    .filter((value): value is VmRow => value !== null);
  return {
    containers,
    vms,
    dockerTotal: containers.length,
    dockerRunning: containers.filter((container) => container.state === 'RUNNING').length,
    dockerPaused: containers.filter((container) => container.state === 'PAUSED').length,
    vmTotal: vms.length,
    vmRunning: vms.filter((vm) => vm.state === 'RUNNING').length,
    vmPaused: vms.filter((vm) => vm.state === 'PAUSED' || vm.state === 'PMSUSPENDED').length,
  };
}

function parseSummaryWorkloads(data: Record<string, unknown>): WorkloadSnapshot {
  const docker = recordField(data, 'docker');
  const vmsValue = recordField(data, 'vms');
  const containers = listField(docker, 'containers')
    .filter(isRecord)
    .map((container, index): ContainerRow => ({
      id: `container-${index + 1}`,
      name: 'Unknown',
      image: 'Unknown',
      state: safeString(container.state).toUpperCase(),
      status: 'Unknown',
      autoStart: false,
    }));
  const vms = listField(vmsValue, 'domains')
    .filter(isRecord)
    .map((vm, index): VmRow => ({
      id: `vm-${index + 1}`,
      name: 'Unknown',
      state: safeString(vm.state).toUpperCase(),
    }));
  return {
    containers,
    vms,
    dockerTotal: containers.length,
    dockerRunning: containers.filter((container) => container.state === 'RUNNING').length,
    dockerPaused: containers.filter((container) => container.state === 'PAUSED').length,
    vmTotal: vms.length,
    vmRunning: vms.filter((vm) => vm.state === 'RUNNING').length,
    vmPaused: vms.filter((vm) => vm.state === 'PAUSED' || vm.state === 'PMSUSPENDED').length,
  };
}

function diskRow(entry: unknown): DiskRow | null {
  if (!isRecord(entry)) return null;
  const sizeBytes = kilobytesToBytes(entry.size);
  const fsSizeBytes = kilobytesToBytes(entry.fsSize);
  const totalBytes = fsSizeBytes || sizeBytes;
  const usedBytes = Math.min(totalBytes || MAX_SAFE_METRIC, kilobytesToBytes(entry.fsUsed));
  const freeBytes = Math.min(totalBytes || MAX_SAFE_METRIC, kilobytesToBytes(entry.fsFree));
  const temperature = boundedNumber(entry.temp, 1000);
  return {
    name: safeString(entry.name),
    type: safeString(entry.type).toUpperCase(),
    status: safeString(entry.status).toUpperCase(),
    temperatureC: typeof entry.temp === 'number' && Number.isFinite(entry.temp) ? temperature : null,
    totalBytes,
    usedBytes,
    freeBytes,
    errorCount: boundedInteger(entry.numErrors),
    spinning: typeof entry.isSpinning === 'boolean' ? entry.isSpinning : null,
  };
}

function shareRow(entry: unknown): ShareRow | null {
  if (!isRecord(entry)) return null;
  const totalBytes = kilobytesToBytes(entry.size);
  const usedBytes = Math.min(totalBytes || MAX_SAFE_METRIC, kilobytesToBytes(entry.used));
  const freeBytes = Math.min(totalBytes || MAX_SAFE_METRIC, kilobytesToBytes(entry.free));
  return {
    name: safeString(entry.name),
    totalBytes,
    usedBytes,
    freeBytes,
    usagePercent: percentage(usedBytes, totalBytes),
    cached: typeof entry.cache === 'boolean' ? entry.cache : null,
  };
}

function overallStatus(
  hostname: string,
  arrayState: string,
  errors: ApiError[],
): { statusLabel: string; statusTone: Tone } {
  if (hostname === 'Unknown') return { statusLabel: 'Host data unavailable', statusTone: 'critical' };
  if (errors.length > 0) return { statusLabel: 'Partially available', statusTone: 'warning' };
  if (arrayState === 'STARTED') return { statusLabel: 'Online', statusTone: 'ok' };
  if (arrayState === 'Unknown') return { statusLabel: 'Array state unavailable', statusTone: 'warning' };
  return { statusLabel: `Array ${arrayState.toLowerCase()}`, statusTone: 'warning' };
}

function appendMissingErrors(
  errors: ApiError[],
  data: Record<string, unknown>,
  fields: string[],
): ApiError[] {
  const result = [...errors];
  for (const field of fields) {
    if (data[field] === null || data[field] === undefined) {
      if (!result.some((error) => error.path === field || error.path.startsWith(`${field}.`))) {
        result.push({ path: field, message: `Unraid API did not return ${field}.` });
      }
    }
  }
  return result.slice(0, MAX_GRAPHQL_ERRORS);
}

export async function overview(_request: ModuleRequest, host: HostApi): Promise<Record<string, unknown>> {
  const result = await queryUnraid(host, OVERVIEW_QUERY);
  const now = new Date();
  const errors = appendMissingErrors(result.errors, result.data, ['info', 'metrics', 'array', 'docker', 'vms']);
  const hostSnapshot = parseHostSnapshot(result.data, now);
  const workloads = parseWorkloadSnapshot(result.data);
  const array = recordField(result.data, 'array');
  const arrayState = safeString(array?.state);
  return {
    ...overallStatus(hostSnapshot.hostname, arrayState, errors),
    ...hostSnapshot,
    arrayState,
    capacity: capacityFromArray(array),
    parity: parityFromArray(array),
    dockerTotal: workloads.dockerTotal,
    dockerRunning: workloads.dockerRunning,
    dockerPaused: workloads.dockerPaused,
    vmTotal: workloads.vmTotal,
    vmRunning: workloads.vmRunning,
    vmPaused: workloads.vmPaused,
    partial: errors.length > 0,
    errors,
    refreshedAt: now.toISOString(),
  };
}

export async function summary(_request: ModuleRequest, host: HostApi): Promise<Record<string, unknown>> {
  const result = await queryUnraid(host, SUMMARY_QUERY);
  const now = new Date();
  const errors = appendMissingErrors(result.errors, result.data, ['info', 'metrics', 'array', 'docker', 'vms']);
  const hostSnapshot = parseHostSnapshot(result.data, now);
  const workloads = parseSummaryWorkloads(result.data);
  const array = recordField(result.data, 'array');
  const arrayState = safeString(array?.state);
  const capacity = capacityFromArray(array);
  return {
    ...overallStatus(hostSnapshot.hostname, arrayState, errors),
    hostname: hostSnapshot.hostname,
    unraidVersion: hostSnapshot.unraidVersion,
    apiVersion: hostSnapshot.apiVersion,
    uptimeSeconds: hostSnapshot.uptimeSeconds,
    cpuUsagePercent: hostSnapshot.cpuUsagePercent,
    memoryUsagePercent: hostSnapshot.memoryUsagePercent,
    arrayState,
    arrayTotalBytes: capacity.totalBytes,
    arrayUsedBytes: capacity.usedBytes,
    arrayFreeBytes: capacity.freeBytes,
    arrayUsagePercent: capacity.usagePercent,
    dockerTotal: workloads.dockerTotal,
    dockerRunning: workloads.dockerRunning,
    vmTotal: workloads.vmTotal,
    vmRunning: workloads.vmRunning,
    partial: errors.length > 0,
    errorCount: errors.length,
    errors,
    refreshedAt: now.toISOString(),
  };
}

export async function storage(_request: ModuleRequest, host: HostApi): Promise<Record<string, unknown>> {
  const result = await queryUnraid(host, STORAGE_QUERY);
  const now = new Date();
  const errors = appendMissingErrors(result.errors, result.data, ['array', 'shares']);
  const array = recordField(result.data, 'array');
  const parities = listField(array, 'parities').map(diskRow).filter((value): value is DiskRow => value !== null);
  const dataDisks = listField(array, 'disks').map(diskRow).filter((value): value is DiskRow => value !== null);
  const caches = listField(array, 'caches').map(diskRow).filter((value): value is DiskRow => value !== null);
  const disks = [...parities, ...dataDisks, ...caches].slice(0, MAX_COLLECTION_ITEMS);
  const shares = listField(result.data, 'shares').map(shareRow).filter((value): value is ShareRow => value !== null);
  return {
    arrayState: safeString(array?.state),
    capacity: capacityFromArray(array),
    parity: parityFromArray(array),
    diskCount: disks.length,
    parityCount: parities.length,
    dataDiskCount: dataDisks.length,
    cacheDiskCount: caches.length,
    shareCount: shares.length,
    disks,
    shares,
    partial: errors.length > 0,
    errors,
    refreshedAt: now.toISOString(),
  };
}

export async function workloads(_request: ModuleRequest, host: HostApi): Promise<Record<string, unknown>> {
  const result = await queryUnraid(host, WORKLOADS_QUERY);
  const now = new Date();
  const errors = appendMissingErrors(result.errors, result.data, ['docker', 'vms']);
  const snapshot = parseWorkloadSnapshot(result.data);
  return {
    ...snapshot,
    partial: errors.length > 0,
    errors,
    refreshedAt: now.toISOString(),
  };
}
