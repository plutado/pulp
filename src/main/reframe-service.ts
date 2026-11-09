/**
 * Auto-reframe in the main process (milestone 77): the cut's window of the
 * clip read at the small color proxy the motion tracker uses, the subject
 * found and the crop steadied in core (src/core/reframe.ts, pure), and the
 * keys handed back for the cut to keep. The window asks by library id, never
 * a path; everything stays on the machine.
 */

import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { tr } from '../core/i18n';
import { splitGrayFrames, TRACK_CHANNELS, TRACK_LIMITS, trackFramesArgs, trackProxySize } from '../core/motion-track';
import { reframeKeysFrom, steadyPath, subjectPath } from '../core/reframe';
import type { ReframeKey } from '../core/cut-track';
import { lookupMedia } from './library-service';

export interface ReframeRequest {
  clip: unknown;
  from: unknown;
  to: unknown;
  /** The frame the crop fills: its width and height, for the window's shape. */
  frame: unknown;
}

export type ReframeResult = { ok: true; keys: ReframeKey[]; shots: number; faces: number; frames: number } | { ok: false; message: string };

const REFRAME_TIMEOUT_MS = 10 * 60 * 1000;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function reframeCut(request: ReframeRequest): Promise<ReframeResult> {
  const found = typeof request.clip === 'string' ? lookupMedia(request.clip) : undefined;
  if (!found || !found.online || found.entry.sequence || found.entry.clipSet || found.entry.mediaKind !== 'video') return { ok: false, message: tr('reframe.error.no-clip') };
  const { entry } = found;
  const width = entry.meta?.width;
  const height = entry.meta?.height;
  if (!width || !height) return { ok: false, message: tr('reframe.error.unmeasured') };
  const frameRaw = typeof request.frame === 'object' && request.frame !== null ? (request.frame as Record<string, unknown>) : {};
  const frame = { width: num(frameRaw.width) ?? 1080, height: num(frameRaw.height) ?? 1920 };
  const fps = entry.meta?.fps && entry.meta.fps > 0 ? entry.meta.fps : 30;
  const status = await detectFfmpeg();
  if (!status.ok) return { ok: false, message: tr('reframe.error.no-ffmpeg') };
  const from = Math.floor(Math.max(0, num(request.from) ?? 0) * fps + 1e-6) / fps;
  let to = num(request.to) ?? (entry.meta?.duration ?? from);
  if (entry.meta?.duration !== undefined) to = Math.min(to, entry.meta.duration);
  to = Math.min(to, from + TRACK_LIMITS.samples / fps);
  if (to <= from) return { ok: false, message: tr('reframe.error.window') };
  const proxy = trackProxySize({ width, height });
  const run = await Promise.race([
    runForBuffer(status.path, trackFramesArgs(entry.path, from, to - from + 1 / fps, proxy)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(tr('reframe.error.timeout'))), REFRAME_TIMEOUT_MS)),
  ]).catch((err: Error) => ({ code: -1, stdout: Buffer.alloc(0), stderr: err.message }));
  if (run.code !== 0 || run.stdout.length < proxy.width * proxy.height * TRACK_CHANNELS) {
    return { ok: false, message: `ffmpeg exited with ${run.code}: ${run.stderr.trim().slice(-300) || 'no frames read'}` }; // i18n-exempt(diagnostic)
  }
  const frames = splitGrayFrames(new Uint8Array(run.stdout.buffer, run.stdout.byteOffset, run.stdout.byteLength), proxy.width, proxy.height, TRACK_CHANNELS);
  const path = subjectPath(frames);
  const steady = steadyPath(path, { frame, clip: { width, height }, window: Math.round(fps / 2) });
  const keys = reframeKeysFrom(steady, path.shots, from, fps);
  return { ok: true, keys, shots: path.shots.length, faces: path.points.filter((p) => p.face).length, frames: frames.frames.length };
}
