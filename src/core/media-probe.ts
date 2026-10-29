/**
 * Running ffprobe for media metadata, through the injectable process runner
 * from ffmpeg.ts. The library store caches results per file with size and
 * mtime, so a file is probed again only when it changed. Parsing and the
 * metadata shape are in media-meta.ts.
 */

import { basename, dirname, join } from 'node:path';
import type { ProcessRunner } from './ffmpeg';
import { parseFfprobe, type MediaMetadata } from './media-meta';

export { ffprobeArgs };
export type { MediaMetadata } from './media-meta';
export { parseFfprobe, resolutionLabel, RESOLUTION_ALIASES } from './media-meta';

/** ffprobe next to ffmpeg, or on PATH when ffmpeg was found on PATH. */
export function ffprobePathFor(ffmpegPath: string): string {
  const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  if (!ffmpegPath.includes('/') && !ffmpegPath.includes('\\')) return 'ffprobe';
  const name = basename(ffmpegPath).toLowerCase();
  return join(dirname(ffmpegPath), name.endsWith('.exe') ? exe : 'ffprobe');
}

function ffprobeArgs(file: string): string[] {
  return [
    '-v', 'error',
    // view_ids_available and view_pos_available are what give away HEVC's auxiliary alpha
    // layer, which no pixel format reports (see hevcAlpha in media-meta.ts).
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,channels,sample_rate,view_ids_available,view_pos_available:stream_tags=alpha_mode',
    '-of', 'json',
    file,
  ];
}

/** Probe one file. Resolves to null when ffprobe fails or its output is not usable. */
export async function probeMedia(ffprobe: string, file: string, run: ProcessRunner): Promise<MediaMetadata | null> {
  try {
    const result = await run(ffprobe, ffprobeArgs(file));
    if (result.code !== 0) return null;
    return parseFfprobe(result.stdout);
  } catch {
    return null;
  }
}

