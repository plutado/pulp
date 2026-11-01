/**
 * A clip's own sound in a render (milestone 48): the ffmpeg audio inputs and
 * filter chains that put each audible video layer's sound under the picture,
 * in step with its in point, speed, start delay and looping — the same
 * arithmetic `clipFrameAt` draws by, written as filters.
 *
 * Pure: it rewrites a render plan's argument list and spawns nothing. The
 * main process supplies the clips' file paths, which are the one thing the
 * plan cannot know.
 *
 * How the chains are built, per layer: the clip's audio is resampled to one
 * known rate (so a loop can be measured in samples), trimmed to the layer's
 * window, retimed by its speed with `atempo`, looped with `aloop` where the
 * layer loops, scaled by its volume and pushed out to its start delay with
 * `adelay`. The layers are then mixed without normalising — a mixer does not
 * duck everyone because someone else is playing — and the mix is trimmed to
 * exactly the rendered range and padded with silence to exactly its length,
 * so a trimmed render hears what its frames show.
 */

import type { RenderPlan } from './render-plan';
import { CLIP_LIMITS, clipAudible, clipWindow, DEFAULT_CLIP_SPEED, type ClipSource, type ClipValue } from './video-layer';

/** Every layer's sound is brought to one rate before measuring or mixing. */
export const CLIP_AUDIO_RATE = 48000;

/** One audible video layer: the clip's file, how the layer plays it, and what was measured about it. */
export interface ClipAudioLayer {
  /** The clip's own file, as an ffmpeg input. */
  path: string;
  value: ClipValue;
  source: ClipSource;
}

/**
 * How a preset writes the sound it is given, or null for one whose output has
 * no room for an audio stream (an image sequence, a still). AAC in MP4 as the
 * platforms take it, PCM in QuickTime for the editing presets, Opus in WebM.
 */
export function presetAudioArgs(presetId: string): string[] | null {
  switch (presetId) {
    case 'h264-mp4':
      return ['-c:a', 'aac', '-b:a', '192k'];
    case 'prores-4444':
    case 'prores-422hq':
    case 'qt-animation':
    case 'hevc-alpha':
      return ['-c:a', 'pcm_s16le'];
    case 'webm-vp9-alpha':
      return ['-c:a', 'libopus', '-b:a', '128k'];
    default:
      return null;
  }
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return DEFAULT_CLIP_SPEED;
  return Math.min(CLIP_LIMITS.speed.max, Math.max(CLIP_LIMITS.speed.min, speed));
}

/**
 * `atempo` filters for a playback speed. One `atempo` takes 0.5 to 100, so a
 * slower speed is factored into halves; the layer's own range is 0.1 to 10.
 * Speed 1 needs no filter at all and returns none.
 */
export function atempoChain(speed: number): string[] {
  let s = clampSpeed(speed);
  if (s === 1) return [];
  const out: string[] = [];
  while (s < 0.5) {
    out.push('atempo=0.5');
    s *= 2;
  }
  out.push(`atempo=${Number(s.toFixed(6))}`);
  return out;
}

/** Seconds of the layer's window at its speed: how long one pass of its sound runs. */
function passSeconds(value: ClipValue, source: ClipSource): number {
  const { frames } = clipWindow(value, source);
  return frames / Math.max(1, source.fps) / clampSpeed(value.speed);
}

/**
 * One layer's chain, from the input's audio to a named segment. The trim is
 * in the clip's own seconds; everything after runs on the layer's timeline.
 */
export function clipAudioChain(inputIndex: number, layer: ClipAudioLayer, label: string): string {
  const { value, source } = layer;
  const fps = Math.max(1, source.fps);
  const { first, last } = clipWindow(value, source);
  const steps: string[] = [
    `aresample=${CLIP_AUDIO_RATE}`,
    `atrim=start=${Number((first / fps).toFixed(6))}:end=${Number(((last + 1) / fps).toFixed(6))}`,
    'asetpts=PTS-STARTPTS',
    ...atempoChain(value.speed),
  ];
  if (value.ending === 'loop') {
    // Loop for as long as the render runs; the mix's own trim ends it. The size is one pass with
    // a second to spare — aloop loops what actually arrived when the stream is shorter.
    const size = Math.ceil(passSeconds(value, source) * CLIP_AUDIO_RATE) + CLIP_AUDIO_RATE;
    steps.push(`aloop=loop=-1:size=${size}`);
  }
  if (value.volume !== 1) steps.push(`volume=${value.volume}`);
  if (value.delay > 0) steps.push(`adelay=${Math.round(value.delay * 1000)}:all=1`);
  return `[${inputIndex}:a]${steps.join(',')}[${label}]`;
}

/**
 * The whole audio graph: each layer's chain, the mix, and the trim and pad
 * that hold it to exactly the rendered range. Returns the chains and the name
 * of the finished stream.
 */
export function clipAudioFilter(layers: readonly ClipAudioLayer[], timing: { fps: number; firstFrame: number; totalFrames: number }, firstInputIndex: number): string {
  const chains = layers.map((layer, i) => clipAudioChain(firstInputIndex + i, layer, `la${i}`));
  const mixed = layers.length === 1 ? 'la0' : 'lamix';
  if (layers.length > 1) {
    chains.push(`${layers.map((_, i) => `[la${i}]`).join('')}amix=inputs=${layers.length}:normalize=0[lamix]`);
  }
  const fps = Math.max(1, timing.fps);
  const start = Number((timing.firstFrame / fps).toFixed(6));
  const seconds = Number((timing.totalFrames / fps).toFixed(6));
  chains.push(`[${mixed}]atrim=start=${start}:end=${Number((start + seconds).toFixed(6))},asetpts=PTS-STARTPTS,apad=whole_dur=${seconds}[aout]`);
  return chains.join(';');
}

/**
 * A render plan with the layers' sound mixed in: the clips join as inputs
 * after the frame pipe, their chains join the filter graph, and the mix is
 * mapped and encoded with the preset's audio codec. A plan is returned
 * untouched when nothing is audible or the preset has no room for sound, so
 * a silent project renders exactly as it always has — no audio stream at all.
 */
export function applyClipAudio(plan: RenderPlan, layers: readonly ClipAudioLayer[]): RenderPlan {
  const codec = presetAudioArgs(plan.preset.id);
  const audible = layers.filter((l) => clipAudible(l.value) && clipWindow(l.value, l.source).frames > 0 && l.path.length > 0);
  if (!codec || audible.length === 0) return plan;

  const args = [...plan.args];
  const pipeAt = args.indexOf('pipe:0');
  const outAt = args.indexOf(plan.output);
  if (pipeAt < 0 || outAt < 0) return plan;

  const filter = clipAudioFilter(audible, plan, 1);
  const vfAt = args.indexOf('-vf');
  const complexAt = args.indexOf('-filter_complex');
  if (complexAt >= 0) {
    // The graph is already complex (a flatten or a matte): the audio chains join it.
    args[complexAt + 1] = `${args[complexAt + 1]};${filter}`;
    args.splice(args.indexOf(plan.output), 0, '-map', '[aout]', ...codec);
  } else if (vfAt >= 0) {
    // A plain video chain becomes part of one complex graph, so the maps stay explicit and together.
    const chain = args[vfAt + 1]!;
    args.splice(vfAt, 2, '-filter_complex', `[0:v]${chain}[vout];${filter}`, '-map', '[vout]');
    args.splice(args.indexOf(plan.output), 0, '-map', '[aout]', ...codec);
  } else {
    return plan;
  }
  // The clips join as inputs after the frame pipe, in chain order.
  args.splice(pipeAt + 1, 0, ...audible.flatMap((l) => ['-i', l.path]));
  return { ...plan, args };
}
