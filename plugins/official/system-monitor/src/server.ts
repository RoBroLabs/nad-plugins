import type { HostApi, HostHttpResponse, ModuleRequest } from '@nad/sdk';

type HostStatus = 'online' | 'offline' | 'degraded';
type Tone = 'ok' | 'warning' | 'critical';
type CheckMethod = 'node_exporter' | 'http';

interface ConfiguredHost {
  name: string;
  address: string;
}

interface HostMetrics {
  name: string;
  address: string;
  status: HostStatus;
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  error?: string;
}

interface MetricsResponse {
  totalHosts: number;
  onlineHosts: number;
  offlineHosts: number;
  status: string;
  statusTone: Tone;
  checkMethod: CheckMethod;
  checkMethodLabel: string;
  hosts: HostMetrics[];
}

function asString(value: string | { secretRef: string; present: boolean } | undefined): string {
  return typeof value === 'string' ? value : '';
}

function parseHosts(value: string): ConfiguredHost[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawName, rawAddress] = entry.split('|');
      const name = rawName?.trim() ?? '';
      const address = rawAddress?.trim() ?? '';
      if (!name || !address) throw new Error('Each host must use name|host syntax.');
      if (seen.has(name)) throw new Error(`Duplicate host name: ${name}`);
      seen.add(name);
      return { name, address };
    });
}

function parsePort(value: string): number {
  const port = value ? Number(value) : 9100;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('node_exporter_port must be between 1 and 65535.');
  }
  return port;
}

function metricValue(metrics: string, name: string, labelNeedle?: string): number | null {
  const lines = metrics.split('\n');
  for (const line of lines) {
    if (!line.startsWith(name)) continue;
    if (labelNeedle && !line.includes(labelNeedle)) continue;
    const parts = line.trim().split(/\s+/);
    const value = Number(parts[parts.length - 1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function allMetricValues(metrics: string, name: string, labelNeedle?: string): number[] {
  const values: number[] = [];
  for (const line of metrics.split('\n')) {
    if (!line.startsWith(name)) continue;
    if (labelNeedle && !line.includes(labelNeedle)) continue;
    const parts = line.trim().split(/\s+/);
    const value = Number(parts[parts.length - 1]);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function percent(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function parseNodeExporterMetrics(host: ConfiguredHost, body: unknown): HostMetrics {
  const metrics = typeof body === 'string'
    ? body
    : typeof body === 'object' && body !== null && 'text' in body && typeof body.text === 'string'
      ? body.text
      : '';
  if (!metrics) {
    return {
      name: host.name,
      address: host.address,
      status: 'degraded',
      uptimeSeconds: null,
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
      error: 'Metrics body was empty.',
    };
  }

  const nowSeconds = Date.now() / 1000;
  const bootTime = metricValue(metrics, 'node_boot_time_seconds');
  const memoryTotal = metricValue(metrics, 'node_memory_MemTotal_bytes');
  const memoryAvailable = metricValue(metrics, 'node_memory_MemAvailable_bytes');
  const diskSize = metricValue(metrics, 'node_filesystem_size_bytes', 'mountpoint="/"');
  const diskAvailable = metricValue(metrics, 'node_filesystem_avail_bytes', 'mountpoint="/"');
  const idleValues = allMetricValues(metrics, 'node_cpu_seconds_total', 'mode="idle"');
  const totalValues = allMetricValues(metrics, 'node_cpu_seconds_total');

  const memoryPercent = memoryTotal && memoryAvailable !== null
    ? ((memoryTotal - memoryAvailable) / memoryTotal) * 100
    : null;
  const diskPercent = diskSize && diskAvailable !== null
    ? ((diskSize - diskAvailable) / diskSize) * 100
    : null;
  const idleTotal = idleValues.reduce((sum, value) => sum + value, 0);
  const cpuTotal = totalValues.reduce((sum, value) => sum + value, 0);
  const cpuPercent = cpuTotal > 0 ? (1 - idleTotal / cpuTotal) * 100 : null;

  return {
    name: host.name,
    address: host.address,
    status: 'online',
    uptimeSeconds: bootTime === null ? null : Math.max(0, Math.round(nowSeconds - bootTime)),
    cpuPercent: percent(cpuPercent),
    memoryPercent: percent(memoryPercent),
    diskPercent: percent(diskPercent),
  };
}

function checkMethodLabel(method: CheckMethod): string {
  return method === 'http' ? 'HTTP reachability' : 'Node Exporter';
}

function summarise(hosts: HostMetrics[], method: CheckMethod): MetricsResponse {
  const totalHosts = hosts.length;
  const onlineHosts = hosts.filter(({ status }) => status === 'online').length;
  const offlineHosts = hosts.filter(({ status }) => status === 'offline').length;
  const degradedHosts = hosts.filter(({ status }) => status === 'degraded').length;
  const statusTone: Tone = offlineHosts > 0 ? 'critical' : degradedHosts > 0 ? 'warning' : 'ok';
  const status = totalHosts === 0
    ? 'No hosts configured'
    : offlineHosts > 0
      ? `${offlineHosts} offline`
      : degradedHosts > 0
        ? `${degradedHosts} degraded`
        : 'All hosts online';

  return {
    totalHosts,
    onlineHosts,
    offlineHosts,
    status,
    statusTone,
    checkMethod: method,
    checkMethodLabel: checkMethodLabel(method),
    hosts,
  };
}

async function loadConfig(host: HostApi): Promise<{
  hosts: ConfiguredHost[];
  method: CheckMethod;
  port: number;
}> {
  const hosts = parseHosts(asString(await host.config.get('hosts')));
  const method = asString(await host.config.get('check_method')) || 'node_exporter';
  const port = parsePort(asString(await host.config.get('node_exporter_port')));
  if (method !== 'node_exporter' && method !== 'http') throw new Error('Unsupported check_method.');
  return { hosts, method, port };
}

async function readHostMetrics(configuredHost: ConfiguredHost, method: CheckMethod, port: number, host: HostApi): Promise<HostMetrics> {
  const url = method === 'node_exporter'
    ? `http://${configuredHost.address}:${port}/metrics`
    : `http://${configuredHost.address}/`;
  try {
    const response = await host.http.request({ url, method: 'GET' });
    if (response.status < 200 || response.status >= 300) {
      return {
        name: configuredHost.name,
        address: configuredHost.address,
        status: 'offline',
        uptimeSeconds: null,
        cpuPercent: null,
        memoryPercent: null,
        diskPercent: null,
        error: `Host returned HTTP ${response.status}.`,
      };
    }
    if (method === 'http') {
      return {
        name: configuredHost.name,
        address: configuredHost.address,
        status: 'online',
        uptimeSeconds: null,
        cpuPercent: null,
        memoryPercent: null,
        diskPercent: null,
      };
    }
    return parseNodeExporterMetrics(configuredHost, response.body);
  } catch (error) {
    return {
      name: configuredHost.name,
      address: configuredHost.address,
      status: 'offline',
      uptimeSeconds: null,
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
      error: error instanceof Error ? error.message.slice(0, 200) : 'Host request failed.',
    };
  }
}

export async function metrics(_request: ModuleRequest, host: HostApi): Promise<MetricsResponse> {
  const config = await loadConfig(host);
  const hosts = await Promise.all(
    config.hosts.map((configuredHost) => readHostMetrics(configuredHost, config.method, config.port, host)),
  );
  return summarise(hosts, config.method);
}

export async function summary(request: ModuleRequest, host: HostApi): Promise<Omit<MetricsResponse, 'hosts'>> {
  const result = await metrics(request, host);
  return {
    totalHosts: result.totalHosts,
    onlineHosts: result.onlineHosts,
    offlineHosts: result.offlineHosts,
    status: result.status,
    statusTone: result.statusTone,
    checkMethod: result.checkMethod,
    checkMethodLabel: result.checkMethodLabel,
  };
}

export async function sendTestNotification(_request: ModuleRequest, host: HostApi): Promise<{ accepted: true }> {
  await host.notifications.emit({
    key: 'system-monitor.notification-test',
    severity: 'info',
    title: 'System Monitor notification test',
    body: 'This test event was requested by the installed System Monitor Module and delivered by NAD core.',
  });
  return { accepted: true };
}
