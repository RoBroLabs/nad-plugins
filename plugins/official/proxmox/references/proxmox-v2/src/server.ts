import type { AppRequestV2, HostApiV2, SecretReference } from '@nad/sdk';

type GuestType = 'qemu' | 'lxc';
type GuestActionName = 'start' | 'stop' | 'restart';

interface NodeItem {
  node: string;
  status: 'online' | 'offline' | 'unknown';
  cpuPercent: number;
  memoryPercent: number;
}

interface GuestItem {
  vmid: number;
  name: string;
  node: string;
  type: GuestType;
  status: 'running' | 'stopped' | 'paused' | 'unknown';
}

interface GuestActionInput {
  action: GuestActionName;
  node: string;
  type: GuestType;
  vmid: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasSecret(value: unknown): value is SecretReference {
  return isRecord(value) && value.present === true && typeof value.secretRef === 'string' && value.secretRef.length > 0;
}

function boundedString(value: unknown, fallback: string, maximum = 120): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

function boundedNumber(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(maximum, parsed)) : 0;
}

async function requireConnection(host: HostApiV2): Promise<{ id: string; name: string }> {
  const [profile, apiUrl, tokenId, tokenSecret] = await Promise.all([
    host.connections.current(),
    host.connections.get('api_url'),
    host.connections.get('token_id'),
    host.connections.get('token_secret'),
  ]);
  if (!profile) throw new Error('CONNECTION_REQUIRED');
  if (typeof apiUrl !== 'string' || !apiUrl.startsWith('https://') || apiUrl.length > 512) throw new Error('CONNECTION_INVALID');
  if (typeof tokenId !== 'string' || !/^[A-Za-z0-9@!._-]{3,256}$/.test(tokenId)) throw new Error('CONNECTION_INVALID');
  if (!hasSecret(tokenSecret)) throw new Error('CONNECTION_INVALID');
  return profile;
}

function envelope(response: { status: number; body: unknown }, operation: string): unknown {
  if (response.status === 401 || response.status === 403) throw new Error('UPSTREAM_ACCESS_DENIED');
  if (response.status < 200 || response.status >= 300) throw new Error(`UPSTREAM_${operation.toUpperCase()}_FAILED`);
  let body = response.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body) as unknown; } catch { throw new Error('UPSTREAM_MALFORMED_RESPONSE'); }
  }
  if (!isRecord(body) || !Object.hasOwn(body, 'data')) throw new Error('UPSTREAM_MALFORMED_RESPONSE');
  return body.data;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('UPSTREAM_MALFORMED_RESPONSE');
  return value.filter(isRecord);
}

function parseNodes(value: unknown): NodeItem[] {
  return records(value).slice(0, 32).map((record) => {
    const memory = boundedNumber(record.mem);
    const maximumMemory = boundedNumber(record.maxmem);
    return {
      node: boundedString(record.node, 'Unknown node', 64),
      status: record.status === 'online' || record.status === 'offline' ? record.status : 'unknown',
      cpuPercent: Math.round(boundedNumber(record.cpu, 1) * 10_000) / 100,
      memoryPercent: maximumMemory > 0 ? Math.round((memory / maximumMemory) * 10_000) / 100 : 0,
    };
  });
}

function parseGuests(value: unknown): GuestItem[] {
  return records(value).map((record) => {
    const type = record.type === 'lxc' || String(record.id ?? '').startsWith('lxc/') ? 'lxc'
      : record.type === 'qemu' || String(record.id ?? '').startsWith('qemu/') ? 'qemu' : null;
    const vmid = boundedNumber(record.vmid, 999_999_999);
    if (!type || !Number.isInteger(vmid) || vmid < 100) return null;
    const status = record.status === 'running' || record.status === 'stopped' || record.status === 'paused'
      ? record.status : 'unknown';
    return {
      vmid,
      name: boundedString(record.name, `${type.toUpperCase()} ${vmid}`),
      node: boundedString(record.node, 'Unknown node', 64),
      type,
      status,
    } satisfies GuestItem;
  }).filter((guest): guest is GuestItem => guest !== null).slice(0, 256);
}

async function readNodes(host: HostApiV2): Promise<NodeItem[]> {
  return parseNodes(envelope(await host.http.request({ scope: 'nodes', method: 'GET' }), 'nodes'));
}

async function readGuests(host: HostApiV2): Promise<GuestItem[]> {
  return parseGuests(envelope(await host.http.request({ scope: 'guests', method: 'GET', query: { type: 'vm' } }), 'guests'));
}

export async function testConnection(_request: AppRequestV2, host: HostApiV2): Promise<{
  connected: true;
  profile: string;
  nodeCount: number;
  version?: string;
}> {
  const profile = await requireConnection(host);
  const [nodes, versionResponse] = await Promise.all([
    readNodes(host),
    host.http.request({ scope: 'version', method: 'GET' }).catch(() => undefined),
  ]);
  const versionData = versionResponse ? envelope(versionResponse, 'version') : undefined;
  const version = isRecord(versionData) ? boundedString(versionData.version, '', 80) : '';
  return { connected: true, profile: profile.name, nodeCount: nodes.length, ...(version ? { version } : {}) };
}

export async function overview(_request: AppRequestV2, host: HostApiV2): Promise<{
  profile: string;
  nodeCount: number;
  onlineNodes: number;
  guestCount: number;
  runningGuests: number;
  nodes: NodeItem[];
  guests: GuestItem[];
}> {
  const profile = await requireConnection(host);
  const [nodes, guestItems] = await Promise.all([readNodes(host), readGuests(host)]);
  return {
    profile: profile.name,
    nodeCount: nodes.length,
    onlineNodes: nodes.filter((node) => node.status === 'online').length,
    guestCount: guestItems.length,
    runningGuests: guestItems.filter((guest) => guest.status === 'running').length,
    nodes,
    guests: guestItems,
  };
}

export async function guests(_request: AppRequestV2, host: HostApiV2): Promise<{ profile: string; guests: GuestItem[] }> {
  const profile = await requireConnection(host);
  return { profile: profile.name, guests: await readGuests(host) };
}

function actionInput(value: unknown): GuestActionInput {
  if (!isRecord(value) || (value.action !== 'start' && value.action !== 'stop' && value.action !== 'restart')) throw new Error('VALIDATION_ERROR');
  if (value.type !== 'qemu' && value.type !== 'lxc') throw new Error('VALIDATION_ERROR');
  if (typeof value.node !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.node)) throw new Error('VALIDATION_ERROR');
  if (typeof value.vmid !== 'number' || !Number.isInteger(value.vmid) || value.vmid < 100 || value.vmid > 999_999_999) throw new Error('VALIDATION_ERROR');
  return { action: value.action, type: value.type, node: value.node, vmid: value.vmid };
}

export async function guestAction(request: AppRequestV2, host: HostApiV2): Promise<{
  accepted: true;
  profile: string;
  action: GuestActionName;
  node: string;
  type: GuestType;
  vmid: number;
  upid: string | null;
}> {
  const profile = await requireConnection(host);
  const input = actionInput(request.body);
  const response = await host.http.request({
    scope: `${input.type}-${input.action}`,
    method: 'POST',
    pathParameters: { node: input.node, vmid: input.vmid },
    body: {},
  });
  const data = envelope(response, 'guest_action');
  const upid = typeof data === 'string' && data.startsWith('UPID:') && data.length <= 512 ? data : null;
  await host.audit.annotate({
    profileId: profile.id,
    action: input.action,
    node: input.node,
    type: input.type,
    vmid: input.vmid,
    accepted: true,
    upid,
  });
  return { accepted: true, profile: profile.name, ...input, upid };
}
