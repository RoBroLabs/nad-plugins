import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Proxmox overview sandbox surface', () => {
  it('renders upstream guest fields through textContent rather than HTML interpolation', async () => {
    const source = await readFile(join(import.meta.dirname, 'overview.html'), 'utf8');
    expect(source).toContain('cell.textContent=String(value');
    expect(source).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(source).not.toMatch(/`<tr>|<td>\$\{/);
  });
});
