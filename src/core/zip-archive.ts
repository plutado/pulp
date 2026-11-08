/**
 * Zipped downloads in a stock library (milestone 32): what is inside an
 * archive, read without unpacking it, and one member unpacked when it is used.
 *
 * Listing reads only the end of the file — the central directory — so a
 * gigabyte download is browsed at once and nothing in it is inflated or
 * copied. Unpacking streams one member's bytes through the inflater and a
 * CRC check to a file beside the archive, in a folder named after it:
 * `Pack.zip` → `Pack/Backgrounds/Blue.png`. That is the library's folder, so
 * the file is then an ordinary part of the library, and the archive is left
 * as it was. A partial write never takes the final name. Where the library
 * cannot be written to — a disc, a locked drive — the member is unpacked into
 * a folder of Pulp's own instead (`extractZipMemberOrElsewhere`).
 *
 * Stored and deflated members, as zip downloads use. **ZIP64** archives and
 * members — over 4 GB, or over 65,535 files — are read through the ZIP64 end
 * record and each entry's ZIP64 extra field, and members are streamed, never
 * held whole. A **password-protected** member (the encryption bit, or WinZip's
 * AES method) is listed with its name and size, marked `encrypted`, and
 * refused when read: Pulp has no password to give it. Names are held to safe
 * relative paths, the same rule as template packs (`safeZipPath`).
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, crc32 as crc32Step, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { crc32, safeZipPath } from './zip';

const inflate = promisify(inflateRaw);

/** One file inside an archive, as its central directory describes it. */
export interface ZipMember {
  /** A safe relative path inside the archive: "Backgrounds/Blue Wash.png". */
  name: string;
  /** Unpacked bytes. */
  size: number;
  compressedSize: number;
  method: number;
  crc: number;
  /** Where its local header starts. */
  offset: number;
  /** Password-protected: listed, never read. */
  encrypted: boolean;
}

export class ZipArchiveError extends Error {}

/** The most members one archive may list: a library of thousands of clips, not a zip bomb's millions. */
const MAX_MEMBERS = 20_000;

/** The largest member `readZipMember` holds whole; anything larger is streamed to a file by `extractZipMember`. */
export const MAX_BUFFERED_MEMBER_BYTES = 256 * 1024 * 1024;

/** A 64-bit field as a number, which it fits while it is a size or an offset a file can have. */
function wide(buffer: Buffer, at: number): number {
  const value = buffer.readBigUInt64LE(at);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipArchiveError('an archive too large to address'); // i18n-exempt(diagnostic)
  return Number(value);
}

/**
 * The sizes and the offset a central directory entry says "see the extra field" for, from its
 * ZIP64 extra field (id 0x0001): each eight bytes, in the order uncompressed size, compressed
 * size, local header offset, present only for the fields the entry set to 0xffffffff.
 */
function zip64Fields(extra: Buffer, want: { size: boolean; compressedSize: boolean; offset: boolean }): Partial<{ size: number; compressedSize: number; offset: number }> {
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const length = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      const out: Partial<{ size: number; compressedSize: number; offset: number }> = {};
      let q = p + 4;
      const end = Math.min(extra.length, p + 4 + length);
      for (const field of ['size', 'compressedSize', 'offset'] as const) {
        if (!want[field]) continue;
        if (q + 8 > end) throw new ZipArchiveError('damaged ZIP64 entry'); // i18n-exempt(diagnostic)
        out[field] = wide(extra, q);
        q += 8;
      }
      return out;
    }
    p += 4 + length;
  }
  throw new ZipArchiveError('damaged ZIP64 entry (no extra field)'); // i18n-exempt(diagnostic)
}

/**
 * Every file an archive holds, from its central directory alone. Unsafe names and folders are
 * left out rather than failing the whole archive: one odd entry should not hide the rest.
 */
export async function listZipFile(path: string): Promise<ZipMember[]> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new ZipArchiveError('not a zip file (too short)'); // i18n-exempt(diagnostic)
    // The end record is within the last 22 bytes plus a comment of up to 64 KiB.
    const tailLength = Math.min(size, 22 + 65_535);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipArchiveError('not a zip file (no central directory)'); // i18n-exempt(diagnostic)
    let count: number = tail.readUInt16LE(eocd + 10);
    let cdSize: number = tail.readUInt32LE(eocd + 12);
    let cdOffset: number = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      // ZIP64: the locator sits just before the end record and names the ZIP64 end record, which
      // carries the count, the directory's size and its offset as eight-byte numbers.
      if (eocd < 20 || tail.readUInt32LE(eocd - 20) !== 0x07064b50) throw new ZipArchiveError('a ZIP64 archive with no locator'); // i18n-exempt(diagnostic)
      const recordAt = wide(tail, eocd - 20 + 8);
      if (recordAt + 56 > size) throw new ZipArchiveError('damaged ZIP64 end record'); // i18n-exempt(diagnostic)
      const record = Buffer.alloc(56);
      await handle.read(record, 0, 56, recordAt);
      if (record.readUInt32LE(0) !== 0x06064b50) throw new ZipArchiveError('damaged ZIP64 end record'); // i18n-exempt(diagnostic)
      count = wide(record, 32);
      cdSize = wide(record, 40);
      cdOffset = wide(record, 48);
    }
    if (count > MAX_MEMBERS) throw new ZipArchiveError(`too many files (${count})`); // i18n-exempt(diagnostic)
    if (cdOffset + cdSize > size) throw new ZipArchiveError('damaged central directory'); // i18n-exempt(diagnostic)
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const members: ZipMember[] = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new ZipArchiveError('damaged central directory entry'); // i18n-exempt(diagnostic)
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      let compressedSize: number = cd.readUInt32LE(p + 20);
      let unpacked: number = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      let offset: number = cd.readUInt32LE(p + 42);
      const raw = cd.toString('utf8', p + 46, p + 46 + nameLength);
      const extra = cd.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
      p += 46 + nameLength + extraLength + commentLength;
      // A member over 4 GB, or one past that mark in the archive: its true numbers are in the extra field.
      const want = { size: unpacked === 0xffffffff, compressedSize: compressedSize === 0xffffffff, offset: offset === 0xffffffff };
      if (want.size || want.compressedSize || want.offset) {
        const big = zip64Fields(extra, want);
        unpacked = big.size ?? unpacked;
        compressedSize = big.compressedSize ?? compressedSize;
        offset = big.offset ?? offset;
      }
      if (raw.endsWith('/')) continue;
      const name = safeZipPath(raw);
      // macOS's resource forks travel in zips as __MACOSX/…; they are not media.
      if (!name || name.startsWith('__MACOSX/') || name.split('/').some((part) => part.startsWith('._'))) continue;
      // The encryption bit, or WinZip's AES method: a password Pulp does not have.
      const encrypted = (flags & 0x0001) !== 0 || method === 99;
      members.push({ name, size: unpacked, compressedSize, method, crc, offset, encrypted });
    }
    return members;
  } finally {
    await handle.close();
  }
}

/** Where a member is unpacked to: beside the archive, in a folder named after it. */
export function unpackedPath(zipPath: string, member: string): string {
  const dir = dirname(zipPath);
  const stem = zipPath.slice(dir.length + 1).replace(/\.zip$/i, '');
  return join(dir, stem, ...member.split('/'));
}

/** The folder an archive unpacks into. */
export function unpackFolder(zipPath: string): string {
  const dir = dirname(zipPath);
  return join(dir, zipPath.slice(dir.length + 1).replace(/\.zip$/i, ''));
}

/** A member that cannot be read, said plainly: Pulp has no password to give a protected one. */
function refuseEncrypted(member: ZipMember): void {
  if (member.encrypted) throw new ZipArchiveError(`"${member.name}" is password-protected`); // i18n-exempt(diagnostic)
}

/** Where a member's compressed bytes begin: past its local header, whose name and extra lengths are its own. */
async function memberDataStart(handle: Awaited<ReturnType<typeof open>>, member: ZipMember): Promise<number> {
  const head = Buffer.alloc(30);
  await handle.read(head, 0, 30, member.offset);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new ZipArchiveError(`damaged entry "${member.name}"`); // i18n-exempt(diagnostic)
  return member.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
}

/** One member's bytes, read and checked. For a small member — a thumbnail inside a file; a large one is streamed to a file instead. */
export async function readZipMember(zipPath: string, member: ZipMember): Promise<Buffer> {
  refuseEncrypted(member);
  if (member.compressedSize > MAX_BUFFERED_MEMBER_BYTES || member.size > MAX_BUFFERED_MEMBER_BYTES) throw new ZipArchiveError(`"${member.name}" is too large to hold in memory`); // i18n-exempt(diagnostic)
  const handle = await open(zipPath, 'r');
  try {
    const start = await memberDataStart(handle, member);
    const compressed = Buffer.alloc(member.compressedSize);
    await handle.read(compressed, 0, member.compressedSize, start);
    let data: Buffer;
    if (member.method === 0) data = compressed;
    else if (member.method === 8) data = await inflate(compressed, { maxOutputLength: member.size + 1 }) as Buffer;
    else throw new ZipArchiveError(`unsupported compression method ${member.method} for "${member.name}"`); // i18n-exempt(diagnostic)
    if (data.length !== member.size || crc32(data) !== member.crc) throw new ZipArchiveError(`"${member.name}" is corrupt in its archive`); // i18n-exempt(diagnostic)
    return data;
  } finally {
    await handle.close();
  }
}

/**
 * Unpack one member to `dest`, unless a file of its size is already there. Streamed — read,
 * inflated, checked against the archive's CRC and written as it goes, so a member of any size
 * passes through a small buffer — under a temporary name and renamed, so an interrupted unpack
 * never looks finished. Returns the path.
 */
export async function extractZipMember(zipPath: string, memberName: string, dest: string): Promise<string> {
  const member = (await listZipFile(zipPath)).find((m) => m.name === memberName);
  if (!member) throw new ZipArchiveError(`"${memberName}" is no longer in ${zipPath}`); // i18n-exempt(diagnostic)
  try {
    if ((await stat(dest)).size === member.size) return dest;
  } catch {
    // Not there yet.
  }
  refuseEncrypted(member);
  if (member.method !== 0 && member.method !== 8) throw new ZipArchiveError(`unsupported compression method ${member.method} for "${member.name}"`); // i18n-exempt(diagnostic)
  await mkdir(dirname(dest), { recursive: true });
  const partial = `${dest}.pulp-part`;
  const handle = await open(zipPath, 'r');
  try {
    const start = await memberDataStart(handle, member);
    let crc = 0;
    let written = 0;
    const check = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        crc = crc32Step(chunk, crc);
        written += chunk.length;
        callback(null, chunk);
      },
    });
    const input = createReadStream(zipPath, { start, end: start + member.compressedSize - 1 });
    const out = createWriteStream(partial);
    if (member.method === 8) await pipeline(input, createInflateRaw(), check, out);
    else await pipeline(input, check, out);
    if (written !== member.size || (crc >>> 0) !== member.crc) throw new ZipArchiveError(`"${member.name}" is corrupt in its archive`); // i18n-exempt(diagnostic)
    await rename(partial, dest);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  } finally {
    await handle.close();
  }
  return dest;
}

/** The errors a folder gives when it cannot be written to: a read-only drive, a disc, a locked folder. */
const READ_ONLY_CODES = new Set(['EROFS', 'EACCES', 'EPERM']);

/**
 * Unpack a member beside its archive, or — when the library cannot be written to — to `elsewhere`,
 * a path in Pulp's own data. Says which it did, so the library can list the file where it is.
 * Any other failure is thrown as it came.
 */
export async function extractZipMemberOrElsewhere(zipPath: string, memberName: string, dest: string, elsewhere: string): Promise<{ path: string; elsewhere: boolean }> {
  try {
    return { path: await extractZipMember(zipPath, memberName, dest), elsewhere: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!code || !READ_ONLY_CODES.has(code)) throw err;
    return { path: await extractZipMember(zipPath, memberName, elsewhere), elsewhere: true };
  }
}

/**
 * Where a member is unpacked when its library cannot be written to: under `baseDir` (a folder of
 * Pulp's own), in a folder named by the archive's path, with the member's own folders and name —
 * so two archives with a "Backgrounds/Blue.png" each keep their own, and the file keeps its name.
 */
export function fallbackUnpackPath(baseDir: string, zipPath: string, member: string): string {
  return join(baseDir, createHash('sha1').update(zipPath).digest('hex').slice(0, 16), ...member.split('/'));
}
