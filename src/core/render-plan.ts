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

import { frameCount, isValidColor, type TemplateManifest } from './manifest';

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

export const OUTPUT_PRESETS: Record<PresetId, OutputPreset> = {
  'prores-4444': {
    id: 'prores-4444',
    label: 'ProRes 4444 (alpha)',
    description: 'QuickTime .mov with alpha. Edits well in Premiere Pro, DaVinci Resolve and Final Cut Pro. Large files.',
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
    codecArgs: ['-c:v', 'png', '-f', 'image2', '-start_number', '0'],
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
    description: '.mov with alpha encoded by Apple VideoToolbox. Small files for Final Cut Pro, Premiere Pro and recent macOS apps. Quality 80, alpha quality 0.9.',
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

export interface RenderPlanInput {
  manifest: Pick<TemplateManifest, 'fps' | 'width' | 'height' | 'duration' | 'alpha'>;
  presetId: string;
  /** Output file path. For PNG sequences, a `%05d` frame pattern is added if missing. */
  outputPath: string;
  /** Overwrite an existing output file. Default false (ffmpeg -n). */
  overwrite?: boolean;
  /** Background used when flattening an alpha template into a non-alpha preset. Default #000000. */
  background?: string;
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
  totalFrames: number;
  warnings: string[];
}

/** ffmpeg-friendly frame rate: NTSC rates become exact rationals. */
export function fpsToRational(fps: number): string {
  const ntsc: Record<string, string> = { '23.976': '24000/1001', '29.97': '30000/1001', '59.94': '60000/1001' };
  const key = String(Number(fps.toFixed(3)));
  return ntsc[key] ?? String(fps);
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

  if (preset.requiresEvenDimensions && (manifest.width % 2 !== 0 || manifest.height % 2 !== 0)) {
    throw new RenderPlanError(
      `${preset.label} needs even width and height; template is ${manifest.width}x${manifest.height}`,
    );
  }
  if (preset.alpha && !manifest.alpha) {
    warnings.push('template does not declare alpha; output will carry an alpha channel but is likely fully opaque');
  }

  const background = input.background ?? '#000000';
  if (!isValidColor(background)) throw new RenderPlanError(`background must be #RRGGBB, got "${background}"`);

  const fps = fpsToRational(manifest.fps);
  const totalFrames = frameCount(manifest);
  const output = normalizeOutputPath(input.outputPath, preset);
  const frameFormat = input.frameFormat ?? DEFAULT_FRAME_FORMAT;
  const rawInput = input.rawInput ?? DEFAULT_RAW_INPUT;
  const size = `${manifest.width}x${manifest.height}`;

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
  const toOutput = preset.color === 'rec709' ? [REC709_CONVERT, REC709_TAGS] : [];
  toOutput.push(`format=${preset.pixelFormat}`);

  if (!preset.alpha && manifest.alpha) {
    // Composite in RGB so the background color and the template pixels share one conversion.
    const foreground = prepare.length > 0 ? `[0:v]${prepare.join(',')}[fg];[bg][fg]` : '[bg][0:v]';
    args.push(
      '-filter_complex',
      `color=c=${hexToFfmpegColor(background)}:s=${size}:r=${fps}[bg];${foreground}overlay=shortest=1:format=rgb,${toOutput.join(',')}[out]`,
      '-map', '[out]',
    );
  } else {
    args.push('-vf', [...prepare, ...toOutput].join(','));
  }

  args.push(...preset.codecArgs, '-frames:v', String(totalFrames), '-r', fps, output);
  return { preset, frameFormat, args, output, totalFrames, warnings };
}
