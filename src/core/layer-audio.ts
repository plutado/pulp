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

import { duckGainAt, duckVolumeFilter, LEVEL_STEP_SECONDS, speakingAt, voiceThreshold, type DuckSpan, type DuckValue, type ResolvedDuck } from './duck';
import { spanWindow, type LayerSpan } from './layer-time';
import type { RenderPlan } from './render-plan';
import { soundAudible, soundTimeAt, soundWindow, type SoundSource, type SoundValue } from './sound-layer';
import { CLIP_LIMITS, clipAudible, clipMediaTimeAt, clipWindow, DEFAULT_CLIP_SPEED, type ClipSource, type ClipValue } from './video-layer';
import { voiceSteps } from './voice-treatment';

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
  /**
   * The rate the sound plays at, its pitch kept (milestone 56): a cut on the
   * track at a speed, as `trackAudio` derives it. A sound layer of its own
   * has none; absent is real time.
   */
  speed?: number;
  /**
   * Its dip under a voice (milestone 80), worked out against the voice's
   * levels by `resolveDuck`: the settings and where the voice speaks. Absent
   * holds its level, as does a dip whose voice never speaks.
   */
  duck?: ResolvedDuck;
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
    case 'dnxhr-hq':
    case 'dnxhr-hqx':
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

/** The rate a layer of either kind plays at: a clip's own setting, or the speed a cut's sound was handed. */
function layerSpeed(layer: AudioLayer): number {
  return layer.kind === 'clip' ? clampSpeed(layer.value.speed) : clampSpeed(layer.speed ?? 1);
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
  if (layer.kind === 'sound') return soundWindow(layer.value, layer.source).seconds / layerSpeed(layer);
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

/** Where in its own file a layer's sound is at a moment of the graphic, or null while it is silent. */
export function layerSourceTimeAt(layer: AudioLayer, time: number): number | null {
  if (layer.kind === 'clip') return clipMediaTimeAt(time, layer.value, layer.source);
  const speed = layerSpeed(layer);
  if (speed === 1) return soundTimeAt(time, layer.value, layer.source);
  // At a speed (milestone 56) the window passes `speed` times as fast: the moment is scaled onto
  // the file's clock from the delay, and the pass is the window's seconds over the speed.
  if (!Number.isFinite(time) || layer.value.id === null || layer.value.hidden) return null;
  const { from, seconds } = soundWindow(layer.value, layer.source);
  if (seconds <= 0) return null;
  const elapsed = time - Math.max(0, layer.value.delay);
  if (elapsed < -1e-9) return null;
  const pass = seconds / speed;
  let within = Math.max(0, elapsed);
  if (layer.value.ending === 'loop') within = within % pass;
  else if (within >= pass - 1e-9) return null;
  return from + within * speed;
}

/**
 * The shape of a layer's sound at a moment, 0 to 1, before its volume and
 * mute: the gate to what it is heard over, and its fades. The gain is this
 * times the volume; the waveform on its bar is the material times this, so a
 * fade is read off the bar and a muted layer still shows what it holds.
 */
export function layerFadeAt(layer: AudioLayer, time: number, length: number): number {
  if (layerSourceTimeAt(layer, time) === null) return 0;
  const { from, to } = layerHeard(layer, length);
  if (time < from - 1e-9 || time > to + 1e-9) return 0;
  const { fadeIn, fadeOut } = settings(layer);
  let shape = 1;
  if (fadeIn > 0 && time < from + fadeIn) shape *= Math.max(0, (time - from) / fadeIn);
  if (fadeOut > 0 && time > to - fadeOut) shape *= Math.max(0, (to - time) / fadeOut);
  return Math.min(1, Math.max(0, shape));
}

/**
 * How loud the layer is at a moment of the graphic, 0 to 1: its volume with
 * its fades, silent outside what it is heard over. What the preview sets on
 * the element each tick, and what the render's `afade` steps draw.
 */
export function layerGainAt(layer: AudioLayer, time: number, length: number): number {
  const audible = layer.kind === 'sound' ? soundAudible(layer.value) : clipAudible(layer.value);
  if (!audible) return 0;
  const { volume } = settings(layer);
  // A dip under a voice (milestone 80) rides on top of the volume and the fades, as the render's
  // `volume` expression does after its `afade` steps.
  const duck = layer.kind === 'sound' ? duckGainAt(layer.duck, time) : 1;
  return Math.min(1, Math.max(0, volume * layerFadeAt(layer, time, length) * duck));
}

/** Seconds the layer's whole file runs for, which its waveform's peaks are spread over. */
function sourceSeconds(layer: AudioLayer): number {
  return layer.kind === 'sound' ? layer.source.duration : layer.source.frames / Math.max(1, layer.source.fps);
}

/**
 * The peaks drawn on a layer's bar under the scrub bar (milestone 48):
 * `columns` samples across the bar's own window, each the material's peak at
 * the file moment that plays then — so an in point shifts the shape, a loop
 * repeats it, a speed squeezes it, and a beat on the bar is the beat that will
 * be heard there. Shaped by the fades and the span's gate but **not** by the
 * volume or the mute: the bar is about time, and a muted layer still shows
 * what it holds.
 */
export function layerBarPeaks(layer: AudioLayer, peaks: ArrayLike<number>, length: number, columns: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, Math.floor(columns)));
  const window = spanWindow(layer.span, length);
  const file = sourceSeconds(layer);
  if (out.length === 0 || peaks.length === 0 || file <= 0 || window.to <= window.from) return out;
  for (let column = 0; column < out.length; column++) {
    const time = window.from + ((column + 0.5) / out.length) * (window.to - window.from);
    const at = layerSourceTimeAt(layer, time);
    if (at === null) continue;
    const shape = layerFadeAt(layer, time, length);
    if (shape <= 0) continue;
    const bucket = Math.min(peaks.length - 1, Math.max(0, Math.floor((at / file) * peaks.length)));
    out[column] = Math.round((peaks[bucket] ?? 0) * shape);
  }
  return out;
}

// ---------------------------------------------------------------- dipping under a voice (milestone 80)

/** A voice a music layer dips under: the layer as it is heard, and the levels measured from its file. */
export interface DuckVoice {
  layer: AudioLayer;
  levels: ArrayLike<number>;
}

/**
 * Where the voices speak, in the graphic's seconds: every step at which one
 * of them is heard (its span, delay, loop and fades — muted or silent, it
 * speaks to no one) and its file is loud enough there, run together into
 * stretches. Measured on the file as recorded, so a voice treatment does not
 * move the dip.
 */
export function voiceSpans(voices: readonly DuckVoice[], length: number): DuckSpan[] {
  const spans: DuckSpan[] = [];
  if (!Number.isFinite(length) || length <= 0) return spans;
  const ready = voices.map((v) => ({ ...v, threshold: voiceThreshold(v.levels) }));
  const steps = Math.ceil(length / LEVEL_STEP_SECONDS);
  let open: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const time = Math.min(length, i * LEVEL_STEP_SECONDS);
    const speaking = i < steps && ready.some((v) => {
      if (layerGainAt(v.layer, time, length) <= 0) return false;
      const at = layerSourceTimeAt(v.layer, time);
      return at !== null && speakingAt(v.levels, v.threshold, at);
    });
    if (speaking && open === null) open = time;
    else if (!speaking && open !== null) {
      spans.push({ from: open, to: time });
      open = null;
    }
  }
  return spans;
}

/** A music layer's dip, worked out: its settings with where its voices speak. */
export function resolveDuck(duck: DuckValue, voices: readonly DuckVoice[], length: number): ResolvedDuck {
  return { depth: duck.depth, speed: duck.speed, spans: voiceSpans(voices, length) };
}

/**
 * Every dip in a mix worked out at once: each sound layer whose value names a
 * voice by `block.layer` gets that voice's spans, its own key never counting
 * as its voice. `keyed` pairs each layer with its key (a layer with stems
 * appears once per stem, all under one key); `levelsFor` gives a voice's
 * levels, or null when they could not be measured — a voice that cannot be
 * measured dips nothing, rather than guessing.
 */
export function applyDucks(keyed: readonly { key: string; layer: AudioLayer }[], levelsFor: (layer: AudioLayer) => ArrayLike<number> | null | undefined, length: number): void {
  for (const { key, layer } of keyed) {
    if (layer.kind !== 'sound') continue;
    const duck = layer.value.duck;
    if (!duck || duck.under === key) {
      delete layer.duck;
      continue;
    }
    const voices: DuckVoice[] = [];
    for (const other of keyed) {
      if (other.key !== duck.under) continue;
      const levels = levelsFor(other.layer);
      if (levels) voices.push({ layer: other.layer, levels });
    }
    layer.duck = resolveDuck(duck, voices, length);
  }
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
  // The voice treatment (milestone 53) runs on the file's own clock, straight after the trim:
  // before a clip's speed, as the preview hears it, before the loop so one pass is treated once,
  // before the volume so the compressor sees the level as recorded — and so before milestone 52's
  // loudness leveling, which measures the treated mix and still lands the target.
  if (layer.kind === 'sound') {
    const { from, to } = soundWindow(layer.value, layer.source);
    // A cut's sound at a speed (milestone 56) is retimed as a clip's is: `atempo` changes the
    // tempo and keeps the pitch, so a slowed voice stays a voice rather than a growl.
    steps.push(`atrim=start=${s(from)}:end=${s(to)}`, 'asetpts=PTS-STARTPTS', ...voiceSteps(layer.value.voice), ...atempoChain(layerSpeed(layer)));
  } else {
    const fps = Math.max(1, layer.source.fps);
    const { first, last } = clipWindow(layer.value, layer.source);
    steps.push(`atrim=start=${s(first / fps)}:end=${s((last + 1) / fps)}`, 'asetpts=PTS-STARTPTS', ...voiceSteps(layer.value.voice), ...atempoChain(layer.value.speed));
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
  // The dip under a voice (milestone 80) is on the graphic's clock too, where the voice was heard.
  const duck = layer.kind === 'sound' ? duckVolumeFilter(layer.duck) : null;
  if (duck) steps.push(duck);
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
  /** A leveling stage after the cut (milestone 52), so what is leveled is exactly what is written. */
  level?: string,
  /** A tag on every label, so several mixes can live in one graph (milestone 16's stems). */
  suffix = '',
): string {
  const fps = Math.max(1, timing.fps);
  const start = s(timing.firstFrame / fps);
  const seconds = s(timing.totalFrames / fps);
  const chains = [
    `anullsrc=r=${LAYER_AUDIO_RATE}:cl=stereo:d=${s(Math.max(timing.length, start + seconds))}[abase${suffix}]`,
    ...layers.map((layer, i) => layerAudioChain(firstInputIndex + i, layer, `la${suffix}${i}`, timing.length)),
    `[abase${suffix}]${layers.map((_, i) => `[la${suffix}${i}]`).join('')}amix=inputs=${layers.length + 1}:normalize=0[amix${suffix}]`,
    `[amix${suffix}]atrim=start=${start}:end=${s(start + seconds)},asetpts=PTS-STARTPTS,apad=whole_dur=${seconds}${level ? `,${level}` : ''}[aout${suffix}]`,
  ];
  return chains.join(';');
}

// ---------------------------------------------------------------- loudness (milestone 52)

/** What a mix is leveled to: integrated loudness and the true-peak ceiling, as a platform preset sets them. */
export interface LoudnessTarget {
  /** Integrated loudness, LUFS (EBU R128). */
  lufs: number;
  /** True peak ceiling, dBTP. */
  truePeakDb: number;
}

/** The loudness range `loudnorm` aims the mix's dynamics at; the EBU default. */
export const LOUDNESS_RANGE_LU = 11;

/** What EBU R128 measured about a mix: exactly what `loudnorm`'s second, linear pass is given back. */
export interface MixLoudness {
  /** Integrated loudness, LUFS. -70 is the meter's floor: silence. */
  inputI: number;
  /** True peak, dBTP. */
  inputTp: number;
  /** Loudness range, LU. */
  inputLra: number;
  /** The gating threshold the measurement used, LUFS. */
  inputThresh: number;
}

/**
 * The `loudnorm` stage that levels the mix. With the first pass's measurement
 * it is **linear** — one gain over the whole mix, transparent — which is the
 * two-pass form EBU R128 normalising is meant to run as; without it the
 * filter levels dynamically as it goes, which is the fallback when the mix
 * could not be measured. `loudnorm` resamples to 192 kHz inside, so the mix
 * is brought back to the one rate everything else runs at.
 */
export function loudnormFilter(target: LoudnessTarget, measured?: MixLoudness): string {
  const base = `loudnorm=I=${s(target.lufs)}:TP=${s(target.truePeakDb)}:LRA=${LOUDNESS_RANGE_LU}`;
  const second = measured
    ? `:measured_I=${s(measured.inputI)}:measured_TP=${s(measured.inputTp)}:measured_LRA=${s(measured.inputLra)}:measured_thresh=${s(measured.inputThresh)}:linear=true`
    : '';
  return `${base}${second},aresample=${LAYER_AUDIO_RATE}`;
}

/**
 * ffmpeg arguments that run the mix to nowhere and print what EBU R128
 * measured of it, as JSON on stderr: `loudnorm`'s first pass. The transport
 * row's meter and a leveled render's second pass both read it, so the meter
 * shows the loudness the render will start from.
 */
export function measureMixArgs(layers: readonly AudioLayer[], timing: { fps: number; firstFrame: number; totalFrames: number; length: number }): string[] {
  const filter = `${layerAudioFilter(layers, timing, 0)};[aout]loudnorm=I=-14:TP=-1:LRA=${LOUDNESS_RANGE_LU}:print_format=json[mout]`;
  return [
    '-hide_banner', '-nostats', '-nostdin',
    ...layers.flatMap((l) => ['-i', l.path]),
    '-filter_complex', filter,
    '-map', '[mout]', '-f', 'null', '-',
  ];
}

/** Read what `loudnorm` printed: the measurement, or null when there is none to read (silence reads as the meter's -70 floor). */
export function parseMixLoudness(stderr: string): MixLoudness | null {
  const at = stderr.lastIndexOf('{');
  const end = stderr.indexOf('}', at);
  if (at < 0 || end < 0) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stderr.slice(at, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  // loudnorm prints numbers as strings, and silence as "-inf": the meter's floor stands in for it.
  const read = (key: string, floor: number): number | null => {
    const value = raw[key];
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    return String(value).includes('-inf') ? floor : null;
  };
  const inputI = read('input_i', -70);
  const inputTp = read('input_tp', -70);
  const inputLra = read('input_lra', 0);
  const inputThresh = read('input_thresh', -80);
  if (inputI === null || inputTp === null || inputLra === null || inputThresh === null) return null;
  return { inputI, inputTp, inputLra, inputThresh };
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
export function applyLayerAudio(
  plan: RenderPlan,
  layers: readonly AudioLayer[],
  /** Level the mix to a platform's target (milestone 52); `measured` makes the pass linear. */
  loudness?: { target: LoudnessTarget; measured?: MixLoudness },
): RenderPlan {
  const audible = audibleLayers(layers, plan.length);
  if (audible.length === 0) return plan;
  // An animated image (milestone 82) is silent by nature: no stream, and no WAV beside a GIF either.
  if (plan.preset.animatedImage) return plan;

  const args = [...plan.args];
  const pipeAt = args.indexOf('pipe:0');
  if (pipeAt < 0 || args.indexOf(plan.output) < 0) return plan;

  // The chains name inputs by index, after whatever is already there — the frame pipe, and the
  // cut track's own inputs when the project has one (milestone 49) — so count rather than assume.
  const inputFlags: number[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '-i') inputFlags.push(i);
  const firstInputIndex = inputFlags.length;
  const lastInputEnd = inputFlags[inputFlags.length - 1]! + 1;

  const filter = layerAudioFilter(audible, plan, firstInputIndex, loudness ? loudnormFilter(loudness.target, loudness.measured) : undefined);
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
  // The files join as inputs after the last input there is, in chain order.
  args.splice(lastInputEnd + 1, 0, ...audible.flatMap((l) => ['-i', l.path]));
  return { ...plan, args, ...(audioOutput ? { audioOutput } : {}) };
}

// ---------------------------------------------------------------- music as stems (milestone 16)

/** Where one stem is written beside the render: `<name>-<slug>.wav`, the slug from the stem's label. */
export function stemOutputPath(output: string, label: string, index: number): string {
  const slash = Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'));
  const dir = output.slice(0, slash + 1);
  let file = output.slice(slash + 1);
  file = file.replace(/_%0?\d*d(?=\.[^.]*$|$)/, '');
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `stem-${index + 1}`;
  return `${dir}${base}-${slug}.wav`;
}

/**
 * A render plan with each stem written as its own WAV beside the output
 * (milestone 16): one chain per stem — the layer's own trim, gain, delay and
 * fades, on its own silent bed, cut to exactly the rendered range — mapped to
 * `<name>-<stem>.wav` as a further output of the same command. Used when the
 * person asked for the music as files rather than in the mix, so an editor
 * can remix what Pulp placed; the rest of the mix is `applyLayerAudio`'s
 * business and is untouched here. No leveling: a stem handed to a mixer is
 * wanted as placed, not normalized on its own.
 */
export function applyStemAudio(plan: RenderPlan, stems: readonly { layer: SoundAudioLayer; label: string }[]): RenderPlan {
  const audible = stems.filter((s) => audibleLayers([s.layer], plan.length).length > 0);
  if (audible.length === 0 || plan.preset.animatedImage) return plan;

  const args = [...plan.args];
  if (args.indexOf('pipe:0') < 0 || args.indexOf(plan.output) < 0) return plan;

  const inputFlags: number[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '-i') inputFlags.push(i);
  const firstInputIndex = inputFlags.length;
  const lastInputEnd = inputFlags[inputFlags.length - 1]! + 1;

  const filter = audible.map((stem, i) => layerAudioFilter([stem.layer], plan, firstInputIndex + i, undefined, `s${i}`)).join(';');
  const vfAt = args.indexOf('-vf');
  const complexAt = args.indexOf('-filter_complex');
  if (complexAt >= 0) {
    args[complexAt + 1] = `${args[complexAt + 1]};${filter}`;
  } else if (vfAt >= 0) {
    const chain = args[vfAt + 1]!;
    args.splice(vfAt, 2, '-filter_complex', `[0:v]${chain}[vout];${filter}`, '-map', '[vout]');
  } else {
    return plan;
  }
  const stemOutputs = audible.map((stem, i) => stemOutputPath(plan.output, stem.label, i));
  audible.forEach((_, i) => args.push('-map', `[aouts${i}]`, '-c:a', 'pcm_s16le', stemOutputs[i]!));
  args.splice(lastInputEnd + 1, 0, ...audible.flatMap((s) => ['-i', s.layer.path]));
  return { ...plan, args, stemOutputs: [...(plan.stemOutputs ?? []), ...stemOutputs] };
}
