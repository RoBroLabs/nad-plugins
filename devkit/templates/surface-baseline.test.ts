import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const template = (relativePath: string) => readFile(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

const surfaces = [
  './app-v2/ui/surfaces/summary.html',
  './addon-v2/ui/surfaces/app-summary.html',
] as const;

describe('schema-v2 starter surfaces', () => {
  it.each(surfaces)('keeps %s accessible, bounded and bridge-only', async (surface) => {
    const html = await template(surface);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('button:focus-visible');
    expect(html).toContain('@media (max-width: 340px)');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html).toContain("Math.min(1200, Math.max(160");
    expect(html).toContain("new ResizeObserver(queueResize)");
    expect(html).toContain("document.documentElement.dataset.theme");
    expect(html).toContain("data.type === 'surface.context'");
    expect(html).toContain("data.type === 'binding.result'");
    expect(html).toContain("data.type === 'binding.error'");
    expect(html).toContain("data.type === 'access.revoked'");
    expect(html).toContain("data.payload?.code");
    expect(html).toContain("Connection: not selected");
    expect(html).toContain("NAD panel above");
    expect(html).not.toMatch(/<(?:select|input|form)\b/i);
    expect(html).not.toMatch(/\bfetch\s*\(/);
    expect(html).not.toMatch(/(?:document\.cookie|localStorage|sessionStorage)/);
  });

  it.each(surfaces)('uses safe copy for empty, degraded, failed and revoked states in %s', async (surface) => {
    const html = await template(surface);

    expect(html).toContain("'empty'");
    expect(html).toContain("'degraded'");
    expect(html).toContain("'error'");
    expect(html).toContain("'unavailable'");
    expect(html).toContain('No ');
    expect(html).toContain('NAD timed out');
    expect(html).toContain('NAD could not load');
    expect(html).toContain('no longer available to this account');
    expect(html).not.toContain('data.payload?.message');
  });
});
