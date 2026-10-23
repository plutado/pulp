/**
 * Thumbnails: the pure parts. Which items get one, the ffmpeg arguments that
 * make one, the cache file name, and the URL the app window loads it from.
 * Generation (ffmpeg, the offscreen renderer) and serving live in the main
 * process; results are cached in the library store with the item's stat
 * signature, so a changed file gets a new thumbnail and an unchanged one is
 * never redone.
 */

import type { LibraryEntry } from './library-types';

export const THUMB_SCHEME = 'pulp-thumb';
/** Longest side of a thumbnail, in pixels. Small files that are already smaller are not enlarged. */
export const THUMB_SIZE = 240;

export function thumbUrlFor(id: string): string {
  return `${THUMB_SCHEME}://${id}/`;
}

/** File name inside the thumbnail cache folder; one per item, overwritten when the item changes. */
export function thumbFileName(id: string): string {
  return `${id}.png`;
}

/** Templates and visual media get thumbnails; audio has nothing to show. */
export function wantsThumbnail(entry: LibraryEntry): boolean {
  return entry.kind === 'template' || entry.mediaKind !== 'audio';
}

/** Fit inside THUMB_SIZE square without enlarging. */
export const THUMB_SCALE = `scale=w='min(iw,${THUMB_SIZE})':h='min(ih,${THUMB_SIZE})':force_original_aspect_ratio=decrease`;

/**
 * ffmpeg arguments for a media thumbnail. Video is sampled one tenth into the
 * clip (or at the start when the duration is unknown); images use their only
 * frame. Alpha is kept, so the UI shows it over the checkerboard.
 */
export function mediaThumbArgs(input: string, output: string, durationSeconds: number | undefined, isVideo: boolean): string[] {
  const seek = isVideo && durationSeconds && durationSeconds > 0 ? ['-ss', (durationSeconds / 10).toFixed(3)] : [];
  return ['-v', 'error', '-y', ...seek, '-i', input, '-frames:v', '1', '-vf', `${THUMB_SCALE},format=rgba`, '-f', 'image2', output];
}

/** ffmpeg arguments to shrink a rendered poster frame into the cache. */
export function posterThumbArgs(input: string, output: string): string[] {
  return ['-v', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', `${THUMB_SCALE},format=rgba`, '-f', 'image2', output];
}
