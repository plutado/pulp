/**
 * Clip clean-up (milestone 52), the spawning half: the pure argument lists in
 * src/core/clip-clean.ts run against real files, by library id under ADR
 * 0013's rule — the window names an item, never a path.
 *
 * Both jobs write **beside the original**, inside the library folder it lives
 * in, and rescan: a keyed alpha clip as `<name> alpha.mov`, a split as clips
 * in a `<name> scenes` folder. Nothing is re-encoded for a split and nothing
 * of the original is touched for either.
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chromaKeyArgs, chromaKeyStillArgs, keyedClipPath, parseSceneCuts, PREVIEW_SECONDS, sanitizeChromaKey,
  sceneDetectArgs, sceneFolder, scenePattern, sceneSplitArgs, type ChromaKeySettings,
} from '../core/clip-clean';
import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { tr } from '../core/i18n';
import { lookupMedia, rescan, prepareForUse } from './library-service';

/** Keying or splitting a long file decodes the whole of it; generous, but an end. */
const CLEANUP_TIMEOUT_MS = 20 * 60 * 1000;

/** The item behind a clean-up ask: an online video file, never a sequence (a folder of frames has no streams to key or split). */
function clipFor(id: string): { path: string; name: string; duration?: number } | null {
  const found = lookupMedia(id);
  if (!found || !found.online || found.entry.sequence || found.entry.clipSet || found.entry.mediaKind !== 'video') return null;
  return { path: found.entry.path, name: found.entry.name, ...(found.entry.meta?.duration ? { duration: found.entry.meta.duration } : {}) };
}

async function ffmpegPath(): Promise<string | null> {
  const status = await detectFfmpeg();
  return status.ok ? status.path : null;
}

/** A run held to the clean-up budget; the caller reads the code and the tail of stderr. */
async function run(ffmpeg: string, args: string[]): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return Promise.race([
    runForBuffer(ffmpeg, args),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(tr('cleanup.timeout'))), CLEANUP_TIMEOUT_MS)),
  ]);
}

/**
 * Both frames of the key dialog: the plain frame the color is picked from,
 * and the same frame keyed with the settings as they stand — so what the
 * sliders do is seen before a long encode is asked for.
 */
export async function chromaKeyPreview(id: string, rawSettings: unknown, atSeconds: unknown): Promise<{ ok: true; plain: string; keyed: string } | { ok: false; message: string }> {
  // An archive's file is unpacked, and one browsed from its preview is read, the first time it is used (milestone 32).
  await prepareForUse([id]);
  const clip = clipFor(id);
  if (!clip) return { ok: false, message: tr('cleanup.not-a-clip') };
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg) return { ok: false, message: tr('cleanup.key.no-ffmpeg') };
  const settings = sanitizeChromaKey(rawSettings);
  // The frame asked for, held inside the clip: the playhead may have been left on a longer item.
  let at = typeof atSeconds === 'number' && Number.isFinite(atSeconds) && atSeconds >= 0 ? atSeconds : PREVIEW_SECONDS;
  if (clip.duration) at = Math.min(at, Math.max(0, clip.duration - 0.1));
  let [plain, keyed] = await Promise.all([
    run(ffmpeg, chromaKeyStillArgs(clip.path, null, at)),
    run(ffmpeg, chromaKeyStillArgs(clip.path, settings, at)),
  ]);
  if ((plain.code !== 0 || plain.stdout.length === 0) && at > 0) {
    // Past the end anyway — a clip the library has not measured: the first frame is always there.
    [plain, keyed] = await Promise.all([
      run(ffmpeg, chromaKeyStillArgs(clip.path, null, 0)),
      run(ffmpeg, chromaKeyStillArgs(clip.path, settings, 0)),
    ]);
  }
  // i18n-exempt(diagnostic): the tool's own words, or that it said none
  if (plain.code !== 0 || plain.stdout.length === 0) return { ok: false, message: tr('cleanup.key.frame-unreadable', { detail: plain.stderr.trim().slice(-200) || 'no error output' }) };
  // i18n-exempt(diagnostic)
  if (keyed.code !== 0 || keyed.stdout.length === 0) return { ok: false, message: tr('cleanup.key.key-failed', { detail: keyed.stderr.trim().slice(-200) || 'no error output' }) };
  const url = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
  return { ok: true, plain: url(plain.stdout), keyed: url(keyed.stdout) };
}

/**
 * The key itself: the whole clip rendered to an alpha clip beside the
 * original, its sound kept, and the library rescanned so it is there to place.
 */
export async function chromaKeyClip(id: string, rawSettings: unknown): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  // An archive's file is unpacked, and one browsed from its preview is read, the first time it is used (milestone 32).
  await prepareForUse([id]);
  const clip = clipFor(id);
  if (!clip) return { ok: false, message: tr('cleanup.not-a-clip') };
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg) return { ok: false, message: tr('cleanup.key.no-ffmpeg') };
  const settings: ChromaKeySettings = sanitizeChromaKey(rawSettings);
  const output = keyedClipPath(clip.path);
  if (existsSync(output)) return { ok: false, message: tr('cleanup.key.exists', { file: output.split(/[\\/]/).pop() ?? output }) };
  try {
    const made = await run(ffmpeg, chromaKeyArgs(clip.path, settings, output));
    if (made.code !== 0) return { ok: false, message: `ffmpeg exited with ${made.code}: ${made.stderr.trim().slice(-300) || 'no error output'}` }; // i18n-exempt(diagnostic)
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  await rescan();
  return { ok: true, path: output };
}

/**
 * Scene detection: the cuts found, the file stream-copied into one clip per
 * scene in a folder beside it, and the library rescanned. A file with no cuts
 * is said rather than split into one piece.
 */
export async function splitScenes(id: string): Promise<{ ok: true; clips: number; folder: string } | { ok: false; message: string }> {
  // An archive's file is unpacked, and one browsed from its preview is read, the first time it is used (milestone 32).
  await prepareForUse([id]);
  const clip = clipFor(id);
  if (!clip) return { ok: false, message: tr('cleanup.not-a-clip') };
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg) return { ok: false, message: tr('cleanup.split.no-ffmpeg') };
  let cuts: number[];
  try {
    const detect = await run(ffmpeg, sceneDetectArgs(clip.path));
    if (detect.code !== 0) return { ok: false, message: `ffmpeg exited with ${detect.code} while looking for cuts: ${detect.stderr.trim().slice(-300) || 'no error output'}` }; // i18n-exempt(diagnostic)
    cuts = parseSceneCuts(detect.stderr);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  if (cuts.length === 0) return { ok: false, message: tr('cleanup.split.no-cuts') };
  const folder = sceneFolder(clip.path);
  await mkdir(folder, { recursive: true });
  try {
    const split = await run(ffmpeg, sceneSplitArgs(clip.path, cuts, join(folder, scenePattern(clip.path))));
    if (split.code !== 0) return { ok: false, message: `ffmpeg exited with ${split.code} while splitting: ${split.stderr.trim().slice(-300) || 'no error output'}` }; // i18n-exempt(diagnostic)
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  await rescan();
  return { ok: true, clips: cuts.length + 1, folder };
}
