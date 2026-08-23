import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspect } from 'node:util';
import type { ModuleManifest, PagesFile, WidgetsFile } from '@nad/sdk';

const allowedPreviewHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export interface CommandIo {
  log(message: string): void;
  error(message: string): void;
}

export interface DevCliOptions {
  moduleDir: string;
  once: boolean;
  scenario?: string;
  role?: string;
  endpoint?: string;
  host: string;
  port: number;
}

export interface DevPreviewServer {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface PreviewLoadedModule {
  moduleDir: string;
  manifest: ModuleManifest;
  pages: PagesFile;
  widgets: WidgetsFile;
}

interface PreviewEndpointResult {
  endpoint: string;
  status: 'ok' | 'denied' | 'error' | 'timeout';
  error?: string;
  response?: unknown;
  sideEffects?: unknown;
}

interface PreviewScenario {
  roles?: Record<string, { grants: string[] }>;
  defaultRole?: string;
}

interface PreviewLoadedScenario {
  fileName: string;
  document: PreviewScenario & {
    name: string;
    description?: string;
  };
}

interface PreviewRunResult {
  schemaVersion: 1;
  module: {
    id: string;
    slug: string;
    name: string;
    version: string;
  };
  scenario: {
    name: string;
    file: string;
    description?: string;
  };
  role: {
    name: string;
    grants: string[];
  };
  config: Record<string, unknown>;
  pages: PagesFile;
  widgets: WidgetsFile;
  endpoints: Record<string, PreviewEndpointResult>;
}

interface TestkitDevRuntime {
  listDevScenarios(moduleDir: string): Promise<string[]>;
  loadDevModule(moduleDir: string): Promise<PreviewLoadedModule>;
  loadDevScenario(moduleDir: string, scenarioRef?: string): Promise<PreviewLoadedScenario>;
  runDevEndpoint(
    module: PreviewLoadedModule,
    scenario: PreviewLoadedScenario,
    endpoint: string,
    role?: string,
  ): Promise<PreviewEndpointResult>;
  runDevSession(options: {
    moduleDir: string;
    scenario?: string;
    role?: string;
    endpoint?: string;
  }): Promise<PreviewRunResult>;
}

async function loadTestkitDevRuntime(): Promise<TestkitDevRuntime> {
  const pkg = await import('@nad/testkit') as Partial<TestkitDevRuntime>;
  if (
    typeof pkg.listDevScenarios === 'function'
    && typeof pkg.loadDevModule === 'function'
    && typeof pkg.loadDevScenario === 'function'
    && typeof pkg.runDevEndpoint === 'function'
    && typeof pkg.runDevSession === 'function'
  ) {
    return pkg as TestkitDevRuntime;
  }

  const fallback = await import('../../testkit/src/index.js') as Partial<TestkitDevRuntime>;
  if (
    typeof fallback.listDevScenarios === 'function'
    && typeof fallback.loadDevModule === 'function'
    && typeof fallback.loadDevScenario === 'function'
    && typeof fallback.runDevEndpoint === 'function'
    && typeof fallback.runDevSession === 'function'
  ) {
    return fallback as TestkitDevRuntime;
  }

  throw new Error('The testkit dev runtime is unavailable. Build @nad/testkit or expose the new dev helpers.');
}

function usage(): string {
  return '  nad-module dev <module-dir> [--once] [--scenario <name>] [--role <name>] [--endpoint <name>] [--host 127.0.0.1|localhost|::1] [--port <number>]';
}

function parseFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.\n${usage()}`);
  }
  return value;
}

export function validatePreviewHost(host: string | undefined): string {
  const resolvedHost = host?.trim() || '127.0.0.1';
  if (!allowedPreviewHosts.has(resolvedHost)) {
    throw new Error(`Preview host ${resolvedHost} is not allowed. Bind the preview to localhost only.`);
  }
  return resolvedHost;
}

function parsePort(value: string | undefined): number {
  if (!value) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid preview port ${value}.`);
  }
  return port;
}

export function parseDevArgs(args: string[]): DevCliOptions {
  const positionals: string[] = [];
  let once = false;
  let scenario: string | undefined;
  let role: string | undefined;
  let endpoint: string | undefined;
  let host: string | undefined;
  let port: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--once') {
      once = true;
      continue;
    }
    if (arg === '--scenario') {
      scenario = parseFlagValue(args, index, '--scenario');
      index += 1;
      continue;
    }
    if (arg === '--role') {
      role = parseFlagValue(args, index, '--role');
      index += 1;
      continue;
    }
    if (arg === '--endpoint') {
      endpoint = parseFlagValue(args, index, '--endpoint');
      index += 1;
      continue;
    }
    if (arg === '--host') {
      host = parseFlagValue(args, index, '--host');
      index += 1;
      continue;
    }
    if (arg === '--port') {
      port = parseFlagValue(args, index, '--port');
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown flag ${arg}.\n${usage()}`);
    }
    positionals.push(arg);
  }

  const moduleDir = positionals[0];
  if (positionals.length !== 1 || !moduleDir) {
    throw new Error(`The dev command requires a module directory.\n${usage()}`);
  }

  return {
    moduleDir,
    once,
    scenario,
    role,
    endpoint,
    host: validatePreviewHost(host),
    port: parsePort(port),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jsonHtml(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function valueAtPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

function renderInlineValue(value: unknown): string {
  if (value === undefined || value === null) return '<span class="muted">n/a</span>';
  if (typeof value === 'string') return escapeHtml(value);
  if (typeof value === 'number' || typeof value === 'boolean') return escapeHtml(String(value));
  return `<code>${escapeHtml(inspect(value, { depth: 2, breakLength: Infinity }))}</code>`;
}

function renderSourceResult(result: PreviewEndpointResult | undefined): string {
  if (!result) return '<p class="callout">No endpoint result is available for this source.</p>';
  if (result.status !== 'ok') {
    return `<p class="callout">${escapeHtml(result.status.toUpperCase())}: ${escapeHtml(result.error ?? 'No details.')}</p>`;
  }
  return '';
}

function renderElement(element: Record<string, unknown>, data: unknown): string {
  const type = element.type;
  if (type === 'section') {
    const title = typeof element.title === 'string' ? `<h4>${escapeHtml(element.title)}</h4>` : '';
    const body = Array.isArray(element.body)
      ? element.body.map((child) => isRecord(child) ? renderElement(child, data) : '').join('')
      : '';
    return `<section class="section">${title}${body}</section>`;
  }
  if (type === 'metric') {
    return `<div class="metric"><span class="label">${escapeHtml(String(element.label ?? 'Value'))}</span><strong>${renderInlineValue(valueAtPath(data, typeof element.valuePath === 'string' ? element.valuePath : undefined))}</strong></div>`;
  }
  if (type === 'status') {
    const tone = valueAtPath(data, typeof element.tonePath === 'string' ? element.tonePath : undefined);
    const toneClass = typeof tone === 'string' ? ` tone-${escapeHtml(tone)}` : '';
    return `<div class="status${toneClass}"><span class="label">${escapeHtml(String(element.label ?? 'Status'))}</span><strong>${renderInlineValue(valueAtPath(data, typeof element.valuePath === 'string' ? element.valuePath : undefined))}</strong></div>`;
  }
  if (type === 'keyValue' && Array.isArray(element.items)) {
    const rows = element.items
      .map((item) => isRecord(item)
        ? `<dt>${escapeHtml(String(item.label ?? 'Field'))}</dt><dd>${renderInlineValue(valueAtPath(data, typeof item.valuePath === 'string' ? item.valuePath : undefined))}</dd>`
        : '')
      .join('');
    return `<dl class="key-value">${rows}</dl>`;
  }
  if (type === 'table' && Array.isArray(element.columns)) {
    const columns = element.columns.filter(isRecord);
    const rows = valueAtPath(data, typeof element.rowsPath === 'string' ? element.rowsPath : undefined);
    if (!Array.isArray(rows) || rows.length === 0) {
      return `<p class="muted">${escapeHtml(String(element.emptyText ?? 'No rows.'))}</p>`;
    }
    const headers = columns
      .map((column) => `<th>${escapeHtml(String(column.label ?? column.key ?? 'Column'))}</th>`)
      .join('');
    const body = rows.map((row) => {
      const cells = columns
        .map((column) => `<td>${renderInlineValue(valueAtPath(row, typeof column.valuePath === 'string' ? column.valuePath : undefined))}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
  }
  return `<p class="muted">Unsupported UI element: ${escapeHtml(String(type ?? 'unknown'))}</p>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sourceEndpoint(source: unknown): string | undefined {
  return isRecord(source) && typeof source.endpoint === 'string' ? source.endpoint : undefined;
}

function renderPageCard(title: string, endpointResult: PreviewEndpointResult | undefined, body: unknown): string {
  const sourceState = renderSourceResult(endpointResult);
  const renderedBody = endpointResult?.status === 'ok' && Array.isArray(body)
    ? body.map((element) => isRecord(element) ? renderElement(element, endpointResult.response) : '').join('')
    : '';
  return `<article class="card"><h3>${escapeHtml(title)}</h3>${sourceState}${renderedBody}</article>`;
}

function buildPreviewHtml(options: {
  module: PreviewLoadedModule;
  scenarioNames: string[];
  scenarioName: string;
  scenario: PreviewScenario;
  selectedRole: string;
  selectedEndpoint: string;
  results: Record<string, PreviewEndpointResult>;
}): string {
  const roleNames = Object.keys(options.scenario.roles ?? { viewer: { grants: ['view'] } }).sort((left, right) => left.localeCompare(right));
  const endpointNames = Object.keys(options.module.manifest.entrypoints).sort((left, right) => left.localeCompare(right));
  const inspector = options.results[options.selectedEndpoint];
  const pageCards = options.module.pages.pages.map((page) => renderPageCard(
    page.title,
    options.results[sourceEndpoint(page.source) ?? ''],
    page.body,
  )).join('');
  const widgetCards = options.module.widgets.widgets.map((widget) => renderPageCard(
    widget.name,
    options.results[sourceEndpoint(widget.source) ?? ''],
    widget.body,
  )).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(options.module.manifest.name)} Preview</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #eef1ed; color: #18251f; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 56px; }
    h1, h2, h3, h4 { margin: 0 0 12px; }
    h1 { font-size: clamp(1.65rem, 4vw, 2.35rem); letter-spacing: -0.035em; }
    h2 { font-size: 1rem; letter-spacing: 0.02em; text-transform: uppercase; }
    .panel { background: #ffffff; border: 1px solid #c9d2cc; border-radius: 7px; padding: 20px; margin-bottom: 14px; }
    .controls { display: grid; grid-template-columns: repeat(3, minmax(150px, 1fr)) auto; gap: 12px; align-items: end; margin-top: 22px; }
    label { display: grid; gap: 6px; color: #4d6056; font-size: 13px; font-weight: 650; }
    select, button { min-height: 42px; border-radius: 5px; border: 1px solid #aebbb3; padding: 9px 11px; background: #fff; color: #18251f; font: inherit; }
    select:focus-visible, button:focus-visible { outline: 3px solid rgba(22, 125, 103, 0.28); outline-offset: 2px; }
    button { border-color: #166b5b; background: #166b5b; color: #ffffff; cursor: pointer; font-weight: 700; }
    button:hover { background: #115848; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card { background: #f9faf8; border: 1px solid #d4dbd6; border-radius: 5px; padding: 17px; }
    .section { border-top: 1px solid #dfe5e1; padding-top: 12px; margin-top: 12px; }
    .metric, .status { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; }
    .label { color: #596b62; font-size: 12px; text-transform: uppercase; letter-spacing: 0.065em; }
    .key-value { display: grid; grid-template-columns: max-content 1fr; gap: 8px 12px; }
    .key-value dt { color: #596b62; }
    .key-value dd { margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; border-bottom: 1px solid #dfe5e1; padding: 8px 6px; vertical-align: top; }
    pre { overflow: auto; margin: 0; border-left: 4px solid #2a9b82; background: #14211c; color: #edf5f0; padding: 16px 18px; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .callout, .muted { color: #596b62; }
    .tone-ok strong { color: #1b7f43; }
    .tone-warning strong { color: #9b6500; }
    .tone-critical strong { color: #a11d24; }
    @media (max-width: 760px) {
      main { padding: 16px 12px 40px; }
      .controls { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>${escapeHtml(options.module.manifest.name)}</h1>
      <p>${escapeHtml(options.module.manifest.id)} · ${escapeHtml(options.module.manifest.version)} · Scenario ${escapeHtml(options.scenarioName)}</p>
      <form method="get" class="controls">
        <label>Scenario
          <select name="scenario">
            ${options.scenarioNames.map((name) => `<option value="${escapeHtml(name)}"${name === options.scenarioName ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
        </label>
        <label>Role
          <select name="role">
            ${roleNames.map((name) => `<option value="${escapeHtml(name)}"${name === options.selectedRole ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
        </label>
        <label>Endpoint
          <select name="endpoint">
            ${endpointNames.map((name) => `<option value="${escapeHtml(name)}"${name === options.selectedEndpoint ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
        </label>
        <button type="submit">Refresh preview</button>
      </form>
    </section>
    <section class="panel">
      <h2>Endpoint Inspector</h2>
      <pre>${jsonHtml(inspector ?? { error: 'No endpoint result available.' })}</pre>
    </section>
    <section class="panel">
      <h2>Pages</h2>
      <div class="grid">${pageCards || '<p class="muted">No pages declared.</p>'}</div>
    </section>
    <section class="panel">
      <h2>Widgets</h2>
      <div class="grid">${widgetCards || '<p class="muted">No widgets declared.</p>'}</div>
    </section>
  </main>
</body>
</html>`;
}

async function renderPreviewResponse(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: TestkitDevRuntime,
  module: PreviewLoadedModule,
  moduleDir: string,
  defaults: DevCliOptions,
): Promise<void> {
  if (!request.url) {
    response.statusCode = 400;
    response.end('Bad request');
    return;
  }
  const url = new URL(request.url, `http://${defaults.host}:${defaults.port || 3000}`);
  if (url.pathname === '/favicon.ico') {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (url.pathname !== '/') {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }

  const scenarioNames = await runtime.listDevScenarios(moduleDir);
  const selectedScenario = url.searchParams.get('scenario') ?? defaults.scenario;
  const scenario = await runtime.loadDevScenario(moduleDir, selectedScenario);
  const roleNames = Object.keys(scenario.document.roles ?? { viewer: { grants: ['view'] } }).sort((left, right) => left.localeCompare(right));
  const endpointNames = Object.keys(module.manifest.entrypoints).sort((left, right) => left.localeCompare(right));
  const selectedRole = url.searchParams.get('role') ?? defaults.role ?? scenario.document.defaultRole ?? roleNames[0] ?? 'viewer';
  const selectedEndpoint = url.searchParams.get('endpoint') ?? defaults.endpoint ?? endpointNames[0] ?? '';
  const previewEndpoints = new Set<string>(endpointNames.filter((name) => {
    const entrypoint = module.manifest.entrypoints[name];
    if (!entrypoint) return false;
    const usedByPage = module.pages.pages.some((page) => sourceEndpoint(page.source) === name);
    const usedByWidget = module.widgets.widgets.some((widget) => sourceEndpoint(widget.source) === name);
    return name === selectedEndpoint || usedByPage || usedByWidget || entrypoint.permission === 'view';
  }));
  const results = Object.fromEntries(
    await Promise.all(
        [...previewEndpoints].sort((left, right) => left.localeCompare(right)).map(async (endpoint) => (
        [endpoint, await runtime.runDevEndpoint(module, scenario, endpoint, selectedRole)] as const
      )),
    ),
  );

  response.statusCode = 200;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(buildPreviewHtml({
    module,
    scenarioNames,
    scenarioName: scenario.fileName,
    scenario: scenario.document,
    selectedRole,
    selectedEndpoint,
    results,
  }));
}

export async function startDevPreviewServer(options: DevCliOptions): Promise<DevPreviewServer> {
  const host = validatePreviewHost(options.host);
  const runtime = await loadTestkitDevRuntime();
  const module = await runtime.loadDevModule(options.moduleDir);
  const server = createServer((request, response) => {
    void renderPreviewResponse(request, response, runtime, module, options.moduleDir, options).catch((error: unknown) => {
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine preview server address.');
  }
  const url = `http://${host}:${address.port}/`;
  return {
    host,
    port: address.port,
    url,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

export async function commandDev(args: string[], io: CommandIo = console): Promise<void> {
  const options = parseDevArgs(args);
  const manifest = JSON.parse(await readFile(join(resolve(options.moduleDir), 'manifest.json'), 'utf8')) as { schemaVersion?: unknown };
  if (manifest.schemaVersion === 2) {
    if (!options.once) {
      throw new Error('Schema-v2 preview currently runs in fixture-only --once mode. Use NAD core to inspect the sandboxed surface.');
    }
    const runtime = await import('@nad/testkit') as {
      runDevPreviewV2?: (input: {
        packageDir: string;
        scenario?: string;
        role?: string;
        operation?: string;
      }) => Promise<unknown>;
    };
    if (typeof runtime.runDevPreviewV2 !== 'function') {
      throw new Error('The schema-v2 Devkit preview runtime is unavailable. Re-run setup.');
    }
    io.log(JSON.stringify(await runtime.runDevPreviewV2({
      packageDir: options.moduleDir,
      scenario: options.scenario,
      role: options.role,
      operation: options.endpoint,
    }), null, 2));
    return;
  }
  if (options.once) {
    const runtime = await loadTestkitDevRuntime();
    const result = await runtime.runDevSession({
      moduleDir: options.moduleDir,
      scenario: options.scenario,
      role: options.role,
      endpoint: options.endpoint,
    });
    io.log(JSON.stringify(result, null, 2));
    return;
  }

  const server = await startDevPreviewServer(options);
  io.log(`Preview available at ${server.url}`);
}
