/**
 * Media metadata: the shape, the ffprobe JSON parser, and resolution labels.
 * Pure (no Node imports) so the renderer and the search can use it; running
 * ffprobe lives in media-probe.ts.
 */

export interface MediaMetadata {
  /** Seconds. */
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Video codec name as ffprobe reports it, e.g. "prores", "h264", "vp9", "png". */
  codec?: string;
  pixelFormat?: string;
  /**
   * True when the video carries an alpha channel: an alpha pixel format, VP9's
   * `alpha_mode` tag, or HEVC's auxiliary alpha layer (see `hevcAlpha`).
   */
  alpha?: boolean;
  audioCodec?: string;
  channels?: number;
  sampleRate?: number;
}

const ALPHA_PIX_FMT = /^(yuva|rgba|argb|bgra|abgr|gbrap|ya|ayuv|pal8)/;

/**
 * HEVC with alpha (what macOS writes, and what VideoToolbox encodes) keeps the
 * alpha in an **auxiliary layer** of the same track, not in the pixel format:
 * the stream reads `yuv420p`, exactly like an opaque H.264, so the pixel
 * format cannot tell them apart. What does is `view_ids_available`, which
 * ffmpeg exports for a multilayer HEVC stream — "0,0" for base plus alpha,
 * absent for a single-layer one. Decoding confirms it: ffmpeg 8.0 hands back
 * `yuva420p` frames for such a file (docs/platform-notes.md).
 *
 * Multiview (stereo) HEVC is multilayer too, so `view_pos_available` has to be
 * empty: ffmpeg fills it with left/right positions for a stereo pair and
 * leaves it empty for an alpha layer, which has no position to report.
 */
function hevcAlpha(stream: ProbeStream): boolean {
  if (stream.codec_name !== 'hevc') return false;
  const views = (stream.view_ids_available ?? '').split(',').filter((v) => v.trim().length > 0);
  const positions = (stream.view_pos_available ?? '').split(',').filter((v) => v.trim().length > 0);
  return views.length > 1 && positions.length === 0;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  channels?: number;
  sample_rate?: string;
  view_ids_available?: string;
  view_pos_available?: string;
  tags?: Record<string, string>;
}

function rate(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const [n, d] = text.split('/').map(Number);
  if (!n || !d || !Number.isFinite(n) || !Number.isFinite(d)) return undefined;
  return Math.round((n / d) * 1000) / 1000;
}

/** Metadata from ffprobe's JSON, or null if it is not ffprobe output. Missing pieces are left undefined. */
export function parseFfprobe(json: string): MediaMetadata | null {
  let data: { streams?: ProbeStream[]; format?: { duration?: string } };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || (!Array.isArray(data.streams) && !data.format)) return null;
  const meta: MediaMetadata = {};
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration);
  if (Number.isFinite(duration) && duration > 0) meta.duration = Math.round(duration * 1000) / 1000;
  if (video) {
    if (video.codec_name) meta.codec = video.codec_name;
    if (typeof video.width === 'number' && video.width > 0) meta.width = video.width;
    if (typeof video.height === 'number' && video.height > 0) meta.height = video.height;
    if (video.pix_fmt) meta.pixelFormat = video.pix_fmt;
    const fps = rate(video.avg_frame_rate) ?? rate(video.r_frame_rate);
    if (fps && fps > 0) meta.fps = fps;
    const alphaTag = video.tags?.alpha_mode ?? video.tags?.ALPHA_MODE;
    meta.alpha = (video.pix_fmt !== undefined && ALPHA_PIX_FMT.test(video.pix_fmt)) || alphaTag === '1' || hevcAlpha(video);
  }
  if (audio) {
    if (audio.codec_name) meta.audioCodec = audio.codec_name;
    if (typeof audio.channels === 'number') meta.channels = audio.channels;
    const sr = Number(audio.sample_rate);
    if (Number.isFinite(sr) && sr > 0) meta.sampleRate = sr;
  }
  return meta;
}

/** "1080p", "2160p" from the shorter picture side, which also covers portrait video. */
export function resolutionLabel(width: number | undefined, height: number | undefined): string | undefined {
  if (!width || !height) return undefined;
  return `${Math.min(width, height)}p`;
}

/** Common names for resolution filters: 4k, uhd, 8k, hd, fhd. */
export const RESOLUTION_ALIASES: Record<string, string> = {
  '4k': '2160p',
  uhd: '2160p',
  '8k': '4320p',
  hd: '720p',
  fhd: '1080p',
  'full-hd': '1080p',
};
