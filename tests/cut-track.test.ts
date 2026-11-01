/**
 * The cut track's arithmetic (milestone 49): where each cut sits, what a
 * split, a trim, a ripple delete and a move leave behind, and what a stored
 * track is read back as. The lane draws and drags by exactly these answers,
 * so a mistake here is a cut that lands somewhere else than it was let go —
 * the kind of thing only a test catches.
 */

import { describe, expect, it } from 'vitest';
import {
  CUT_TRACK_LIMITS, cutFromClip, cutIndexAt, cutWindows, MIN_CUT_SECONDS, sanitizeCutTrack, snapTime,
  splitAt, trackAudio, trackDuration, trackSourceAt, withCutInserted, withCutMoved, withCutRemoved, withCutWindow, type CutTrack,
} from '../src/core/cut-track';

const id = (n: number) => String(n).repeat(24);
const track = (): CutTrack => ({
  cuts: [
    { id: id(1), from: 0, to: 2 },
    { id: id(2), from: 1, to: 2.5 },
    { id: id(3), from: 0.5, to: 1.5 },
  ],
});

describe('where the cuts sit', () => {
  it('lays them end to end from zero, and knows which is under a moment', () => {
    expect(cutWindows(track())).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3.5 },
      { start: 3.5, end: 4.5 },
    ]);
    expect(trackDuration(track())).toBe(4.5);
    expect(cutIndexAt(track(), 0)).toBe(0);
    // A boundary belongs to the later cut, so a split at one never makes a sliver.
    expect(cutIndexAt(track(), 2)).toBe(1);
    expect(cutIndexAt(track(), 4.49)).toBe(2);
    expect(cutIndexAt(track(), 4.5)).toBeNull();
    expect(cutIndexAt(track(), -1)).toBeNull();
  });

  it('makes a whole clip a cut, and inserts it where it was dropped', () => {
    const dropped = cutFromClip(id(4), 3.0004);
    expect(dropped).toEqual({ id: id(4), from: 0, to: 3 });
    const grown = withCutInserted(track(), 1, dropped);
    expect(grown.cuts.map((c) => c.id)).toEqual([id(1), id(4), id(2), id(3)]);
    // The index is clamped into the list: past the end appends.
    expect(withCutInserted(track(), 99, dropped).cuts[3]!.id).toBe(id(4));
    // And the track has a cap, past which it comes back unchanged.
    const full: CutTrack = { cuts: Array.from({ length: CUT_TRACK_LIMITS.count }, () => ({ id: id(5), from: 0, to: 1 })) };
    expect(withCutInserted(full, 0, dropped)).toBe(full);
  });
});

describe('split at the playhead', () => {
  it('splits the cut under the moment into two of the same clip meeting there', () => {
    const split = splitAt(track(), 2.5);
    expect(split.cuts).toHaveLength(4);
    expect(split.cuts[1]).toEqual({ id: id(2), from: 1, to: 1.5 });
    expect(split.cuts[2]).toEqual({ id: id(2), from: 1.5, to: 2.5 });
    // The timeline around the split does not move.
    expect(trackDuration(split)).toBe(4.5);
  });

  it('is a no-op at a boundary or off the track, and says so by identity', () => {
    const t = track();
    expect(splitAt(t, 2)).toBe(t);
    expect(splitAt(t, 2.01)).toBe(t); // within a minimum of the boundary: the sliver is never made
    expect(splitAt(t, 99)).toBe(t);
    const empty: CutTrack = { cuts: [] };
    expect(splitAt(empty, 1)).toBe(empty);
  });
});

describe('trimming either end', () => {
  it('moves an end in the file\'s own seconds, held inside the file and clear of the other end', () => {
    const headed = withCutWindow(track(), 1, { from: 1.5 }, 10);
    expect(headed.cuts[1]).toEqual({ id: id(2), from: 1.5, to: 2.5 });
    // Everything after ripples by construction: the third cut starts where the second now ends.
    expect(cutWindows(headed)[2]!.start).toBe(3);
    const tailed = withCutWindow(track(), 1, { to: 99 }, 4);
    expect(tailed.cuts[1]!.to, 'the file is the only bound an out point has').toBe(4);
    const pinched = withCutWindow(track(), 1, { from: 99 }, 4);
    expect(pinched.cuts[1]!.from).toBeCloseTo(2.5 - MIN_CUT_SECONDS, 6);
    const t = track();
    expect(withCutWindow(t, 1, { from: 1 }, 10), 'nothing moved is the same track').toBe(t);
  });
});

describe('ripple delete and the move', () => {
  it('closes up around a removed cut: deleting is the ripple', () => {
    const gone = withCutRemoved(track(), 1);
    expect(gone.cuts.map((c) => c.id)).toEqual([id(1), id(3)]);
    expect(cutWindows(gone)[1]).toEqual({ start: 2, end: 3 });
    const t = track();
    expect(withCutRemoved(t, 9)).toBe(t);
  });

  it('moves a cut to a new place with the rest closing around it', () => {
    const moved = withCutMoved(track(), 0, 2);
    expect(moved.cuts.map((c) => c.id)).toEqual([id(2), id(3), id(1)]);
    expect(trackDuration(moved)).toBe(4.5);
    const t = track();
    expect(withCutMoved(t, 1, 1)).toBe(t);
  });
});

describe('what the track plays (milestone 49)', () => {
  it('names the clip and the second of its file under any moment of the timeline', () => {
    expect(trackSourceAt(track(), 0.5)).toEqual({ id: id(1), index: 0, seconds: 0.5 });
    // The second cut starts at 2 on the timeline and at 1 in its file.
    expect(trackSourceAt(track(), 2)).toEqual({ id: id(2), index: 1, seconds: 1 });
    expect(trackSourceAt(track(), 3.25)).toEqual({ id: id(2), index: 1, seconds: 2.25 });
    expect(trackSourceAt(track(), 4.5)).toBeNull();
  });

  it('carries each cut\'s sound as a sound-shaped value, placed by its delay and gated by its span', () => {
    const audio = trackAudio(track());
    expect(audio).toHaveLength(3);
    expect(audio[1]!.value).toMatchObject({ id: id(2), inPoint: 1, outPoint: 2.5, ending: 'once', delay: 2, volume: 1, muted: false });
    expect(audio[1]!.span).toEqual({ start: 2, end: 3.5 });
    expect(audio[0]!.value).toMatchObject({ inPoint: 0, outPoint: 2, delay: 0 });
  });
});

describe('snapping', () => {
  it('pulls a moment to the nearest target within the tolerance, or leaves it be', () => {
    expect(snapTime(1.9, [0, 2, 3.5], 0.2)).toBe(2);
    expect(snapTime(1.9, [0, 2.2, 1.95], 0.3), 'the nearest wins').toBe(1.95);
    expect(snapTime(1.5, [0, 2, 3.5], 0.2)).toBe(1.5);
    expect(snapTime(1.5, [], 0.2)).toBe(1.5);
  });
});

describe('reading a stored track', () => {
  it('keeps cuts with a clip and a window, drops the rest, and an empty track is no track at all', () => {
    expect(sanitizeCutTrack({ cuts: [{ id: ' a ', from: 0, to: 1.23456 }, { id: '', from: 0, to: 1 }, { id: 'b', from: 1, to: 1.01 }, 'junk', { id: 'c', from: -5, to: 1e9 }] }))
      .toEqual({ cuts: [{ id: 'a', from: 0, to: 1.235 }, { id: 'c', from: 0, to: CUT_TRACK_LIMITS.seconds.max }] });
    expect(sanitizeCutTrack({ cuts: [] })).toBeNull();
    expect(sanitizeCutTrack({ cuts: 'nope' })).toBeNull();
    expect(sanitizeCutTrack(null)).toBeNull();
    expect(sanitizeCutTrack('x')).toBeNull();
    const long = { cuts: Array.from({ length: CUT_TRACK_LIMITS.count + 9 }, () => ({ id: 'a', from: 0, to: 1 })) };
    expect(sanitizeCutTrack(long)!.cuts).toHaveLength(CUT_TRACK_LIMITS.count);
  });
});
