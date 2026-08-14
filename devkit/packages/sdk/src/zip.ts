import { createHash } from 'node:crypto';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const crcTable = new Uint32Array(256);
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 200;
const MAX_TOTAL_PAYLOAD_BYTES = 40 * 1024 * 1024;

for (let i = 0; i < 256; i += 1) {
  let crc = i;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  crcTable[i] = crc >>> 0;
}

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(typeof data === 'string' ? encoder.encode(data) : data).digest('hex');
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function dosDate(): { date: number; time: number } {
  return { date: (0 << 9) | (1 << 5) | 1, time: 0 };
}

export function createDeterministicZip(entries: ZipEntry[]): Uint8Array {
  const seen = new Set<string>();
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const { date, time } = dosDate();

  for (const entry of sorted) {
    validateZipPath(entry.path);
    if (seen.has(entry.path)) throw new Error(`Duplicate ZIP path: ${entry.path}`);
    const foldedPath = entry.path.toLocaleLowerCase('en-US');
    if ([...seen].some((path) => path.toLocaleLowerCase('en-US') === foldedPath)) {
      throw new Error(`Case-colliding ZIP path: ${entry.path}`);
    }
    seen.add(entry.path);
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(entry.data.byteLength),
      u32(entry.data.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      entry.data,
    ]);
    locals.push(local);
    centrals.push(concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(entry.data.byteLength),
      u32(entry.data.byteLength),
      u16(name.byteLength),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));
    offset += local.byteLength;
  }

  const centralDirectory = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(sorted.length),
    u16(sorted.length),
    u32(centralDirectory.byteLength),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, centralDirectory, end]);
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('ZIP archive size is outside the supported bounds.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= 0 && offset >= bytes.byteLength - 65_558; offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset === -1) throw new Error('ZIP end of central directory not found.');

  const entryCount = readU16(view, endOffset + 10);
  if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('ZIP archive contains too many entries.');
  const centralSize = readU32(view, endOffset + 12);
  const centralOffset = readU32(view, endOffset + 16);
  if (centralOffset + centralSize > endOffset) throw new Error('ZIP central directory is outside the archive bounds.');
  let cursor = centralOffset;
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  const foldedPaths = new Set<string>();
  const payloadRanges: Array<{ start: number; end: number }> = [];
  let totalPayloadBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor < 0 || cursor + 46 > endOffset) throw new Error('Truncated ZIP central directory entry.');
    if (readU32(view, cursor) !== 0x02014b50) throw new Error('Invalid central directory entry.');
    const versionMadeBy = readU16(view, cursor + 4);
    const flags = readU16(view, cursor + 8);
    if ((flags & ~0x0800) !== 0) throw new Error('Encrypted or streaming ZIP entries are not supported.');
    const compression = readU16(view, cursor + 10);
    if (compression !== 0) throw new Error('Compressed ZIP entries are not supported in MVP packages.');
    const crc = readU32(view, cursor + 16);
    const compressedSize = readU32(view, cursor + 20);
    const uncompressedSize = readU32(view, cursor + 24);
    if (compressedSize !== uncompressedSize) throw new Error('ZIP entry size mismatch.');
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > endOffset) {
      throw new Error('ZIP central directory entry exceeds its declared bounds.');
    }
    const path = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    validateZipPath(path);
    if (seen.has(path)) throw new Error(`Duplicate ZIP path: ${path}`);
    seen.add(path);
    const foldedPath = path.toLocaleLowerCase('en-US');
    if (foldedPaths.has(foldedPath)) throw new Error(`Case-colliding ZIP path: ${path}`);
    foldedPaths.add(foldedPath);

    const platform = versionMadeBy >>> 8;
    const unixMode = readU32(view, cursor + 38) >>> 16;
    const fileType = unixMode & 0o170000;
    if (platform === 3 && fileType !== 0 && fileType !== 0o100000) {
      throw new Error(`Special or linked ZIP entry rejected: ${path}`);
    }

    if (localOffset + 30 > centralOffset) throw new Error(`Invalid local header offset for ${path}.`);
    if (readU32(view, localOffset) !== 0x04034b50) throw new Error(`Invalid local header for ${path}.`);
    const localFlags = readU16(view, localOffset + 6);
    const localCompression = readU16(view, localOffset + 8);
    const localCrc = readU32(view, localOffset + 14);
    const localCompressedSize = readU32(view, localOffset + 18);
    const localUncompressedSize = readU32(view, localOffset + 22);
    if (
      localFlags !== flags
      || localCompression !== compression
      || localCrc !== crc
      || localCompressedSize !== compressedSize
      || localUncompressedSize !== uncompressedSize
    ) {
      throw new Error(`Local and central ZIP metadata disagree for ${path}.`);
    }
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const localPath = decoder.decode(bytes.slice(localOffset + 30, localOffset + 30 + localNameLength));
    if (localPath !== path) throw new Error(`Local and central ZIP paths disagree for ${path}.`);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + uncompressedSize;
    if (dataStart < localOffset + 30 || dataEnd > centralOffset) throw new Error(`ZIP payload is outside bounds for ${path}.`);
    if (payloadRanges.some((range) => dataStart < range.end && dataEnd > range.start)) {
      throw new Error(`Overlapping ZIP payload rejected for ${path}.`);
    }
    payloadRanges.push({ start: localOffset, end: dataEnd });
    totalPayloadBytes += uncompressedSize;
    if (totalPayloadBytes > MAX_TOTAL_PAYLOAD_BYTES) throw new Error('ZIP payload total exceeds its limit.');
    const data = bytes.slice(dataStart, dataStart + uncompressedSize);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${path}.`);
    entries.push({ path, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function validateZipPath(path: string): void {
  if (!path || path.length > 240) throw new Error('ZIP path is empty or too long.');
  if (path.startsWith('/') || path.startsWith('\\')) throw new Error(`Absolute ZIP path rejected: ${path}`);
  if (path.includes('\\')) throw new Error(`Backslash ZIP path rejected: ${path}`);
  if (!/^[A-Za-z0-9._/-]+$/.test(path)) throw new Error(`Unsupported ZIP path characters rejected: ${path}`);
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Traversal or ambiguous ZIP path rejected: ${path}`);
  }
  if (path.endsWith('/')) throw new Error(`Directory ZIP entry rejected: ${path}`);
}
