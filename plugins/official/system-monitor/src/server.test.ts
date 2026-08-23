import { describe, expect, it } from 'vitest';
import { createFakeHost } from '@nad/testkit';
import { metrics, sendTestNotification, summary } from './server.js';

const nodeExporterBody = [
  'node_boot_time_seconds 1700000000',
  'node_memory_MemTotal_bytes 100',
  'node_memory_MemAvailable_bytes 25',
  'node_filesystem_size_bytes{mountpoint="/"} 200',
  'node_filesystem_avail_bytes{mountpoint="/"} 50',
  'node_cpu_seconds_total{cpu="0",mode="idle"} 80',
  'node_cpu_seconds_total{cpu="0",mode="system"} 10',
  'node_cpu_seconds_total{cpu="0",mode="user"} 10'
].join('\n');

describe('system-monitor server handlers', () => {
  it('summarises online and offline hosts through the host HTTP broker', async () => {
    const host = createFakeHost({
      config: {
        hosts: 'server-one|10.0.0.10,server-two|10.0.0.11',
        check_method: 'node_exporter',
        node_exporter_port: '9100',
      },
      responses: {
        'http://10.0.0.10:9100/metrics': { status: 200, headers: {}, body: nodeExporterBody },
        'http://10.0.0.11:9100/metrics': { status: 503, headers: {}, body: '' },
      },
    });

    const result = await metrics({ method: 'GET' }, host);
    expect(result.totalHosts).toBe(2);
    expect(result.onlineHosts).toBe(1);
    expect(result.offlineHosts).toBe(1);
    expect(result.hosts[0]).toMatchObject({
      name: 'server-one',
      status: 'online',
      memoryPercent: 75,
      diskPercent: 75,
    });
    expect(result.checkMethod).toBe('node_exporter');
    expect(result.checkMethodLabel).toBe('Node Exporter');
    expect(result.statusTone).toBe('critical');
  });

  it('returns a bounded summary without host rows', async () => {
    const host = createFakeHost({
      config: {
        hosts: 'server-one|10.0.0.10',
        check_method: 'http',
      },
      responses: {
        'http://10.0.0.10/': { status: 200, headers: {}, body: 'ok' },
      },
    });

    await expect(summary({ method: 'GET' }, host)).resolves.toEqual({
      totalHosts: 1,
      onlineHosts: 1,
      offlineHosts: 0,
      status: 'All hosts online',
      statusTone: 'ok',
      checkMethod: 'http',
      checkMethodLabel: 'HTTP reachability',
    });
  });

  it('requests notification delivery through the host API without owning channel configuration', async () => {
    const host = createFakeHost();

    await expect(sendTestNotification({ method: 'POST' }, host)).resolves.toEqual({ accepted: true });
    expect(host.notificationsLog).toEqual([{
      key: 'system-monitor.notification-test',
      severity: 'info',
      title: 'System Monitor notification test',
      body: 'This test event was requested by the installed System Monitor Module and delivered by NAD core.',
    }]);
  });
});
