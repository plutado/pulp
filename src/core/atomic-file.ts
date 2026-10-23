/**
 * Atomic file replacement: write to a temporary file in the same folder,
 * flush it, then rename it over the target. A reader, or a crash at any
 * point, sees either the old file or the new one, never a mix or an empty
 * file. On Windows the rename can fail while another process has the target
 * open (EPERM, EBUSY, EACCES), so it is retried briefly. Uses node:fs only.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface AtomicWriteOptions {
  /** Rename attempts when the target is busy. Default 20 (about 2 s). */
  retries?: number;
  retryDelayMs?: number;
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

export async function writeFileAtomic(path: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  const retries = options.retries ?? 20;
  const delay = options.retryDelayMs ?? 100;
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  // Same folder as the target, so the rename is a same-volume move and therefore atomic.
  const tmp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(data, typeof data === 'string' ? 'utf8' : undefined);
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, path);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? '';
        if (!BUSY.has(code) || attempt >= retries) throw err;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
