/**
 * Files inside zip archives in the library (milestone 32), in the main process.
 *
 * - **Browsing** — a preview on the stage, a thumbnail, a probe for length and
 *   size — reads a member through Pulp's own scratch cache: it is inflated
 *   there, used, and kept a while for the next look. Nothing is written into
 *   the library for it, and the archive is untouched.
 * - **Using** — placing it in a graphic, rendering it, exporting it — unpacks
 *   it into the library's folder, beside the archive in a folder named after
 *   it, once. From then on it is an ordinary file there, which a render, a
 *   project and an editor can all refer to by its path. When the library
 *   cannot be written to — a disc, a read-only drive, a locked folder — it is
 *   unpacked into Pulp's own data instead (`archive-unpacked`), and the
 *   library lists it from there; nothing is pruned from that folder, since a
 *   project may refer to it.
 */

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import type { MediaEntry } from '../core/library-types';
import { extractZipMember, extractZipMemberOrElsewhere, fallbackUnpackPath } from '../core/zip-archive';

/** Scratch copies kept for browsing; the oldest go first. */
const SCRATCH_KEEP_BYTES = 512 * 1024 * 1024;

export function archiveScratchDir(): string {
  return join(app.getPath('userData'), 'archive-cache');
}

/** Where members are unpacked when their library cannot be written to; kept, never pruned. */
export function archiveUnpackedDir(): string {
  return join(app.getPath('userData'), 'archive-unpacked');
}

/** The path a member takes in Pulp's own data when its library is read-only; what the library's scan looks for too. */
export function unpackTargetElsewhere(zipPath: string, member: string): string {
  return fallbackUnpackPath(archiveUnpackedDir(), zipPath, member);
}

/** Whether a file is one unpacked into Pulp's own data, which the media handler serves from there. */
export function isUnpackedElsewhere(file: string): boolean {
  return file.startsWith(archiveUnpackedDir() + sep);
}

/** The same member asked for twice at once is inflated once. */
const inflating = new Map<string, Promise<string>>();

/**
 * The file to read for browsing an entry: its own path, or, for an archive member not unpacked
 * yet, a copy in Pulp's scratch cache. Never writes into the library.
 */
export async function browsableFile(entry: MediaEntry): Promise<string> {
  if (!entry.archive || existsSync(entry.path)) return entry.path;
  const { zip, member } = entry.archive;
  const name = `${createHash('sha1').update(`${zip}|${entry.mtimeMs}|${member}`).digest('hex')}${extname(member).toLowerCase()}`;
  const file = join(archiveScratchDir(), name);
  if (existsSync(file)) {
    // Touched, so the cache keeps what is being looked at.
    const now = new Date();
    await utimes(file, now, now).catch(() => undefined);
    return file;
  }
  const running = inflating.get(file);
  if (running) return running;
  const work = (async () => {
    await mkdir(archiveScratchDir(), { recursive: true });
    await extractZipMember(zip, member, file);
    void prune();
    return file;
  })();
  inflating.set(file, work);
  return work.finally(() => inflating.delete(file));
}

/** An entry as something reading it for browsing should see it: its path a file that exists. */
export async function browsable<T extends MediaEntry>(entry: T): Promise<T> {
  if (!entry.archive) return entry;
  return { ...entry, path: await browsableFile(entry) };
}

/** Called after a member is unpacked, so the library reads it again and says so. */
let onUnpacked: () => void = () => undefined;
export function whenUnpacked(fn: () => void): void {
  onUnpacked = fn;
}

/**
 * Unpack an archive member into the library's folder because it is being used. Idempotent: a
 * member already there (of the right size) is left as it is. Answers where the file is and whether
 * that is in Pulp's own data rather than beside the archive; null only when it could not be
 * unpacked, which the caller then reports as for any unreadable file.
 */
export async function unpackForUse(entry: MediaEntry): Promise<{ path: string; elsewhere: boolean } | null> {
  if (!entry.archive) return { path: entry.path, elsewhere: false };
  if (entry.archive.unpacked && existsSync(entry.path)) return { path: entry.path, elsewhere: entry.archive.elsewhere === true };
  const { zip, member } = entry.archive;
  let made: { path: string; elsewhere: boolean };
  try {
    // Beside the archive, or — the library being read-only — into Pulp's own data, which the
    // library's next scan lists the item from.
    made = await extractZipMemberOrElsewhere(zip, member, entry.path, unpackTargetElsewhere(zip, member));
    if (made.elsewhere) console.info(`archive: ${zip} cannot be written beside; ${member} unpacked into Pulp's data`);
  } catch (err) {
    console.warn(`archive: could not unpack ${member} from ${zip}: ${(err as Error).message}`);
    return null;
  }
  onUnpacked();
  return made;
}

/** Keep the scratch cache under its size, newest first. */
async function prune(): Promise<void> {
  const dir = archiveScratchDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  const files = await Promise.all(names.filter((n) => !n.endsWith('.pulp-part')).map(async (n) => {
    const info = await stat(join(dir, n));
    return { n, size: info.size, t: info.mtimeMs };
  }));
  files.sort((a, b) => b.t - a.t);
  let kept = 0;
  for (const f of files) {
    kept += f.size;
    if (kept > SCRATCH_KEEP_BYTES) await rm(join(dir, f.n), { force: true });
  }
}
