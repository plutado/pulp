/**
 * Zipped downloads in a stock library (milestone 32): what is inside an
 * archive, read without unpacking it, and one member unpacked when it is used.
 *
 * Listing reads only the end of the file — the central directory — so a
 * gigabyte download is browsed at once and nothing in it is inflated or
 * copied. Unpacking reads one member's bytes, checks them against the
 * archive's CRC, and writes the file beside the archive, in a folder named
 * after it: `Pack.zip` → `Pack/Backgrounds/Blue.png`. That is the library's
 * folder, so the file is then an ordinary part of the library, and the
 * archive is left as it was. A partial write never takes the final name.
 *
 * Stored and deflated members, as zip downloads use; no ZIP64 (members and
 * archives under 4 GB), no encryption. Names are held to safe relative paths,
 * the same rule as template packs (`safeZipPath`).
 */

import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { inflateRaw } from 'node:zlib';
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
}

export class ZipArchiveError extends Error {}

/** The most members one archive may list: a library of thousands of clips, not a zip bomb's millions. */
const MAX_MEMBERS = 20_000;

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
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipArchiveError('a ZIP64 archive (over 4 GB or 65,535 files), which is not read yet'); // i18n-exempt(diagnostic)
    if (count > MAX_MEMBERS) throw new ZipArchiveError(`too many files (${count})`); // i18n-exempt(diagnostic)
    if (cdOffset + cdSize > size) throw new ZipArchiveError('damaged central directory'); // i18n-exempt(diagnostic)
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const members: ZipMember[] = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new ZipArchiveError('damaged central directory entry'); // i18n-exempt(diagnostic)
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const compressedSize = cd.readUInt32LE(p + 20);
      const unpacked = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      const offset = cd.readUInt32LE(p + 42);
      const raw = cd.toString('utf8', p + 46, p + 46 + nameLength);
      p += 46 + nameLength + extraLength + commentLength;
      if (raw.endsWith('/')) continue;
      const name = safeZipPath(raw);
      // macOS's resource forks travel in zips as __MACOSX/…; they are not media.
      if (!name || name.startsWith('__MACOSX/') || name.split('/').some((part) => part.startsWith('._'))) continue;
      members.push({ name, size: unpacked, compressedSize, method, crc, offset });
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

/** One member's bytes, read and checked. */
export async function readZipMember(zipPath: string, member: ZipMember): Promise<Buffer> {
  const handle = await open(zipPath, 'r');
  try {
    const head = Buffer.alloc(30);
    await handle.read(head, 0, 30, member.offset);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new ZipArchiveError(`damaged entry "${member.name}"`); // i18n-exempt(diagnostic)
    const start = member.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
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
 * Unpack one member to `dest`, unless a file of its size is already there. Written under a
 * temporary name and renamed, so an interrupted unpack never looks finished. Returns the path.
 */
export async function extractZipMember(zipPath: string, memberName: string, dest: string): Promise<string> {
  try {
    const existing = await stat(dest);
    const member = (await listZipFile(zipPath)).find((m) => m.name === memberName);
    if (member && existing.size === member.size) return dest;
  } catch {
    // Not there yet.
  }
  const member = (await listZipFile(zipPath)).find((m) => m.name === memberName);
  if (!member) throw new ZipArchiveError(`"${memberName}" is no longer in ${zipPath}`); // i18n-exempt(diagnostic)
  const data = await readZipMember(zipPath, member);
  await mkdir(dirname(dest), { recursive: true });
  const partial = `${dest}.pulp-part`;
  try {
    const out = await open(partial, 'w');
    try {
      await out.writeFile(data);
    } finally {
      await out.close();
    }
    await rename(partial, dest);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
  return dest;
}
