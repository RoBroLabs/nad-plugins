import { describe, expect, it } from 'vitest';
import { createDeterministicZip, readZipEntries, sha256Hex } from './zip.js';

describe('deterministic ZIP writer', () => {
  it('writes stable store ZIP archives independent of input order', () => {
    const first = createDeterministicZip([
      { path: 'b.txt', data: new TextEncoder().encode('b') },
      { path: 'a.txt', data: new TextEncoder().encode('a') },
    ]);
    const second = createDeterministicZip([
      { path: 'a.txt', data: new TextEncoder().encode('a') },
      { path: 'b.txt', data: new TextEncoder().encode('b') },
    ]);

    expect(sha256Hex(first)).toBe(sha256Hex(second));
    expect(readZipEntries(first).map(({ path }) => path)).toEqual(['a.txt', 'b.txt']);
  });

  it('rejects duplicate entries', () => {
    expect(() => createDeterministicZip([
      { path: 'a.txt', data: new Uint8Array() },
      { path: 'a.txt', data: new Uint8Array() },
    ])).toThrow(/Duplicate/);
  });

  it('rejects traversal, ambiguous, and case-colliding paths before packing', () => {
    expect(() => createDeterministicZip([
      { path: '../escape.txt', data: new Uint8Array() },
    ])).toThrow(/Traversal|ambiguous/);
    expect(() => createDeterministicZip([
      { path: 'README.md', data: new Uint8Array() },
      { path: 'readme.md', data: new Uint8Array() },
    ])).toThrow(/Case-colliding/);
    expect(() => createDeterministicZip([
      { path: 'ui//pages.json', data: new Uint8Array() },
    ])).toThrow(/Traversal|ambiguous/);
  });

  it('rejects hostile paths and oversized bytes while reading untrusted archives', () => {
    const archive = createDeterministicZip([
      { path: 'safe.txt', data: new TextEncoder().encode('safe') },
    ]);
    const hostile = archive.slice();
    const original = new TextEncoder().encode('safe.txt');
    const replacement = new TextEncoder().encode('../x.txt');
    let replacements = 0;
    for (let offset = 0; offset <= hostile.byteLength - original.byteLength; offset += 1) {
      if (original.every((byte, index) => hostile[offset + index] === byte)) {
        hostile.set(replacement, offset);
        replacements += 1;
      }
    }
    expect(replacements).toBe(2);
    expect(() => readZipEntries(hostile)).toThrow(/Traversal|ambiguous/);

    expect(() => readZipEntries(new Uint8Array((50 * 1024 * 1024) + 1)))
      .toThrow(/archive size/);
  });
});
