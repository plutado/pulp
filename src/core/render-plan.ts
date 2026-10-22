/**
 * Render planner: turns a template's timing/size plus an output preset into
 * the exact ffmpeg argument list. Pure; does not spawn anything.
 *
 * Frames are captured by the host and written to ffmpeg's stdin. The default
 * is raw BGRA pixels, which skip a PNG encode and decode per frame:
 *   -f rawvideo -pixel_format bgra -video_size WxH -framerate <fps> -i pipe:0
 * The PNG path is kept for comparison (frameFormat 'png'):
 *   -f image2pipe -framerate <fps> -c:v png -i pipe:0
 *
 * Chromium hands out premultiplied pixels. PNG encoding undoes that; raw
 * frames from alpha templates go through ffmpeg's unpremultiply filter so
 * semi-transparent edges keep their color instead of darkening.
 */

import { frameCount, isValidColor, type TemplateManifest } from './manifest';

export type PresetId = 'prores-4444' | 'prores-422hq' | 'png-sequence' | 'webm-vp9-alpha' | 'h264-mp4';

/** How captured frames are handed to ffmpeg: raw BGRA pixels or PNG images. */
export type FrameFormat = 'raw' | 'png';
export const FRAME_FORMATS: readonly FrameFormat[] = ['raw', 'png'];
export const DEFAULT_FRAME_FORMAT: FrameFormat = 'raw';

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
}

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
    codecArgs: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart'],
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
  const size = `${manifest.width}x${manifest.height}`;

  const args: string[] = ['-hide_banner', '-loglevel', 'error', input.overwrite ? '-y' : '-n'];
  if (frameFormat === 'raw') {
    args.push('-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', size, '-framerate', fps, '-i', 'pipe:0');
  } else {
    args.push('-f', 'image2pipe', '-framerate', fps, '-c:v', 'png', '-i', 'pipe:0');
  }

  // Raw pixels arrive premultiplied; opaque templates have nothing to undo.
  const unpremultiply = frameFormat === 'raw' && manifest.alpha ? 'unpremultiply=inplace=1' : null;

  if (!preset.alpha && manifest.alpha) {
    const foreground = unpremultiply ? `[0:v]${unpremultiply}[fg];[bg][fg]` : '[bg][0:v]';
    args.push(
      '-filter_complex',
      `color=c=${hexToFfmpegColor(background)}:s=${size}:r=${fps}[bg];${foreground}overlay=shortest=1:format=auto,format=${preset.pixelFormat}[out]`,
      '-map', '[out]',
    );
  } else {
    if (unpremultiply) args.push('-vf', unpremultiply);
    args.push('-pix_fmt', preset.pixelFormat);
  }

  args.push(...preset.codecArgs, '-frames:v', String(totalFrames), '-r', fps, output);
  return { preset, frameFormat, args, output, totalFrames, warnings };
}
