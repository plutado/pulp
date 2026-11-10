/**
 * A film strip on the timeline (milestone 87): a clip's frames drawn along its
 * shot, as editing apps draw them, with a choice of none, the first frame, or
 * a continuous strip.
 *
 * **One strip per file, made once.** The frames are sampled evenly over the
 * whole clip — denser than the hover scrub's eight (milestone 12), small, and
 * tiled into one image — in the main process's background queue, and cached by
 * the file's size and modification time. Every shot of that file, however it
 * is trimmed or timed, draws from the same strip: what changes per shot is
 * only which tile goes where, and that is arithmetic, here.
 *
 * **Placed by the clip's own time.** A slot along a shot shows the frame of
 * the file under the slot's left edge on the timeline (`cutSourceTime`), so a
 * trim moves the first picture, a speed change or a ramp spaces the pictures
 * as the shot plays them, and a freeze frame repeats its one. As a shot
 * widens the slots stay the same size and more of them come, so frames that
 * were skipped appear and a slow shot repeats a frame; as it narrows they
 * thin out. Pure: the window draws, the main process decodes.
 */

import { cutSeconds, cutSourceTime, type Cut } from './cut-track';

/** What a timeline lane draws of a clip: nothing, the shot's first frame, or a frame per slot along it. */
export const FILM_STRIP_MODES = ['off', 'first', 'continuous'] as const;
export type FilmStripMode = (typeof FILM_STRIP_MODES)[number];
export const DEFAULT_FILM_STRIP: FilmStripMode = 'continuous';

export function sanitizeFilmStripMode(raw: unknown): FilmStripMode {
  return (FILM_STRIP_MODES as readonly unknown[]).includes(raw) ? (raw as FilmStripMode) : DEFAULT_FILM_STRIP;
}

/** A tile's height in the strip, in pixels: the lane draws it at about this, so nothing is scaled up much. */
export const FILM_TILE_HEIGHT = 40;
/** Tiles per row of the strip image, so a long strip is a block rather than one very wide line. */
export const FILM_COLUMNS = 16;
/** The most frames one strip holds: four a second for a minute, then spread thinner. */
export const FILM_MAX_FRAMES = 240;
/** The fewest: a short clip still gets a strip denser than the hover scrub's eight. */
export const FILM_MIN_FRAMES = 32;
/** The rate a long clip is sampled at, up to the most frames. */
export const FILM_RATE = 4;

/** How a clip is sampled and how big its tiles are. */
export interface FilmStripPlan {
  /** Frames a second of the file; frame `i` is the one nearest `i / rate` seconds in. */
  rate: number;
  /** Frames expected; the decode says how many it really gave. */
  count: number;
  tileWidth: number;
  tileHeight: number;
}

/** A strip as made: the plan's rate and tile size, the frames it really holds, and how they are laid out. */
export interface FilmStripInfo {
  rate: number;
  count: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
}

/**
 * How to sample a clip of this length and shape: at least the fewest frames,
 * four a second where that is more, never more than the most, and never
 * faster than the clip's own rate (a frame repeated in the strip says nothing).
 * Tiles keep the clip's shape at the strip's height, in whole even pixels.
 */
export function filmStripPlan(duration: number, width: number, height: number, sourceFps?: number): FilmStripPlan {
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 1;
  let count = Math.min(FILM_MAX_FRAMES, Math.max(FILM_MIN_FRAMES, Math.ceil(seconds * FILM_RATE)));
  if (sourceFps && sourceFps > 0) count = Math.max(1, Math.min(count, Math.floor(seconds * sourceFps)));
  const shape = width > 0 && height > 0 ? width / height : 16 / 9;
  const tileWidth = Math.max(8, Math.min(160, Math.round((FILM_TILE_HEIGHT * shape) / 2) * 2));
  return { rate: count / seconds, count, tileWidth, tileHeight: FILM_TILE_HEIGHT };
}

/** ffmpeg: the clip's frames at the plan's rate, scaled to a tile, as raw RGB on stdout — so their number is the bytes over a tile's. */
export function filmFramesArgs(input: string, plan: FilmStripPlan, decoder?: string): string[] {
  return [
    '-v', 'error', '-nostdin',
    ...(decoder ? ['-c:v', decoder] : []),
    '-i', input, '-an',
    '-vf', `fps=${Number(plan.rate.toFixed(6))},scale=${plan.tileWidth}:${plan.tileHeight}:flags=bilinear,setsar=1,format=rgb24`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ];
}

/** How a strip of this many frames is laid out: rows of `FILM_COLUMNS`, or one row when there are fewer. */
export function filmLayout(count: number): { columns: number; rows: number } {
  const columns = Math.max(1, Math.min(FILM_COLUMNS, count));
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
}

/** ffmpeg: the raw frames on stdin tiled into one PNG on stdout; a short last row is padded. */
export function filmTileArgs(tileWidth: number, tileHeight: number, count: number): string[] {
  const { columns, rows } = filmLayout(count);
  return [
    '-v', 'error', '-nostdin',
    '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${tileWidth}x${tileHeight}`, '-framerate', '1', '-i', 'pipe:0',
    '-vf', `tile=${columns}x${rows}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
  ];
}

/** The strip's frame nearest a second of the file. */
export function filmFrameAt(strip: Pick<FilmStripInfo, 'rate' | 'count'>, seconds: number): number {
  if (strip.count <= 0) return 0;
  const at = Math.round(Math.max(0, seconds) * strip.rate);
  return Math.min(strip.count - 1, Math.max(0, at));
}

/** Where tile `index` sits in the strip image, in its pixels. */
export function filmTileRect(strip: FilmStripInfo, index: number): { x: number; y: number; width: number; height: number } {
  const i = Math.min(strip.count - 1, Math.max(0, index));
  return { x: (i % strip.columns) * strip.tileWidth, y: Math.floor(i / strip.columns) * strip.tileHeight, width: strip.tileWidth, height: strip.tileHeight };
}

/** One picture along a lane: where it starts, in pixels from the shot's left, and the second of the file it shows. */
export interface FilmSlot {
  x: number;
  seconds: number;
}

/**
 * The pictures along a span `width` pixels wide whose slots are `slot` pixels
 * each: one, at the left, for the first frame; for a continuous strip as many
 * as fit and one more cut short at the end. `sourceAt` maps a fraction of the
 * span (0 at its left edge) to the second of the file playing there, or null
 * where nothing plays — a slot over nothing is left out.
 */
export function filmSlots(width: number, slot: number, mode: FilmStripMode, sourceAt: (fraction: number) => number | null): FilmSlot[] {
  if (mode === 'off' || !(width > 0) || !(slot > 0)) return [];
  const count = mode === 'first' ? 1 : Math.ceil(width / slot);
  const out: FilmSlot[] = [];
  for (let k = 0; k < count; k++) {
    const x = k * slot;
    const seconds = sourceAt(Math.min(1, x / width));
    if (seconds !== null && Number.isFinite(seconds)) out.push({ x, seconds });
  }
  return out;
}

/** The slots along a shot on the cut track: each the file second under its left edge, by the shot's own timing. */
export function cutFilmSlots(cut: Pick<Cut, 'from' | 'to' | 'speed' | 'hold'>, width: number, slot: number, mode: FilmStripMode): FilmSlot[] {
  const seconds = cutSeconds(cut);
  return filmSlots(width, slot, mode, (fraction) => cutSourceTime(cut, fraction * seconds));
}
