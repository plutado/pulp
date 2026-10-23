/**
 * A small ZIP reader and writer for template packs: stored and deflated
 * entries, the central directory, CRC-32. Pure (node:zlib only). Reading is
 * defensive, since a pack can come from anywhere: entry names must be
 * relative, forward-slash paths without "..", and the unpacked size and entry
 * count are bounded. No ZIP64, no encryption, no symlinks; a pack needs none.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ZipLimits {
  /** Total uncompressed bytes. Default 512 MiB. */
  maxBytes?: number;
  /** Default 5000. */
  maxEntries?: number;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipError extends Error {
  override name = 'ZipError';
}

/** A safe relative path inside an archive, or null. Directory entries ("a/") return null too. */
export function safeZipPath(name: string): string | null {
  if (name.length === 0 || name.endsWith('/')) return null;
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  for (let i = 0; i < normalized.length; i++) if (normalized.charCodeAt(i) < 32) return null;
  return parts.join('/');
}

/** Read every file entry. Throws ZipError for a damaged archive, an unsafe name, or exceeded limits. */
export function readZip(buf: Buffer, limits: ZipLimits = {}): ZipEntry[] {
  const maxBytes = limits.maxBytes ?? 512 * 1024 * 1024;
  const maxEntries = limits.maxEntries ?? 5000;
  // End of central directory: scan back for its signature (the comment may follow it).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not a zip file (no central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > maxEntries) throw new ZipError(`too many entries (${count})`);
  if (cdOffset + cdSize > buf.length) throw new ZipError('damaged central directory');

  const entries: ZipEntry[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('damaged central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const rawName = buf.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;

    if (rawName.endsWith('/')) continue; // directory entry
    const name = safeZipPath(rawName);
    if (!name) throw new ZipError(`unsafe entry name "${rawName}"`);
    total += size;
    if (total > maxBytes) throw new ZipError(`unpacked size exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB`);

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError(`damaged entry "${name}"`);
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start + compressedSize > buf.length) throw new ZipError(`damaged entry "${name}"`);
    const compressed = buf.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed, { maxOutputLength: size + 1 });
    else throw new ZipError(`unsupported compression method ${method} for "${name}"`);
    if (data.length !== size || crc32(data) !== crc) throw new ZipError(`entry "${name}" is corrupt`);
    entries.push({ name, data });
  }
  return entries;
}

/** Write entries (deflated) with a central directory. Names must already be safe relative paths. */
export function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = safeZipPath(entry.name);
    if (!name) throw new ZipError(`unsafe entry name "${entry.name}"`);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(entry.data);
    const deflated = deflateRawSync(entry.data, { level: 6 });
    const method = deflated.length < entry.data.length ? 8 : 0;
    const body = method === 8 ? deflated : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, body);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
