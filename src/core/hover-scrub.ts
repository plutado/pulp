/**
 * Hover-scrub: a few frames of a video or template in one wide image, stepped by
 * where the pointer sits over a card (docs/ui-layout.md, milestone 12). This is
 * the pure half — which items have something to scrub, the ffmpeg arguments that
 * make a strip, the cache file name, the URL the window loads it from, and the
 * sprite arithmetic the card styles itself with.
 *
 * Strips are made when a card is first hovered rather than for the whole library
 * up front: a template strip costs a render, and most items are never pointed at.
 * They are then cached beside the thumbnails, keyed by the item's size and mtime,
 * so an unchanged item is never done twice.
 */

import type { LibraryEntry } from './library-types';
import { THUMB_SIZE } from './thumbnails';

export const STRIP_SCHEME = 'pulp-strip';

/** Frames in a strip: enough to read a move at a glance, few enough to make on demand. */
export const STRIP_FRAMES = 8;

/** How long the pointer must rest on a card before its strip is asked for. */
export const HOVER_DWELL_MS = 250;

/**
 * How long before asking again when a strip was not ready — the machine was
 * busy, or a clip has yet to be probed. Only while the pointer stays on the card.
 */
export const STRIP_RETRY_MS = 1_000;

export function stripUrlFor(id: string): string {
  return `${STRIP_SCHEME}://${id}/`;
}

/** File name in the thumbnail cache folder; the poster is `<id>.png`, so the strip needs its own. */
export function stripFileName(id: string): string {
  return `${id}-strip.png`;
}

/**
 * Could this item ever scrub? A template or a video; a still or a sound has
 * nothing to step through and never will. Separate from `wantsStrip` because
 * "never" and "not yet" are different answers: the first is worth remembering,
 * the second must not be.
 */
export function canHaveStrip(entry: LibraryEntry): boolean {
  return entry.kind === 'template' ? entry.manifest.duration > 0 : entry.mediaKind === 'video';
}

/**
 * Can a strip be made for it right now? It must be reachable, and a video must
 * have been probed for the duration the frames are spread over. Both of those
 * can change, so a false here is "ask again later", not "no".
 */
export function wantsStrip(entry: LibraryEntry): boolean {
  if (!canHaveStrip(entry) || entry.offline) return false;
  return entry.kind === 'template' || (entry.meta?.duration ?? 0) > 0;
}

/**
 * The frames of a template's timeline a strip samples: evenly spaced from the
 * first to the last, so the strip covers the whole animation including its end.
 *
 * Always as many as the strip holds, even for a template with fewer frames than
 * that — then some repeat. A strip with a different number of tiles would need
 * the card to know how many before it could place one, and a four-frame
 * template is not worth that.
 */
export function stripFrameIndices(totalFrames: number, frames = STRIP_FRAMES): number[] {
  const last = Math.max(0, Math.floor(totalFrames) - 1);
  const want = Math.max(1, frames);
  if (want === 1) return [Math.floor(last / 2)];
  return Array.from({ length: want }, (_, i) => Math.round((i * last) / (want - 1)));
}

/** Tiles keep the thumbnail's width at most, so a strip is never larger than it needs to be and small sources are not enlarged. */
const TILE_SCALE = `scale=w='min(iw,${THUMB_SIZE})':h=-2`;

/**
 * ffmpeg: frames spread across a clip, tiled left to right into one image.
 *
 * The rate asks for slightly more than the strip holds. `tile` emits as soon as
 * it has a full row, so a few extra inputs cost nothing; one input short and it
 * would flush a padded, part-blank tile at the end of the file instead.
 */
export function mediaStripArgs(input: string, output: string, durationSeconds: number, frames = STRIP_FRAMES): string[] {
  const rate = ((frames * 1.08) / Math.max(durationSeconds, 0.1)).toFixed(6);
  return ['-v', 'error', '-y', '-i', input, '-an', '-vf', `fps=${rate},${TILE_SCALE},tile=${frames}x1`, '-frames:v', '1', '-f', 'image2', output];
}

/**
 * ffmpeg: a frame sequence, read through the image2 demuxer and tiled the same
 * way a clip is. The run is fed in at its own rate so that the `fps` filter
 * above picks the same frames it would from a video of that length;
 * `-start_number` is what tells the demuxer where the run begins.
 */
export function sequenceStripArgs(
  patternPath: string,
  startNumber: number,
  output: string,
  durationSeconds: number,
  sequenceFps: number,
  frames = STRIP_FRAMES,
): string[] {
  const rate = ((frames * 1.08) / Math.max(durationSeconds, 0.1)).toFixed(6);
  return [
    '-v', 'error', '-y',
    '-start_number', String(startNumber), '-framerate', String(sequenceFps), '-i', patternPath,
    '-an', '-vf', `fps=${rate},${TILE_SCALE},tile=${frames}x1`, '-frames:v', '1', '-f', 'image2', output,
  ];
}

/**
 * ffmpeg: frames already captured, arriving as one PNG stream on stdin, tiled
 * into one image. A pipe rather than a numbered pattern in a scratch folder:
 * nothing to name, nothing to clean up, and no Windows path to get wrong.
 */
export function framesStripArgs(output: string, frames = STRIP_FRAMES): string[] {
  return ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', 'pipe:0', '-vf', `${TILE_SCALE},tile=${frames}x1`, '-frames:v', '1', '-f', 'image2', output];
}

/** Which tile a pointer fraction across the thumbnail lands on; outside the box clamps to an end. */
export function tileAt(fraction: number, frames = STRIP_FRAMES): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(frames - 1, Math.max(0, Math.floor(fraction * frames)));
}

/**
 * The `background-position-x` that shows a tile, as a percentage, given
 * `background-size: frames * 100%`. With that sizing 0% is the first tile and
 * 100% is the last, so the step is 100 / (frames - 1), not 100 / frames.
 */
export function tilePercent(tile: number, frames = STRIP_FRAMES): number {
  if (frames <= 1) return 0;
  return (Math.min(frames - 1, Math.max(0, tile)) / (frames - 1)) * 100;
}

/** The `background-size` width for a strip, as a percentage of the thumbnail. */
export function stripWidthPercent(frames = STRIP_FRAMES): number {
  return frames * 100;
}
