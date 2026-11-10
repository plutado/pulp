/**
 * Rendering a library item in the main process (milestone 15): what the pure
 * planner (src/core/media-render.ts) needs to know about the item is gathered
 * here — its measured facts, probed now if the library has not yet — and its
 * stages are run one after another with ffmpeg, progress read off `-progress`,
 * a cancel killing the stage in flight, and the scratch folder cleaned up.
 *
 * A layered Photoshop file renders as the picture it was collected as: its
 * composite with the collected hidden layers left out, written to the scratch
 * folder as a PNG and rendered as a still.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { detectFfmpeg, runForBuffer, type FfmpegStatus } from '../core/ffmpeg';
import { canTonemap } from './hdr-service';
import { clipSetLayersStitchArgs, stitchHasSound } from '../core/clip-set';
import { stitchLayersFor } from './clip-set-service';
import { tr } from '../core/i18n';
import { sanitizePsdChoice } from '../core/image-slot';
import type { MediaEntry } from '../core/library-types';
import { AUDIO_PRESETS, buildMediaRenderPlan, DEFAULT_MEDIA_FPS, isAudioPresetId, MediaNotMeasuredError, parseProgressLine, sourceFromEntry, type MediaRenderPlan, type MediaSource } from '../core/media-render';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import { sequenceMetadata, sequencePatternName } from '../core/media-sequence';
import { coverOutputPath, OUTPUT_PRESETS, RenderPlanError, type PresetId, type RenderOptions } from '../core/render-plan';
import { presetUnavailableReason } from '../core/ffmpeg-presets';
import { nodeRunner } from '../core/ffmpeg';
import type { RenderProgress, RenderResult } from '../shared/api';
import { isLayeredPath, layeredFileFor } from './layered-service';
import { finishedFileWarnings } from './platform-check';
import { lookupMedia, probeClipSet } from './library-service';
import { soundIdsFor } from '../core/music-groups';

export interface MediaRenderJob {
  entry: MediaEntry;
  /** A layered still's collected hidden layers travel in `params.psd` (milestone 33). */
  params: Record<string, unknown>;
  presetId: string;
  outputPath: string;
  options?: RenderOptions;
  overwrite?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}

/** What the planner needs to know about an item: the library's measurements, or a probe now; a layered file as its collected composite. */
export async function mediaSourceFor(entry: MediaEntry, ffmpeg: FfmpegStatus & { ok: true }, scratchDir?: string, params: Record<string, unknown> = {}, target?: { width?: number; height?: number }, options: RenderOptions = {}): Promise<MediaSource> {
  if (entry.clipSet) return clipSetSource(entry, ffmpeg, scratchDir, options);
  // A track in several lengths renders the cut that fits the length asked (milestone 32).
  if (entry.versions && entry.versions.length > 0) {
    // Each cut measured, on the spot where the library has not yet, so the pick is by real lengths.
    const lengths = new Map(await Promise.all(entry.versions.map(async (v) => {
      const cut = lookupMedia(v.id)?.entry;
      const seconds = cut?.meta?.duration ?? (cut ? (await probeMedia(ffprobePathFor(ffmpeg.path), cut.path, nodeRunner))?.duration : undefined);
      return [v.id, seconds] as const;
    })));
    const pick = soundIdsFor(entry, options.length, (id) => ({ meta: { duration: lengths.get(id) } }));
    const cut = lookupMedia(pick.id)?.entry;
    if (cut) return mediaSourceFor(cut, ffmpeg, scratchDir, params, target, options);
  }
  // A song's stems render as their mix, every stem at full gain.
  if (entry.stemParts && entry.stemParts.length > 0) return stemsSource(entry, ffmpeg, scratchDir);
  // A clip with no sound of its own carries the sound made for it.
  if (entry.pairedSound && entry.mediaKind === 'video') {
    const own = await mediaSourceFor({ ...entry, pairedSound: undefined } as MediaEntry, ffmpeg, scratchDir, params, target, options);
    const paired = lookupMedia(entry.pairedSound)?.entry;
    if (own.hasAudio || !paired || !('path' in own.input)) return own;
    if (!scratchDir) return { ...own, hasAudio: true };
    // The source's own container family: QuickTime codecs (Animation, ProRes) need QuickTime's.
    const muxed = join(scratchDir, /\.(webm|mkv)$/i.test(own.input.path) ? 'with-sound.mkv' : 'with-sound.mov');
    const run = await runForBuffer(ffmpeg.path, ['-v', 'error', '-nostdin', '-i', own.input.path, '-i', paired.path, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-af', 'apad', '-shortest', '-y', muxed]);
    if (run.code !== 0) return own;
    return { ...own, input: { path: muxed }, hasAudio: true };
  }
  if (isLayeredPath(entry.path)) {
    const read = await layeredFileFor(entry.path);
    if (!read.ok) throw new RenderPlanError(tr('render.media.layered-unreadable', { reason: read.message }));
    const { width, height } = read.handle.outline;
    if (!scratchDir) {
      // Planned, not run: the size is all that is needed.
      return { kind: 'image', input: { path: entry.path }, width, height, alpha: true, hasAudio: false };
    }
    // The composite as collected, as a still in the scratch folder. A vector format is drawn at the
    // render's own size — never below its own — so the picture stays sharp at any output (milestone 33).
    const hide = sanitizePsdChoice((params as { psd?: unknown }).psd)?.hide;
    const vector = /\.(svg|ai|pdf)$/i.test(entry.path);
    const scale = vector && target ? Math.max(1, (target.width ?? 0) / width, (target.height ?? 0) / height) : 1;
    const still = join(scratchDir, 'composite.png');
    await writeFile(still, await read.handle.composite(hide, scale));
    return { kind: 'image', input: { path: still }, width: Math.round(width * scale), height: Math.round(height * scale), alpha: true, hasAudio: false };
  }
  let measured = entry;
  if (!entry.meta) {
    const probed = await probeMedia(ffprobePathFor(ffmpeg.path), entry.path, nodeRunner);
    if (probed) measured = { ...entry, meta: entry.sequence ? (sequenceMetadata(probed, entry.sequence) ?? probed) : probed };
  }
  const source = sourceFromEntry(measured);
  if ('pattern' in source.input && entry.sequence) source.input = { ...source.input, pattern: join(entry.sequence.dir, sequencePatternName(entry.sequence)) };
  return source;
}

/**
 * A clip set as a source (milestone 32): its parts stitched to the length asked — the intro once,
 * the loop repeated, the outro at the end — so the render that follows plays one clip that is
 * already as long as it should be, and never loops or crossfades it again. Planned, it is only
 * measured; rendered, it is written into the render's scratch folder as ProRes 4444, alpha kept.
 * Speed applies after, so the parts are stitched to the length the speed will bring to the one asked.
 */
async function clipSetSource(entry: MediaEntry, ffmpeg: FfmpegStatus & { ok: true }, scratchDir: string | undefined, options: RenderOptions): Promise<MediaSource> {
  const meta = entry.meta?.parts ? entry.meta : await probeClipSet(ffprobePathFor(ffmpeg.path), entry);
  if (!meta?.parts || !meta.width || !meta.height) throw new MediaNotMeasuredError(tr('media-render.error.not-measured.length'));
  const fps = meta.fps ?? DEFAULT_MEDIA_FPS;
  const measured = sourceFromEntry({ ...entry, meta }, options);
  const length = measured.duration!;
  if (!scratchDir) return measured;
  const stitched = join(scratchDir, 'clip-set.mov');
  // A set of several layers (milestone 32) is stitched layer by layer and composited, its parts'
  // sounds with it: the render that follows hears the set as it plays.
  const layers = stitchLayersFor(entry, meta);
  const sound = stitchHasSound(layers);
  const args = [...clipSetLayersStitchArgs(layers, length, { fps, width: meta.width, height: meta.height }, true), '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', ...(sound ? ['-c:a', 'pcm_s16le'] : []), '-y', stitched];
  const run = await runForBuffer(ffmpeg.path, args);
  if (run.code !== 0) throw new RenderPlanError(tr('render.media.clip-set-failed', { reason: run.stderr.trim().split('\n').slice(-3).join(' ') }));
  return { ...measured, input: { path: stitched }, hasAudio: sound };
}

/** A song's stems as one sound: mixed in the render's scratch folder, each at full gain. */
async function stemsSource(entry: MediaEntry, ffmpeg: FfmpegStatus & { ok: true }, scratchDir: string | undefined): Promise<MediaSource> {
  const stems = entry.stemParts!.map((s) => lookupMedia(s.id)?.entry).filter((e): e is MediaEntry => e !== undefined);
  if (stems.length === 0) throw new RenderPlanError(tr('render.media.stems-missing'));
  // Measured on the spot where the library's own pass has not reached them yet, as any clip is.
  const lengths = await Promise.all(stems.map(async (s) => s.meta?.duration ?? (await probeMedia(ffprobePathFor(ffmpeg.path), s.path, nodeRunner))?.duration ?? 0));
  const longest = Math.max(...lengths);
  const measured: MediaSource = { kind: 'audio', input: { path: stems[0]!.path }, ...(longest > 0 ? { duration: longest } : {}), alpha: false, hasAudio: true };
  if (!scratchDir) return measured;
  const mixed = join(scratchDir, 'stems.wav');
  const run = await runForBuffer(ffmpeg.path, [
    '-v', 'error', '-nostdin', ...stems.flatMap((s) => ['-i', s.path]),
    '-filter_complex', `${stems.map((_, i) => `[${i}:a]`).join('')}amix=inputs=${stems.length}:duration=longest:normalize=0[mix]`,
    '-map', '[mix]', '-c:a', 'pcm_s24le', '-y', mixed,
  ]);
  if (run.code !== 0) throw new RenderPlanError(tr('render.media.stems-failed', { reason: run.stderr.trim().split('\n').slice(-2).join(' ') }));
  return { ...measured, input: { path: mixed } };
}

/** The planner's answer for an item without running anything: what the Output tab and the queue validate with. */
export async function planMediaRender(entry: MediaEntry, presetId: string, options: RenderOptions | undefined, params: Record<string, unknown>, outputPath: string): Promise<{ ok: true; plan: MediaRenderPlan } | { ok: false; message: string }> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };
  try {
    // A scratch folder is named but not made: the plan only has to know one would exist.
    const source = await mediaSourceFor(entry, ffmpeg, undefined, params, undefined, options);
    const plan = buildMediaRenderPlan({ source, presetId, outputPath, options, scratchDir: join(tmpdir(), 'pulp-media'), tonemap: await canTonemap(ffmpeg.path) });
    return { ok: true, plan };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Why this build of ffmpeg cannot write the preset, or null. */
function encoderProblem(ffmpeg: FfmpegStatus & { ok: true }, presetId: string): string | null {
  if (isAudioPresetId(presetId)) {
    const preset = AUDIO_PRESETS[presetId];
    return preset.encoder.startsWith('pcm') || ffmpeg.encoders.includes(preset.encoder) ? null : tr('render.media.encoder-missing', { preset: preset.label, encoder: preset.encoder });
  }
  const preset = OUTPUT_PRESETS[presetId as PresetId];
  if (!preset) return tr('render.media.unknown-preset', { preset: presetId });
  return presetUnavailableReason(ffmpeg.encoders, preset);
}

async function runStage(ffmpegPath: string, args: string[], job: MediaRenderJob, onFrame: (frame: number | undefined, seconds: number | undefined) => void): Promise<{ code: number | null; stderr: string }> {
  const child: ChildProcess = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-8000);
  });
  if (child.stdout) {
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const p = parseProgressLine(line);
      if (p.frame !== undefined || p.seconds !== undefined) onFrame(p.frame, p.seconds);
    });
  }
  const abort = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  job.signal?.addEventListener('abort', abort, { once: true });
  try {
    const [code] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
    return { code, stderr };
  } finally {
    job.signal?.removeEventListener('abort', abort);
  }
}

export async function renderMedia(job: MediaRenderJob): Promise<RenderResult> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };
  const problem = encoderProblem(ffmpeg, job.presetId);
  if (problem) return { ok: false, message: problem };
  const scratch = await mkdtemp(join(tmpdir(), 'pulp-media-'));
  try {
    const source = await mediaSourceFor(job.entry, ffmpeg, scratch, job.params, { ...(job.options?.width ? { width: job.options.width } : {}), ...(job.options?.height ? { height: job.options.height } : {}) }, job.options);
    const plan = buildMediaRenderPlan({ source, presetId: job.presetId, outputPath: job.outputPath, options: job.options, overwrite: job.overwrite, scratchDir: scratch, tonemap: await canTonemap(ffmpeg.path) });
    await mkdir(dirname(plan.output), { recursive: true });
    const total = plan.timing.totalFrames;
    for (let i = 0; i < plan.stages.length; i += 1) {
      if (job.signal?.aborted) return { ok: false, cancelled: true, message: tr('render.canceled') };
      const stage = plan.stages[i]!;
      const last = i === plan.stages.length - 1;
      const { code, stderr } = await runStage(ffmpeg.path, stage.args, job, (frame, seconds) => {
        if (!last) return;
        // ffmpeg counts the frames it writes, which an animated image at a lower rate has fewer of (milestone 82).
        const written = plan.image ? plan.timing.fps / plan.image.fps : 1;
        const done = frame !== undefined && plan.kind === 'video' ? Math.round(frame * written) : seconds !== undefined ? Math.round(seconds * plan.timing.fps) : undefined;
        if (done !== undefined) job.onProgress?.({ frame: Math.min(total, done), totalFrames: total });
      });
      if (job.signal?.aborted) {
        await Promise.all([plan.output, plan.matteOutput].filter((f): f is string => !!f && !/%0?\d*d/.test(f)).map((f) => rm(f, { force: true })));
        return { ok: false, cancelled: true, message: tr('render.canceled') };
      }
      if (code !== 0) return { ok: false, message: `ffmpeg exited with code ${code}${last ? '' : ' while making the loop unit'}: ${stderr.trim() || 'no error output'}` }; // i18n-exempt(diagnostic)
    }
    job.onProgress?.({ frame: total, totalFrames: total });

    // The cover image (milestone 20): one frame of the clip beside the render, at the same size,
    // written through the still-image preset. A cover that cannot be written is said rather than
    // throwing the render away with it.
    const warnings = [...plan.warnings];
    let cover: string | undefined;
    if (job.options?.coverFrame !== undefined) {
      const written = await writeMediaCover(ffmpeg.path, source, job, plan.output);
      if (written.ok) cover = written.output;
      else warnings.push(tr('render.warning.cover', { reason: written.message }));
    }
    // The platform's limits against the file that was written (milestone 20), not the one planned.
    warnings.push(...(await finishedFileWarnings({
      platform: job.options?.platform,
      output: plan.output,
      seconds: total / plan.timing.fps,
      sequence: /%0?\d*d/.test(plan.output),
    })));
    return {
      ok: true, output: plan.output, frames: total, warnings,
      transport: plan.stages.length > 1 ? 'ffmpeg (loop unit, then stream loop)' : 'ffmpeg', // i18n-exempt(diagnostic)
      ...(cover ? { cover } : {}),
    };
  } catch (err) {
    return { ok: false, message: err instanceof RenderPlanError ? err.message : tr('render.failed', { reason: (err as Error).message }) };
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * One frame of a clip beside its render (milestone 20): the still-image preset
 * at the cover's frame and the render's own size, so the thumbnail matches the
 * picture it stands for. The matte and the trim are left behind — a cover is
 * one frame, and which one is the cover's own setting.
 */
async function writeMediaCover(
  ffmpegPath: string,
  source: MediaSource,
  job: MediaRenderJob,
  output: string,
): Promise<{ ok: true; output: string } | { ok: false; message: string }> {
  try {
    const { matte, outFrame, ...rest } = job.options ?? {};
    void matte;
    void outFrame;
    const plan = buildMediaRenderPlan({
      source,
      presetId: 'png-still',
      outputPath: coverOutputPath(output),
      options: { ...rest, inFrame: job.options?.coverFrame },
      overwrite: true,
    });
    for (const stage of plan.stages) {
      const result = await nodeRunner(ffmpegPath, stage.args);
      if (result.code !== 0) return { ok: false, message: `ffmpeg exited with ${result.code}: ${result.stderr.trim() || 'no error output'}` }; // i18n-exempt(diagnostic)
    }
    return { ok: true, output: plan.output };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
