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
 *   project and an editor can all refer to by its path.
 */

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { MediaEntry } from '../core/library-types';
import { extractZipMember } from '../core/zip-archive';

/** Scratch copies kept for browsing; the oldest go first. */
const SCRATCH_KEEP_BYTES = 512 * 1024 * 1024;

export function archiveScratchDir(): string {
  return join(app.getPath('userData'), 'archive-cache');
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
 * member already there (of the right size) is left as it is. Returns false only when it could
 * not be unpacked, which the caller then reports as for any unreadable file.
 */
export async function unpackForUse(entry: MediaEntry | undefined): Promise<boolean> {
  if (!entry?.archive) return true;
  if (entry.archive.unpacked && existsSync(entry.path)) return true;
  try {
    await extractZipMember(entry.archive.zip, entry.archive.member, entry.path);
  } catch (err) {
    console.warn(`archive: could not unpack ${entry.archive.member} from ${entry.archive.zip}: ${(err as Error).message}`);
    return false;
  }
  onUnpacked();
  return true;
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
