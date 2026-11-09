/**
 * Motion tracking in the main process (milestone 76): the frames a track is
 * run over, read from the clip's file by ffmpeg at a small color proxy, and the
 * tracker run over them (src/core/motion-track.ts, pure). The window asks by
 * library id, never a path, and gets the samples back in the clip's own
 * seconds and picture fractions. Everything stays on the machine.
 */

import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { tr } from '../core/i18n';
import {
  POINT_PATCH_FRACTION, samplesFromPoints, splitGrayFrames, TRACK_CHANNELS, TRACK_LIMITS, trackFramesArgs, trackPatch, trackProxySize,
  type TrackKind, type TrackSample,
} from '../core/motion-track';
import { lookupMedia } from './library-service';

export interface TrackMotionRequest {
  /** The library clip, and the window of its file to track within, in seconds. */
  clip: unknown;
  from: unknown;
  to: unknown;
  /** The clip second the target was picked on, and where, as fractions of the clip's picture. */
  at: unknown;
  x: unknown;
  y: unknown;
  kind: unknown;
  /** A box's size as fractions of the picture; a point has its own. */
  size?: unknown;
  /** Follow forward from `at` (default) and back to `from` (default); re-tracking from a fixed frame goes forward only. */
  forward?: unknown;
  backward?: unknown;
}

export type TrackMotionResult =
  | { ok: true; samples: TrackSample[]; fps: number; from: number; to: number; size: { w: number; h: number }; kind: TrackKind; frames: number }
  | { ok: false; message: string };

const TRACK_TIMEOUT_MS = 10 * 60 * 1000;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function trackMotion(request: TrackMotionRequest): Promise<TrackMotionResult> {
  const found = typeof request.clip === 'string' ? lookupMedia(request.clip) : undefined;
  if (!found || !found.online || found.entry.sequence || found.entry.clipSet || found.entry.mediaKind !== 'video') return { ok: false, message: tr('track.error.no-clip') };
  const { entry } = found;
  const width = entry.meta?.width;
  const height = entry.meta?.height;
  if (!width || !height) return { ok: false, message: tr('track.error.unmeasured') };
  const fps = entry.meta?.fps && entry.meta.fps > 0 ? entry.meta.fps : 30;
  const status = await detectFfmpeg();
  if (!status.ok) return { ok: false, message: tr('track.error.no-ffmpeg') };

  // On the clip's own frame grid: the samples then fall on the frames the stage shows, and a
  // track picked up again from a frame lands back on the same grid as the frames before it.
  const from = Math.floor(Math.max(0, num(request.from) ?? 0) * fps + 1e-6) / fps;
  const duration = entry.meta?.duration;
  let to = num(request.to) ?? (duration ?? from);
  if (duration !== undefined) to = Math.min(to, duration);
  // Held to the samples a track may carry, from where the tracking starts.
  to = Math.min(to, from + TRACK_LIMITS.samples / fps);
  if (to <= from) return { ok: false, message: tr('track.error.window') };
  const at = Math.min(to, Math.max(from, num(request.at) ?? from));
  const x = Math.min(1, Math.max(0, num(request.x) ?? 0.5));
  const y = Math.min(1, Math.max(0, num(request.y) ?? 0.5));
  const kind: TrackKind = request.kind === 'box' ? 'box' : 'point';
  const sizeRaw = typeof request.size === 'object' && request.size !== null ? (request.size as Record<string, unknown>) : {};
  const size = kind === 'box'
    ? { w: Math.min(1, Math.max(TRACK_LIMITS.size.min, num(sizeRaw.w) ?? 0.1)), h: Math.min(1, Math.max(TRACK_LIMITS.size.min, num(sizeRaw.h) ?? 0.1)) }
    : { w: POINT_PATCH_FRACTION, h: (POINT_PATCH_FRACTION * width) / height };

  const proxy = trackProxySize({ width, height });
  // One frame more than the window, so the last frame of the window is there whatever the rounding.
  const seconds = to - from + 1 / fps;
  const run = await Promise.race([
    runForBuffer(status.path, trackFramesArgs(entry.path, from, seconds, proxy)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(tr('track.error.timeout'))), TRACK_TIMEOUT_MS)),
  ]).catch((err: Error) => ({ code: -1, stdout: Buffer.alloc(0), stderr: err.message }));
  if (run.code !== 0 || run.stdout.length < proxy.width * proxy.height * TRACK_CHANNELS) {
    return { ok: false, message: `ffmpeg exited with ${run.code}: ${run.stderr.trim().slice(-300) || 'no frames read'}` }; // i18n-exempt(diagnostic)
  }
  const frames = splitGrayFrames(new Uint8Array(run.stdout.buffer, run.stdout.byteOffset, run.stdout.byteLength), proxy.width, proxy.height, TRACK_CHANNELS);
  const startIndex = Math.min(frames.frames.length - 1, Math.max(0, Math.round((at - from) * fps)));
  const odd = (n: number): number => Math.max(3, Math.round(n) | 1);
  const patch = { w: odd(size.w * proxy.width), h: odd(size.h * proxy.height) };
  const points = trackPatch(frames, { index: startIndex, x: x * proxy.width, y: y * proxy.height }, {
    patch,
    // How far a frame may carry the target past where its motion says: a tenth of the picture, at least the patch.
    radius: Math.max(12, Math.round(proxy.width * 0.1), Math.max(patch.w, patch.h)),
    forward: request.forward !== false,
    backward: request.backward !== false,
  });
  const samples = samplesFromPoints(points, frames, from, fps).filter((s) => s.at <= to + 1e-6);
  return { ok: true, samples, fps, from, to: Math.round(to * 1000) / 1000, size, kind, frames: frames.frames.length };
}
