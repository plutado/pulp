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
import { detectFfmpeg, type FfmpegStatus } from '../core/ffmpeg';
import { sanitizePsdChoice } from '../core/image-slot';
import type { MediaEntry } from '../core/library-types';
import { AUDIO_PRESETS, buildMediaRenderPlan, isAudioPresetId, parseProgressLine, sourceFromEntry, type MediaRenderPlan, type MediaSource } from '../core/media-render';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import { sequenceMetadata, sequencePatternName } from '../core/media-sequence';
import { OUTPUT_PRESETS, RenderPlanError, type PresetId, type RenderOptions } from '../core/render-plan';
import { presetUnavailableReason } from '../core/ffmpeg-presets';
import { nodeRunner } from '../core/ffmpeg';
import type { RenderProgress, RenderResult } from '../shared/api';
import { isLayeredPath, layeredFileFor } from './layered-service';

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
export async function mediaSourceFor(entry: MediaEntry, ffmpeg: FfmpegStatus & { ok: true }, scratchDir?: string, params: Record<string, unknown> = {}, target?: { width?: number; height?: number }): Promise<MediaSource> {
  if (isLayeredPath(entry.path)) {
    const read = await layeredFileFor(entry.path);
    if (!read.ok) throw new RenderPlanError(`the layered file could not be read: ${read.message}`);
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

/** The planner's answer for an item without running anything: what the Output tab and the queue validate with. */
export async function planMediaRender(entry: MediaEntry, presetId: string, options: RenderOptions | undefined, params: Record<string, unknown>, outputPath: string): Promise<{ ok: true; plan: MediaRenderPlan } | { ok: false; message: string }> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };
  try {
    // A scratch folder is named but not made: the plan only has to know one would exist.
    const source = await mediaSourceFor(entry, ffmpeg, undefined, params);
    const plan = buildMediaRenderPlan({ source, presetId, outputPath, options, scratchDir: join(tmpdir(), 'pulp-media') });
    return { ok: true, plan };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Why this build of ffmpeg cannot write the preset, or null. */
function encoderProblem(ffmpeg: FfmpegStatus & { ok: true }, presetId: string): string | null {
  if (isAudioPresetId(presetId)) {
    const preset = AUDIO_PRESETS[presetId];
    return preset.encoder.startsWith('pcm') || ffmpeg.encoders.includes(preset.encoder) ? null : `${preset.label} needs the ${preset.encoder} encoder, which this ffmpeg lacks`;
  }
  const preset = OUTPUT_PRESETS[presetId as PresetId];
  if (!preset) return `unknown output preset "${presetId}"`;
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
    const source = await mediaSourceFor(job.entry, ffmpeg, scratch, job.params, { ...(job.options?.width ? { width: job.options.width } : {}), ...(job.options?.height ? { height: job.options.height } : {}) });
    const plan = buildMediaRenderPlan({ source, presetId: job.presetId, outputPath: job.outputPath, options: job.options, overwrite: job.overwrite, scratchDir: scratch });
    await mkdir(dirname(plan.output), { recursive: true });
    const total = plan.timing.totalFrames;
    for (let i = 0; i < plan.stages.length; i += 1) {
      if (job.signal?.aborted) return { ok: false, cancelled: true, message: 'Render cancelled.' };
      const stage = plan.stages[i]!;
      const last = i === plan.stages.length - 1;
      const { code, stderr } = await runStage(ffmpeg.path, stage.args, job, (frame, seconds) => {
        if (!last) return;
        const done = frame !== undefined && plan.kind === 'video' ? frame : seconds !== undefined ? Math.round(seconds * plan.timing.fps) : undefined;
        if (done !== undefined) job.onProgress?.({ frame: Math.min(total, done), totalFrames: total });
      });
      if (job.signal?.aborted) {
        await Promise.all([plan.output, plan.matteOutput].filter((f): f is string => !!f && !/%0?\d*d/.test(f)).map((f) => rm(f, { force: true })));
        return { ok: false, cancelled: true, message: 'Render cancelled.' };
      }
      if (code !== 0) return { ok: false, message: `ffmpeg exited with code ${code}${last ? '' : ' while making the loop unit'}: ${stderr.trim() || 'no error output'}` };
    }
    job.onProgress?.({ frame: total, totalFrames: total });
    return { ok: true, output: plan.output, frames: total, warnings: plan.warnings, transport: plan.stages.length > 1 ? 'ffmpeg (loop unit, then stream loop)' : 'ffmpeg' };
  } catch (err) {
    return { ok: false, message: err instanceof RenderPlanError ? err.message : `Render failed: ${(err as Error).message}` };
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
