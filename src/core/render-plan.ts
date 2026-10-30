/**
 * Render planner: turns a template's timing/size plus an output preset into
 * the exact ffmpeg argument list. Pure; does not spawn anything.
 *
 * Frames are captured by the host and written to ffmpeg's stdin. The default
 * is raw pixels, which skip a PNG encode and decode per frame:
 *   -f rawvideo -pixel_format bgra -video_size WxH -framerate <fps> -i pipe:0
 * The PNG path is kept for comparison (frameFormat 'png'):
 *   -f image2pipe -framerate <fps> -c:v png -i pipe:0
 *
 * The raw bitmap's byte order and whether its colors are premultiplied by
 * alpha are measured by the host (capture-format.ts) and passed in as
 * `rawInput`. Premultiplied frames from alpha templates go through ffmpeg's
 * unpremultiply filter so semi-transparent edges keep their color. That
 * filter is fed planar RGB explicitly, so format negotiation cannot route it
 * through a lossy Y'CbCr intermediate.
 *
 * ffmpeg 8.1 and later negotiate an alpha mode on filter links. Untagged raw
 * input counts as straight alpha there, and the graph silently premultiplies
 * it before an unpremultiply filter, which leaves the output premultiplied
 * and one step low everywhere. When the host reports `tagAlphaMode`, raw
 * frames are tagged with the measured layout as the first filter.
 *
 * Color (ADR 0004): templates draw in sRGB. Video presets convert to Y'CbCr
 * with the BT.709 matrix at limited range and tag every frame BT.709 /
 * limited, after any compositing over the background color. PNG sequences
 * stay full-range RGB.
 */

import { AspectError, resolveRenderSize } from './aspect';
import { resolveLength, type TemplateStructure } from './timing';
import { isValidColor, type TemplateManifest } from './manifest';
import { fpsToRational, isStandardFrameRate, STANDARD_FRAME_RATES } from './timecode';

export { fpsToRational } from './timecode';

export type PresetId = 'prores-4444' | 'prores-422hq' | 'png-sequence' | 'webm-vp9-alpha' | 'h264-mp4' | 'qt-animation' | 'hevc-alpha';

/** How captured frames are handed to ffmpeg: raw BGRA pixels or PNG images. */
export type FrameFormat = 'raw' | 'png';
export const FRAME_FORMATS: readonly FrameFormat[] = ['raw', 'png'];
export const DEFAULT_FRAME_FORMAT: FrameFormat = 'raw';

/** Layout of the raw frames on the pipe. */
export interface RawInput {
  pixelFormat: 'bgra' | 'rgba';
  premultiplied: boolean;
}
/** What Chromium produces on macOS; the host measures the real value before each render. */
export const DEFAULT_RAW_INPUT: RawInput = { pixelFormat: 'bgra', premultiplied: true };

/** Undo premultiplied alpha without going through Y'CbCr. */
export const UNPREMULTIPLY = 'format=gbrap,unpremultiply=inplace=1';

/** Tell ffmpeg 8.1+ what the raw frames' alpha is, so it does not guess (and premultiply) for us. */
export function alphaModeTag(premultiplied: boolean): string {
  return `setparams=alpha_mode=${premultiplied ? 'premultiplied' : 'straight'}`;
}

export interface OutputPreset {
  id: PresetId;
  label: string;
  description: string;
  /** File extension including the dot. */
  extension: string;
  /** True if the output keeps the alpha channel. */
  alpha: boolean;
  /** True if the output is a numbered image sequence rather than one file. */
  sequence: boolean;
  /** True if the pixel format needs even width and height (chroma subsampling). */
  requiresEvenDimensions: boolean;
  /** ffmpeg encoder that must be present (checked against `ffmpeg -encoders`). */
  encoder: string;
  pixelFormat: string;
  codecArgs: readonly string[];
  /** 'rec709': BT.709 matrix, limited range, tagged. 'rgb': full-range RGB left untouched. */
  color: 'rec709' | 'rgb';
  /** Why the encoder may be missing, shown next to the preset when it is. */
  platformNote?: string;
}

/** Rec.709 output, step 1: convert RGB to Y'CbCr with the BT.709 matrix at limited (video) range. */
export const REC709_CONVERT = 'scale=out_color_matrix=bt709:out_range=tv';
/** Rec.709 output, step 2: tag every frame so the muxer writes colr / VUI / Matroska Colour. */
export const REC709_TAGS = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
/**
 * RGB output (PNG, QuickTime Animation): full range, the GBR matrix (meaning
 * "this is RGB, not Y'CbCr") and BT.709 primaries and transfer. QuickTime's
 * colr atom has no range field for RGB codecs; the GBR matrix is how a reader
 * knows the data is full-range RGB, and without it Resolve's Data Levels
 * "Auto" treated QuickTime Animation as video range and scaled the alpha.
 */
export const RGB_FULL_TAGS = 'setparams=range=pc:color_primaries=bt709:color_trc=bt709:colorspace=gbr';

export const OUTPUT_PRESETS: Record<PresetId, OutputPreset> = {
  'prores-4444': {
    id: 'prores-4444',
    label: 'ProRes 4444 (alpha)',
    description: 'QuickTime .mov with alpha. Edits well in Premiere Pro and DaVinci Resolve. Large files.',
    extension: '.mov',
    alpha: true,
    sequence: false,
    requiresEvenDimensions: false,
    encoder: 'prores_ks',
    pixelFormat: 'yuva444p10le',
    color: 'rec709',
    codecArgs: ['-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0', '-alpha_bits', '16'],
  },
  'prores-422hq': {
    id: 'prores-422hq',
    label: 'ProRes 422 HQ',
    description: 'QuickTime .mov without alpha. Transparent areas are flattened over the background color.',
    extension: '.mov',
    alpha: false,
    sequence: false,
    requiresEvenDimensions: true,
    encoder: 'prores_ks',
    pixelFormat: 'yuv422p10le',
    color: 'rec709',
    codecArgs: ['-c:v', 'prores_ks', '-profile:v', 'hq', '-vendor', 'apl0'],
  },
  'png-sequence': {
    id: 'png-sequence',
    label: 'PNG sequence (alpha)',
    description: 'Numbered RGBA PNG files. Lossless and universally supported; import as an image sequence.',
    extension: '.png',
    alpha: true,
    sequence: true,
    requiresEvenDimensions: false,
    encoder: 'png',
    pixelFormat: 'rgba',
    color: 'rgb',
    // -start_number is added by buildRenderPlan: the files carry the frame indices of the render.
    codecArgs: ['-c:v', 'png', '-f', 'image2'],
  },
  'webm-vp9-alpha': {
    id: 'webm-vp9-alpha',
    label: 'WebM VP9 (alpha)',
    description: 'Small files with alpha for web use and some editors. Not supported for alpha by every NLE.',
    extension: '.webm',
    alpha: true,
    sequence: false,
    requiresEvenDimensions: true,
    encoder: 'libvpx-vp9',
    pixelFormat: 'yuva420p',
    color: 'rec709',
    codecArgs: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-auto-alt-ref', '0'],
  },
  'h264-mp4': {
    id: 'h264-mp4',
    label: 'H.264 MP4',
    description: 'Universal delivery or review file without alpha. Transparent areas are flattened over the background color.',
    extension: '.mp4',
    alpha: false,
    sequence: false,
    requiresEvenDimensions: true,
    encoder: 'libx264',
    pixelFormat: 'yuv420p',
    color: 'rec709',
    codecArgs: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart'],
  },
  'qt-animation': {
    id: 'qt-animation',
    label: 'QuickTime Animation (alpha)',
    description: 'Lossless RLE .mov with alpha for older workflows. Small with lots of transparency, large for full-frame content.',
    extension: '.mov',
    alpha: true,
    sequence: false,
    requiresEvenDimensions: false,
    encoder: 'qtrle',
    pixelFormat: 'argb',
    color: 'rgb',
    codecArgs: ['-c:v', 'qtrle'],
  },
  'hevc-alpha': {
    id: 'hevc-alpha',
    label: 'HEVC (alpha, macOS only)',
    description: '.mov with alpha encoded by Apple VideoToolbox. Small files for recent macOS apps; DaVinci Resolve reads it with Alpha Mode set to Straight, Premiere Pro does not read the alpha. Quality 80, alpha quality 0.9.',
    extension: '.mov',
    alpha: true,
    sequence: false,
    requiresEvenDimensions: true,
    encoder: 'hevc_videotoolbox',
    // 4:4:4 Y'CbCr with alpha, converted and tagged by the Rec.709 steps (ADR 0005): from BGRA the
    // encoder converts itself and leaves the matrix untagged. hvc1 is the tag Apple's players expect.
    pixelFormat: 'ayuv',
    color: 'rec709',
    codecArgs: ['-c:v', 'hevc_videotoolbox', '-q:v', '80', '-alpha_quality', '0.9', '-tag:v', 'hvc1'],
    platformNote: 'macOS only: Apple VideoToolbox',
  },
};

export const PRESET_IDS = Object.keys(OUTPUT_PRESETS) as PresetId[];

export class RenderPlanError extends Error {
  override name = 'RenderPlanError';
}

/** Per-render choices on top of the template's timing and the preset. All optional. */
export interface RenderOptions {
  /** Output frame rate, one of STANDARD_FRAME_RATES. Frames are sampled from the template's timeline at this rate. Default: the template's fps. */
  fps?: number;
  /** Background used when flattening an alpha template into a non-alpha preset. Default #000000. */
  background?: string;
  /** In point: first rendered frame, counted at the output frame rate. Default 0. */
  inFrame?: number;
  /** Out point: last rendered frame, inclusive as in editing apps, counted at the output frame rate. Default: the last frame. */
  outFrame?: number;
  /** Which of the template's aspects to render. Default: the one its declared size has, else its first. */
  aspect?: string;
  /** Output size in pixels, of the chosen aspect. Default: the template's declared size for that aspect, else the aspect's standard 1080-class size. */
  width?: number;
  height?: number;
  /**
   * Seconds the graphic is to run for (milestone 30). Only a template that
   * declares a structure can be stretched; for any other it is ignored, and
   * the template's own duration stands. For a media item (milestone 15) it is
   * the length to loop a clip to, or how long a still is held.
   */
  length?: number;
  /**
   * A second file beside the render holding the alpha as grey (milestone 15),
   * for codecs and editors without alpha: `<name>-matte<ext>`, encoded with the
   * same codec. Templates and media alike.
   */
  matte?: boolean;
  /** Media only (milestone 15): playback speed of a clip; 1 is as recorded. */
  speed?: number;
  /** Media only: seconds of crossfade at the join when a clip is looped past its own length. */
  crossfade?: number;
  /** Audio presets only: how the sound is written. */
  audio?: AudioOptions;
}

/** How an audio render is written (milestone 15); each unset field keeps the source's. */
export interface AudioOptions {
  sampleRate?: number;
  channels?: number;
  bitDepth?: 16 | 24;
}

export const AUDIO_SAMPLE_RATES = [44100, 48000, 96000] as const;
export const AUDIO_BIT_DEPTHS = [16, 24] as const;

// ---------------------------------------------------------------- the matte pass (milestone 15)

/** The matte's pixel format: the preset's own without its alpha, since a matte is grey. */
export const MATTE_PIXEL_FORMATS: Record<PresetId, string> = {
  'prores-4444': 'yuv444p10le',
  'prores-422hq': 'yuv422p10le',
  'png-sequence': 'rgb24',
  'webm-vp9-alpha': 'yuv420p',
  'h264-mp4': 'yuv420p',
  'qt-animation': 'rgb24',
  'hevc-alpha': 'yuv420p',
};

/** The preset's codec arguments with what only an alpha channel needs taken out. */
export function matteCodecArgs(preset: OutputPreset): string[] {
  const out: string[] = [];
  const args = preset.codecArgs;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-alpha_bits' || args[i] === '-alpha_quality') {
      i += 1;
      continue;
    }
    out.push(args[i]!);
  }
  return out;
}

/** Where the matte goes: beside the render, "-matte" before the extension; a sequence keeps its frame pattern. */
export function matteOutputPath(output: string, preset: OutputPreset): string {
  if (preset.sequence) {
    const m = /^(.*?)(_%0?\d*d)?(\.[^.\\/]+)$/.exec(output);
    if (m) return `${m[1]}-matte${m[2] ?? ''}${m[3]}`;
  }
  const dot = output.lastIndexOf('.');
  const slash = Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'));
  return dot > slash ? `${output.slice(0, dot)}-matte${output.slice(dot)}` : `${output}-matte`;
}

/** The filter steps that turn a straight-alpha picture into the grey matte in the preset's colour and format. */
export function matteFilters(preset: OutputPreset): string {
  const tags = preset.color === 'rec709' ? [REC709_CONVERT, REC709_TAGS] : [RGB_FULL_TAGS];
  return ['format=rgba', 'alphaextract', ...tags, `format=${MATTE_PIXEL_FORMATS[preset.id]}`].join(',');
}

export interface RenderTiming {
  /** Frame rate the frames are sampled and encoded at. */
  fps: number;
  /** Index of the first rendered frame on that timeline (time = frame / fps). */
  firstFrame: number;
  totalFrames: number;
  /** Seconds the whole graphic runs for, which a trim is taken within (milestone 30). */
  length: number;
}

/**
 * Frame rate and frame range for a render: the template's timing with the fps
 * override and in/out points applied. Frame indices stay on the (resampled)
 * template timeline, so a trimmed render shows the same picture at a given
 * second as a full one, and the output numbering can carry the same indices.
 */
export function resolveTiming(manifest: Pick<TemplateManifest, 'fps' | 'duration'> & { structure?: TemplateStructure }, options: RenderOptions = {}): RenderTiming {
  const fps = options.fps ?? manifest.fps;
  if (options.fps !== undefined && !isStandardFrameRate(options.fps)) {
    throw new RenderPlanError(
      `frame rate must be one of ${STANDARD_FRAME_RATES.map((r) => r.fps).join(', ')}, got ${String(options.fps)}`,
    );
  }
  // The length the graphic runs for: what was asked, held to what the structure allows, or the
  // template's own duration. A trim is then taken within that, as it always was.
  if (options.length !== undefined && (!Number.isFinite(options.length) || options.length <= 0)) {
    throw new RenderPlanError(`length must be a number of seconds greater than 0, got ${String(options.length)}`);
  }
  if (options.length !== undefined && !manifest.structure) {
    throw new RenderPlanError('this template does not declare an animate-in, hold and animate-out, so its length is fixed');
  }
  const length = resolveLength(manifest.duration, manifest.structure ?? null, options.length);
  // Like frameCount: a template shorter than one frame still has one frame.
  const lastFrame = Math.max(1, Math.round(length * fps)) - 1;
  const inFrame = options.inFrame ?? 0;
  const outFrame = options.outFrame ?? lastFrame;
  if (!Number.isInteger(inFrame) || inFrame < 0) throw new RenderPlanError(`in point must be a frame number of 0 or more, got ${String(options.inFrame)}`);
  if (!Number.isInteger(outFrame) || outFrame > lastFrame) {
    throw new RenderPlanError(`out point must be at most the last frame (${lastFrame} at ${fps} fps), got ${String(options.outFrame)}`);
  }
  if (outFrame < inFrame) throw new RenderPlanError(`out point (frame ${outFrame}) must not be before the in point (frame ${inFrame})`);
  return { fps, firstFrame: inFrame, totalFrames: outFrame - inFrame + 1, length };
}

export interface RenderPlanInput {
  manifest: Pick<TemplateManifest, 'fps' | 'duration' | 'alpha' | 'aspects' | 'size'>;
  presetId: string;
  /** Output file path. For PNG sequences, a `%05d` frame pattern is added if missing. */
  outputPath: string;
  /** Overwrite an existing output file. Default false (ffmpeg -n). */
  overwrite?: boolean;
  /** Frame rate, background and trim. */
  options?: RenderOptions;
  /** Frame encoding on the pipe. Defaults to DEFAULT_FRAME_FORMAT. */
  frameFormat?: FrameFormat;
  /** Byte layout of raw frames. Defaults to DEFAULT_RAW_INPUT. Ignored for PNG frames. */
  rawInput?: RawInput;
  /** Tag raw frames with their alpha mode (needs ffmpeg 8.1 or later; see FfmpegStatus.alphaModeAware). Default false. */
  tagAlphaMode?: boolean;
}

export interface RenderPlan {
  preset: OutputPreset;
  frameFormat: FrameFormat;
  /** Arguments to pass to ffmpeg (not including the executable). */
  args: string[];
  /** Final output path or, for sequences, the printf-style pattern. */
  output: string;
  /** Frame rate the frames are sampled and encoded at (the override, or the template's). */
  fps: number;
  /** First frame index on that timeline; 0 unless trimmed. */
  firstFrame: number;
  totalFrames: number;
  /** Seconds the whole graphic runs for; a trim is taken within it (milestone 30). */
  length: number;
  /** The aspect rendered and the frame size in pixels: the offscreen window, the capture check and ffmpeg's input all use this. */
  aspect: string;
  width: number;
  height: number;
  /** The grey matte written beside the render, when one was asked for (milestone 15). */
  matteOutput?: string;
  warnings: string[];
}

/** Make the output path agree with the preset's extension (and frame pattern for sequences). */
export function normalizeOutputPath(outputPath: string, preset: OutputPreset): string {
  const lastSlash = Math.max(outputPath.lastIndexOf('/'), outputPath.lastIndexOf('\\'));
  const dir = outputPath.slice(0, lastSlash + 1);
  let file = outputPath.slice(lastSlash + 1);
  if (file.length === 0) throw new RenderPlanError('output path must include a file name');

  const dot = file.lastIndexOf('.');
  const ext = dot > 0 ? file.slice(dot).toLowerCase() : '';
  if (ext !== preset.extension) {
    file = dot > 0 && ext.length <= 5 ? file.slice(0, dot) : file;
    file += preset.extension;
  }
  if (preset.sequence && !/%0?\d*d/.test(file)) {
    const base = file.slice(0, file.length - preset.extension.length);
    file = `${base}_%05d${preset.extension}`;
  }
  return dir + file;
}

function hexToFfmpegColor(hex: string): string {
  // ffmpeg accepts 0xRRGGBB[AA]; drop alpha because the background must be opaque.
  return `0x${hex.slice(1, 7)}`;
}

export function buildRenderPlan(input: RenderPlanInput): RenderPlan {
  const preset = OUTPUT_PRESETS[input.presetId as PresetId];
  if (!preset) {
    throw new RenderPlanError(`unknown output preset "${input.presetId}" (expected one of: ${PRESET_IDS.join(', ')})`);
  }
  const { manifest } = input;
  const warnings: string[] = [];

  let frameSize: ReturnType<typeof resolveRenderSize>;
  try {
    frameSize = resolveRenderSize(manifest, input.options ?? {});
  } catch (err) {
    if (err instanceof AspectError) throw new RenderPlanError(err.message);
    throw err;
  }
  const { width, height } = frameSize;
  if (preset.requiresEvenDimensions && (width % 2 !== 0 || height % 2 !== 0)) {
    throw new RenderPlanError(`${preset.label} needs even width and height; the output size is ${width}x${height}`);
  }
  if (preset.alpha && !manifest.alpha) {
    warnings.push('template does not declare alpha; output will carry an alpha channel but is likely fully opaque');
  }

  const background = input.options?.background ?? '#000000';
  if (!isValidColor(background)) throw new RenderPlanError(`background must be #RRGGBB, got "${background}"`);

  const timing = resolveTiming(manifest, input.options);
  const fps = fpsToRational(timing.fps);
  const totalFrames = timing.totalFrames;
  const output = normalizeOutputPath(input.outputPath, preset);
  const frameFormat = input.frameFormat ?? DEFAULT_FRAME_FORMAT;
  const rawInput = input.rawInput ?? DEFAULT_RAW_INPUT;
  const size = `${width}x${height}`;

  const args: string[] = ['-hide_banner', '-loglevel', 'error', input.overwrite ? '-y' : '-n'];
  if (frameFormat === 'raw') {
    args.push('-f', 'rawvideo', '-pixel_format', rawInput.pixelFormat, '-video_size', size, '-framerate', fps, '-i', 'pipe:0');
  } else {
    args.push('-f', 'image2pipe', '-framerate', fps, '-c:v', 'png', '-i', 'pipe:0');
  }

  // Steps applied to the raw frames before anything else: say what their alpha is (ffmpeg 8.1+
  // would otherwise assume straight and premultiply them), then undo premultiplication for alpha
  // templates. PNG frames and straight bitmaps need no undo, and opaque templates have nothing to undo.
  const prepare: string[] = [];
  if (frameFormat === 'raw' && input.tagAlphaMode) prepare.push(alphaModeTag(rawInput.premultiplied));
  if (frameFormat === 'raw' && rawInput.premultiplied && manifest.alpha) prepare.push(UNPREMULTIPLY);
  // From straight RGB to the preset's pixel format. Rec.709 presets convert and tag; the format
  // filter last makes the scale step do the conversion, with the matrix and range given above.
  const toOutput = preset.color === 'rec709' ? [REC709_CONVERT, REC709_TAGS] : [RGB_FULL_TAGS];
  toOutput.push(`format=${preset.pixelFormat}`);

  const matte = input.options?.matte === true;
  const matteOutput = matte ? matteOutputPath(output, preset) : undefined;
  // With a matte, the prepared frames are split: one branch to the picture, one to the grey (milestone 15).
  const prepared = prepare.length > 0 ? `[0:v]${prepare.join(',')}[src]` : '[0:v]null[src]';
  const split = `${prepared};[src]split[pic][mat];[mat]${matteFilters(preset)}[matte]`;
  if (!preset.alpha && manifest.alpha) {
    // Composite in RGB so the background color and the template pixels share one conversion.
    const foreground = matte ? `${split};[bg][pic]` : prepare.length > 0 ? `[0:v]${prepare.join(',')}[fg];[bg][fg]` : '[bg][0:v]';
    args.push(
      '-filter_complex',
      `color=c=${hexToFfmpegColor(background)}:s=${size}:r=${fps}[bg];${foreground}overlay=shortest=1:format=rgb,${toOutput.join(',')}[out]`,
      '-map', '[out]',
    );
  } else if (matte) {
    args.push('-filter_complex', `${split};[pic]${toOutput.join(',')}[out]`, '-map', '[out]');
  } else {
    args.push('-vf', [...prepare, ...toOutput].join(','));
  }

  args.push(...preset.codecArgs);
  // Sequence files are numbered with the frame indices they hold, so a render from frame 60 starts at _00060.
  if (preset.sequence) args.push('-start_number', String(timing.firstFrame));
  args.push('-frames:v', String(totalFrames), '-r', fps, output);
  if (matte && matteOutput) {
    args.push('-map', '[matte]', ...matteCodecArgs(preset));
    if (preset.sequence) args.push('-start_number', String(timing.firstFrame));
    args.push('-frames:v', String(totalFrames), '-r', fps, matteOutput);
  }
  return { preset, frameFormat, args, output, fps: timing.fps, firstFrame: timing.firstFrame, totalFrames, length: timing.length, aspect: frameSize.aspect, width, height, ...(matteOutput ? { matteOutput } : {}), warnings };
}
