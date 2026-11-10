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
import { cutRates, cutSeconds, type CutSpeed, cutTimelineTime, type ReframeKey } from './cut-track';
import { resolveLength, type TemplateStructure } from './timing';
import { isValidColor, type TemplateManifest } from './manifest';
import { fpsToRational, isStandardFrameRate, STANDARD_FRAME_RATES } from './timecode';
import { isCubeFile, lutFilter } from './clip-clean';
import { tonemapSteps, type HdrFormat } from './hdr';
import { tr } from './i18n';
import { reframeCropFilter } from './reframe';

export { fpsToRational } from './timecode';

export type PresetId =
  | 'prores-4444' | 'prores-422hq' | 'png-sequence' | 'png-still' | 'webm-vp9-alpha' | 'h264-mp4' | 'qt-animation' | 'hevc-alpha'
  // Milestone 82: DNxHR for editing apps that prefer it, and animated images for the web.
  | 'dnxhr-hq' | 'dnxhr-hqx' | 'gif' | 'webp-animated' | 'apng';

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
  /** True for a still image (milestone 44): one frame, the in point's — the playhead's, as the Output tab fills it — whatever the out point says. */
  still?: boolean;
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
  /**
   * An animated image for the web (milestone 82): GIF, animated WebP, APNG.
   * It carries no sound and gets no file of sound beside it, takes no matte,
   * and has a rate and a width of its own, set on the way out
   * (`animatedImageOutput`) — these are the defaults, each "as rendered"
   * where it is absent.
   */
  animatedImage?: { fps?: number; width?: number };
}

/** Rec.709 output, step 1: convert RGB to Y'CbCr with the BT.709 matrix at limited (video) range. */
export const REC709_CONVERT = 'scale=out_color_matrix=bt709:out_range=tv';
/** Rec.709 output, step 2: tag every frame so the muxer writes colr / VUI / Matroska Color. */
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
    get label() { return tr('preset.prores-4444'); },
    get description() { return tr('preset.prores-4444.description'); },
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
    get label() { return tr('preset.prores-422hq'); },
    get description() { return tr('preset.prores-422hq.description'); },
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
    get label() { return tr('preset.png-sequence'); },
    get description() { return tr('preset.png-sequence.description'); },
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
  'png-still': {
    id: 'png-still',
    get label() { return tr('preset.png-still'); },
    get description() { return tr('preset.png-still.description'); },
    extension: '.png',
    alpha: true,
    sequence: false,
    still: true,
    requiresEvenDimensions: false,
    encoder: 'png',
    pixelFormat: 'rgba',
    color: 'rgb',
    // -update 1: one file, written once, rather than image2's numbered pattern.
    codecArgs: ['-c:v', 'png', '-f', 'image2', '-update', '1'],
  },
  'webm-vp9-alpha': {
    id: 'webm-vp9-alpha',
    get label() { return tr('preset.webm-vp9-alpha'); },
    get description() { return tr('preset.webm-vp9-alpha.description'); },
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
    get label() { return tr('preset.h264-mp4'); },
    get description() { return tr('preset.h264-mp4.description'); },
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
    get label() { return tr('preset.qt-animation'); },
    get description() { return tr('preset.qt-animation.description'); },
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
    get label() { return tr('preset.hevc-alpha'); },
    get description() { return tr('preset.hevc-alpha.description'); },
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
    get platformNote() { return tr('preset.hevc-alpha.platform-note'); },
  },
  // DNxHR (milestone 82), for Avid-style editing and anything else that prefers it to ProRes. No
  // alpha: ffmpeg's encoder writes none, so a graphic over nothing takes the matte beside it.
  // MOV rather than MXF, which every editor that reads DNxHR links or imports as it is.
  'dnxhr-hq': {
    id: 'dnxhr-hq',
    get label() { return tr('preset.dnxhr-hq'); },
    get description() { return tr('preset.dnxhr-hq.description'); },
    extension: '.mov',
    alpha: false,
    sequence: false,
    requiresEvenDimensions: true,
    encoder: 'dnxhd',
    pixelFormat: 'yuv422p',
    color: 'rec709',
    codecArgs: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq'],
  },
  'dnxhr-hqx': {
    id: 'dnxhr-hqx',
    get label() { return tr('preset.dnxhr-hqx'); },
    get description() { return tr('preset.dnxhr-hqx.description'); },
    extension: '.mov',
    alpha: false,
    sequence: false,
    requiresEvenDimensions: true,
    encoder: 'dnxhd',
    pixelFormat: 'yuv422p10le',
    color: 'rec709',
    codecArgs: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx'],
  },
  // Animated images (milestone 82). A GIF is flattened: its transparency is one bit, which leaves a
  // jagged edge round every soft one, and WebP and APNG are there for a picture with alpha. Each
  // loops forever, as an animated image on a page is expected to.
  gif: {
    id: 'gif',
    get label() { return tr('preset.gif'); },
    get description() { return tr('preset.gif.description'); },
    extension: '.gif',
    alpha: false,
    sequence: false,
    requiresEvenDimensions: false,
    encoder: 'gif',
    // RGB in, for the palette to be made from; the palette step makes the GIF's own pal8.
    pixelFormat: 'rgb24',
    color: 'rgb',
    codecArgs: ['-c:v', 'gif', '-loop', '0', '-f', 'gif'],
    // A GIF at a video's size and rate runs to tens of megabytes: smaller to start with.
    animatedImage: { fps: 15, width: 480 },
  },
  'webp-animated': {
    id: 'webp-animated',
    get label() { return tr('preset.webp-animated'); },
    get description() { return tr('preset.webp-animated.description'); },
    extension: '.webp',
    alpha: true,
    sequence: false,
    requiresEvenDimensions: false,
    encoder: 'libwebp_anim',
    // RGB with alpha, converted by libwebp itself with the matrix a WebP decoder assumes.
    pixelFormat: 'bgra',
    color: 'rgb',
    codecArgs: ['-c:v', 'libwebp_anim', '-quality', '85', '-loop', '0', '-f', 'webp'],
    animatedImage: {},
  },
  apng: {
    id: 'apng',
    get label() { return tr('preset.apng'); },
    get description() { return tr('preset.apng.description'); },
    // `.png`, not `.apng`: what an upload form and a browser take, and it still shows its first
    // frame anywhere that does not animate it. The muxer is named, since `.png` alone means a still.
    extension: '.png',
    alpha: true,
    sequence: false,
    requiresEvenDimensions: false,
    encoder: 'apng',
    pixelFormat: 'rgba',
    color: 'rgb',
    codecArgs: ['-c:v', 'apng', '-plays', '0', '-f', 'apng'],
    animatedImage: {},
  },
};

// ---------------------------------------------------------------- animated images (milestone 82)

/**
 * The rates an animated image may be written at. Fewer than a video's: what
 * matters is the size of the file, and a GIF counts its delays in hundredths
 * of a second, so nothing past 50 is kept by a browser anyway.
 */
export const ANIMATED_IMAGE_FPS = [10, 12, 15, 20, 24, 25, 30] as const;

/** The widths the Output tab offers; anything from 16 to 4096 may be asked on the command line. */
export const ANIMATED_IMAGE_WIDTHS = [240, 320, 480, 640, 800, 1080] as const;

export const ANIMATED_IMAGE_LIMITS = { width: { min: 16, max: 4096 } } as const;

/**
 * What an animated image's own rate and width come to, and the steps that
 * make them: frames dropped to the rate (never made up — a rate above the
 * render's is the render's), the picture scaled down to the width (never up,
 * its height following its shape), and for a GIF the palette.
 *
 * **A palette made for the clip.** A GIF holds 256 colors, and ffmpeg's
 * stock palette is a fixed cube of them that turns every gradient to bands;
 * `palettegen` reads every frame and picks the 256 this clip actually uses,
 * `paletteuse` maps the frames onto them. The dither is ordered (Bayer)
 * rather than diffused: a diffused dither moves from frame to frame, which
 * shimmers on a still background and defeats the GIF's own trick of only
 * storing what changed — `diff_mode=rectangle` keeps that trick.
 *
 * `steps` is a filtergraph fragment to follow the preset's own conversion: it
 * starts unlabeled and ends unlabeled, so it reads the same after a `-vf`
 * chain and before a complex graph's output label. Null for every preset
 * that is not an animated image.
 */
export function animatedImageOutput(
  preset: OutputPreset,
  options: Pick<RenderOptions, 'animatedImage'>,
  render: { fps: number; frames: number },
): { fps: number; frames: number; width?: number; steps: string } | null {
  if (!preset.animatedImage) return null;
  // What was asked over the preset's defaults; null is "as rendered", the default notwithstanding.
  const merged = { ...preset.animatedImage, ...options.animatedImage };
  const asked = { fps: merged.fps ?? undefined, width: merged.width ?? undefined };
  if (asked.fps !== undefined && !(ANIMATED_IMAGE_FPS as readonly number[]).includes(asked.fps)) {
    throw new RenderPlanError(tr('render-plan.error.image-fps', { rates: ANIMATED_IMAGE_FPS.join(', '), got: String(asked.fps) }));
  }
  const { min, max } = ANIMATED_IMAGE_LIMITS.width;
  if (asked.width !== undefined && (!Number.isInteger(asked.width) || asked.width < min || asked.width > max)) {
    throw new RenderPlanError(tr('render-plan.error.image-width', { min, max, got: String(asked.width) }));
  }
  const steps: string[] = [];
  // Frames dropped to the rate, and counted as the `fps` filter counts them (to the nearest, a half up).
  const slower = asked.fps !== undefined && asked.fps < render.fps;
  const fps = slower ? asked.fps! : render.fps;
  const frames = slower ? Math.max(1, Math.round((render.frames * fps) / render.fps)) : render.frames;
  if (slower) steps.push(`fps=${fps}`);
  if (asked.width !== undefined) steps.push(`scale='min(iw,${asked.width})':-2:flags=lanczos`);
  let graph = steps.join(',');
  if (preset.id === 'gif') {
    const palette = 'split[gifa][gifb];[gifa]palettegen=max_colors=256:stats_mode=full[gifp];[gifb][gifp]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle';
    graph = graph ? `${graph},${palette}` : palette;
  }
  return { fps, frames, ...(asked.width !== undefined ? { width: asked.width } : {}), steps: graph };
}

export const PRESET_IDS = Object.keys(OUTPUT_PRESETS) as PresetId[];

export class RenderPlanError extends Error {
  override name = 'RenderPlanError';
}

/** Per-render choices on top of the template's timing and the preset. All optional. */
export const CAPTIONS_MODES = ['burn', 'track', 'none'] as const;
export type CaptionsMode = (typeof CAPTIONS_MODES)[number];

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
   * A second file beside the render holding the alpha as gray (milestone 15),
   * for codecs and editors without alpha: `<name>-matte<ext>`, encoded with the
   * same codec. Templates and media alike.
   */
  matte?: boolean;
  /**
   * A cover image beside the render (milestone 20): a still of this frame,
   * written as `<name>-cover.png` at the render's own size, for the thumbnail
   * a platform asks for separately. The frame is on the graphic's own
   * timeline at the output rate, picked on the scrub bar, and need not be
   * inside the trim — a cover is often the moment the title has landed, which
   * a trimmed render may not include.
   */
  coverFrame?: number;
  /**
   * The platform this render is aimed at (milestone 20), by the id of a
   * platform preset (src/core/platform-presets.ts). It changes no pixel and no
   * ffmpeg argument — choosing a platform has already set the aspect, size,
   * rate and encoder — it only says what the length and file-size warnings are
   * measured against, before the render and from the file afterwards.
   */
  platform?: string;
  /**
   * A `.cube` LUT graded over the whole render (milestone 52), as a file path.
   * Applied in RGB after any flattening and before the preset's color
   * conversion, so the grade sees the finished picture; the matte beside a
   * render is alpha only and takes no grade.
   */
  lut?: string;
  /**
   * How the project's captions reach the render (milestone 50), when it has
   * any: `burn` draws them into the picture (the default), `track` leaves the
   * picture alone and renders them on their own as an alpha caption track
   * beside it (`<name>-captions.mov`, ProRes 4444), and `none` draws them
   * nowhere. The SRT and WebVTT files beside the video are written whichever
   * is chosen: a subtitle file is what a platform takes, drawn or not.
   */
  captions?: CaptionsMode;
  /** Media only (milestone 15): playback speed of a clip; 1 is as recorded. */
  speed?: number;
  /** Media only: recolor the picture at render time — its luminance in this color (`#rrggbb`), alpha kept. */
  tint?: string;
  /** Media only: seconds of crossfade at the join when a clip is looped past its own length. */
  crossfade?: number;
  /** Audio presets only: how the sound is written. */
  audio?: AudioOptions;
  /**
   * How music that came in as stems reaches the render (milestone 16): `mix`
   * (the default) folds the stems into the mix like any other sound; `files`
   * leaves them out of the render's own audio and writes one WAV per stem
   * beside it — `<name>-<stem>.wav`, trimmed to exactly the rendered range —
   * so an editor can remix what Pulp placed. A project with no stems is
   * untouched either way.
   */
  stems?: 'mix' | 'files';
  /**
   * An animated image's own rate and width (milestone 82): GIF, animated WebP
   * and APNG only, ignored by every other preset. The rate is one of
   * `ANIMATED_IMAGE_FPS` and only ever drops frames; the width only ever
   * scales down. Absent, each is the preset's default — a GIF's 15 frames a
   * second and 480 pixels — or the render's own. `null` is the render's own
   * even where the preset has a default: a GIF at full rate or full size.
   */
  animatedImage?: { fps?: number | null; width?: number | null };
}

export const STEMS_MODES = ['mix', 'files'] as const;

/** How an audio render is written (milestone 15); each unset field keeps the source's. */
export interface AudioOptions {
  sampleRate?: number;
  channels?: number;
  bitDepth?: 16 | 24;
}

export const AUDIO_SAMPLE_RATES = [44100, 48000, 96000] as const;
export const AUDIO_BIT_DEPTHS = [16, 24] as const;

// ---------------------------------------------------------------- the matte pass (milestone 15)

/** The matte's pixel format: the preset's own without its alpha, since a matte is gray. */
export const MATTE_PIXEL_FORMATS: Record<PresetId, string> = {
  'dnxhr-hq': 'yuv422p',
  'dnxhr-hqx': 'yuv422p10le',
  // An animated image takes no matte (it has its alpha, or is a GIF for a page); listed for the type.
  gif: 'rgb24',
  'webp-animated': 'bgra',
  apng: 'rgb24',
  'prores-4444': 'yuv444p10le',
  'prores-422hq': 'yuv422p10le',
  'png-sequence': 'rgb24',
  'png-still': 'rgb24',
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

// ---------------------------------------------------------------- the cover image (milestone 20)

/** Where the cover goes: beside the render, "-cover.png"; a sequence's frame pattern is dropped. */
export function coverOutputPath(output: string): string {
  const slash = Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'));
  const dir = output.slice(0, slash + 1);
  let file = output.slice(slash + 1);
  // A sequence is written as `name_%05d.png`; its cover is one file, so the pattern goes.
  file = file.replace(/_%0?\d*d(?=\.[^.]*$|$)/, '');
  const dot = file.lastIndexOf('.');
  return `${dir}${dot > 0 ? file.slice(0, dot) : file}-cover.png`;
}

/**
 * Which frame the cover is taken at: what was asked for, held inside the
 * graphic's own length. A playhead read at one rate and a render at another
 * can land a frame past the end, and the end is what was meant.
 */
export function coverFrameWithin(asked: number, fps: number, length: number): number {
  const lastFrame = Math.max(1, Math.round(length * fps)) - 1;
  if (!Number.isFinite(asked)) return 0;
  return Math.max(0, Math.min(Math.round(asked), lastFrame));
}

/**
 * ffmpeg arguments that turn one captured PNG on stdin into the cover file.
 * An alpha preset keeps its transparency, since the render it sits beside
 * has it too; a preset without alpha is flattened over the same background
 * the video was, so the thumbnail matches the picture it stands for.
 */
export function coverArgs(preset: OutputPreset, size: { width: number; height: number }, background: string, out: string): string[] {
  const base = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', 'pipe:0'];
  if (preset.alpha) return [...base, '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgba', out];
  const colour = `0x${background.replace('#', '').slice(0, 6)}`;
  return [
    ...base,
    '-f', 'lavfi', '-i', `color=c=${colour}:s=${size.width}x${size.height}`,
    '-filter_complex', '[1:v][0:v]overlay=shortest=1,format=rgb24[cover]',
    '-map', '[cover]', '-frames:v', '1', '-c:v', 'png', out,
  ];
}

/** The filter steps that turn a straight-alpha picture into the gray matte in the preset's color and format. */
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
export function resolveTiming(manifest: Pick<TemplateManifest, 'fps' | 'duration'> & { structure?: TemplateStructure }, options: RenderOptions = {}, shape: { still?: boolean } = {}): RenderTiming {
  const fps = options.fps ?? manifest.fps;
  if (options.fps !== undefined && !isStandardFrameRate(options.fps)) {
    throw new RenderPlanError(tr('render-plan.error.fps', { rates: STANDARD_FRAME_RATES.map((r) => r.fps).join(', '), got: String(options.fps) }));
  }
  // The length the graphic runs for: what was asked, held to what the structure allows, or the
  // template's own duration. A trim is then taken within that, as it always was.
  if (options.length !== undefined && (!Number.isFinite(options.length) || options.length <= 0)) {
    throw new RenderPlanError(tr('render-plan.error.length', { got: String(options.length) }));
  }
  if (options.length !== undefined && !manifest.structure) {
    throw new RenderPlanError(tr('render-plan.error.length-fixed'));
  }
  const length = resolveLength(manifest.duration, manifest.structure ?? null, options.length);
  // Like frameCount: a template shorter than one frame still has one frame.
  const lastFrame = Math.max(1, Math.round(length * fps)) - 1;
  const inFrame = options.inFrame ?? 0;
  if (!Number.isInteger(inFrame) || inFrame < 0) throw new RenderPlanError(tr('render-plan.error.in-point', { got: String(options.inFrame) }));
  // A still (milestone 44) is the one frame at the in point, held within the timeline: a playhead
  // read at another rate can round a frame past the end, and the end is what was meant.
  if (shape.still) {
    const at = Math.min(inFrame, lastFrame);
    return { fps, firstFrame: at, totalFrames: 1, length };
  }
  const outFrame = options.outFrame ?? lastFrame;
  if (!Number.isInteger(outFrame) || outFrame > lastFrame) {
    throw new RenderPlanError(tr('render-plan.error.out-point', { last: lastFrame, fps, got: String(options.outFrame) }));
  }
  if (outFrame < inFrame) throw new RenderPlanError(tr('render-plan.error.out-before-in', { out: outFrame, in: inFrame }));
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
  /**
   * The cut track under the graphic (milestone 49), its clip ids already
   * resolved to files by the caller: each cut a window of a file in seconds.
   * The cuts are read as inputs, scaled and padded to the output's own frame,
   * joined end to end, and the graphic is composited over them.
   */
  track?: {
    cuts: {
      path: string;
      from: number;
      to: number;
      /** The speed the cut plays at (milestone 56); absent is real time. */
      speed?: CutSpeed;
      /** A freeze frame: the frame at `from` held for this many seconds (milestone 56). */
      hold?: number;
      /** The transition into the next cut, already clamped by the caller (transitionAt). A wipe rides in `wipes`. */
      transition?: { type: 'dissolve' | 'dip'; seconds: number; color?: string };
      /** The crop's path for the output's shape (milestone 77): present, the picture fills the frame and follows it. */
      reframe?: ReframeKey[];
      /**
       * The HDR the cut's file carries, where it is to be converted to
       * standard range (milestone 81): the conversion comes first in the
       * cut's chain, so its speed, framing, transitions and the graphic over
       * it all meet an ordinary Rec. 709 picture. Absent for a standard-range
       * clip, and for an HDR one this ffmpeg cannot convert.
       */
      tonemap?: HdrFormat;
    }[];
    /** Bundled wipes over the joins, captured by the caller as numbered RGBA frames at the output's own rate. */
    wipes?: { pattern: string; at: number; seconds: number }[];
  };
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
  /** The gray matte written beside the render, when one was asked for (milestone 15). */
  matteOutput?: string;
  /** The cover image beside the render, and the frame it is taken at (milestone 20). */
  coverOutput?: string;
  coverFrame?: number;
  /** The mix written beside the render when the output has no room for an audio stream (milestone 48). */
  audioOutput?: string;
  /** The music's stems written beside the render, one WAV each, when asked for as files (milestone 16). */
  stemOutputs?: string[];
  warnings: string[];
  /**
   * An animated image's own rate, frame count and width (milestone 82), where
   * they differ from the render's: what the written file holds, which the
   * frames piped in (`totalFrames`) are not once the rate drops some.
   */
  image?: { fps: number; frames: number; width?: number };
}

/** Make the output path agree with the preset's extension (and frame pattern for sequences). */
export function normalizeOutputPath(outputPath: string, preset: OutputPreset): string {
  const lastSlash = Math.max(outputPath.lastIndexOf('/'), outputPath.lastIndexOf('\\'));
  const dir = outputPath.slice(0, lastSlash + 1);
  let file = outputPath.slice(lastSlash + 1);
  if (file.length === 0) throw new RenderPlanError(tr('render-plan.error.no-file-name'));

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

/**
 * The filter steps that put one cut of the track on the timeline's clock at
 * the output's rate (milestone 56). Real time is the output rate alone. A
 * constant speed divides the timestamps; a ramp maps each frame's file second
 * to the timeline moment the ramp reaches it — the quadratic `cutSourceTime`
 * integrates, solved for t, written as a `setpts` expression — and either is
 * then resampled to the rate: frames repeated or dropped by `fps`, or, for
 * smooth slow motion, made up by motion-compensated interpolation. A freeze
 * frame is its first frame alone, held for the hold.
 */
export function cutSpeedSteps(cut: { from: number; to: number; speed?: CutSpeed; hold?: number }, fps: number): string[] {
  const rate = String(fps);
  if (cut.hold !== undefined) {
    return ['trim=end_frame=1', 'setpts=PTS-STARTPTS', `tpad=stop_mode=clone:stop_duration=${Math.round(cut.hold * 1e6) / 1e6}`, `fps=${rate}`, `trim=duration=${Math.round(cut.hold * 1e6) / 1e6}`];
  }
  const { start, end } = cutRates(cut);
  if (start === 1 && end === 1) return [`fps=${rate}`];
  const seconds = Math.max(0.001, cutSeconds(cut));
  const slow = Math.min(start, end) < 1;
  // Interpolation where frames have to be made up, at the rate the output wants; otherwise the
  // ordinary repeat-or-drop. The interpolation is the costly step of the whole render.
  const resample = cut.speed?.smooth && slow
    ? `minterpolate=fps=${rate}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
    : `fps=${rate}`;
  if (start === end) return [`setpts=(PTS-STARTPTS)/${Number(start.toFixed(6))}`, resample];
  // t = (−r₁ + √(r₁² + 4a·s)) / 2a, with a = (r₂ − r₁) / 2T and s the file second from the
  // cut's start; numbers in plain decimals, since the expression parser reads no exponents.
  const a = (end - start) / (2 * seconds);
  const plain = (v: number) => v.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
  const expr = `((0-${plain(start)})+sqrt(${plain(start * start)}+${plain(4 * a)}*(PTS-STARTPTS)*TB))/(${plain(2 * a)})/TB`;
  return [`setpts=${expr}`, resample, `trim=duration=${Math.round(seconds * 1e6) / 1e6}`];
}

export function buildRenderPlan(input: RenderPlanInput): RenderPlan {
  const preset = OUTPUT_PRESETS[input.presetId as PresetId];
  if (!preset) {
    throw new RenderPlanError(tr('render-plan.error.unknown-preset', { preset: input.presetId, presets: PRESET_IDS.join(', ') }));
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
    throw new RenderPlanError(tr('render-plan.error.even-size', { preset: preset.label, width, height }));
  }
  if (preset.alpha && !manifest.alpha) {
    warnings.push(tr('render-plan.warning.no-alpha'));
  }

  const background = input.options?.background ?? '#000000';
  if (!isValidColor(background)) throw new RenderPlanError(tr('render-plan.error.background', { got: background }));
  const lut = input.options?.lut;
  if (lut !== undefined && !isCubeFile(lut)) throw new RenderPlanError(tr('render-plan.error.lut', { got: lut }));

  const timing = resolveTiming(manifest, input.options, { still: preset.still === true });
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
  // A LUT (milestone 52) grades first, in RGB, after any flattening below: the grade sees the
  // finished picture, as it would in an editor.
  const toOutput = [...(lut ? [lutFilter(lut)] : []), ...(preset.color === 'rec709' ? [REC709_CONVERT, REC709_TAGS] : [RGB_FULL_TAGS])];
  toOutput.push(`format=${preset.pixelFormat}`);

  const matte = input.options?.matte === true;
  // An animated image (milestone 82) has its own alpha, or is a GIF for a page: a gray matte beside
  // it is for an editing app, which takes neither.
  if (matte && preset.animatedImage) throw new RenderPlanError(tr('render-plan.error.image-matte', { preset: preset.label }));
  const matteOutput = matte ? matteOutputPath(output, preset) : undefined;
  // Its own rate, width and palette, after the preset's conversion; null for everything else.
  const image = animatedImageOutput(preset, input.options ?? {}, { fps: timing.fps, frames: totalFrames });
  if (image?.steps) toOutput.push(image.steps);
  // The cover is not an output of this command: it is one more frame captured from the same page
  // once the video is written, so it can be any frame of the graphic rather than only one inside
  // the trim (src/main/render.ts).
  const askedCover = input.options?.coverFrame;
  const coverFrame = askedCover === undefined ? undefined : coverFrameWithin(askedCover, timing.fps, timing.length);
  const coverOutput = coverFrame === undefined ? undefined : coverOutputPath(output);
  // With a matte, the prepared frames are split: one branch to the picture, one to the gray (milestone 15).
  const prepared = prepare.length > 0 ? `[0:v]${prepare.join(',')}[src]` : '[0:v]null[src]';
  const split = `${prepared};[src]split[pic][mat];[mat]${matteFilters(preset)}[matte]`;
  const track = input.track && input.track.cuts.length > 0 ? input.track : undefined;
  if (track) {
    // The cut track under the graphic (milestone 49): each cut is its own input, sought to its
    // window (`-ss`/`-t` before `-i`: fast to the keyframe, exact from there), brought to the
    // output's clock and frame — scaled inside it, padded to it, square pixels, one pixel format
    // so a dissolve can cross-fade them — then joined boundary by boundary. The join is padded on
    // in time, so a track shorter than the graphic shows the pad rather than ending the render,
    // and trimmed to the rendered range exactly as the audio mix is. The graphic is composited
    // over it in RGB, as the flatten branch composites, so one conversion serves both; a
    // flattening render's chosen background is the pad, since that is the color the graphic
    // would have met. The matte stays the graphic's own alpha — the graphics over the footage are
    // exactly what an editing app wants a matte of.
    //
    // Transitions take their duration from both sides, half each, without moving the timeline: a
    // **dip** fades the earlier segment out to its color and the later one in from it, inside the
    // segments themselves; a **dissolve** clone-pads each side by half the duration — the held
    // edge frame, exactly what the preview holds — and cross-fades over the pad, so the join's
    // length is the two cuts' lengths to the frame; a **wipe** is a bundled wipe template the
    // caller captured as frames with alpha, overlaid across the boundary after the join.
    const sec = (v: number) => String(Math.round(v * 1e6) / 1e6);
    const pad = !preset.alpha && manifest.alpha ? hexToFfmpegColor(background) : 'black';
    // A freeze frame reads a sliver of the file at its moment; everything else reads its window.
    track.cuts.forEach((cut) => args.push('-ss', sec(cut.from), '-t', sec(cut.hold !== undefined ? 0.2 : Math.max(0.001, cut.to - cut.from)), '-i', cut.path));
    const wipes = track.wipes ?? [];
    wipes.forEach((wipe) => args.push('-framerate', fps, '-start_number', '0', '-i', wipe.pattern));
    const chains: string[] = [];
    const segments = track.cuts.map((cut, i) => {
      // The cut's time, before anything else (milestone 56): `cutSpeedSteps` retimes the frames
      // to the timeline and brings them to the output's constant rate — by repeating or dropping
      // frames, or by interpolating them where smooth slow motion is asked for — so the scale,
      // the pad and the joins after it see an ordinary constant-rate stream of the cut's length.
      // Letterboxed into the frame — or, reframed for this shape (milestone 77), filling it with the
      // crop following its keys in the cut's own time on the timeline, which is what `t` is here
      // after the speed steps.
      const framing = cut.reframe && cut.reframe.length > 0
        ? [reframeCropFilter({ width, height }, cut.reframe, (clipSeconds) => cutTimelineTime(cut, clipSeconds))]
        : [`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:-1:-1:color=${pad}`];
      const steps = [...(cut.tonemap ? tonemapSteps(cut.tonemap) : []), ...cutSpeedSteps(cut, timing.fps), ...framing, 'setsar=1', 'format=yuv420p', 'setpts=PTS-STARTPTS'];
      const seconds = Math.max(0.001, cutSeconds(cut));
      const into = i > 0 ? track.cuts[i - 1]!.transition : undefined;
      if (into?.type === 'dip') steps.push(`fade=t=in:st=0:d=${sec(into.seconds / 2)}:color=${hexToFfmpegColor(into.color ?? '#000000')}`);
      if (cut.transition?.type === 'dip' && i < track.cuts.length - 1) {
        steps.push(`fade=t=out:st=${sec(seconds - cut.transition.seconds / 2)}:d=${sec(cut.transition.seconds / 2)}:color=${hexToFfmpegColor(cut.transition.color ?? '#000000')}`);
      }
      return `[${i + 1}:v]${steps.join(',')}[t${i}]`;
    });
    chains.push(...segments);
    // Fold the segments together one boundary at a time: a straight cut concats, a dissolve
    // clone-pads both sides and cross-fades — the running length never moves.
    let run = 't0';
    let runLength = Math.max(0.001, cutSeconds(track.cuts[0]!));
    track.cuts.slice(1).forEach((cut, i) => {
      const earlier = track.cuts[i]!.transition;
      const seconds = Math.max(0.001, cutSeconds(cut));
      const joined = `j${i}`;
      if (earlier?.type === 'dissolve') {
        const half = sec(earlier.seconds / 2);
        chains.push(`[${run}]tpad=stop_mode=clone:stop_duration=${half}[a${i}]`);
        chains.push(`[t${i + 1}]tpad=start_mode=clone:start_duration=${half}[b${i}]`);
        chains.push(`[a${i}][b${i}]xfade=transition=fade:duration=${sec(earlier.seconds)}:offset=${sec(runLength - earlier.seconds / 2)}[${joined}]`);
      } else {
        chains.push(`[${run}][t${i + 1}]concat=n=2:v=1:a=0[${joined}]`);
      }
      run = joined;
      runLength += seconds;
    });
    chains.push(`[${run}]null[tcat]`);
    // The wipes play over the joins: each captured sequence, with its alpha, padded in time to its
    // place on the timeline and overlaid; the base carries on past it (the pipe ends the render).
    let base = 'tcat';
    wipes.forEach((wipe, k) => {
      const index = 1 + track.cuts.length + k;
      const start = Math.max(0, wipe.at - wipe.seconds / 2);
      chains.push(
        `[${index}:v]format=rgba,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:-1:-1:color=0x00000000,setsar=1,setpts=PTS-STARTPTS,` +
        `tpad=start_mode=add:start_duration=${sec(start)}:color=0x00000000[w${k}]`,
      );
      chains.push(`[${base}][w${k}]overlay=eof_action=pass[wb${k}]`);
      base = `wb${k}`;
    });
    chains.push(`[${base}]tpad=stop=-1:stop_mode=add:color=${pad},trim=start=${sec(timing.firstFrame / timing.fps)},setpts=PTS-STARTPTS[trk]`);
    const graphic = matte ? split : prepared;
    const over = matte ? '[pic]' : '[src]';
    args.push(
      '-filter_complex',
      `${chains.join(';')};${graphic};[trk]${over}overlay=shortest=1:format=rgb,${toOutput.join(',')}[out]`,
      '-map', '[out]',
    );
  } else if (!preset.alpha && manifest.alpha) {
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
  // An animated image at a lower rate writes the frames its rate keeps, at that rate (milestone 82).
  args.push('-frames:v', String(image ? image.frames : totalFrames), '-r', image && image.fps !== timing.fps ? String(image.fps) : fps, output);
  if (matte && matteOutput) {
    args.push('-map', '[matte]', ...matteCodecArgs(preset));
    if (preset.sequence) args.push('-start_number', String(timing.firstFrame));
    args.push('-frames:v', String(totalFrames), '-r', fps, matteOutput);
  }
  return {
    preset, frameFormat, args, output, fps: timing.fps, firstFrame: timing.firstFrame, totalFrames, length: timing.length,
    aspect: frameSize.aspect, width, height,
    ...(matteOutput ? { matteOutput } : {}),
    ...(coverOutput !== undefined && coverFrame !== undefined ? { coverOutput, coverFrame } : {}),
    warnings,
    ...(image && (image.fps !== timing.fps || image.width !== undefined) ? { image: { fps: image.fps, frames: image.frames, ...(image.width !== undefined ? { width: image.width } : {}) } } : {}),
  };
}
