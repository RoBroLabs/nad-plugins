import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandDev, parseDevArgs, startDevPreviewServer, validatePreviewHost } from './dev.js';

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nad-cli-dev-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function writePreviewModule(): Promise<string> {
  const directory = await tempDirectory();
  await mkdir(join(directory, 'dist/server'), { recursive: true });
  await mkdir(join(directory, 'ui'), { recursive: true });
  await mkdir(join(directory, 'schemas/endpoints'), { recursive: true });
  await mkdir(join(directory, 'assets'), { recursive: true });
  await mkdir(join(directory, 'fixtures/scenarios'), { recursive: true });

  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'dev.robrolabs.preview-module',
    slug: 'preview-module',
    name: 'Preview Module',
    description: 'CLI preview fixture.',
    icon: 'box',
    category: 'tools',
    version: '0.1.0',
    publisher: 'Robro Labs',
    compatibility: { core: '>=0.2.2 <1.0.0', hostApi: '1.x', uiApi: '1.x' },
    capabilities: [{ name: 'config.get', reason: 'Read preview config.' }],
    permissions: [{ action: 'view', label: 'View preview', risk: 'read' }],
    configSchema: [{ key: 'headline', label: 'Headline', type: 'text', required: true }],
    entrypoints: {
      summary: {
        method: 'GET',
        kind: 'query',
        permission: 'view',
        handler: 'summary',
        requestSchema: 'schemas/endpoints/summary-input.json',
        responseSchema: 'schemas/endpoints/summary-output.json',
        timeoutClass: 'short',
        maxRequestBytes: 1024,
        maxResponseBytes: 4096,
      },
    },
  }, null, 2));

  await writeFile(join(directory, 'dist/server/main.js'), `
export async function summary(_request, host) {
  return {
    headline: await host.config.get('headline'),
    statusMessage: 'Preview rendered',
    statusTone: 'ok',
    mode: 'read-only',
    publisher: 'Robro Labs'
  };
}
`);

  await writeFile(join(directory, 'ui/pages.json'), JSON.stringify({
    schemaVersion: 1,
    pages: [{
      path: '/',
      title: 'Preview Page',
      source: { endpoint: 'summary' },
      body: [{ type: 'status', label: 'State', valuePath: 'statusMessage', tonePath: 'statusTone' }],
    }],
  }, null, 2));
  await writeFile(join(directory, 'ui/widgets.json'), JSON.stringify({
    schemaVersion: 1,
    widgets: [{
      id: 'summary',
      name: 'Preview Widget',
      description: 'Preview widget.',
      defaultSize: { w: 4, h: 3 },
      source: { endpoint: 'summary' },
      body: [{ type: 'status', label: 'State', valuePath: 'statusMessage', tonePath: 'statusTone' }],
    }],
  }, null, 2));
  await writeFile(join(directory, 'schemas/config.json'), '{"type":"object","additionalProperties":false}\n');
  await writeFile(join(directory, 'schemas/endpoints/summary-input.json'), '{"type":"object","additionalProperties":false}\n');
  await writeFile(join(directory, 'schemas/endpoints/summary-output.json'), '{"type":"object","additionalProperties":true}\n');
  await writeFile(join(directory, 'README.md'), '# Preview\n');
  await writeFile(join(directory, 'LICENSE'), 'AGPL-3.0-only\n');
  await writeFile(join(directory, 'assets/icon.png'), new Uint8Array([137, 80, 78, 71]));
  await writeFile(join(directory, 'fixtures/scenarios/default.v1.json'), JSON.stringify({
    schemaVersion: 1,
    name: 'Default',
    roles: {
      viewer: { grants: ['view'] },
    },
    defaultRole: 'viewer',
    config: {
      headline: 'CLI preview headline',
    },
  }, null, 2));
  return directory;
}

describe('nad-module dev CLI', () => {
  it('emits deterministic JSON in --once mode', async () => {
    const moduleDir = await writePreviewModule();
    const logs: string[] = [];

    await commandDev([moduleDir, '--once', '--endpoint', 'summary'], {
      log(message) {
        logs.push(message);
      },
      error() {},
    });

    const parsed = JSON.parse(logs[0] ?? '{}') as { endpoints?: Record<string, { status?: string; response?: { headline?: string } }> };
    expect(parsed.endpoints?.summary?.status).toBe('ok');
    expect(parsed.endpoints?.summary?.response?.headline).toBe('CLI preview headline');
  }, 30_000);

  it('binds preview servers to localhost by default and renders controls', async () => {
    const moduleDir = await writePreviewModule();
    const server = await startDevPreviewServer({
      ...parseDevArgs([moduleDir, '--port', '0']),
    });

    try {
      expect(server.host).toBe('127.0.0.1');
      const html = await fetch(server.url).then((response) => response.text());
      expect(html).toContain('Scenario');
      expect(html).toContain('Preview Widget');
      expect(html).toContain('Endpoint Inspector');
    } finally {
      await server.close();
    }
  });

  it('rejects non-local preview hosts', () => {
    expect(validatePreviewHost(undefined)).toBe('127.0.0.1');
    expect(() => validatePreviewHost('0.0.0.0')).toThrow(/localhost only/);
  });
});
