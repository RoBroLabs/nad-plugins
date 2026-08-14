import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDevSession } from './dev.js';

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nad-testkit-dev-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function writeFixtureModule(): Promise<string> {
  const directory = await tempDirectory();
  await mkdir(join(directory, 'dist/server'), { recursive: true });
  await mkdir(join(directory, 'ui'), { recursive: true });
  await mkdir(join(directory, 'schemas/endpoints'), { recursive: true });
  await mkdir(join(directory, 'assets'), { recursive: true });
  await mkdir(join(directory, 'fixtures/scenarios'), { recursive: true });
  await mkdir(join(directory, 'fixtures/upstream'), { recursive: true });

  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'dev.robrolabs.dev-preview',
    slug: 'dev-preview',
    name: 'Dev Preview',
    description: 'Fixture module for dev preview tests.',
    icon: 'box',
    category: 'tools',
    version: '0.1.0',
    publisher: 'Robro Labs',
    compatibility: { core: '>=0.2.2 <1.0.0', hostApi: '1.x', uiApi: '1.x' },
    capabilities: [
      { name: 'config.get', reason: 'Read fixture config.' },
      { name: 'http.request', reason: 'Read fake upstream fixture responses.' },
      { name: 'notifications.emit', reason: 'Capture preview notification side effects.' },
      { name: 'storage.get', reason: 'Read fake storage.' },
      { name: 'storage.set', reason: 'Write fake storage.' },
      { name: 'storage.delete', reason: 'Delete fake storage.' },
      { name: 'audit.annotate', reason: 'Capture preview audit events.' },
    ],
    httpAccess: [
      {
        scheme: 'https',
        hostConfig: 'headline',
        port: 443,
        path: '/status',
        methods: ['GET'],
      },
    ],
    permissions: [
      { action: 'view', label: 'View module', risk: 'read' },
      { action: 'admin', label: 'Admin module', risk: 'admin' },
    ],
    configSchema: [
      { key: 'headline', label: 'Headline', type: 'text', required: true },
      { key: 'api_token', label: 'API token', type: 'secret', required: false },
    ],
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
      capture: {
        method: 'POST',
        kind: 'mutation',
        permission: 'admin',
        handler: 'capture',
        requestSchema: 'schemas/endpoints/capture-input.json',
        responseSchema: 'schemas/endpoints/capture-output.json',
        auditAction: 'preview_capture',
        timeoutClass: 'short',
        maxRequestBytes: 1024,
        maxResponseBytes: 4096,
      },
      explode: {
        method: 'GET',
        kind: 'query',
        permission: 'view',
        handler: 'explode',
        requestSchema: 'schemas/endpoints/explode-input.json',
        responseSchema: 'schemas/endpoints/explode-output.json',
        timeoutClass: 'short',
        maxRequestBytes: 1024,
        maxResponseBytes: 4096,
      },
      slow: {
        method: 'GET',
        kind: 'query',
        permission: 'view',
        handler: 'slow',
        requestSchema: 'schemas/endpoints/slow-input.json',
        responseSchema: 'schemas/endpoints/slow-output.json',
        timeoutClass: 'short',
        maxRequestBytes: 1024,
        maxResponseBytes: 4096,
      },
    },
  }, null, 2));

  await writeFile(join(directory, 'dist/server/main.js'), `
export async function summary(_request, host) {
  const headline = await host.config.get('headline');
  const token = await host.config.get('api_token');
  return {
    headline,
    hasToken: Boolean(token && typeof token === 'object' && token.present === true),
    mode: 'ok'
  };
}

export async function capture(_request, host) {
  const upstream = await host.http.request({ url: 'https://service.example/status', method: 'GET' });
  await host.storage.set('seen', upstream.body);
  await host.notifications.emit({
    key: 'capture.test',
    severity: 'info',
    title: 'Captured',
    body: 'Notification emitted from preview.',
  });
  await host.audit.annotate({ safe: true, status: upstream.status });
  return {
    accepted: true,
    upstream: upstream.body
  };
}

export async function explode() {
  throw new Error('preview exploded');
}

export async function slow() {
  await new Promise(() => {});
  return { slow: true };
}
`);

  await writeFile(join(directory, 'ui/widgets.json'), JSON.stringify({
    schemaVersion: 1,
    widgets: [{
      id: 'summary',
      name: 'Summary',
      description: 'Fixture summary widget.',
      defaultSize: { w: 4, h: 3 },
      source: { endpoint: 'summary' },
      body: [{ type: 'status', label: 'Mode', valuePath: 'mode' }],
    }],
  }, null, 2));
  await writeFile(join(directory, 'ui/pages.json'), JSON.stringify({
    schemaVersion: 1,
    pages: [{ path: '/', title: 'Fixture', source: { endpoint: 'summary' }, body: [{ type: 'status', label: 'Mode', valuePath: 'mode' }] }],
  }, null, 2));
  await writeFile(join(directory, 'schemas/config.json'), JSON.stringify({
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: { type: 'string' },
      api_token: { type: 'string' },
    },
  }, null, 2));

  for (const name of ['summary', 'capture', 'explode', 'slow']) {
    await writeFile(join(directory, 'schemas/endpoints', `${name}-input.json`), '{"type":"object","additionalProperties":false}\n');
    await writeFile(join(directory, 'schemas/endpoints', `${name}-output.json`), '{"type":"object","additionalProperties":true}\n');
  }

  await writeFile(join(directory, 'README.md'), '# Fixture\n');
  await writeFile(join(directory, 'LICENSE'), 'AGPL-3.0-only\n');
  await writeFile(join(directory, 'assets/icon.png'), new Uint8Array([137, 80, 78, 71]));
  await writeFile(join(directory, 'fixtures/upstream/status.json'), JSON.stringify({ ok: true, source: 'fixture' }, null, 2));
  await writeFile(join(directory, 'fixtures/scenarios/default.v1.json'), JSON.stringify({
    schemaVersion: 1,
    name: 'Default',
    description: 'Happy-path preview scenario.',
    defaultRole: 'viewer',
    roles: {
      viewer: { grants: ['view'] },
      operator: { grants: ['admin', 'view'] },
      denied: { grants: [] },
    },
    config: {
      headline: 'Preview ready',
      api_token: { secretRef: 'preview-token', present: true },
    },
    requests: {
      capture: { method: 'POST', body: { accepted: true } },
    },
    responses: {
      'https://service.example/status': {
        status: 200,
        headers: { 'content-type': 'application/json' },
        fixture: '../upstream/status.json',
      },
    },
  }, null, 2));

  return directory;
}

describe('runDevSession', () => {
  it('executes a successful endpoint with opaque secret refs', async () => {
    const moduleDir = await writeFixtureModule();
    const result = await runDevSession({ moduleDir, endpoint: 'summary', role: 'viewer' });

    expect(result.role).toEqual({ name: 'viewer', grants: ['view'] });
    expect(result.config.api_token).toEqual({ secretRef: 'preview-token', present: true });
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(result.endpoints.summary).toMatchObject({
      status: 'ok',
      response: {
        headline: 'Preview ready',
        hasToken: true,
        mode: 'ok',
      },
    });
  });

  it('denies access when the selected role lacks the endpoint permission', async () => {
    const moduleDir = await writeFixtureModule();
    const result = await runDevSession({ moduleDir, endpoint: 'capture', role: 'viewer' });
    const endpoint = result.endpoints.capture;
    if (!endpoint) throw new Error('capture result missing');

    expect(endpoint.status).toBe('denied');
    expect(endpoint.error).toContain('does not grant admin');
  });

  it('captures host side effects for successful handlers', async () => {
    const moduleDir = await writeFixtureModule();
    const result = await runDevSession({ moduleDir, endpoint: 'capture', role: 'operator' });
    const endpoint = result.endpoints.capture;
    if (!endpoint) throw new Error('capture result missing');

    expect(endpoint.status).toBe('ok');
    expect(endpoint.sideEffects.notifications).toEqual([{
      key: 'capture.test',
      severity: 'info',
      title: 'Captured',
      body: 'Notification emitted from preview.',
    }]);
    expect(endpoint.sideEffects.audit).toEqual([{ safe: true, status: 200 }]);
    expect(endpoint.sideEffects.storage.snapshot).toEqual({
      seen: { ok: true, source: 'fixture' },
    });
    expect(endpoint.sideEffects.http.requests[0]).toMatchObject({
      url: 'https://service.example/status',
      method: 'GET',
    });
  });

  it('reports thrown handler errors without crashing the harness', async () => {
    const moduleDir = await writeFixtureModule();
    const result = await runDevSession({ moduleDir, endpoint: 'explode', role: 'viewer' });
    const endpoint = result.endpoints.explode;
    if (!endpoint) throw new Error('explode result missing');

    expect(endpoint.status).toBe('error');
    expect(endpoint.error).toContain('preview exploded');
  });

  it('bounds handler execution with timeout status', async () => {
    const moduleDir = await writeFixtureModule();
    const result = await runDevSession({ moduleDir, endpoint: 'slow', role: 'viewer' });
    const endpoint = result.endpoints.slow;
    if (!endpoint) throw new Error('slow result missing');

    expect(endpoint.status).toBe('timeout');
    expect(endpoint.error).toContain('timeout budget');
  });
});
