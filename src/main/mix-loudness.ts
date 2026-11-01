/**
 * The mix's loudness for the transport row's meter (milestone 52): the window
 * sends the layers that make sound — ids and settings, never paths — the main
 * process resolves each to its file under ADR 0013's rule, runs the same EBU
 * R128 measurement a levelled render's first pass runs, and answers with the
 * integrated loudness and true peak. The meter therefore shows the loudness a
 * render would start from, by the one measurement, not an estimate.
 *
 * Measured, not live: a real-time meter would need the preview's elements
 * routed through an audio graph, and what the number is for is "how far is
 * this mix from the platform's target", which is a fact about the whole mix.
 */

import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { audibleLayers, measureMixArgs, parseMixLoudness, type AudioLayer } from '../core/layer-audio';
import type { LayerSpan } from '../core/layer-time';
import { ffprobePathFor } from '../core/media-probe';
import { sanitizeSoundValue } from '../core/sound-layer';
import { sanitizeClipValue } from '../core/video-layer';
import { resolveClipAudio, resolveClipSource } from './clip-grant';
import { resolveSoundSource } from './sound-grant';

/** What the window sends: each layer's settings as stored, with its span; the kind says which value it is. */
export interface MixLoudnessRequest {
  layers: { kind: 'clip' | 'sound'; value: unknown; span?: LayerSpan }[];
  fps: number;
  length: number;
}

export interface MixLoudnessAnswer {
  /** Integrated loudness, LUFS; null when there is nothing to measure or it could not be. */
  lufs: number | null;
  truePeakDb: number | null;
}

const NOTHING: MixLoudnessAnswer = { lufs: null, truePeakDb: null };

/** Only one measurement runs at a time, and only the newest ask is answered with work: edits arrive faster than decodes. */
let running: Promise<MixLoudnessAnswer> | null = null;

export async function mixLoudness(raw: unknown): Promise<MixLoudnessAnswer> {
  // A second ask while one runs waits for the first, then measures afresh: the layers may have changed.
  if (running) await running.catch(() => undefined);
  const work = measure(raw).catch(() => NOTHING);
  running = work;
  return work.finally(() => {
    if (running === work) running = null;
  });
}

async function measure(raw: unknown): Promise<MixLoudnessAnswer> {
  const request = raw as Partial<MixLoudnessRequest>;
  const fps = Number(request?.fps);
  const length = Number(request?.length);
  if (!Array.isArray(request?.layers) || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(length) || length <= 0) return NOTHING;
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return NOTHING;
  const layers: AudioLayer[] = [];
  for (const entry of request.layers) {
    const span = entry?.span ? { span: entry.span } : {};
    if (entry?.kind === 'sound') {
      const value = sanitizeSoundValue(entry.value);
      if (!value?.id) continue;
      const found = await resolveSoundSource(ffprobePathFor(ffmpeg.path), value.id);
      if (found) layers.push({ kind: 'sound', path: found.path, value, source: found.source, ...span });
    } else if (entry?.kind === 'clip') {
      const value = sanitizeClipValue(entry.value);
      if (!value?.id) continue;
      const audio = await resolveClipAudio(ffprobePathFor(ffmpeg.path), value.id);
      const source = audio?.hasAudio ? await resolveClipSource(ffprobePathFor(ffmpeg.path), value.id) : null;
      if (audio?.hasAudio && source) layers.push({ kind: 'clip', path: audio.path, value, source, ...span });
    }
  }
  const audible = audibleLayers(layers, length);
  if (audible.length === 0) return NOTHING;
  const timing = { fps, firstFrame: 0, totalFrames: Math.max(1, Math.round(length * fps)), length };
  const run = await runForBuffer(ffmpeg.path, measureMixArgs(audible, timing));
  if (run.code !== 0) return NOTHING;
  const measured = parseMixLoudness(run.stderr);
  return measured ? { lufs: measured.inputI, truePeakDb: measured.inputTp } : NOTHING;
}
