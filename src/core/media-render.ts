/**
 * Rendering a library item itself (milestone 15): a clip, a still, a layered
 * file or a sound transcoded with the same presets a template renders to, so
 * a collection is never a dead end. Pure: this turns an item's measured facts
 * and the render options into ffmpeg argument lists; the main process spawns
 * them (src/main/media-render.ts).
 *
 * What the options mean for media:
 * - `length` holds a still for that long, or loops a clip to it. A clip looped
 *   past its own length is joined with a **crossfade**: its last `crossfade`
 *   seconds fade into its first, which makes a seamless unit one crossfade
 *   shorter than the clip. That unit is written once to a scratch file and
 *   then stream-looped to length, so memory stays flat however long the
 *   result; a loop with no crossfade, and a still, need no scratch at all.
 * - `speed` plays a clip faster or slower (and its sound with it).
 * - `fps`, `width`/`height`, `inFrame`/`outFrame`, `background` and `matte`
 *   mean what they mean for a template.
 * - Audio items render with the audio presets, with `audio` saying the sample
 *   rate, channels and bit depth.
 */

import type { MediaEntry } from './library-types';
import { isValidColor } from './manifest';
import { sequencePatternName, SEQUENCE_FPS } from './media-sequence';
import {
  AUDIO_BIT_DEPTHS, AUDIO_SAMPLE_RATES, matteCodecArgs, matteFilters, matteOutputPath, normalizeOutputPath, OUTPUT_PRESETS, REC709_CONVERT, REC709_TAGS,
  RenderPlanError, RGB_FULL_TAGS, type AudioOptions, type OutputPreset, type PresetId, type RenderOptions,
} from './render-plan';
import { fpsToRational, isStandardFrameRate, STANDARD_FRAME_RATES } from './timecode';

// ---------------------------------------------------------------- audio presets

export type AudioPresetId = 'wav-pcm' | 'aac-m4a' | 'mp3';

export interface AudioPreset {
  id: AudioPresetId;
  label: string;
  description: string;
  extension: string;
  /** ffmpeg encoder that must be present; "pcm" is always there. */
  encoder: string;
}

export const AUDIO_PRESETS: Record<AudioPresetId, AudioPreset> = {
  'wav-pcm': { id: 'wav-pcm', label: 'WAV (PCM)', description: 'Uncompressed audio, 16 or 24 bit. Edits anywhere.', extension: '.wav', encoder: 'pcm_s16le' },
  'aac-m4a': { id: 'aac-m4a', label: 'AAC (M4A)', description: 'Compressed audio at 256 kb/s for delivery and review.', extension: '.m4a', encoder: 'aac' },
  mp3: { id: 'mp3', label: 'MP3', description: 'Compressed audio that plays everywhere, high quality setting.', extension: '.mp3', encoder: 'libmp3lame' },
};

export const AUDIO_PRESET_IDS = Object.keys(AUDIO_PRESETS) as AudioPresetId[];

export function isAudioPresetId(id: string): id is AudioPresetId {
  return id in AUDIO_PRESETS;
}

/** The sound a video output carries, by container; a PNG sequence carries none. */
export function audioCodecArgsFor(preset: OutputPreset): string[] | null {
  switch (preset.extension) {
    case '.mov': return ['-c:a', 'pcm_s16le'];
    case '.mp4': return ['-c:a', 'aac', '-b:a', '192k'];
    case '.webm': return ['-c:a', 'libopus', '-b:a', '128k'];
    default: return null;
  }
}

// ---------------------------------------------------------------- what an item is

export type MediaInput =
  | { path: string }
  /** A run of numbered frames read as one clip (milestone 26). */
  | { pattern: string; start: number; fps: number };

export interface MediaSource {
  kind: 'video' | 'image' | 'audio';
  input: MediaInput;
  width?: number;
  height?: number;
  /** Seconds; a still has none. */
  duration?: number;
  fps?: number;
  alpha: boolean;
  hasAudio: boolean;
}

/**
 * What the library knows about an item, as a source: its measured size, length
 * and rate where it has been probed. A layered Photoshop file is a still here;
 * the main process swaps in its composite (src/main/media-render.ts). Absent
 * measurements leave the fields out, and the timing says the item is not yet
 * measured rather than guessing.
 */
export function sourceFromEntry(entry: MediaEntry): MediaSource {
  const meta = entry.meta;
  if (entry.sequence) {
    const fps = meta?.fps ?? SEQUENCE_FPS;
    return {
      kind: 'video',
      input: { pattern: `${entry.sequence.dir}/${sequencePatternName(entry.sequence)}`, start: entry.sequence.start, fps },
      ...(meta?.width ? { width: meta.width } : {}),
      ...(meta?.height ? { height: meta.height } : {}),
      duration: entry.sequence.count / fps,
      fps,
      alpha: meta?.alpha === true,
      hasAudio: false,
    };
  }
  const ext = entry.ext.toLowerCase();
  return {
    kind: entry.mediaKind,
    input: { path: entry.path },
    ...(meta?.width ? { width: meta.width } : {}),
    ...(meta?.height ? { height: meta.height } : {}),
    ...(meta?.duration ? { duration: meta.duration } : {}),
    ...(meta?.fps ? { fps: meta.fps } : {}),
    alpha: meta?.alpha === true || ext === '.png' || ext === '.svg' || ext === '.psd' || ext === '.webp' || ext === '.gif',
    hasAudio: entry.mediaKind === 'audio' || meta?.audioCodec !== undefined,
  };
}

/** The message resolveMediaTiming gives for an item the library has not measured; the window treats it as "wait", not "wrong". */
export const NOT_MEASURED = 'the item has not been measured yet';

/** How long a still is held when no length is asked for. */
export const DEFAULT_STILL_SECONDS = 5;
/** The rate a still or a clip of unknown rate is written at when none is asked for. */
export const DEFAULT_MEDIA_FPS = 30;
/** The crossfade at a loop join when none is given, held under a quarter of the clip. */
export const DEFAULT_CROSSFADE_SECONDS = 0.5;
export const SPEED_LIMITS = { min: 0.1, max: 10 } as const;
/** The timecode base for a sound, which has no frames of its own. */
export const AUDIO_TIMECODE_FPS = 25;

/**
 * The rate an item is counted at when none is asked for: a clip's own, a sound
 * at the timecode base, a still at the default. The Output tab's trim fields
 * and the transport row's scrub bar both count in these frames, so a mark set
 * on the bar is the frame the field shows (milestones 15 and 37).
 */
export function mediaDefaultFps(entry: MediaEntry): number {
  const source = sourceFromEntry(entry);
  return source.kind === 'image' ? DEFAULT_MEDIA_FPS : source.kind === 'audio' ? AUDIO_TIMECODE_FPS : source.fps ?? DEFAULT_MEDIA_FPS;
}

export interface MediaTiming {
  fps: number;
  speed: number;
  /** The item's own length at this speed: a still's default hold, a clip's duration. */
  natural: number;
  /** Seconds the output runs for before any trim. */
  length: number;
  /** True when a clip or sound must repeat to reach the length. */
  loops: boolean;
  /** Seconds of crossfade at each join; 0 for a plain repeat. */
  crossfade: number;
  /** The seamless unit's length when a crossfade is used: the clip less one crossfade. */
  unitSeconds: number;
  /** How many more times the unit or the clip plays after the first, to cover the length. */
  repeats: number;
  firstFrame: number;
  totalFrames: number;
}

/**
 * The frame rate, length, loop and trim a render will have. Everything the
 * Output tab says about a media render and everything the stages encode comes
 * from here, so the two cannot disagree.
 */
export function resolveMediaTiming(source: MediaSource, options: RenderOptions = {}): MediaTiming {
  const isStill = source.kind === 'image';
  const isAudio = source.kind === 'audio';
  if (options.fps !== undefined && !isStandardFrameRate(options.fps)) {
    throw new RenderPlanError(`frame rate must be one of ${STANDARD_FRAME_RATES.map((r) => r.fps).join(', ')}, got ${String(options.fps)}`);
  }
  const fps = options.fps ?? (isAudio ? AUDIO_TIMECODE_FPS : isStill ? DEFAULT_MEDIA_FPS : source.fps ?? DEFAULT_MEDIA_FPS);
  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed < SPEED_LIMITS.min || speed > SPEED_LIMITS.max) {
    throw new RenderPlanError(`speed must be from ${SPEED_LIMITS.min} to ${SPEED_LIMITS.max}, got ${String(options.speed)}`);
  }
  if (isStill && speed !== 1) throw new RenderPlanError('a still has no speed');
  if (!isStill && !(source.duration && source.duration > 0)) throw new RenderPlanError(`${NOT_MEASURED}; its length is not known`);
  const natural = isStill ? DEFAULT_STILL_SECONDS : source.duration! / speed;
  if (options.length !== undefined && (!Number.isFinite(options.length) || options.length <= 0)) {
    throw new RenderPlanError(`length must be a number of seconds greater than 0, got ${String(options.length)}`);
  }
  const length = options.length ?? natural;
  const loops = !isStill && length > natural + 1e-6;
  let crossfade = 0;
  if (loops) {
    const asked = options.crossfade ?? Math.min(DEFAULT_CROSSFADE_SECONDS, natural / 4);
    if (!Number.isFinite(asked) || asked < 0) throw new RenderPlanError(`crossfade must be a number of seconds, 0 or more, got ${String(options.crossfade)}`);
    if (asked >= natural / 2) throw new RenderPlanError(`a crossfade of ${asked} s needs a clip longer than ${(asked * 2).toFixed(2)} s; this one runs ${natural.toFixed(2)} s`);
    crossfade = asked;
  }
  const unitSeconds = loops ? natural - crossfade : natural;
  const repeats = loops ? Math.max(0, Math.ceil(length / unitSeconds) - 1) : 0;
  const lastFrame = Math.max(1, Math.round(length * fps)) - 1;
  const inFrame = options.inFrame ?? 0;
  const outFrame = options.outFrame ?? lastFrame;
  if (!Number.isInteger(inFrame) || inFrame < 0) throw new RenderPlanError(`in point must be a frame number of 0 or more, got ${String(options.inFrame)}`);
  if (!Number.isInteger(outFrame) || outFrame > lastFrame) throw new RenderPlanError(`out point must be at most the last frame (${lastFrame} at ${fps} fps), got ${String(options.outFrame)}`);
  if (outFrame < inFrame) throw new RenderPlanError(`out point (frame ${outFrame}) must not be before the in point (frame ${inFrame})`);
  return { fps, speed, natural, length, loops, crossfade, unitSeconds, repeats, firstFrame: inFrame, totalFrames: outFrame - inFrame + 1 };
}

// ---------------------------------------------------------------- the plan

export interface MediaRenderInput {
  source: MediaSource;
  presetId: string;
  outputPath: string;
  options?: RenderOptions;
  overwrite?: boolean;
  /** A folder for the loop unit when a crossfaded loop needs one; a plan that needs it and has none is refused. */
  scratchDir?: string;
}

export interface MediaRenderStage {
  args: string[];
  /** What the stage writes; the last stage's is the render. */
  output: string;
}

export interface MediaRenderPlan {
  kind: 'video' | 'audio';
  preset: OutputPreset | AudioPreset;
  stages: MediaRenderStage[];
  output: string;
  matteOutput?: string;
  timing: MediaTiming;
  width: number;
  height: number;
  warnings: string[];
}

function hexToFfmpegColor(hex: string): string {
  return `0x${hex.slice(1, 7)}`;
}

/**
 * Recolor (milestone 15): the picture's luminance in one colour, alpha kept —
 * what a light leak or a texture is tinted to match a palette. One
 * colorchannelmixer: each output channel is the Rec.601 luma scaled by the
 * tint's channel, so grey stays the tint and black stays black.
 */
export function tintFilter(tint: string): string {
  const r = parseInt(tint.slice(1, 3), 16) / 255;
  const g = parseInt(tint.slice(3, 5), 16) / 255;
  const b = parseInt(tint.slice(5, 7), 16) / 255;
  const n = (v: number) => Number(v.toFixed(6));
  const row = (c: number) => `${n(0.299 * c)}:${n(0.587 * c)}:${n(0.114 * c)}:0`;
  return `format=rgba,colorchannelmixer=${row(r)}:${row(g)}:${row(b)}:0:0:0:1`;
}

/** ffmpeg's atempo takes 0.5 to 2 per step, so a wider change is a chain of them. */
export function atempoChain(speed: number): string[] {
  const steps: string[] = [];
  let left = speed;
  while (left > 2) {
    steps.push('atempo=2');
    left /= 2;
  }
  while (left < 0.5) {
    steps.push('atempo=0.5');
    left /= 0.5;
  }
  if (Math.abs(left - 1) > 1e-9) steps.push(`atempo=${Number(left.toFixed(6))}`);
  return steps;
}

/** The input flags for a source, with `-stream_loop` when it plays again as it is. */
function inputArgs(source: MediaSource, repeats: number, fps: number, holdSeconds?: number): string[] {
  const loop = repeats > 0 ? ['-stream_loop', String(repeats)] : [];
  if ('pattern' in source.input) return [...loop, '-framerate', String(source.input.fps), '-start_number', String(source.input.start), '-i', source.input.pattern];
  if (source.kind === 'image') return ['-loop', '1', '-framerate', String(fps), '-t', String(holdSeconds ?? DEFAULT_STILL_SECONDS), '-i', source.input.path];
  return [...loop, '-i', source.input.path];
}

/** Scale into the asked size, keeping the picture's shape, with the rest left clear (or in the background colour). */
function fitFilter(width: number, height: number, clear: boolean, background: string): string {
  const pad = clear ? '0x00000000' : hexToFfmpegColor(background);
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${pad}`;
}

function sizeOf(source: MediaSource, options: RenderOptions, preset: OutputPreset): { width: number; height: number; fitted: boolean } {
  const own = { width: source.width ?? 0, height: source.height ?? 0 };
  const asked = options.width !== undefined || options.height !== undefined;
  if (asked) {
    const width = options.width ?? Math.round((own.width / Math.max(1, own.height)) * (options.height ?? own.height));
    const height = options.height ?? Math.round((own.height / Math.max(1, own.width)) * width);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) throw new RenderPlanError(`width and height must be whole numbers of at least 2, got ${String(options.width)} × ${String(options.height)}`);
    if (preset.requiresEvenDimensions && (width % 2 !== 0 || height % 2 !== 0)) throw new RenderPlanError(`${preset.label} needs even width and height; the output size is ${width}x${height}`);
    return { width, height, fitted: true };
  }
  if (own.width === 0 || own.height === 0) throw new RenderPlanError(`${NOT_MEASURED}; its size is not known`);
  if (preset.requiresEvenDimensions && (own.width % 2 !== 0 || own.height % 2 !== 0)) {
    // An odd source is not a mistake the person made: it is fitted to the even size just under it.
    return { width: own.width - (own.width % 2), height: own.height - (own.height % 2), fitted: true };
  }
  return { width: own.width, height: own.height, fitted: false };
}

/**
 * The seamless loop unit (video, and sound when there is any): the clip's
 * head crossfaded under its tail, written losslessly to the scratch folder.
 * `in` labels are the normalised streams this builds from.
 */
function loopUnitGraph(timing: MediaTiming, video: boolean, audio: boolean): { graph: string; maps: string[] } {
  const { natural: d, crossfade: x } = timing;
  const parts: string[] = [];
  const maps: string[] = [];
  if (video) {
    parts.push(
      `[vin]split=3[vb][vt][vh]`,
      `[vb]trim=start=${x}:end=${d - x},setpts=PTS-STARTPTS[body]`,
      `[vt]trim=start=${d - x}:end=${d},setpts=PTS-STARTPTS[tail]`,
      `[vh]trim=start=0:end=${x},setpts=PTS-STARTPTS[head]`,
      `[tail][head]xfade=transition=fade:duration=${x}:offset=0[join]`,
      `[body][join]concat=n=2:v=1:a=0[vunit]`,
    );
    maps.push('-map', '[vunit]');
  }
  if (audio) {
    parts.push(
      `[ain]asplit=3[ab][at][ah]`,
      `[ab]atrim=start=${x}:end=${d - x},asetpts=PTS-STARTPTS[abody]`,
      `[at]atrim=start=${d - x}:end=${d},asetpts=PTS-STARTPTS[atail]`,
      `[ah]atrim=start=0:end=${x},asetpts=PTS-STARTPTS[ahead]`,
      `[atail][ahead]acrossfade=d=${x}:c1=tri:c2=tri[ajoin]`,
      `[abody][ajoin]concat=n=2:v=0:a=1[aunit]`,
    );
    maps.push('-map', '[aunit]');
  }
  return { graph: parts.join(';'), maps };
}

const PROGRESS = ['-progress', 'pipe:1', '-nostats'];

function videoPlan(input: MediaRenderInput, preset: OutputPreset): MediaRenderPlan {
  const { source } = input;
  const options = input.options ?? {};
  if (source.kind === 'audio') throw new RenderPlanError(`a sound renders with an audio preset, not ${preset.label}`);
  const timing = resolveMediaTiming(source, options);
  const fps = fpsToRational(timing.fps);
  const background = options.background ?? '#000000';
  if (!isValidColor(background)) throw new RenderPlanError(`background must be #RRGGBB, got "${background}"`);
  const { width, height, fitted } = sizeOf(source, options, preset);
  const output = normalizeOutputPath(input.outputPath, preset);
  const matte = options.matte === true;
  const matteOutput = matte ? matteOutputPath(output, preset) : undefined;
  const warnings: string[] = [];
  const audioArgs = audioCodecArgsFor(preset);
  const withAudio = source.hasAudio && audioArgs !== null;
  const crossfaded = timing.loops && timing.crossfade > 0;
  if (crossfaded && !input.scratchDir) throw new RenderPlanError('a crossfaded loop needs a scratch folder to write its loop unit to');
  const overwrite = input.overwrite ? '-y' : '-n';
  const head = ['-hide_banner', '-loglevel', 'error', overwrite, ...PROGRESS];

  const tint = options.tint;
  if (tint !== undefined && !isValidColor(tint)) throw new RenderPlanError(`tint must be #RRGGBB, got "${tint}"`);
  // What every path normalises the picture to first: speed, a constant output rate, the recolor, the size.
  const normalise = (speedToo: boolean): string[] => [
    ...(speedToo && timing.speed !== 1 ? [`setpts=PTS/${timing.speed}`] : []),
    `fps=${fps}`,
    ...(tint ? [tintFilter(tint)] : []),
    ...(fitted ? [fitFilter(width, height, preset.alpha || matte || source.alpha, background)] : []),
  ];
  const normaliseAudio = (speedToo: boolean): string[] => (speedToo && timing.speed !== 1 ? atempoChain(timing.speed) : []);

  const stages: MediaRenderStage[] = [];
  let finalInput: string[];
  let finalVideoPrepare: string[];
  let finalAudioPrepare: string[];
  if (crossfaded) {
    // Stage one: the seamless unit, lossless, in the scratch folder.
    const unit = `${input.scratchDir!.replace(/[\\/]+$/, '')}/loop-unit.mov`;
    const { graph, maps } = loopUnitGraph(timing, true, withAudio);
    const prepared = [`[0:v]${normalise(true).join(',')}[vin]`, ...(withAudio ? [`[0:a]${[...normaliseAudio(true), 'anull'].join(',')}[ain]`] : [])].join(';');
    stages.push({
      output: unit,
      args: [...head.slice(0, 3), '-y', ...PROGRESS, ...inputArgs(source, 0, timing.fps), '-filter_complex', `${prepared};${graph}`, ...maps, '-c:v', 'png', '-pix_fmt', source.alpha ? 'rgba' : 'rgb24', ...(withAudio ? ['-c:a', 'pcm_s16le'] : []), unit],
    });
    finalInput = ['-stream_loop', String(timing.repeats), '-i', unit];
    finalVideoPrepare = [];
    finalAudioPrepare = [];
  } else {
    finalInput = inputArgs(source, timing.loops ? timing.repeats : 0, timing.fps, timing.length);
    finalVideoPrepare = normalise(true);
    finalAudioPrepare = normaliseAudio(true);
  }

  // The final stage: trim to the asked frames, flatten or keep alpha, the preset's colour and format, the matte.
  const start = timing.firstFrame / timing.fps;
  const end = (timing.firstFrame + timing.totalFrames) / timing.fps;
  const trimV = `trim=start=${start}:end=${end},setpts=PTS-STARTPTS`;
  const trimA = `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`;
  const toOutput = preset.color === 'rec709' ? [REC709_CONVERT, REC709_TAGS] : [RGB_FULL_TAGS];
  toOutput.push(`format=${preset.pixelFormat}`);
  const parts: string[] = [`[0:v]${[...finalVideoPrepare, trimV].join(',')}[src]`];
  if (matte) parts.push(`[src]split[pic][mat]`, `[mat]${matteFilters(preset)}[matte]`);
  const pic = matte ? '[pic]' : '[src]';
  if (!preset.alpha && source.alpha) {
    // Transparent media flattened over the background colour, as an alpha template is.
    parts.push(`color=c=${hexToFfmpegColor(background)}:s=${width}x${height}:r=${fps}[bg]`, `[bg]${pic}overlay=shortest=1:format=rgb,${toOutput.join(',')}[out]`);
  } else {
    parts.push(`${pic}${toOutput.join(',')}[out]`);
  }
  if (withAudio) parts.push(`[0:a]${[...finalAudioPrepare, trimA].join(',')}[aout]`);
  const args = [...head, ...finalInput, '-filter_complex', parts.join(';'), '-map', '[out]'];
  if (withAudio) args.push('-map', '[aout]', ...audioArgs!);
  else args.push('-an');
  args.push(...preset.codecArgs);
  if (preset.sequence) args.push('-start_number', String(timing.firstFrame));
  args.push('-frames:v', String(timing.totalFrames), '-r', fps, output);
  if (matte && matteOutput) {
    args.push('-map', '[matte]', '-an', ...matteCodecArgs(preset));
    if (preset.sequence) args.push('-start_number', String(timing.firstFrame));
    args.push('-frames:v', String(timing.totalFrames), '-r', fps, matteOutput);
  }
  stages.push({ output, args });
  if (preset.alpha && !source.alpha) warnings.push('the item has no alpha; the output carries an alpha channel that is fully opaque');
  if (matte && !source.alpha) warnings.push('the item has no alpha, so its matte is all white');
  return { kind: 'video', preset, stages, output, ...(matteOutput ? { matteOutput } : {}), timing, width, height, warnings };
}

/** The encoder arguments for an audio preset with the asked bit depth. */
export function audioPresetArgs(preset: AudioPreset, audio: AudioOptions = {}): string[] {
  const bitDepth = audio.bitDepth ?? 16;
  if (!(AUDIO_BIT_DEPTHS as readonly number[]).includes(bitDepth)) throw new RenderPlanError(`bit depth must be ${AUDIO_BIT_DEPTHS.join(' or ')}, got ${String(audio.bitDepth)}`);
  if (audio.sampleRate !== undefined && !(AUDIO_SAMPLE_RATES as readonly number[]).includes(audio.sampleRate)) throw new RenderPlanError(`sample rate must be one of ${AUDIO_SAMPLE_RATES.join(', ')}, got ${String(audio.sampleRate)}`);
  if (audio.channels !== undefined && ![1, 2].includes(audio.channels)) throw new RenderPlanError(`channels must be 1 or 2, got ${String(audio.channels)}`);
  const codec = preset.id === 'wav-pcm' ? ['-c:a', bitDepth === 24 ? 'pcm_s24le' : 'pcm_s16le'] : preset.id === 'aac-m4a' ? ['-c:a', 'aac', '-b:a', '256k'] : ['-c:a', 'libmp3lame', '-q:a', '2'];
  return [...codec, ...(audio.sampleRate ? ['-ar', String(audio.sampleRate)] : []), ...(audio.channels ? ['-ac', String(audio.channels)] : [])];
}

function audioPlan(input: MediaRenderInput, preset: AudioPreset): MediaRenderPlan {
  const { source } = input;
  const options = input.options ?? {};
  if (source.kind !== 'audio' && !source.hasAudio) throw new RenderPlanError(`${preset.label} writes sound, and this item has none`);
  const timing = resolveMediaTiming({ ...source, kind: 'audio' }, options);
  const output = normalizeOutputPath(input.outputPath, { extension: preset.extension, sequence: false } as OutputPreset);
  const codec = audioPresetArgs(preset, options.audio);
  const crossfaded = timing.loops && timing.crossfade > 0;
  if (crossfaded && !input.scratchDir) throw new RenderPlanError('a crossfaded loop needs a scratch folder to write its loop unit to');
  const head = ['-hide_banner', '-loglevel', 'error', input.overwrite ? '-y' : '-n', ...PROGRESS];
  const stages: MediaRenderStage[] = [];
  let finalInput: string[];
  let prepare: string[];
  if (crossfaded) {
    const unit = `${input.scratchDir!.replace(/[\\/]+$/, '')}/loop-unit.wav`;
    const { graph, maps } = loopUnitGraph(timing, false, true);
    stages.push({ output: unit, args: [...head.slice(0, 3), '-y', ...PROGRESS, ...inputArgs(source, 0, timing.fps), '-vn', '-filter_complex', `[0:a]${[...atempoChain(timing.speed), 'anull'].join(',')}[ain];${graph}`, ...maps, '-c:a', 'pcm_s16le', unit] });
    finalInput = ['-stream_loop', String(timing.repeats), '-i', unit];
    prepare = [];
  } else {
    finalInput = inputArgs(source, timing.loops ? timing.repeats : 0, timing.fps);
    prepare = atempoChain(timing.speed);
  }
  const start = timing.firstFrame / timing.fps;
  const end = (timing.firstFrame + timing.totalFrames) / timing.fps;
  const args = [...head, ...finalInput, '-vn', '-af', [...prepare, `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`].join(','), ...codec, output];
  stages.push({ output, args });
  return { kind: 'audio', preset, stages, output, timing, width: 0, height: 0, warnings: [] };
}

export function buildMediaRenderPlan(input: MediaRenderInput): MediaRenderPlan {
  if (isAudioPresetId(input.presetId)) return audioPlan(input, AUDIO_PRESETS[input.presetId]);
  const preset = OUTPUT_PRESETS[input.presetId as PresetId];
  if (!preset) throw new RenderPlanError(`unknown output preset "${input.presetId}"`);
  return videoPlan(input, preset);
}

/** A line in ffmpeg's `-progress` output, read for how far a stage has got: frames, or seconds for sound. */
export function parseProgressLine(line: string): { frame?: number; seconds?: number } {
  const [key, value] = line.trim().split('=');
  if (key === 'frame' && value !== undefined) return { frame: Number(value) };
  if (key === 'out_time_us' && value !== undefined) return { seconds: Number(value) / 1_000_000 };
  if (key === 'out_time_ms' && value !== undefined) return { seconds: Number(value) / 1_000_000 };
  return {};
}
