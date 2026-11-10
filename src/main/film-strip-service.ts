/**
 * The timeline's film strips (milestone 87), made in the main process: a
 * clip's frames sampled evenly, scaled to small tiles and tiled into one PNG
 * (src/core/film-strip.ts says how many and how big). Two ffmpeg runs — the
 * decode writes raw tiles, whose count is then exact from the bytes, and the
 * tiling packs them — so a strip never has a blank tile where a clip ended a
 * hair early, which `tile` on a live decode would leave (docs/platform-notes.md).
 *
 * In the background, on the library's heavy chain, so posters and strips take
 * turns; cached beside the thumbnails by the file's size and modification time,
 * and kept in memory for the run. The window asks by library id, never by path
 * (ADR 0013), and gets the PNG's bytes with how to read them.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectFfmpeg, runForBuffer, runWithInputForBuffer } from '../core/ffmpeg';
import { filmFramesArgs, filmLayout, filmStripPlan, filmTileArgs, type FilmStripInfo } from '../core/film-strip';
import { alphaDecoderFor, type MediaMetadata } from '../core/media-meta';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import { nodeRunner } from '../core/ffmpeg';
import { cachesPersist, lookupClipItem, lookupMedia, takeHeavyTurn, thumbnailDir } from './library-service';

export type FilmStripAnswer =
  | ({ ok: true; png: Uint8Array } & FilmStripInfo)
  /** `transient`: worth asking again later (no ffmpeg yet, a folder offline); otherwise this file has none. */
  | { ok: false; reason: string; transient?: boolean };

const made = new Map<string, Promise<FilmStripAnswer>>();
/** Strips kept in memory for the run, by file identity; a handful of projects' worth. */
const KEEP = 64;

export function filmStrip(id: unknown): Promise<FilmStripAnswer> {
  if (typeof id !== 'string' || id === '') return Promise.resolve({ ok: false, reason: 'no id' }); // i18n-exempt(diagnostic)
  const found = lookupMedia(id);
  if (!found || found.entry.mediaKind !== 'video' || found.entry.sequence || found.entry.clipSet) {
    return Promise.resolve({ ok: false, reason: 'not a clip with a file of its own' }); // i18n-exempt(diagnostic)
  }
  if (!found.online) return Promise.resolve({ ok: false, reason: 'its folder is offline', transient: true }); // i18n-exempt(diagnostic)
  const { entry } = found;
  // The file's size and modification time, which the cache is keyed by: a changed file is a new strip.
  const stamp = lookupClipItem(id);
  const key = `${id}|${stamp?.size ?? 0}|${stamp?.mtimeMs ?? 0}`;
  const known = made.get(key);
  if (known) return known;
  const work = takeHeavyTurn(() => make(id, entry.path, entry.meta, key), 'film strip').catch((err: Error): FilmStripAnswer => ({ ok: false, reason: err.message }));
  made.set(key, work);
  while (made.size > KEEP) made.delete(made.keys().next().value!);
  // A failure worth retrying is not kept: the next ask tries again.
  void work.then((answer) => {
    if (!answer.ok && answer.transient && made.get(key) === work) made.delete(key);
  });
  return work;
}

async function make(id: string, path: string, known: MediaMetadata | undefined, key: string): Promise<FilmStripAnswer> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, reason: 'ffmpeg was not found', transient: true }; // i18n-exempt(diagnostic)
  // The disk cache: the PNG and what it holds, named by the item, stamped with the file it was made from.
  const dir = thumbnailDir();
  const png = join(dir, `${id}-film.png`);
  const about = join(dir, `${id}-film.json`);
  if (cachesPersist() && existsSync(png) && existsSync(about)) {
    try {
      const info = JSON.parse(await readFile(about, 'utf8')) as FilmStripInfo & { key: string };
      if (info.key === key) return { ok: true, png: new Uint8Array(await readFile(png)), rate: info.rate, count: info.count, tileWidth: info.tileWidth, tileHeight: info.tileHeight, columns: info.columns };
    } catch {
      // A torn cache file is made again.
    }
  }
  // A headless render never runs the library's probe; the strip reads the file itself if it must.
  const meta = known?.duration && known.width && known.height && !known.fromPreview ? known : await probeMedia(ffprobePathFor(ffmpeg.path), path, nodeRunner);
  if (!meta?.duration || !meta.width || !meta.height) return { ok: false, reason: 'the clip has not been measured', transient: true }; // i18n-exempt(diagnostic)
  const plan = filmStripPlan(meta.duration, meta.width, meta.height, meta.fps);
  const decoded = await runForBuffer(ffmpeg.path, filmFramesArgs(path, plan, alphaDecoderFor(meta)));
  const tileBytes = plan.tileWidth * plan.tileHeight * 3;
  const count = Math.floor(decoded.stdout.length / tileBytes);
  if (decoded.code !== 0 || count === 0) return { ok: false, reason: `ffmpeg decoded no frames (${decoded.code}): ${decoded.stderr.trim().slice(-300)}` }; // i18n-exempt(diagnostic)
  const tiled = await runWithInputForBuffer(ffmpeg.path, filmTileArgs(plan.tileWidth, plan.tileHeight, count), decoded.stdout.subarray(0, count * tileBytes));
  if (tiled.code !== 0 || tiled.stdout.length === 0) return { ok: false, reason: `ffmpeg could not tile the strip (${tiled.code}): ${tiled.stderr.trim().slice(-300)}` }; // i18n-exempt(diagnostic)
  // The rate the frames really came at: the decode's count over the length, which is what `fps` kept.
  const info: FilmStripInfo = { rate: plan.rate, count, tileWidth: plan.tileWidth, tileHeight: plan.tileHeight, columns: filmLayout(count).columns };
  if (cachesPersist()) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(png, tiled.stdout);
      await writeFile(about, JSON.stringify({ ...info, key }));
    } catch {
      // A cache that cannot be written costs only the next run's time.
    }
  }
  return { ok: true, png: new Uint8Array(tiled.stdout), ...info };
}
