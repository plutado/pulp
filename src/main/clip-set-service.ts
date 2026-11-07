/**
 * A clip set as one file (milestone 32). Its intro, loop and outro — and
 * every layer of a layered set — are stitched by ffmpeg to the length asked,
 * alpha and sound kept, into Pulp's own cache, never beside the stock media,
 * named by everything they were made from so a changed part or another length
 * is made again. Two forms: the **preview**, a small VP9 WebM the stage's
 * video and audio elements play like any clip's; and the **set file**, a
 * full-quality ProRes 4444 with PCM sound, which stands for the set wherever
 * Pulp needs a single file — a cut on the track, a layer's sound in the mix,
 * an exported edit, a clean-up — so a set works everywhere one clip does.
 */

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { clipSetLayersStitchArgs, clipSetNaturalSeconds, stitchHasSound, type StitchLayer } from '../core/clip-set';
import type { MediaEntry, MediaMetadata } from '../core/library-types';
import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { ffprobePathFor } from '../core/media-probe';
import { alphaDecoderFor } from '../core/media-meta';
import { clipSetPreviewUrlFor } from '../core/media-serve';
import { tr } from '../core/i18n';
import { lookupMedia, probeClipSet } from './library-service';

/** Previews kept; the oldest go first. Each is a few seconds of small video. */
const CACHE_KEEP = 24;
/** The preview's longer side: enough for the stage, small enough to make in a moment. */
const PREVIEW_SIDE = 640;
/** Longer than this is not a preview anyone waits for. */
const MAX_PREVIEW_SECONDS = 300;

export function clipSetPreviewDir(): string {
  return join(app.getPath('userData'), 'clip-set-cache');
}

export type ClipSetPreview = { ok: true; url: string; seconds: number } | { ok: false; message: string };

const inFlight = new Map<string, Promise<ClipSetPreview>>();

/**
 * What a set is stitched from: each layer's files, timing, decoder and which parts carry sound,
 * from the entry and its probe. The one place the three are put together, so the preview, the set
 * file and the item's own render stitch the same set.
 */
export function stitchLayersFor(entry: MediaEntry, meta: MediaMetadata): StitchLayer[] {
  const decoder = alphaDecoderFor(meta);
  const timings = entry.clipSetLayers && meta.layers?.length === entry.clipSetLayers.length ? meta.layers : [meta.parts!];
  const files = entry.clipSetLayers && meta.layers?.length === entry.clipSetLayers.length ? entry.clipSetLayers.map((l) => l.files) : [entry.clipSet!];
  const sounds = meta.layersSound?.length === files.length ? meta.layersSound : [meta.partsSound ?? {}];
  return files.map((f, i) => ({ files: f, timing: timings[i]!, ...(decoder ? { decoder } : {}), ...(sounds[i] && Object.keys(sounds[i]!).length > 0 ? { sound: sounds[i]! } : {}) }));
}

/** Every part of every layer with its modification time: what a stitched file is named by. */
async function stampsOf(layers: readonly StitchLayer[]): Promise<string[] | null> {
  return Promise.all(layers.flatMap((l) => Object.values(l.files)).map(async (p) => `${p}|${(await stat(p)).mtimeMs}`)).catch(() => null);
}

/** The stage's preview of a clip set at `length` seconds, or its own length when none is asked. */
export async function clipSetPreview(id: string, length: number | undefined): Promise<ClipSetPreview> {
  const found = lookupMedia(id);
  if (!found || !found.entry.clipSet) return { ok: false, message: tr('clip-set.preview.not-a-set') };
  if (!found.online) return { ok: false, message: tr('stage.empty.file-offline') };
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };
  const entry = found.entry;
  const meta = entry.meta?.parts ? entry.meta : await probeClipSet(ffprobePathFor(ffmpeg.path), entry);
  if (!meta?.parts || !meta.width || !meta.height) return { ok: false, message: tr('clip-set.preview.unreadable') };
  const seconds = Math.min(MAX_PREVIEW_SECONDS, length !== undefined && Number.isFinite(length) && length > 0 ? length : clipSetNaturalSeconds(meta.parts));
  // A set of several layers (milestone 32) is stitched layer by layer and composited, its sound with it.
  const layers = stitchLayersFor(entry, meta);
  const stamps = await stampsOf(layers);
  if (!stamps) return { ok: false, message: tr('stage.empty.file-offline') };
  const name = `${createHash('sha1').update(`${stamps.join('|')}|${seconds}|sound`).digest('hex')}.webm`;
  const running = inFlight.get(name);
  if (running) return running;
  const work = make(ffmpeg.path, ffmpeg.encoders, layers, seconds, { fps: meta.fps ?? 30, width: meta.width, height: meta.height }, name);
  inFlight.set(name, work);
  return work.finally(() => inFlight.delete(name));
}

export type ClipSetFileResult = { ok: true; path: string; seconds: number; hasAudio: boolean } | { ok: false; message: string };

const filesInFlight = new Map<string, Promise<ClipSetFileResult>>();

/**
 * The set as one full-quality file (milestone 32): its layers stitched to `length` seconds — its
 * own length when none is asked — as ProRes 4444 with PCM sound, in Pulp's own cache. What stands
 * for the set wherever a single file is needed: a cut on the track, a layer's sound in a render's
 * mix, a clip an exported edit references, a clean-up. Made once per set, length and modification
 * time of its parts; the same ask twice at once is made once.
 */
export async function clipSetFile(id: string, length?: number): Promise<ClipSetFileResult> {
  const found = lookupMedia(id);
  if (!found || !found.entry.clipSet) return { ok: false, message: tr('clip-set.preview.not-a-set') };
  if (!found.online) return { ok: false, message: tr('stage.empty.file-offline') };
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };
  const entry = found.entry;
  const meta = entry.meta?.parts ? entry.meta : await probeClipSet(ffprobePathFor(ffmpeg.path), entry);
  if (!meta?.parts || !meta.width || !meta.height) return { ok: false, message: tr('clip-set.preview.unreadable') };
  const seconds = length !== undefined && Number.isFinite(length) && length > 0 ? length : clipSetNaturalSeconds(meta.parts);
  const layers = stitchLayersFor(entry, meta);
  const stamps = await stampsOf(layers);
  if (!stamps) return { ok: false, message: tr('stage.empty.file-offline') };
  const hasAudio = stitchHasSound(layers);
  const name = `${createHash('sha1').update(`${stamps.join('|')}|${seconds}|file`).digest('hex')}.mov`;
  const running = filesInFlight.get(name);
  if (running) return running;
  const work = (async (): Promise<ClipSetFileResult> => {
    const dir = clipSetPreviewDir();
    const file = join(dir, name);
    if (await stat(file).then(() => true, () => false)) return { ok: true, path: file, seconds, hasAudio };
    await mkdir(dir, { recursive: true });
    const partial = `${file}.part`;
    const run = await runForBuffer(ffmpeg.path, [
      ...clipSetLayersStitchArgs(layers, seconds, { fps: meta.fps ?? 30, width: meta.width!, height: meta.height! }, true),
      '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', ...(hasAudio ? ['-c:a', 'pcm_s16le'] : []), '-f', 'mov', '-y', partial,
    ]);
    if (run.code !== 0) {
      await rm(partial, { force: true });
      return { ok: false, message: tr('render.media.clip-set-failed', { reason: run.stderr.trim().split('\n').slice(-3).join(' ') }) };
    }
    await rename(partial, file);
    void prune(dir);
    return { ok: true, path: file, seconds, hasAudio };
  })();
  filesInFlight.set(name, work);
  return work.finally(() => filesInFlight.delete(name));
}

async function make(
  ffmpegPath: string,
  encoders: readonly string[],
  layers: readonly StitchLayer[],
  seconds: number,
  own: { fps: number; width: number; height: number },
  name: string,
): Promise<ClipSetPreview> {
  const dir = clipSetPreviewDir();
  const file = join(dir, name);
  const url = clipSetPreviewUrlFor(name);
  try {
    await stat(file);
    return { ok: true, url, seconds };
  } catch {
    // Not made yet.
  }
  await mkdir(dir, { recursive: true });
  // The stage's size, kept even and in proportion.
  const k = Math.min(1, PREVIEW_SIDE / Math.max(own.width, own.height));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  const size = { fps: own.fps, width: even(own.width), height: even(own.height) };
  const codec = encoders.includes('libvpx-vp9') ? 'libvpx-vp9' : 'libvpx';
  // Its sound too, where the parts have any and this ffmpeg writes a WebM codec for it.
  const audioCodec = encoders.includes('libopus') ? 'libopus' : encoders.includes('libvorbis') ? 'libvorbis' : null;
  const withSound = audioCodec !== null && stitchHasSound(layers);
  const partial = `${file}.part`;
  const run = await runForBuffer(ffmpegPath, [
    ...clipSetLayersStitchArgs(layers, seconds, size, withSound),
    '-c:v', codec, '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '0', '-crf', '36',
    ...(withSound ? ['-c:a', audioCodec!, '-b:a', '96k'] : []),
    '-f', 'webm', '-y', partial,
  ]);
  if (run.code !== 0) {
    await rm(partial, { force: true });
    return { ok: false, message: tr('render.media.clip-set-failed', { reason: run.stderr.trim().split('\n').slice(-3).join(' ') }) };
  }
  await rename(partial, file);
  void prune(dir);
  return { ok: true, url, seconds };
}

/** Keep the newest few of each kind — previews and set files alike; the rest are made again if they are asked for. */
async function prune(dir: string): Promise<void> {
  const all = await readdir(dir);
  for (const ext of ['.webm', '.mov']) {
    const names = all.filter((n) => n.endsWith(ext));
    if (names.length <= CACHE_KEEP) continue;
    const dated = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(dir, n))).mtimeMs })));
    dated.sort((a, b) => b.t - a.t);
    await Promise.all(dated.slice(CACHE_KEEP).map((d) => rm(join(dir, d.n), { force: true })));
  }
}

/**
 * A song's stems mixed for the stage (milestone 32): the stage plays one element, so the stems are
 * heard together through one short AAC file in the same cache, made again when a stem changes.
 */
export async function stemsPreview(id: string): Promise<ClipSetPreview> {
  const found = lookupMedia(id);
  if (!found?.entry.stemParts?.length) return { ok: false, message: tr('render.media.stems-missing') };
  if (!found.online) return { ok: false, message: tr('stage.empty.file-offline') };
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };
  const stems = found.entry.stemParts.map((s) => lookupMedia(s.id)?.entry.path).filter((p): p is string => p !== undefined);
  const stamps = await Promise.all(stems.map(async (p) => `${p}|${(await stat(p)).mtimeMs}`)).catch(() => null);
  if (!stamps || stems.length === 0) return { ok: false, message: tr('render.media.stems-missing') };
  const name = `${createHash('sha1').update(`stems|${stamps.join('|')}`).digest('hex')}.m4a`;
  const dir = clipSetPreviewDir();
  const file = join(dir, name);
  const url = clipSetPreviewUrlFor(name);
  if (await stat(file).then(() => true, () => false)) return { ok: true, url, seconds: 0 };
  await mkdir(dir, { recursive: true });
  const partial = `${file}.part`;
  const run = await runForBuffer(ffmpeg.path, [
    '-v', 'error', '-nostdin', ...stems.flatMap((p) => ['-i', p]),
    '-filter_complex', `${stems.map((_, i) => `[${i}:a]`).join('')}amix=inputs=${stems.length}:duration=longest:normalize=0[mix]`,
    '-map', '[mix]', '-c:a', 'aac', '-b:a', '160k', '-f', 'mp4', '-y', partial,
  ]);
  if (run.code !== 0) {
    await rm(partial, { force: true });
    return { ok: false, message: tr('render.media.stems-failed', { reason: run.stderr.trim().split('\n').slice(-2).join(' ') }) };
  }
  await rename(partial, file);
  return { ok: true, url, seconds: 0 };
}
