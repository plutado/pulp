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

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import type { BrowserWindow } from 'electron';
import {
  chromaKeyArgs, chromaKeyStillArgs, hasStabilizer, keyedClipPath, parseSceneCuts, passSeconds, PREVIEW_SECONDS,
  sanitizeChromaKey, sceneDetectArgs, sceneFolder, scenePattern, sceneSplitArgs, stabilizeDetectArgs,
  stabilizedClipPath, stabilizeTransformArgs, type ChromaKeySettings,
} from '../core/clip-clean';
import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { sanitizeStabilize } from '../core/clip-clean';
import { tr } from '../core/i18n';
import { lookupMedia, rescan, prepareForUse } from './library-service';
import { clipSetFile } from './clip-set-service';

/** Keying or splitting a long file decodes the whole of it; generous, but an end. */
const CLEANUP_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * The item behind a clean-up ask: an online video file, never a sequence (a folder of frames has no
 * streams to key or split). A clip set (milestone 32) is read from its set file — the parts stitched
 * once, with their sound — and what is made of it is named after the set, beside its parts, as a
 * clip's own results are beside it.
 */
async function clipFor(id: string): Promise<{ path: string; name: string; duration?: number; named: string } | null> {
  const found = lookupMedia(id);
  if (!found || !found.online || found.entry.sequence || found.entry.mediaKind !== 'video') return null;
  const { entry } = found;
  if (entry.clipSet) {
    const made = await clipSetFile(id);
    if (!made.ok) return null;
    return { path: made.path, name: entry.name, duration: made.seconds, named: join(dirname(entry.clipSet.loop), `${entry.name}${extname(entry.clipSet.loop)}`) };
  }
  return { path: entry.path, name: entry.name, named: entry.path, ...(entry.meta?.duration ? { duration: entry.meta.duration } : {}) };
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
  const clip = await clipFor(id);
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
  const clip = await clipFor(id);
  if (!clip) return { ok: false, message: tr('cleanup.not-a-clip') };
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg) return { ok: false, message: tr('cleanup.key.no-ffmpeg') };
  const settings: ChromaKeySettings = sanitizeChromaKey(rawSettings);
  const output = keyedClipPath(clip.named);
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
  const clip = await clipFor(id);
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
  const folder = sceneFolder(clip.named);
  await mkdir(folder, { recursive: true });
  try {
    const split = await run(ffmpeg, sceneSplitArgs(clip.path, cuts, join(folder, scenePattern(clip.named))));
    if (split.code !== 0) return { ok: false, message: `ffmpeg exited with ${split.code} while splitting: ${split.stderr.trim().slice(-300) || 'no error output'}` }; // i18n-exempt(diagnostic)
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  await rescan();
  return { ok: true, clips: cuts.length + 1, folder };
}

// ---------------------------------------------------------------- stabilization (milestone 78)

/** The window hears how the two passes are going through this; the main window is the only listener. */
let stabilizeProgressTo: BrowserWindow | null = null;

export function setStabilizeProgressWindow(window: BrowserWindow | null): void {
  stabilizeProgressTo = window;
}

function reportStabilize(pass: 1 | 2, fraction: number | null): void {
  if (stabilizeProgressTo && !stabilizeProgressTo.isDestroyed()) stabilizeProgressTo.webContents.send('cleanup:stabilize-progress', { pass, fraction });
}

/**
 * The run in flight, so Cancel can reach it; one stabilization at a time is
 * all the dialog offers. Made before anything is awaited, so a Stop that lands
 * while the clip is still being looked up — well before ffmpeg spawns — still
 * cancels the run rather than being lost to timing.
 */
let stabilizing: { child: ReturnType<typeof spawn> | null; cancelled: boolean } | null = null;

/**
 * One pass, streamed: stderr watched for the `time=` ffmpeg prints as it goes,
 * each sighting reported as this pass's share of the whole. Cancel kills the
 * child; the caller reads `cancelled` off the handle.
 */
function runPass(ffmpeg: string, args: string[], pass: 1 | 2, duration: number | undefined): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    if (stabilizing) stabilizing.child = child;
    else stabilizing = { child, cancelled: false };
    let stderr = '';
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      reject(new Error(tr('cleanup.timeout')));
    }, CLEANUP_TIMEOUT_MS);
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr = (stderr + text).slice(-8000);
      const at = passSeconds(text);
      if (at !== null && duration && duration > 0) {
        const within = Math.min(1, at / duration);
        reportStabilize(pass, pass === 1 ? within / 2 : 0.5 + within / 2);
      } else if (at !== null) {
        reportStabilize(pass, null);
      }
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/**
 * Whether Stabilize can run here: ffmpeg found, and built with vid.stab. Read
 * from the filter list each time the dialog opens — cheap, and true of the
 * ffmpeg actually in use, which Settings can change.
 */
export async function stabilizeStatus(): Promise<{ ok: true } | { ok: false; message: string }> {
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg) return { ok: false, message: tr('cleanup.stabilize.no-ffmpeg') };
  try {
    const filters = await run(ffmpeg, ['-hide_banner', '-filters']);
    if (filters.code === 0 && hasStabilizer(filters.stdout.toString('utf8'))) return { ok: true };
  } catch {
    // Listing failed: treated as a build without the filter, said below.
  }
  return { ok: false, message: tr('cleanup.stabilize.no-filter') };
}

/** Stop the stabilization in flight, if one is; the run itself answers with `cancelled`. */
export function cancelStabilize(): void {
  if (!stabilizing) return;
  stabilizing.cancelled = true;
  try {
    stabilizing.child?.kill();
  } catch {
    // Already gone.
  }
}

/**
 * The stabilization itself: pass one reads the motion into a transforms file
 * in the temporary folder, pass two smooths and renders the steadier clip
 * beside the original, and the library rescans so it is there to place.
 * Cancelled, it cleans up after itself and says nothing went wrong.
 */
export async function stabilizeClip(id: string, rawSettings: unknown): Promise<{ ok: true; path: string } | { ok: false; cancelled?: boolean; message: string }> {
  // The handle Cancel reaches, there from the first moment of the run (see `stabilizing`).
  stabilizing = { child: null, cancelled: false };
  // An archive's file is unpacked, and one browsed from its preview is read, the first time it is used (milestone 32).
  await prepareForUse([id]);
  const clip = await clipFor(id);
  if (!clip) return { ok: false, message: tr('cleanup.not-a-clip') };
  const ready = await stabilizeStatus();
  if (!ready.ok) return ready;
  if (stabilizing?.cancelled) {
    stabilizing = null;
    return { ok: false, cancelled: true, message: '' };
  }
  const ffmpeg = (await ffmpegPath())!;
  const settings = sanitizeStabilize(rawSettings);
  const output = stabilizedClipPath(clip.named);
  if (existsSync(output)) return { ok: false, message: tr('cleanup.stabilize.exists', { file: output.split(/[\\/]/).pop() ?? output }) };
  const transforms = join(tmpdir(), `pulp-stabilize-${process.pid}-${Date.now()}.trf`);
  const tidy = async (alsoOutput: boolean): Promise<void> => {
    await rm(transforms, { force: true }).catch(() => undefined);
    if (alsoOutput) await rm(output, { force: true }).catch(() => undefined);
  };
  try {
    reportStabilize(1, 0);
    const detect = await runPass(ffmpeg, stabilizeDetectArgs(clip.path, transforms), 1, clip.duration);
    if (stabilizing?.cancelled) {
      await tidy(true);
      return { ok: false, cancelled: true, message: '' };
    }
    if (detect.code !== 0) {
      await tidy(false);
      return { ok: false, message: `ffmpeg exited with ${detect.code} while reading the motion: ${detect.stderr.trim().slice(-300) || 'no error output'}` }; // i18n-exempt(diagnostic)
    }
    if (stabilizing?.cancelled) {
      await tidy(true);
      return { ok: false, cancelled: true, message: '' };
    }
    reportStabilize(2, 0.5);
    const made = await runPass(ffmpeg, stabilizeTransformArgs(clip.path, transforms, settings, output), 2, clip.duration);
    if (stabilizing?.cancelled) {
      await tidy(true);
      return { ok: false, cancelled: true, message: '' };
    }
    if (made.code !== 0) {
      await tidy(true);
      return { ok: false, message: `ffmpeg exited with ${made.code} while rendering: ${made.stderr.trim().slice(-300) || 'no error output'}` }; // i18n-exempt(diagnostic)
    }
  } catch (err) {
    await tidy(true);
    return { ok: false, message: (err as Error).message };
  } finally {
    stabilizing = null;
  }
  await tidy(false);
  reportStabilize(2, 1);
  await rescan();
  return { ok: true, path: output };
}
