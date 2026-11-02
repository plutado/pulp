/**
 * The preview's window onto a long cut (milestone 58). A cut's frames used
 * to be decoded whole for the preview, which is fine for a shot of a few
 * seconds and impossible for a ten-minute one: a window may hold 900 frames,
 * so anything longer showed the pad, and a 30-minute track would have asked
 * for a gigabyte of PNG. The preview now decodes **tiles** — fixed stretches
 * of a cut's file, on a grid — around the moment being shown, and holds only
 * the tiles it is drawing from plus the one coming next.
 *
 * The grid is what keeps the asks stable: a playhead wandering inside a tile
 * asks for nothing, and the same tile is the same cache key in the main
 * process however the playhead reached it.
 */

/** Seconds of a cut's file one tile holds. At 30 fps that is 300 frames at proxy size. */
export const TRACK_TILE_SECONDS = 10;

/** How near a tile's far edge the playhead gets before the next tile is asked for. */
export const TRACK_PREFETCH_SECONDS = 2.5;

/**
 * The most frames the preview holds for the whole track, across every cut:
 * the tile being shown, its neighbour across a transition and the tile ahead,
 * at any ordinary frame rate. The memory budget the long-track test holds.
 */
export const TRACK_HELD_FRAMES_BUDGET = 1200;

export interface Tile {
  /** Seconds into the file, on the grid, clamped to the cut's window. */
  from: number;
  to: number;
}

const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/** The tile of a cut's window that holds this second of its file. */
export function tileFor(cut: { from: number; to: number }, source: number, tileSeconds = TRACK_TILE_SECONDS): Tile {
  const at = Math.min(Math.max(cut.from, source), Math.max(cut.from, cut.to - 1e-6));
  const index = Math.floor((at - cut.from) / tileSeconds);
  const from = cut.from + index * tileSeconds;
  return { from: ms(from), to: ms(Math.min(cut.to, from + tileSeconds)) };
}

/** True when this tile holds the second, inclusive at its start, exclusive at its end but for the cut's own end. */
export function tileHolds(tile: Tile, source: number, cutEnd: number): boolean {
  if (source < tile.from - 1e-6) return false;
  if (tile.to >= cutEnd - 1e-6) return source <= cutEnd + 1e-6;
  return source < tile.to - 1e-6;
}

/**
 * The tiles a moment wants of one cut: the one it is in, and the next when it
 * is near enough to need it soon — so playback crosses the seam without a
 * stall. Nothing past the cut's end.
 */
export function tilesWanted(cut: { from: number; to: number }, source: number, tileSeconds = TRACK_TILE_SECONDS, prefetchSeconds = TRACK_PREFETCH_SECONDS): Tile[] {
  const current = tileFor(cut, source, tileSeconds);
  const tiles = [current];
  if (current.to < cut.to - 1e-6 && current.to - source <= prefetchSeconds) tiles.push(tileFor(cut, current.to, tileSeconds));
  return tiles;
}

/** A tile's identity for caches and comparisons. */
export function tileKey(cutIndex: number, tile: Tile): string {
  return `${cutIndex}:${tile.from}-${tile.to}`;
}
