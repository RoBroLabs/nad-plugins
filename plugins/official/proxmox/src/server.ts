import type { HostApi, HostHttpResponse, ModuleRequest, SecretReference } from '@nad/sdk';

type GuestType = 'qemu' | 'lxc';
type GuestActionName = 'start' | 'stop' | 'restart';
type Tone = 'ok' | 'warning' | 'critical';
type TaskStatus = 'running' | 'success' | 'failed' | 'unknown';
type ActionOutcome = 'success' | 'failed' | 'indeterminate';

interface ProxmoxConfig { origin: string }
interface NodeItem {
  id: string; node: string; status: 'online' | 'offline' | 'unknown'; cpuPercent: number; cpuCores: number;
  memoryUsed: number; memoryTotal: number; memoryPercent: number; storageUsed: number; storageTotal: number;
  storagePercent: number; uptimeSeconds: number;
}
interface GuestItem {
  id: string; vmid: number; name: string; node: string; type: GuestType; typeLabel: string;
  status: 'running' | 'stopped' | 'paused' | 'unknown'; template: boolean; cpuPercent: number;
  cpuCores: number; memoryUsed: number; memoryTotal: number; memoryPercent: number; diskUsed: number;
  diskTotal: number; diskPercent: number; networkIn: number; networkOut: number; uptimeSeconds: number;
}
interface StorageItem {
  id: string; storage: string; node: string; type: string; status: 'available' | 'unavailable' | 'unknown';
  shared: boolean; used: number; total: number; available: number; percent: number; content: string;
}
interface TaskItem {
  upid: string; node: string; type: string; user: string; status: TaskStatus; exitStatus?: string;
  startTime: number; endTime?: number; guestId?: number;
}
interface SectionState { available: boolean; error?: string }
interface SummaryResponse {
  nodeCount: number; onlineNodes: number; guestCount: number; runningGuests: number; storageCount: number;
  failedTasks: number; cpuPercent: number; memoryUsed: number; memoryTotal: number; memoryPercent: number;
  storageUsed: number; storageTotal: number; storagePercent: number; statusLabel: string; statusTone: Tone;
  degradedSections: number; refreshedAt: string;
}
interface OverviewResponse extends SummaryResponse {
  nodes: NodeItem[]; guests: GuestItem[]; storage: StorageItem[]; tasks: TaskItem[];
  sections: { nodes: SectionState; guests: SectionState; storage: SectionState; tasks: SectionState };
}
interface GuestActionInput { action: GuestActionName; node: string; type: GuestType; vmid: number }
interface GuestActionResponse extends GuestActionInput {
  accepted: true; complete: boolean; outcome: ActionOutcome; upid: string | null;
  observedState: GuestItem['status']; taskStatus: TaskStatus; message: string;
}

const MAX_URL_LENGTH = 512;
const MAX_NODES = 32;
const MAX_GUESTS = 256;
const MAX_STORAGE = 256;
const MAX_TASKS = 50;
const MAX_SAFE_NUMBER = 9_007_199_254_740_991;
const NODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOKEN_ID_PATTERN = /^[A-Za-z0-9@!._-]{3,256}$/;

class ProxmoxError extends Error {
  public constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ProxmoxError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicValue(value: string | SecretReference | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasSecret(value: string | SecretReference | undefined): boolean {
  return isRecord(value) && value.present === true && typeof value.secretRef === 'string' && value.secretRef.length > 0;
}

function boundedString(value: unknown, fallback: string, maximum = 160): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

function boundedNumber(value: unknown, maximum = MAX_SAFE_NUMBER): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, parsed)) : 0;
}

function percentage(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((used / total) * 10_000) / 100) : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

async function loadConfig(host: HostApi): Promise<ProxmoxConfig> {
  const [urlValue, tokenIdValue, tokenSecret, verifyValue] = await Promise.all([
    host.config.get('api_url'), host.config.get('token_id'), host.config.get('token_secret'), host.config.get('verify_ssl'),
  ]);
  const rawUrl = publicValue(urlValue);
  const tokenId = publicValue(tokenIdValue);
  const verify = publicValue(verifyValue);
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) throw new ProxmoxError('The Proxmox API URL is missing or too long.', 'NOT_CONFIGURED');
  if (!TOKEN_ID_PATTERN.test(tokenId)) throw new ProxmoxError('The Proxmox API token ID is missing or invalid.', 'NOT_CONFIGURED');
  if (!hasSecret(tokenSecret)) throw new ProxmoxError('The Proxmox API token secret is not configured.', 'NOT_CONFIGURED');
  if (verify && verify !== 'true' && verify !== 'false') throw new ProxmoxError('The TLS verification setting is invalid.', 'VALIDATION_ERROR');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new ProxmoxError('The Proxmox API URL is invalid.', 'VALIDATION_ERROR'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ProxmoxError('The Proxmox API URL must be HTTPS and must not contain credentials, a query, or a fragment.', 'VALIDATION_ERROR');
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && path !== '/api2/json') throw new ProxmoxError('The Proxmox API URL must point to the server root or /api2/json.', 'VALIDATION_ERROR');
  return { origin: url.origin };
}

function apiUrl(config: ProxmoxConfig, path: string, query?: Record<string, string>): string {
  const url = new URL(`/api2/json/${path.replace(/^\/+/, '')}`, `${config.origin}/`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

function parseEnvelope(response: HostHttpResponse, operation: string): unknown {
  if (response.status === 401) throw new ProxmoxError('Proxmox rejected the configured API token.', 'UPSTREAM_AUTHENTICATION_FAILED');
  if (response.status === 403) throw new ProxmoxError('The configured Proxmox API token does not have permission for this request.', 'UPSTREAM_PERMISSION_DENIED');
  if (response.status < 200 || response.status >= 300) throw new ProxmoxError(`Proxmox rejected the ${operation} request with HTTP ${response.status}.`, 'UPSTREAM_ERROR');
  let payload: unknown = response.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) as unknown; } catch { throw new ProxmoxError(`Proxmox returned malformed ${operation} data.`, 'UPSTREAM_ERROR'); }
  }
  if (!isRecord(payload) || !Object.hasOwn(payload, 'data')) throw new ProxmoxError(`Proxmox returned malformed ${operation} data.`, 'UPSTREAM_ERROR');
  return payload.data;
}

async function requestData(host: HostApi, config: ProxmoxConfig, operation: string, path: string, method: 'GET' | 'POST' = 'GET', query?: Record<string, string>): Promise<unknown> {
  try {
    const response = await host.http.request({
      url: apiUrl(config, path, query), method,
      headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: {} } : {}),
    });
    return parseEnvelope(response, operation);
  } catch (error) {
    if (error instanceof ProxmoxError) throw error;
    throw new ProxmoxError(`NAD could not reach Proxmox for ${operation}.`, 'CONNECTION_ERROR');
  }
}

function records(value: unknown, operation: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new ProxmoxError(`Proxmox returned malformed ${operation} data.`, 'UPSTREAM_ERROR');
  return value.filter(isRecord);
}

function parseNodes(value: unknown): NodeItem[] {
  return records(value, 'node').slice(0, MAX_NODES).map((record) => {
    const node = boundedString(record.node, 'Unknown node', 64);
    const status: NodeItem['status'] = record.status === 'online' || record.status === 'offline' ? record.status : 'unknown';
    const memoryUsed = boundedNumber(record.mem); const memoryTotal = boundedNumber(record.maxmem);
    const storageUsed = boundedNumber(record.disk); const storageTotal = boundedNumber(record.maxdisk);
    return {
      id: boundedString(record.id, `node/${node}`, 160), node, status,
      cpuPercent: Math.min(100, Math.round(boundedNumber(record.cpu, 1) * 10_000) / 100), cpuCores: boundedNumber(record.maxcpu, 4096),
      memoryUsed, memoryTotal, memoryPercent: percentage(memoryUsed, memoryTotal), storageUsed, storageTotal,
      storagePercent: percentage(storageUsed, storageTotal), uptimeSeconds: boundedNumber(record.uptime),
    };
  }).sort((a, b) => a.node.localeCompare(b.node));
}

function guestType(record: Record<string, unknown>): GuestType | null {
  if (record.type === 'qemu' || String(record.id ?? '').startsWith('qemu/')) return 'qemu';
  if (record.type === 'lxc' || String(record.id ?? '').startsWith('lxc/')) return 'lxc';
  return null;
}

function parseGuests(value: unknown): GuestItem[] {
  return records(value, 'guest').map((record) => {
    const type = guestType(record); const vmid = boundedNumber(record.vmid, 999_999_999);
    if (!type || !Number.isInteger(vmid) || vmid < 100) return null;
    const status = record.status === 'running' || record.status === 'stopped' || record.status === 'paused' ? record.status : 'unknown';
    const memoryUsed = boundedNumber(record.mem); const memoryTotal = boundedNumber(record.maxmem);
    const diskUsed = boundedNumber(record.disk); const diskTotal = boundedNumber(record.maxdisk);
    return {
      id: `${type}/${vmid}`, vmid, name: boundedString(record.name, `${type === 'qemu' ? 'VM' : 'CT'} ${vmid}`, 120),
      node: boundedString(record.node, 'Unknown node', 64), type, typeLabel: type === 'qemu' ? 'VM' : 'Container', status,
      template: booleanValue(record.template), cpuPercent: Math.min(100, Math.round(boundedNumber(record.cpu, 1) * 10_000) / 100),
      cpuCores: boundedNumber(record.maxcpu ?? record.cpus, 4096), memoryUsed, memoryTotal, memoryPercent: percentage(memoryUsed, memoryTotal),
      diskUsed, diskTotal, diskPercent: percentage(diskUsed, diskTotal), networkIn: boundedNumber(record.netin),
      networkOut: boundedNumber(record.netout), uptimeSeconds: boundedNumber(record.uptime),
    };
  }).filter((item): item is GuestItem => item !== null).sort((a, b) => a.vmid - b.vmid || a.name.localeCompare(b.name)).slice(0, MAX_GUESTS);
}

function parseStorage(value: unknown): StorageItem[] {
  return records(value, 'storage').map((record) => {
    const storage = boundedString(record.storage, boundedString(record.id, 'Unknown storage', 120), 120);
    const node = boundedString(record.node, 'Unknown node', 64);
    const total = boundedNumber(record.maxdisk ?? record.total); const used = boundedNumber(record.disk ?? record.used);
    const active = record.active;
    const status: StorageItem['status'] = active === 1 || active === true || record.status === 'available'
      ? 'available' : active === 0 || active === false || record.status === 'unavailable' ? 'unavailable' : 'unknown';
    return {
      id: boundedString(record.id, `storage/${node}/${storage}`, 160), storage,
      node, type: boundedString(record.plugintype ?? record.type, 'storage', 80),
      status, shared: booleanValue(record.shared), used, total,
      available: record.avail === undefined ? Math.max(0, total - used) : boundedNumber(record.avail),
      percent: percentage(used, total), content: boundedString(record.content, '', 200),
    };
  }).slice(0, MAX_STORAGE);
}

function taskStatus(record: Record<string, unknown>): TaskStatus {
  const end = boundedNumber(record.endtime); if (!end) return 'running';
  const terminal = boundedString(record.exitstatus ?? record.status, '', 120).toUpperCase();
  if (terminal === 'OK') return 'success';
  return terminal ? 'failed' : 'unknown';
}

function parseTasks(value: unknown): TaskItem[] {
  return records(value, 'task').map((record) => {
    const upid = boundedString(record.upid, '', 512); if (!upid) return null;
    const exitStatus = boundedString(record.exitstatus ?? record.status, '', 120);
    const guestId = boundedNumber(record.id, 999_999_999); const endTime = boundedNumber(record.endtime);
    return {
      upid, node: boundedString(record.node, 'Unknown node', 64), type: boundedString(record.type, 'unknown', 120),
      user: boundedString(record.user, 'unknown', 160), status: taskStatus(record), ...(exitStatus ? { exitStatus } : {}),
      startTime: boundedNumber(record.starttime), ...(endTime ? { endTime } : {}), ...(guestId ? { guestId } : {}),
    };
  }).filter((item): item is TaskItem => item !== null).sort((a, b) => b.startTime - a.startTime).slice(0, MAX_TASKS);
}

function safeError(error: unknown, section: string): string {
  return error instanceof ProxmoxError ? error.message.slice(0, 200) : `Proxmox ${section} data is unavailable.`;
}

async function readStorage(host: HostApi, config: ProxmoxConfig): Promise<StorageItem[]> {
  return parseStorage(await requestData(host, config, 'storage', 'cluster/resources', 'GET', { type: 'storage' }));
}

function summarize(nodes: NodeItem[], guests: GuestItem[], storage: StorageItem[], tasks: TaskItem[], sections: OverviewResponse['sections']): SummaryResponse {
  const memoryUsed = nodes.reduce((sum, item) => Math.min(MAX_SAFE_NUMBER, sum + item.memoryUsed), 0);
  const memoryTotal = nodes.reduce((sum, item) => Math.min(MAX_SAFE_NUMBER, sum + item.memoryTotal), 0);
  const storageUsed = storage.reduce((sum, item) => Math.min(MAX_SAFE_NUMBER, sum + item.used), 0);
  const storageTotal = storage.reduce((sum, item) => Math.min(MAX_SAFE_NUMBER, sum + item.total), 0);
  const online = nodes.filter(({ status }) => status === 'online').length;
  const degradedSections = Object.values(sections).filter((section) => !section.available || section.error).length;
  const statusTone: Tone = nodes.length > 0 && online === 0 ? 'critical' : degradedSections > 0 || online < nodes.length ? 'warning' : 'ok';
  return {
    nodeCount: nodes.length, onlineNodes: online, guestCount: guests.length,
    runningGuests: guests.filter(({ status }) => status === 'running').length, storageCount: storage.length,
    failedTasks: tasks.filter(({ status }) => status === 'failed').length,
    cpuPercent: nodes.length ? Math.round((nodes.reduce((sum, item) => sum + item.cpuPercent, 0) / nodes.length) * 100) / 100 : 0,
    memoryUsed, memoryTotal, memoryPercent: percentage(memoryUsed, memoryTotal), storageUsed, storageTotal,
    storagePercent: percentage(storageUsed, storageTotal),
    statusLabel: statusTone === 'ok' ? 'Cluster healthy' : statusTone === 'critical' ? 'Cluster unavailable' : 'Partial data',
    statusTone, degradedSections, refreshedAt: new Date().toISOString(),
  };
}

async function collectOverview(host: HostApi): Promise<OverviewResponse> {
  const config = await loadConfig(host);
  const [nodesResult, guestsResult, storageResult, tasksResult] = await Promise.allSettled([
    requestData(host, config, 'node', 'nodes').then(parseNodes),
    requestData(host, config, 'guest', 'cluster/resources', 'GET', { type: 'vm' }).then(parseGuests),
    readStorage(host, config),
    requestData(host, config, 'task', 'cluster/tasks').then(parseTasks),
  ]);
  const nodes = nodesResult.status === 'fulfilled' ? nodesResult.value : [];
  const guests = guestsResult.status === 'fulfilled' ? guestsResult.value : [];
  const storage = storageResult.status === 'fulfilled' ? storageResult.value : [];
  const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : [];
  const sections: OverviewResponse['sections'] = {
    nodes: nodesResult.status === 'fulfilled' ? { available: true } : { available: false, error: safeError(nodesResult.reason, 'node') },
    guests: guestsResult.status === 'fulfilled' ? { available: true } : { available: false, error: safeError(guestsResult.reason, 'guest') },
    storage: storageResult.status === 'fulfilled' ? { available: true } : { available: false, error: safeError(storageResult.reason, 'storage') },
    tasks: tasksResult.status === 'fulfilled' ? { available: true } : { available: false, error: safeError(tasksResult.reason, 'task') },
  };
  return { ...summarize(nodes, guests, storage, tasks, sections), nodes, guests, storage, tasks, sections };
}

export async function overview(_request: ModuleRequest, host: HostApi): Promise<OverviewResponse> {
  return collectOverview(host);
}

export async function nodeOverview(_request: ModuleRequest, host: HostApi): Promise<{ nodes: NodeItem[]; storage: StorageItem[]; unavailableStorageNodes: number; refreshedAt: string }> {
  const config = await loadConfig(host);
  const [nodes, storage] = await Promise.all([
    requestData(host, config, 'node', 'nodes').then(parseNodes),
    readStorage(host, config),
  ]);
  return { nodes, storage, unavailableStorageNodes: 0, refreshedAt: new Date().toISOString() };
}

export async function guestList(_request: ModuleRequest, host: HostApi): Promise<{ guests: GuestItem[]; refreshedAt: string }> {
  const config = await loadConfig(host);
  return { guests: parseGuests(await requestData(host, config, 'guest', 'cluster/resources', 'GET', { type: 'vm' })), refreshedAt: new Date().toISOString() };
}

export async function resourceSummary(_request: ModuleRequest, host: HostApi): Promise<SummaryResponse> {
  const value = await collectOverview(host);
  const { nodes: _nodes, guests: _guests, storage: _storage, tasks: _tasks, sections: _sections, ...summary } = value;
  return summary;
}

export async function taskLog(_request: ModuleRequest, host: HostApi): Promise<{ tasks: TaskItem[]; refreshedAt: string }> {
  const config = await loadConfig(host);
  return { tasks: parseTasks(await requestData(host, config, 'task', 'cluster/tasks')), refreshedAt: new Date().toISOString() };
}

export async function testConnection(_request: ModuleRequest, host: HostApi): Promise<{ connected: true; nodeCount: number; version?: string; message: string }> {
  const config = await loadConfig(host);
  const [nodesValue, versionResult] = await Promise.all([
    requestData(host, config, 'node', 'nodes'),
    requestData(host, config, 'version', 'version').catch(() => undefined),
  ]);
  const nodes = parseNodes(nodesValue); const version = isRecord(versionResult) ? boundedString(versionResult.version, '', 80) : '';
  return { connected: true, nodeCount: nodes.length, ...(version ? { version } : {}), message: `Connected to Proxmox with ${nodes.length} visible node${nodes.length === 1 ? '' : 's'}.` };
}

function parseActionInput(value: unknown): GuestActionInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !['action', 'node', 'type', 'vmid'].includes(key))) {
    throw new ProxmoxError('A valid action, node, guest type, and VMID are required.', 'VALIDATION_ERROR');
  }
  if (value.action !== 'start' && value.action !== 'stop' && value.action !== 'restart') throw new ProxmoxError('Choose start, stop, or restart.', 'VALIDATION_ERROR');
  if (typeof value.node !== 'string' || !NODE_PATTERN.test(value.node)) throw new ProxmoxError('The Proxmox node name is invalid.', 'VALIDATION_ERROR');
  if (value.type !== 'qemu' && value.type !== 'lxc') throw new ProxmoxError('The guest type must be qemu or lxc.', 'VALIDATION_ERROR');
  if (typeof value.vmid !== 'number' || !Number.isInteger(value.vmid) || value.vmid < 100 || value.vmid > 999_999_999) throw new ProxmoxError('The VMID must be a whole number from 100 to 999999999.', 'VALIDATION_ERROR');
  return { action: value.action, node: value.node, type: value.type, vmid: value.vmid };
}

function actionPath(input: GuestActionInput): string {
  const verb = input.action === 'restart' ? 'reboot' : input.action;
  return `nodes/${encodeURIComponent(input.node)}/${input.type}/${input.vmid}/status/${verb}`;
}

function safeUpid(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('UPID:') && value.length <= 512 ? value : null;
}

async function annotateAction(host: HostApi, input: GuestActionInput, outcome: ActionOutcome, upid: string | null, observedState: string, task: TaskStatus, code: string | null): Promise<void> {
  try {
    await host.audit.annotate({ action: input.action, node: input.node, type: input.type, vmid: input.vmid, outcome, upid, observedState, taskStatus: task, code });
  } catch { throw new ProxmoxError('NAD could not record the Proxmox guest action outcome in the audit log.', 'AUDIT_FAILED'); }
}

export async function guestAction(request: ModuleRequest, host: HostApi): Promise<GuestActionResponse> {
  const input = parseActionInput(request.body); const config = await loadConfig(host);
  let upid: string | null = null;
  try {
    upid = safeUpid(await requestData(host, config, 'guest action', actionPath(input), 'POST'));
  } catch (error) {
    const code = error instanceof ProxmoxError ? error.code : 'INTERNAL_ERROR';
    await annotateAction(host, input, 'failed', null, 'unknown', 'unknown', code);
    throw error;
  }
  const [tasksResult, guestsResult] = await Promise.allSettled([
    requestData(host, config, 'task confirmation', 'cluster/tasks'),
    requestData(host, config, 'guest confirmation', 'cluster/resources', 'GET', { type: 'vm' }),
  ]);
  let task: TaskItem | undefined; let guest: GuestItem | undefined;
  try { task = tasksResult.status === 'fulfilled' && upid ? parseTasks(tasksResult.value).find((item) => item.upid === upid) : undefined; } catch { task = undefined; }
  try { guest = guestsResult.status === 'fulfilled' ? parseGuests(guestsResult.value).find((item) => item.vmid === input.vmid && item.node === input.node && item.type === input.type) : undefined; } catch { guest = undefined; }
  const observedState = guest?.status ?? 'unknown'; const observedTask = task?.status ?? 'unknown';
  const expected = input.action === 'stop' ? 'stopped' : 'running';
  const outcome: ActionOutcome = observedTask === 'failed' ? 'failed'
    : observedTask === 'success' || (input.action !== 'restart' && observedState === expected) ? 'success' : 'indeterminate';
  await annotateAction(host, input, outcome, upid, observedState, observedTask, null);
  const message = outcome === 'success' ? `${input.action} was confirmed for ${input.type} ${input.vmid}.`
    : outcome === 'failed' ? `Proxmox reported that ${input.action} failed for ${input.type} ${input.vmid}.`
      : `Proxmox accepted ${input.action} for ${input.type} ${input.vmid}, but the final state is not yet known. Refresh the guest and task views.`;
  return { accepted: true, complete: outcome !== 'indeterminate', outcome, ...input, upid, observedState, taskStatus: observedTask, message };
}
