/**
 * Every layer's sound (milestone 48): when a layer is heard, how loud, and
 * the ffmpeg graph that mixes the lot into a render.
 *
 * Two kinds of layer make sound — a video layer playing a clip that carries
 * an audio stream, and an audio layer holding a piece of music or a
 * voice-over — and both are heard by the same rules, so they are decided in
 * one place. The preview asks `layerHeard` and `layerGainAt` per tick; the
 * render asks `applyLayerAudio` for the argument list. What is heard cannot
 * drift from what is written, because neither has arithmetic of its own.
 *
 * **When a layer is heard** is the span it is on screen for (milestone 28's
 * per-layer timing, which is the bar under the scrub bar) narrowed by the
 * sound's own start delay, and by where a `once` sound runs out. A layer
 * timed off the screen is silent, so dragging its bar moves its sound.
 *
 * **How loud** is the layer's volume, with its fades at either end of what is
 * heard — and a sound that loops fades out at the end of the graphic, since a
 * loop has no end of its own to fade from.
 *
 * Pure: the render side rewrites a plan's argument list and spawns nothing.
 * The main process supplies the files' paths, which are the one thing a plan
 * cannot know.
 *
 * How a chain is built, per layer: the source's audio is resampled to one
 * known rate (so a loop can be measured in samples), trimmed to the layer's
 * window, retimed by a clip's speed with `atempo`, looped with `aloop` where
 * the layer loops, scaled by its volume and pushed out to its start delay
 * with `adelay`. The fades and the span then shape it with `afade` on the
 * graphic's own clock. The layers are mixed without normalising — a mixer
 * does not duck everyone because someone else is playing — and the mix is
 * trimmed to exactly the rendered range and padded with silence to exactly
 * its length, so a trimmed render hears what its frames show.
 */

import { spanWindow, type LayerSpan } from './layer-time';
import type { RenderPlan } from './render-plan';
import { soundAudible, soundTimeAt, soundWindow, type SoundSource, type SoundValue } from './sound-layer';
import { CLIP_LIMITS, clipAudible, clipMediaTimeAt, clipWindow, DEFAULT_CLIP_SPEED, type ClipSource, type ClipValue } from './video-layer';

/** Every layer's sound is brought to one rate before measuring or mixing. */
export const LAYER_AUDIO_RATE = 48000;

/**
 * The shortest `afade` used to gate a layer to its span. A hard cut on a
 * waveform clicks; ten milliseconds does not, and is far too short to hear as
 * a fade.
 */
export const GATE_SECONDS = 0.01;

/** A video layer playing a clip whose file carries sound. */
export interface ClipAudioLayer {
  kind: 'clip';
  /** The clip's own file, as an ffmpeg input. */
  path: string;
  value: ClipValue;
  source: ClipSource;
  /** When the layer is on screen, if it has a span of its own (milestone 28). */
  span?: LayerSpan;
}

/** An audio layer: a piece of music or a voice-over. */
export interface SoundAudioLayer {
  kind: 'sound';
  path: string;
  value: SoundValue;
  source: SoundSource;
  span?: LayerSpan;
}

/** One layer that makes sound, of either kind. */
export type AudioLayer = ClipAudioLayer | SoundAudioLayer;

/**
 * How a preset writes the sound it is given, or null for one whose output has
 * no room for an audio stream (an image sequence, a still) — those get the mix
 * as a WAV beside them instead. AAC in MP4 as the platforms take it, PCM in
 * QuickTime for the editing presets, Opus in WebM.
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

/** The mix written beside a render that cannot carry it: `<name>-audio.wav`, with a sequence's frame pattern dropped. */
export function audioOutputPath(output: string): string {
  const slash = Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'));
  const dir = output.slice(0, slash + 1);
  let file = output.slice(slash + 1);
  file = file.replace(/_%0?\d*d(?=\.[^.]*$|$)/, '');
  const dot = file.lastIndexOf('.');
  return `${dir}${dot > 0 ? file.slice(0, dot) : file}-audio.wav`;
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return DEFAULT_CLIP_SPEED;
  return Math.min(CLIP_LIMITS.speed.max, Math.max(CLIP_LIMITS.speed.min, speed));
}

// ---------------------------------------------------------------- when a layer is heard

/** The layer's own settings, whichever kind it is. */
function settings(layer: AudioLayer): { delay: number; volume: number; ending: 'loop' | 'once'; fadeIn: number; fadeOut: number } {
  if (layer.kind === 'sound') {
    const { delay, volume, ending, fadeIn, fadeOut } = layer.value;
    return { delay: Math.max(0, delay), volume, ending, fadeIn, fadeOut };
  }
  // A clip has no fades of its own: its picture arrives and leaves by the layer's transitions,
  // and its sound follows the span's own ten-millisecond gate.
  return { delay: Math.max(0, layer.value.delay), volume: layer.value.volume, ending: layer.value.ending, fadeIn: 0, fadeOut: 0 };
}

/** Seconds one pass of the layer's sound runs for on the graphic's clock. */
export function layerPassSeconds(layer: AudioLayer): number {
  if (layer.kind === 'sound') return soundWindow(layer.value, layer.source).seconds;
  const { frames } = clipWindow(layer.value, layer.source);
  return frames / Math.max(1, layer.source.fps) / clampSpeed(layer.value.speed);
}

/**
 * The stretch of the graphic a layer is heard over, in its seconds: its span
 * narrowed by its start delay, and by where a sound that plays once runs out.
 * `to` is at or before `from` when the layer is never heard.
 */
export function layerHeard(layer: AudioLayer, length: number): { from: number; to: number } {
  const span = spanWindow(layer.span, length);
  const { delay, ending } = settings(layer);
  const from = Math.max(span.from, delay);
  const pass = layerPassSeconds(layer);
  // A loop runs until the graphic stops; a single pass ends where it ends.
  const ownEnd = ending === 'loop' ? length : delay + pass;
  return { from, to: Math.min(span.to, ownEnd, length) };
}

/**
 * How loud the layer is at a moment of the graphic, 0 to 1: its volume with
 * its fades, silent outside what it is heard over. What the preview sets on
 * the element each tick, and what the render's `afade` steps draw.
 */
export function layerGainAt(layer: AudioLayer, time: number, length: number): number {
  const audible = layer.kind === 'sound' ? soundAudible(layer.value) : clipAudible(layer.value);
  if (!audible) return 0;
  const at = layer.kind === 'sound'
    ? soundTimeAt(time, layer.value, layer.source)
    : clipMediaTimeAt(time, layer.value, layer.source);
  if (at === null) return 0;
  const { from, to } = layerHeard(layer, length);
  if (time < from - 1e-9 || time > to + 1e-9) return 0;
  const { volume, fadeIn, fadeOut } = settings(layer);
  let gain = volume;
  if (fadeIn > 0 && time < from + fadeIn) gain *= Math.max(0, (time - from) / fadeIn);
  if (fadeOut > 0 && time > to - fadeOut) gain *= Math.max(0, (to - time) / fadeOut);
  return Math.min(1, Math.max(0, gain));
}

// ---------------------------------------------------------------- the render's graph

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

/** Seconds, to the microsecond, as an ffmpeg option value. */
function s(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * One layer's chain, from the input's audio to a named segment. Up to the
 * `adelay` it runs on the source's own clock; after it, on the graphic's, and
 * the fades and the span gate are placed in the graphic's seconds.
 */
export function layerAudioChain(inputIndex: number, layer: AudioLayer, label: string, length: number): string {
  const steps: string[] = [`aresample=${LAYER_AUDIO_RATE}`];
  const { delay, volume, ending, fadeIn, fadeOut } = settings(layer);
  if (layer.kind === 'sound') {
    const { from, to } = soundWindow(layer.value, layer.source);
    steps.push(`atrim=start=${s(from)}:end=${s(to)}`, 'asetpts=PTS-STARTPTS');
  } else {
    const fps = Math.max(1, layer.source.fps);
    const { first, last } = clipWindow(layer.value, layer.source);
    steps.push(`atrim=start=${s(first / fps)}:end=${s((last + 1) / fps)}`, 'asetpts=PTS-STARTPTS', ...atempoChain(layer.value.speed));
  }
  if (ending === 'loop') {
    // Loop for as long as the render runs; the mix's own trim ends it. The size is one pass with
    // a second to spare — aloop loops what actually arrived when the stream is shorter.
    const size = Math.ceil(layerPassSeconds(layer) * LAYER_AUDIO_RATE) + LAYER_AUDIO_RATE;
    steps.push(`aloop=loop=-1:size=${size}`);
  }
  if (volume !== 1) steps.push(`volume=${volume}`);
  if (delay > 0) steps.push(`adelay=${Math.round(delay * 1000)}:all=1`);
  // From here the stream is on the graphic's clock, which is what the fades and the gate are in.
  const { from, to } = layerHeard(layer, length);
  // A fade of its own, or the gate that holds the layer to its span: the same filter either way,
  // and the gate's ten milliseconds is a cut without the click.
  if (fadeIn > 0 || from > 0) steps.push(`afade=t=in:st=${s(from)}:d=${s(Math.max(fadeIn, GATE_SECONDS))}`);
  if (fadeOut > 0 || to < length - 1e-9) {
    const d = Math.max(fadeOut, GATE_SECONDS);
    steps.push(`afade=t=out:st=${s(Math.max(0, to - d))}:d=${s(d)}`);
  }
  return `[${inputIndex}:a]${steps.join(',')}[${label}]`;
}

/**
 * The whole audio graph: a silent bed of the graphic's own length, each
 * layer's chain mixed onto it, and the trim and pad that hold the result to
 * exactly the rendered range.
 *
 * **The bed is not decoration.** `adelay` pushes a layer out by leaving a gap
 * rather than samples, and `atrim` throws that gap away — so without a stream
 * that really has samples from the first one, a delayed layer came out at the
 * top of the render and a trimmed render shifted by the wrong amount. Mixing
 * onto silence of a known length settles both, and makes the mix exactly as
 * long as the graphic whatever the layers do.
 */
export function layerAudioFilter(
  layers: readonly AudioLayer[],
  timing: { fps: number; firstFrame: number; totalFrames: number; length: number },
  firstInputIndex: number,
): string {
  const fps = Math.max(1, timing.fps);
  const start = s(timing.firstFrame / fps);
  const seconds = s(timing.totalFrames / fps);
  const chains = [
    `anullsrc=r=${LAYER_AUDIO_RATE}:cl=stereo:d=${s(Math.max(timing.length, start + seconds))}[abase]`,
    ...layers.map((layer, i) => layerAudioChain(firstInputIndex + i, layer, `la${i}`, timing.length)),
    `[abase]${layers.map((_, i) => `[la${i}]`).join('')}amix=inputs=${layers.length + 1}:normalize=0[amix]`,
    `[amix]atrim=start=${start}:end=${s(start + seconds)},asetpts=PTS-STARTPTS,apad=whole_dur=${seconds}[aout]`,
  ];
  return chains.join(';');
}

/** The layers that will actually be heard: something chosen, not muted, not silent, with a file to read and a window to play. */
export function audibleLayers(layers: readonly AudioLayer[], length: number): AudioLayer[] {
  return layers.filter((l) => {
    if (l.path.length === 0) return false;
    if (layerPassSeconds(l) <= 0) return false;
    const heard = layerHeard(l, length);
    if (heard.to - heard.from <= 0) return false;
    return l.kind === 'sound' ? soundAudible(l.value) : clipAudible(l.value);
  });
}

/**
 * A render plan with the layers' sound mixed in: the files join as inputs
 * after the frame pipe, their chains join the filter graph, and the mix is
 * mapped and encoded with the preset's audio codec — or written as a WAV
 * beside the render where the output has no room for an audio stream, so an
 * image sequence still comes with its sound. A plan is returned untouched
 * when nothing is audible, so a silent project renders exactly as it always
 * has: no audio stream and no file beside it.
 */
export function applyLayerAudio(plan: RenderPlan, layers: readonly AudioLayer[]): RenderPlan {
  const audible = audibleLayers(layers, plan.length);
  if (audible.length === 0) return plan;

  const args = [...plan.args];
  const pipeAt = args.indexOf('pipe:0');
  if (pipeAt < 0 || args.indexOf(plan.output) < 0) return plan;

  const filter = layerAudioFilter(audible, plan, 1);
  const vfAt = args.indexOf('-vf');
  const complexAt = args.indexOf('-filter_complex');
  if (complexAt >= 0) {
    // The graph is already complex (a flatten or a matte): the audio chains join it.
    args[complexAt + 1] = `${args[complexAt + 1]};${filter}`;
  } else if (vfAt >= 0) {
    // A plain video chain becomes part of one complex graph, so the maps stay explicit and together.
    const chain = args[vfAt + 1]!;
    args.splice(vfAt, 2, '-filter_complex', `[0:v]${chain}[vout];${filter}`, '-map', '[vout]');
  } else {
    return plan;
  }
  const codec = presetAudioArgs(plan.preset.id);
  let audioOutput: string | undefined;
  if (codec) {
    // Into the render itself, before the output path it belongs to.
    args.splice(args.indexOf(plan.output), 0, '-map', '[aout]', ...codec);
  } else {
    // No room in this output: the mix goes beside it as a WAV, a second output of the same command.
    audioOutput = audioOutputPath(plan.output);
    args.push('-map', '[aout]', '-c:a', 'pcm_s16le', audioOutput);
  }
  // The files join as inputs after the frame pipe, in chain order.
  args.splice(pipeAt + 1, 0, ...audible.flatMap((l) => ['-i', l.path]));
  return { ...plan, args, ...(audioOutput ? { audioOutput } : {}) };
}
