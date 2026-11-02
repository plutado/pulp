/**
 * The preview's tiles onto a long cut (milestone 58): the grid, the clamp to
 * the cut, and the prefetch of the tile ahead.
 */

import { describe, expect, it } from 'vitest';
import { tileFor, tileHolds, tileKey, tilesWanted, TRACK_HELD_FRAMES_BUDGET, TRACK_PREFETCH_SECONDS, TRACK_TILE_SECONDS } from '../src/core/track-window';

describe('tiles onto a cut', () => {
  const cut = { from: 3, to: 627 };

  it('lie on a grid from the cut\'s start, clamped to its window', () => {
    expect(tileFor(cut, 3)).toEqual({ from: 3, to: 13 });
    expect(tileFor(cut, 12.999)).toEqual({ from: 3, to: 13 });
    expect(tileFor(cut, 13)).toEqual({ from: 13, to: 23 });
    // The last tile is however much is left; past the end is the last tile.
    expect(tileFor(cut, 626.5)).toEqual({ from: 623, to: 627 });
    expect(tileFor(cut, 1000)).toEqual({ from: 623, to: 627 });
    expect(tileFor(cut, -5)).toEqual({ from: 3, to: 13 });
    // A short cut is one tile, its own length.
    expect(tileFor({ from: 1, to: 3 }, 2)).toEqual({ from: 1, to: 3 });
  });

  it('know which seconds they hold, the cut\'s very end included', () => {
    const first = tileFor(cut, 3);
    expect(tileHolds(first, 3, cut.to)).toBe(true);
    expect(tileHolds(first, 12.99, cut.to)).toBe(true);
    expect(tileHolds(first, 13, cut.to)).toBe(false);
    const last = tileFor(cut, 626);
    expect(tileHolds(last, 627, cut.to)).toBe(true);
  });

  it('ask for the tile ahead only when the playhead is near the seam, and never past the cut', () => {
    expect(tilesWanted(cut, 5)).toEqual([{ from: 3, to: 13 }]);
    expect(tilesWanted(cut, 13 - TRACK_PREFETCH_SECONDS)).toEqual([{ from: 3, to: 13 }, { from: 13, to: 23 }]);
    expect(tilesWanted(cut, 626)).toEqual([{ from: 623, to: 627 }]);
    expect(tileKey(2, { from: 13, to: 23 })).toBe('2:13-23');
  });

  it('fit the budget: three tiles at 30 fps are under what the preview may hold', () => {
    expect(3 * TRACK_TILE_SECONDS * 30).toBeLessThanOrEqual(TRACK_HELD_FRAMES_BUDGET);
  });
});
