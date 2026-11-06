/**
 * Video layers' access to the library (milestone 26, under ADR 0013's rule).
 * A template page is refused the library outright, so a clip reaches it the
 * way a still does: the main process reads exactly the clips a layer named, by
 * library id, and hands the page their frames for the length of a preview or a
 * render. There is no URL a template could vary, and nothing is read for an id
 * that was not chosen.
 *
 * A clip is handed over as **frames, decoded once**: a render asks for a
 * different frame of it every frame, and decoding per frame would cost far
 * more than drawing does. Only the window the layer plays is read, and it is
 * scaled to the size the layer is actually drawn at — a quarter-height plate
 * on a 1080p frame needs nothing like the clip's own resolution, and the
 * difference is the whole memory budget.
 */

import { join } from 'node:path';
import { detectFfmpeg, nodeRunner, runForBuffer } from '../core/ffmpeg';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import { sequencePatternName, SEQUENCE_FPS } from '../core/media-sequence';
import { clipProxySize, clipWindow, EMPTY_CLIP, sanitizeClipValue, type ClipSource, type ClipValue } from '../core/video-layer';
import { isCubeFile, lutFilter } from '../core/clip-clean';
import type { MediaEntry, TemplateEntry } from '../core/library-types';
import { lookupClipItem, lookupMedia, probeClipSet, unpackIfArchived } from './library-service';
import { clipSetFramesArgs } from '../core/clip-set';
import { templateDefaultSize } from '../core/aspect';

/** One clip, ready for a template page: its frames in window order, as data URLs. */
export interface ClipFrameData {
  id: string;
  kind: 'clip';
  srcs: string[];
}

/**
 * The most frames one clip may be held at once. Thirty seconds at 30 fps: past
 * that a layer is a film rather than an element on a frame, and the memory it
 * would take in the page is not worth spending silently.
 */
export const MAX_CLIP_FRAMES = 900;

/** The longest side a clip frame is decoded at, whatever the layer asks for: a cap on one careless layer. */
export const MAX_CLIP_FRAME_SIDE = 2048;

/** A clip entry's timing from metadata already in hand, or null when it is not there yet. */
function sourceFromEntry(entry: MediaEntry, meta = entry.meta): ClipSource | null {
  if (entry.sequence) return { frames: entry.sequence.count, fps: meta?.fps ?? SEQUENCE_FPS, sequence: entry.sequence };
  // A clip set (milestone 32): its three parts end to end, each counted at the loop's rate.
  if (entry.clipSet) {
    if (!meta?.parts || !meta.fps) return null;
    const p = meta.parts;
    const frames = Math.round(p.intro * meta.fps) + Math.round(p.loop * meta.fps) + Math.round(p.outro * meta.fps);
    return { frames: Math.max(1, frames), fps: meta.fps, set: p };
  }
  if (!meta?.fps || !meta.duration) return null;
  return { frames: Math.max(1, Math.round(meta.duration * meta.fps)), fps: meta.fps };
}

/** A drawn template's own timing, straight from its manifest (milestone 35; any effect since 45). */
function sourceFromTemplate(entry: TemplateEntry): ClipSource {
  const { duration, fps } = entry.manifest;
  return { frames: Math.max(1, Math.round(duration * fps)), fps };
}

/** What the library knows about a clip's own timing, or null when it cannot be used as one or has not been read. */
export function clipSourceFor(id: string): ClipSource | null {
  const found = lookupClipItem(id);
  if (!found) return null;
  return found.kind === 'drawn' ? sourceFromTemplate(found.entry) : sourceFromEntry(found.entry);
}

/**
 * The same, but reading the file when the library has not. Metadata arrives
 * from a background pass that a headless render never runs and that a window
 * may not have finished, and a render that quietly dropped a layer for want of
 * it would be a bad surprise — so the one clip a layer names is probed here if
 * it must be. The result is not stored: this is a render's own business, and
 * the library's own pass fills its cache in its own time.
 */
export async function resolveClipSource(ffprobePath: string, id: string): Promise<ClipSource | null> {
  // An archive's file is unpacked into the library the first time it is used (milestone 32).
  await unpackIfArchived([id]);
  const found = lookupClipItem(id);
  if (!found) return null;
  // A drawn template states its own rate and length in its manifest: nothing to probe.
  if (found.kind === 'drawn') return sourceFromTemplate(found.entry);
  const known = sourceFromEntry(found.entry);
  if (known) return known;
  const meta = found.entry.clipSet ? await probeClipSet(ffprobePath, found.entry) : await probeMedia(ffprobePath, found.entry.path, nodeRunner);
  if (!meta) return null;
  return sourceFromEntry(found.entry, meta);
}

/**
 * The clip's file and whether it carries sound (milestone 48): what mixing a
 * layer's audio into a render needs to know. Null for anything without a file
 * of its own to read sound from — a drawn template, a frame sequence — and
 * probed on the spot when the library's background pass has not run, the same
 * reason `resolveClipSource` probes.
 */
export async function resolveClipAudio(ffprobePath: string, id: string): Promise<{ path: string; hasAudio: boolean } | null> {
  // An archive's file is unpacked into the library the first time it is used (milestone 32).
  await unpackIfArchived([id]);
  const found = lookupClipItem(id);
  // A clip set's layer is silent for now: its parts' sounds are not stitched (milestone 32).
  if (!found || found.kind !== 'media' || found.entry.sequence || found.entry.clipSet) return null;
  const meta = found.entry.meta ?? (ffprobePath ? await probeMedia(ffprobePath, found.entry.path, nodeRunner) : null);
  if (!meta) return null;
  // A clip with no sound of its own plays the sound made for it — a transition's whoosh
  // (milestone 32) — on the clip's own timing, as the stage plays it (src/renderer/stage-audio.ts).
  if (!meta.audioCodec && found.entry.pairedSound) {
    const paired = lookupMedia(found.entry.pairedSound);
    if (paired?.online) return { path: paired.entry.path, hasAudio: true };
  }
  return { path: found.entry.path, hasAudio: Boolean(meta.audioCodec) };
}

/** Only ids that are online clips the library has measured; anything else is named back as missing. */
export function checkClips(ids: readonly string[]): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (clipSourceFor(id)) ok.push(id);
    else missing.push(id);
  }
  return { ok, missing };
}

/**
 * Decoded clip windows, kept so that choosing a template again, or scrubbing
 * after a change elsewhere, does not decode the same frames twice. Keyed by
 * everything that decides the bytes — the clip and its stat signature, the
 * window, and the proxy size — so a re-exported clip is never served stale.
 * Oldest out first, under a budget counted in the characters actually held.
 */
const frameCache = new Map<string, ClipFrameData>();
let frameCacheBytes = 0;

/** How much decoded clip the main process holds at once. Generous enough for a few proxies, bounded. */
export const CLIP_CACHE_BUDGET_BYTES = 192 * 1024 * 1024;

function cacheSize(data: ClipFrameData): number {
  return data.srcs.reduce((n, src) => n + src.length, 0);
}

function cacheTake(key: string): ClipFrameData | undefined {
  const hit = frameCache.get(key);
  if (!hit) return undefined;
  // Most recently used goes to the back, so the oldest is always the first out.
  frameCache.delete(key);
  frameCache.set(key, hit);
  return hit;
}

function cachePut(key: string, data: ClipFrameData): void {
  const size = cacheSize(data);
  if (size > CLIP_CACHE_BUDGET_BYTES) return;
  frameCache.set(key, data);
  frameCacheBytes += size;
  for (const [oldest, held] of frameCache) {
    if (frameCacheBytes <= CLIP_CACHE_BUDGET_BYTES) break;
    if (oldest === key) continue;
    frameCache.delete(oldest);
    frameCacheBytes -= cacheSize(held);
  }
}

/** Forget every decoded frame; for tests, and for a library that has been rescanned from scratch. */
export function clearClipFrameCache(): void {
  frameCache.clear();
  frameCacheBytes = 0;
}

/** The size and modification time of each chosen clip, for the render cache key; unknown ids stamp as zero. */
export function clipStamps(ids: readonly string[]): { id: string; size: number; mtimeMs: number }[] {
  return ids.map((id) => {
    const found = lookupClipItem(id);
    return { id, size: found?.size ?? 0, mtimeMs: found?.mtimeMs ?? 0 };
  });
}

/**
 * ffmpeg arguments that write a clip's window to stdout as a PNG stream, one
 * image per frame, scaled to fit a box without enlarging and with alpha kept.
 *
 * A frame sequence is read through the image2 demuxer at its own rate;
 * everything else is seeked to the in point and read forward. The seek is
 * before `-i`, so it is the fast kind, and `-frames:v` stops it at the window's
 * end rather than decoding the rest of a long clip.
 */
export function clipFramesArgs(entry: MediaEntry, source: ClipSource, window: { first: number; frames: number }, maxSide: number, lut?: string): string[] {
  const side = Math.max(16, Math.min(MAX_CLIP_FRAME_SIDE, Math.round(maxSide)));
  const scale = `scale=w='min(iw,${side})':h='min(ih,${side})':force_original_aspect_ratio=decrease`;
  // A clip set is decoded as its parts end to end, each once: the frames the timing counts in.
  if (entry.clipSet && source.set) {
    const grade = lut && isCubeFile(lut) ? lutFilter(lut) : '';
    const own = { fps: source.fps, width: entry.meta?.width ?? side, height: entry.meta?.height ?? side };
    return clipSetFramesArgs(entry.clipSet, source.set, own, window, [grade, scale].filter(Boolean).join(','));
  }
  const input = entry.sequence
    ? ['-start_number', String(entry.sequence.start + window.first), '-framerate', String(source.fps), '-i', join(entry.sequence.dir, sequencePatternName(entry.sequence))]
    : ['-ss', (window.first / Math.max(1, source.fps)).toFixed(6), '-i', entry.path];
  // The layer's own grade (milestone 52) is decoded into the frames, so the preview and the
  // render show it by the one path, and the page never learns there was a file.
  const grade = lut && isCubeFile(lut) ? `${lutFilter(lut)},` : '';
  return [
    '-v', 'error', '-nostdin',
    ...input,
    '-frames:v', String(window.frames),
    '-an', '-vf', `${grade}${scale},format=rgba`,
    '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
  ];
}

/** Split a PNG stream into its images. The signature and the IEND chunk bound each one exactly. */
export function splitPngStream(buffer: Buffer): Buffer[] {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out: Buffer[] = [];
  let at = buffer.indexOf(SIGNATURE);
  while (at >= 0) {
    const next = buffer.indexOf(SIGNATURE, at + SIGNATURE.length);
    out.push(buffer.subarray(at, next < 0 ? buffer.length : next));
    at = next;
  }
  return out;
}

/**
 * Read the window a layer plays of one clip, as frames a page can decode.
 * `drawnHeight` is how tall the layer is on the rendered frame, in pixels; the
 * clip is read at no more than twice that, which keeps a scaled or rotated
 * layer sharp without holding a full-resolution film in memory.
 */
export async function readClipFrames(
  ffmpegPath: string,
  id: string,
  value: ClipValue,
  source: ClipSource,
  drawnHeight: number,
): Promise<{ ok: true; data: ClipFrameData } | { ok: false; problem: ClipReadProblem }> {
  // An archive's file is unpacked into the library the first time it is used (milestone 32).
  await unpackIfArchived([id]);
  const found = lookupClipItem(id);
  if (!found) return { ok: false, problem: { kind: 'not-a-clip' } };
  const window = clipWindow(value, source);
  if (window.frames === 0) return { ok: false, problem: { kind: 'no-frames' } };
  if (window.frames > MAX_CLIP_FRAMES) {
    const seconds = Math.round(MAX_CLIP_FRAMES / Math.max(1, source.fps));
    return { ok: false, problem: { kind: 'too-long', frames: window.frames, max: MAX_CLIP_FRAMES, seconds } };
  }
  // Twice the drawn height, rounded up to a proxy step: sharp enough for a scaled or rotated
  // layer, and stable while a window is resized, so nothing is decoded twice for a few pixels.
  const side = clipProxySize(drawnHeight * 2);
  const key = `${found.kind}|${id}|${found.size}|${found.mtimeMs}|${window.first}|${window.frames}|${side}|${value.lut ?? ''}`;
  const cached = cacheTake(key);
  if (cached) return { ok: true, data: cached };
  const frames = found.kind === 'drawn'
    ? await drawnClipFrames(found.entry, window, side)
    : await ffmpegClipFrames(ffmpegPath, found.entry, source, window, side, value.lut);
  if (!frames.ok) return { ok: false, problem: { kind: 'failed', detail: frames.message } };
  const data: ClipFrameData = { id, kind: 'clip', srcs: frames.pngs.map((f) => `data:image/png;base64,${f.toString('base64')}`) };
  cachePut(key, data);
  return { ok: true, data };
}

/**
 * Why a clip's frames could not be read, for the render to say in a whole sentence of its own
 * (src/main/render.ts): which layer or slot it was is the sentence's, not this module's.
 */
export type ClipReadProblem =
  | { kind: 'not-a-clip' }
  | { kind: 'no-frames' }
  | { kind: 'too-long'; frames: number; max: number; seconds: number }
  /** ffmpeg's or the drawing page's own account: a diagnostic, said as it came. */
  | { kind: 'failed'; detail: string };

type FramesRead = { ok: true; pngs: Buffer[] } | { ok: false; message: string };

async function ffmpegClipFrames(ffmpegPath: string, entry: MediaEntry, source: ClipSource, window: { first: number; frames: number }, side: number, lut?: string): Promise<FramesRead> {
  const result = await runForBuffer(ffmpegPath, clipFramesArgs(entry, source, window, side, lut));
  if (result.code !== 0) return { ok: false, message: `ffmpeg exited with ${result.code}: ${result.stderr.trim() || 'no error output'}` }; // i18n-exempt(diagnostic)
  const pngs = splitPngStream(result.stdout);
  if (pngs.length === 0) return { ok: false, message: 'ffmpeg decoded no frames from it' }; // i18n-exempt(diagnostic)
  return { ok: true, pngs };
}

/**
 * A template's window, drawn rather than decoded (milestone 35, and any
 * effect or object on transparency since 45): it has no file of pixels for
 * ffmpeg to read, so its frames are captured through the same offscreen
 * window its poster and its hover strip come from, at the size the layer is
 * drawn — which is also why one placed small costs little. Its own shape is
 * kept, inside the box the proxy step allows.
 */
async function drawnClipFrames(entry: TemplateEntry, window: { first: number; frames: number }, side: number): Promise<FramesRead> {
  const own = templateDefaultSize(entry.manifest);
  const scale = Math.min(1, side / Math.max(own.width, own.height));
  const size = { width: Math.max(16, Math.round(own.width * scale)), height: Math.max(16, Math.round(own.height * scale)) };
  const wanted = Array.from({ length: window.frames }, (_, i) => window.first + i);
  // Imported here, not at the top: the render module reads clips from this one, and this is the
  // only call going the other way.
  const { captureTemplateFrames } = await import('./render');
  const shot = await captureTemplateFrames(entry, wanted, { size, frameTimeoutMs: 10_000 });
  if (!shot.ok) return { ok: false, message: shot.message };
  if (shot.frames.length === 0) return { ok: false, message: 'drew no frames' }; // i18n-exempt(diagnostic)
  return { ok: true, pngs: shot.frames };
}

/** One cut's frames for the preview (milestone 49): the proxy window, with what maps a moment to a frame. */
export interface TrackCutFrames {
  srcs: string[];
  fps: number;
  /** The source frame `srcs[0]` holds, so `floor(seconds * fps) - first` indexes the window. */
  first: number;
}

/**
 * Read the cut track's frames for the preview (milestone 49): each cut's
 * window through the same proxy decode a video layer's window takes, so the
 * cache, the LUT-free scale and the size steps are all the ones already
 * there. A cut that cannot be read — offline, no ffmpeg, or longer than the
 * frames a window may hold — is null, and the lane shows the pad for it
 * rather than failing the rest; the render reads the file itself and is exact
 * regardless.
 */
export async function loadTrackFrames(raw: unknown): Promise<{ cuts: (TrackCutFrames | null)[] }> {
  const request = raw as Partial<{ cuts: { id: string; from: number; to: number }[]; height: number }>;
  const asked = Array.isArray(request?.cuts) ? request.cuts : [];
  const height = typeof request?.height === 'number' && Number.isFinite(request.height) ? Math.min(1080, Math.max(90, request.height)) : 360;
  const ffmpeg = await detectFfmpeg();
  const cuts: (TrackCutFrames | null)[] = [];
  for (const cut of asked) {
    const from = Number(cut?.from);
    const to = Number(cut?.to);
    if (typeof cut?.id !== 'string' || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      cuts.push(null);
      continue;
    }
    const isDrawn = lookupClipItem(cut.id)?.kind === 'drawn';
    if (!ffmpeg.ok && !isDrawn) {
      cuts.push(null);
      continue;
    }
    const source = await resolveClipSource(ffmpeg.ok ? ffprobePathFor(ffmpeg.path) : '', cut.id);
    if (!source) {
      cuts.push(null);
      continue;
    }
    const first = Math.max(0, Math.round(from * source.fps));
    const last = Math.min(source.frames - 1, Math.max(first, Math.round(to * source.fps) - 1));
    const value: ClipValue = { ...EMPTY_CLIP, id: cut.id, inPoint: first, outPoint: last, ending: 'once' };
    const read = await readClipFrames(ffmpeg.ok ? ffmpeg.path : '', cut.id, value, source, height);
    cuts.push(read.ok ? { srcs: read.data.srcs, fps: source.fps, first } : null);
  }
  return { cuts };
}

/** What the window asks for: a layer's clip and how tall it is drawn in the preview. */
export interface ClipRequest {
  id: string;
  value: ClipValue;
  drawnHeight: number;
}

/**
 * Read every clip a preview needs: its frames, and what was measured about it
 * so the window can lay out the moment. Clips that cannot be read are named
 * rather than failing the lot — a preview should still draw the rest of the
 * graphic while one layer is wrong.
 */
export async function loadLayerClips(
  requests: readonly unknown[],
): Promise<{ clips: ClipFrameData[]; sources: Record<string, ClipSource>; missing: string[] }> {
  const ffmpeg = await detectFfmpeg();
  const clips: ClipFrameData[] = [];
  const sources: Record<string, ClipSource> = {};
  const missing: string[] = [];
  for (const raw of requests) {
    const request = raw as Partial<ClipRequest>;
    const value = sanitizeClipValue(request?.value);
    const id = typeof request?.id === 'string' ? request.id : '';
    if (!id || !value?.id || sources[id]) continue;
    // A template is drawn, not decoded, so it plays as a layer on a machine with no ffmpeg;
    // a clip from a file cannot be read without one.
    const isDrawn = lookupClipItem(id)?.kind === 'drawn';
    if (!ffmpeg.ok && !isDrawn) {
      missing.push(id);
      continue;
    }
    const source = await resolveClipSource(ffmpeg.ok ? ffprobePathFor(ffmpeg.path) : '', id);
    if (!source) {
      missing.push(id);
      continue;
    }
    const read = await readClipFrames(ffmpeg.ok ? ffmpeg.path : '', id, value, source, Math.max(16, Number(request?.drawnHeight) || 120));
    if (!read.ok) {
      missing.push(id);
      continue;
    }
    sources[id] = source;
    clips.push(read.data);
  }
  return { clips, sources, missing };
}
