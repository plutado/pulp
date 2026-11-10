/**
 * The flash warning in the main process (milestone 84): a finished render read
 * back and checked, and its strong moments calmed into a file of its own that
 * the person sees before anything is written over.
 *
 * The rule and the graph are pure (src/core/flash.ts). This runs ffmpeg over
 * the render's own file: read back at the grid for the check, and for the
 * softening written whole to a scratch file beside the render, checked again,
 * with a still of the worst moment before and after — and only then kept as a
 * copy, put in the render's place, or thrown away, as the person chooses.
 */

import { existsSync } from 'node:fs';
import { copyFile, rename, rm } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { nodeRunner, runForBuffer } from '../core/ffmpeg';
import { canSoften, detectFlashes, flashFramesArgs, softenArgs, softenedCopyPath, softenWindows, splitGridFrames, type FlashInput, type FlashReport, type FlashSpan } from '../core/flash';
import { alphaDecoderFor } from '../core/media-meta';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import { matteCodecArgs, matteFilters, matteOutputPath, OUTPUT_PRESETS, type PresetId } from '../core/render-plan';

/** A finished render, as the check needs to know it. */
export interface FlashTarget {
  /** The file, or a sequence's pattern (`name_%05d.png`). */
  output: string;
  presetId: string;
  /** The render's rate, and where a sequence's numbering starts. */
  fps: number;
  firstFrame: number;
  /** How many frames the render wrote, so a file read back short is known for what it is. */
  frames: number;
}

/** The check's answer: what it found, or why it could not look. */
export type FlashCheck = { ok: true; report: FlashReport } | { ok: false; reason: 'unreadable' | 'still' | 'sound' | 'failed'; detail?: string };

const CHECK_TIMEOUT_MS = 10 * 60 * 1000;

/** How the render's file is opened: a sequence by its pattern, a file through the decoder its alpha needs. */
async function inputFor(ffmpegPath: string, target: FlashTarget): Promise<FlashInput> {
  if (OUTPUT_PRESETS[target.presetId as PresetId]?.sequence) return { pattern: target.output, start: target.firstFrame };
  // A WebM with alpha keeps it in a stream ffmpeg's own VP9 decoder leaves out (milestone 32).
  const meta = target.presetId === 'webm-vp9-alpha' ? await probeMedia(ffprobePathFor(ffmpegPath), target.output, nodeRunner) : null;
  const decoder = alphaDecoderFor(meta ?? undefined);
  return { file: target.output, ...(decoder ? { decoder } : {}) };
}

/**
 * Read a finished render back and check it. A still and a sound have nothing
 * to flash; a file read back with far fewer frames than were written — an
 * animated WebP, which ffmpeg reads only the first frame of — could not be
 * checked, and says so rather than passing.
 */
export async function checkRender(ffmpegPath: string, target: FlashTarget): Promise<FlashCheck> {
  const preset = OUTPUT_PRESETS[target.presetId as PresetId];
  if (!preset) return { ok: false, reason: 'sound' }; // i18n-exempt(technical): a reason's code, worded by the card
  if (preset.still) return { ok: false, reason: 'still' }; // i18n-exempt(technical): a reason's code
  const input = await inputFor(ffmpegPath, target);
  const run = await Promise.race([
    runForBuffer(ffmpegPath, flashFramesArgs(input, target.fps)),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS)),
  ]).catch(() => null);
  if (!run || run.code !== 0) return { ok: false, reason: 'failed', detail: run?.stderr.trim().slice(-300) }; // i18n-exempt(technical): a reason's code
  const frames = splitGridFrames(new Uint8Array(run.stdout.buffer, run.stdout.byteOffset, run.stdout.byteLength));
  if (frames.length < Math.max(2, Math.floor(target.frames / 2))) return { ok: false, reason: 'unreadable' }; // i18n-exempt(technical): a reason's code
  return { ok: true, report: detectFlashes(frames, target.fps) };
}

/** A softened render waiting on the person's choice: the scratch file, what it was checked to be, and the stills. */
export interface SoftenedDraft {
  draft: string;
  recheck: FlashReport;
  /** The worst moment's middle, in seconds of the file, and a still of it before and after, as PNG data URLs. */
  at: number;
  before: string;
  after: string;
}

export type SoftenResult = { ok: true; draft: SoftenedDraft } | { ok: false; message: string };

/** A still of one moment of a file, small, as a PNG data URL; empty when it cannot be read. */
async function still(ffmpegPath: string, input: { file: string; decoder?: string }, at: number): Promise<string> {
  const run = await runForBuffer(ffmpegPath, [
    '-v', 'error', '-nostdin', ...(input.decoder ? ['-c:v', input.decoder] : []), '-ss', String(at), '-i', input.file,
    '-frames:v', '1', '-vf', "scale='min(iw,480)':-2,format=rgba", '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
  ]).catch(() => null);
  return run && run.code === 0 && run.stdout.length > 0 ? `data:image/png;base64,${run.stdout.toString('base64')}` : '';
}

/** The scratch name a draft is written to: beside the render, so keeping it is a rename on the same drive. */
export function draftPathFor(output: string): string {
  return join(dirname(output), `.${basename(output)}.softening${output.slice(output.lastIndexOf('.'))}`);
}

/**
 * Calm a checked render's strong moments into a draft beside it, check the
 * draft again, and take a still of the worst moment before and after. Nothing
 * of the render is touched: the draft is the person's to keep or throw away.
 */
export async function softenRender(ffmpegPath: string, target: FlashTarget, spans: readonly FlashSpan[]): Promise<SoftenResult> {
  if (!canSoften(target.presetId)) return { ok: false, message: 'not a video file' }; // i18n-exempt(diagnostic): the window offers it only for video
  if (spans.length === 0) return { ok: false, message: 'nothing to soften' }; // i18n-exempt(diagnostic)
  const input = await inputFor(ffmpegPath, target);
  if ('pattern' in input) return { ok: false, message: 'not a video file' }; // i18n-exempt(diagnostic)
  const duration = target.frames / target.fps;
  const draft = draftPathFor(target.output);
  const run = await runForBuffer(ffmpegPath, softenArgs(input, target.presetId, softenWindows(spans, duration), target.fps, draft)).catch((err: Error) => ({ code: -1, stdout: Buffer.alloc(0), stderr: err.message }));
  if (run.code !== 0) {
    await rm(draft, { force: true });
    return { ok: false, message: `ffmpeg exited with ${run.code}: ${run.stderr.trim().slice(-300) || 'no error output'}` }; // i18n-exempt(diagnostic)
  }
  const checked = await checkRender(ffmpegPath, { ...target, output: draft });
  if (!checked.ok) {
    await rm(draft, { force: true });
    return { ok: false, message: `the softened file could not be checked (${checked.reason})` }; // i18n-exempt(diagnostic)
  }
  const worst = [...spans].sort((a, b) => b.perSecond - a.perSecond || (b.to - b.from) - (a.to - a.from))[0]!;
  // The middle of the worst moment: the most flashes a second, the longest of those.
  const at = Math.round(((worst.from + worst.to) / 2) * target.fps) / target.fps;
  const [before, after] = await Promise.all([still(ffmpegPath, input, at), still(ffmpegPath, { ...input, file: draft }, at)]);
  return { ok: true, draft: { draft, recheck: checked.report, at, before, after } };
}

/**
 * The person's choice for a draft: kept as a copy beside the render (never
 * over anything), put in the render's place, or thrown away. A render with a
 * matte beside it gets a matte made again from the kept picture, so the two
 * still agree. Answers the file now holding the softened picture.
 */
export async function keepSoftened(ffmpegPath: string, target: FlashTarget, draft: string, choice: 'copy' | 'replace' | 'discard'): Promise<{ ok: true; file?: string } | { ok: false; message: string }> {
  if (choice === 'discard' || !existsSync(draft)) {
    await rm(draft, { force: true });
    return { ok: true };
  }
  const preset = OUTPUT_PRESETS[target.presetId as PresetId]!;
  const file = choice === 'replace' ? target.output : softenedCopyPath(target.output, existsSync);
  try {
    await rename(draft, file);
  } catch {
    // Another drive, or a name Windows holds open: copied, then the draft let go.
    await copyFile(draft, file);
    await rm(draft, { force: true });
  }
  const matte = matteOutputPath(target.output, preset);
  if (existsSync(matte)) {
    const into = choice === 'replace' ? matte : matteOutputPath(file, preset);
    const run = await runForBuffer(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', file, '-map', '0:v:0', '-vf', matteFilters(preset), ...matteCodecArgs(preset), into]).catch(() => null);
    if (!run || run.code !== 0) return { ok: false, message: `the matte could not be made again: ${run?.stderr.trim().slice(-300) ?? 'ffmpeg did not run'}` }; // i18n-exempt(diagnostic)
  }
  return { ok: true, file };
}
