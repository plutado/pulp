/**
 * Render cache and drag-out. "Prepare for drag" renders through the normal
 * queue into the cache folder (or finds an earlier render with the same key);
 * the UI then starts a native drag of that file with webContents.startDrag.
 * Only files in the cache folder and outputs of finished queue jobs may be
 * dragged. The folder has a size limit; the oldest files go first.
 */

import { app, dialog, nativeImage, type WebContents } from 'electron';
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { basename, extname, join, resolve, sep } from 'node:path';
import { formatMB, planEviction, type CachedFile } from '../core/render-cache';
import { expandSequence } from '../core/render-guard';
import { loadSettings, updateSettings } from './settings';
import { lookupThumbnail } from './library-service';

export async function cacheDir(): Promise<string> {
  const settings = await loadSettings();
  return settings.renderCacheDir ?? join(app.getPath('userData'), 'render-cache');
}

export interface CacheStats {
  dir: string;
  files: number;
  bytes: number;
  maxMB: number;
  summary: string;
}

async function listCache(dir: string): Promise<CachedFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: CachedFile[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const info = await stat(join(dir, name));
      if (info.isFile()) out.push({ path: join(dir, name), bytes: info.size, mtimeMs: info.mtimeMs });
    } catch {
      // vanished
    }
  }
  return out;
}

export async function cacheStats(): Promise<CacheStats> {
  const settings = await loadSettings();
  const dir = await cacheDir();
  const files = await listCache(dir);
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  return { dir, files: files.length, bytes, maxMB: settings.renderCacheMaxMB, summary: `${files.length} file${files.length === 1 ? '' : 's'}, ${formatMB(bytes)} of ${settings.renderCacheMaxMB} MB` };
}

/** Delete the oldest cached renders until the folder is under its limit. `keep` protects files in use. */
export async function evictIfNeeded(keep: ReadonlySet<string> = new Set()): Promise<string[]> {
  const settings = await loadSettings();
  const dir = await cacheDir();
  const victims = planEviction(await listCache(dir), settings.renderCacheMaxMB * 1024 * 1024, keep);
  for (const v of victims) await rm(v, { force: true, maxRetries: 10, retryDelay: 100 });
  return victims;
}

export async function clearRenderCache(): Promise<CacheStats> {
  const dir = await cacheDir();
  for (const f of await listCache(dir)) await rm(f.path, { force: true, maxRetries: 10, retryDelay: 100 });
  return cacheStats();
}

export async function ensureCacheDir(): Promise<string> {
  const dir = await cacheDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function chooseRenderCacheDir(): Promise<CacheStats | null> {
  const pick = await dialog.showOpenDialog({ title: 'Render cache folder', properties: ['openDirectory', 'createDirectory'], defaultPath: await cacheDir() });
  const folder = pick.filePaths[0];
  if (pick.canceled || !folder) return null;
  await updateSettings((s) => ({ ...s, renderCacheDir: folder }));
  return cacheStats();
}

export async function setRenderCacheLimit(maxMB: number): Promise<CacheStats> {
  await updateSettings((s) => ({ ...s, renderCacheMaxMB: maxMB }));
  await evictIfNeeded();
  return cacheStats();
}

/** True if the path is a file inside the cache folder (by real path). */
export async function isCachedFile(path: string): Promise<boolean> {
  try {
    const [real, dir] = await Promise.all([realpath(path), realpath(await cacheDir())]);
    return real.startsWith(dir + sep) && (await stat(real)).isFile();
  } catch {
    return false;
  }
}

/** The file to drag for a job output: a plain file as is; a sequence pattern's first frame. */
export function dragFileFor(output: string, firstFrame: number): string {
  return /%0?\d*d/.test(output) ? expandSequence(output, 1, firstFrame)[0]! : output;
}

/** A 48x48 PNG for the drag image when the template has no thumbnail: a dark rounded square. */
function fallbackIcon(): Electron.NativeImage {
  const size = 48;
  const rows: number[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) {
      const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      rows.push(edge ? 0x30 : 0x1d, edge ? 0x35 : 0x20, edge ? 0x3f : 0x26, 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
  return nativeImage.createFromBuffer(png);
}

/**
 * Start a native drag of a rendered file. Refused (false) unless the file is
 * in the cache folder or is an output of a finished job (`allowed`), and
 * exists. The icon is the template's thumbnail when there is one; macOS and
 * Windows require a non-empty icon.
 */
export async function startDragOut(sender: WebContents, path: string, allowed: ReadonlySet<string>, templateId?: string): Promise<boolean> {
  const file = resolve(path);
  const ok = allowed.has(file) || (await isCachedFile(file));
  if (!ok) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }
  let icon = fallbackIcon();
  const thumb = templateId ? lookupThumbnail(templateId) : undefined;
  if (thumb) {
    const img = nativeImage.createFromPath(thumb);
    if (!img.isEmpty()) icon = img.resize({ width: 64 });
  }
  sender.startDrag({ file, icon });
  return true;
}

export const describeDragFile = (path: string): string => `${basename(path)}${extname(path) ? '' : ''}`;
