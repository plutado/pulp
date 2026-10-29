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
import { clipProxySize, clipWindow, sanitizeClipValue, type ClipSource, type ClipValue } from '../core/video-layer';
import type { MediaEntry } from '../core/library-types';
import { lookupMedia } from './library-service';

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
  if (!meta?.fps || !meta.duration) return null;
  return { frames: Math.max(1, Math.round(meta.duration * meta.fps)), fps: meta.fps };
}

/** What the library knows about a clip's own timing, or null when it cannot be used as one or has not been read. */
export function clipSourceFor(id: string): ClipSource | null {
  const found = lookupMedia(id);
  if (!found || !found.online || found.entry.kind !== 'media' || found.entry.mediaKind !== 'video') return null;
  return sourceFromEntry(found.entry);
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
  const found = lookupMedia(id);
  if (!found || !found.online || found.entry.kind !== 'media' || found.entry.mediaKind !== 'video') return null;
  const known = sourceFromEntry(found.entry);
  if (known) return known;
  const meta = await probeMedia(ffprobePath, found.entry.path, nodeRunner);
  if (!meta) return null;
  return sourceFromEntry(found.entry, meta);
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
    const found = lookupMedia(id);
    return { id, size: found?.entry.size ?? 0, mtimeMs: found?.entry.mtimeMs ?? 0 };
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
export function clipFramesArgs(entry: MediaEntry, source: ClipSource, window: { first: number; frames: number }, maxSide: number): string[] {
  const side = Math.max(16, Math.min(MAX_CLIP_FRAME_SIDE, Math.round(maxSide)));
  const scale = `scale=w='min(iw,${side})':h='min(ih,${side})':force_original_aspect_ratio=decrease`;
  const input = entry.sequence
    ? ['-start_number', String(entry.sequence.start + window.first), '-framerate', String(source.fps), '-i', join(entry.sequence.dir, sequencePatternName(entry.sequence))]
    : ['-ss', (window.first / Math.max(1, source.fps)).toFixed(6), '-i', entry.path];
  return [
    '-v', 'error', '-nostdin',
    ...input,
    '-frames:v', String(window.frames),
    '-an', '-vf', `${scale},format=rgba`,
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
): Promise<{ ok: true; data: ClipFrameData } | { ok: false; message: string }> {
  const found = lookupMedia(id);
  if (!found) return { ok: false, message: 'is not a clip in the library' };
  const window = clipWindow(value, source);
  if (window.frames === 0) return { ok: false, message: 'has no frames' };
  if (window.frames > MAX_CLIP_FRAMES) {
    const seconds = Math.round(MAX_CLIP_FRAMES / Math.max(1, source.fps));
    return { ok: false, message: `plays ${window.frames} frames, more than the ${MAX_CLIP_FRAMES} a layer may hold (about ${seconds} s); set an in and out point` };
  }
  // Twice the drawn height, rounded up to a proxy step: sharp enough for a scaled or rotated
  // layer, and stable while a window is resized, so nothing is decoded twice for a few pixels.
  const side = clipProxySize(drawnHeight * 2);
  const key = `${id}|${found.entry.size}|${found.entry.mtimeMs}|${window.first}|${window.frames}|${side}`;
  const cached = cacheTake(key);
  if (cached) return { ok: true, data: cached };
  const args = clipFramesArgs(found.entry, source, window, side);
  const result = await runForBuffer(ffmpegPath, args);
  if (result.code !== 0) return { ok: false, message: `ffmpeg exited with ${result.code}: ${result.stderr.trim() || 'no error output'}` };
  const frames = splitPngStream(result.stdout);
  if (frames.length === 0) return { ok: false, message: 'ffmpeg decoded no frames from it' };
  const data: ClipFrameData = { id, kind: 'clip', srcs: frames.map((f) => `data:image/png;base64,${f.toString('base64')}`) };
  cachePut(key, data);
  return { ok: true, data };
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
  if (!ffmpeg.ok) return { clips, sources, missing: requests.map((r) => String((r as ClipRequest)?.id ?? '')) };
  for (const raw of requests) {
    const request = raw as Partial<ClipRequest>;
    const value = sanitizeClipValue(request?.value);
    const id = typeof request?.id === 'string' ? request.id : '';
    if (!id || !value?.id || sources[id]) continue;
    const source = await resolveClipSource(ffprobePathFor(ffmpeg.path), id);
    if (!source) {
      missing.push(id);
      continue;
    }
    const read = await readClipFrames(ffmpeg.path, id, value, source, Math.max(16, Number(request?.drawnHeight) || 120));
    if (!read.ok) {
      missing.push(id);
      continue;
    }
    sources[id] = source;
    clips.push(read.data);
  }
  return { clips, sources, missing };
}
