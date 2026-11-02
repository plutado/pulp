/**
 * The cut track's arithmetic (milestone 49): where each cut sits, what a
 * split, a trim, a ripple delete and a move leave behind, and what a stored
 * track is read back as. The lane draws and drags by exactly these answers,
 * so a mistake here is a cut that lands somewhere else than it was let go —
 * the kind of thing only a test catches.
 */

import { describe, expect, it } from 'vitest';
import {
  CUT_TRACK_LIMITS, cutFromClip, cutIndexAt, cutRateAt, cutSeconds, cutSourceTime, cutTimelineTime, cutWindows, MIN_CUT_SECONDS, sanitizeCutTrack, snapTime,
  healedTrack, splitAt, trackAudio, trackDuration, trackSourceAt, transitionAt, withCutHold, withCutInserted, withCutSound, withCutSpeed, withCutTransition, withFreezeAt, withSilencesCut, withCutMoved, withCutRemoved, withCutWindow, type Cut, type CutTrack,
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

describe('transitions on a cut (milestone 49)', () => {
  it('plays between a cut and the next, centred on their boundary, no more than either side has', () => {
    const t = withCutTransition(track(), 0, { type: 'dissolve', seconds: 1 });
    expect(transitionAt(t, 0)).toEqual({ type: 'dissolve', seconds: 1, at: 2, color: '#000000' });
    // A short neighbour shortens it: the third cut is one second, so a 5 s dip plays over 1 s... no —
    // both sides bound it: half from each, the smaller side ruling both halves.
    const short = withCutTransition(track(), 1, { type: 'dip', seconds: 5, color: '#00ff00' });
    expect(transitionAt(short, 1)).toMatchObject({ type: 'dip', seconds: 1, at: 3.5, color: '#00ff00' });
    // On the last cut there is no next shot to go to; absent is a straight cut.
    expect(transitionAt(withCutTransition(track(), 2, { type: 'dissolve', seconds: 1 }), 2)).toBeNull();
    expect(transitionAt(track(), 0)).toBeNull();
  });

  it('is set and cleared on the cut, and a wipe must name its template', () => {
    const wiped = withCutTransition(track(), 0, { type: 'wipe', seconds: 0.5, template: 'pulp.samples.diagonal-wipe' });
    expect(wiped.cuts[0]!.transition).toMatchObject({ type: 'wipe', template: 'pulp.samples.diagonal-wipe' });
    expect(withCutTransition(wiped, 0, null).cuts[0]!.transition).toBeUndefined();
    const stored = sanitizeCutTrack({ cuts: [
      { id: 'a', from: 0, to: 2, transition: { type: 'dip', seconds: 99, color: '#ABCdef' } },
      { id: 'b', from: 0, to: 2, transition: { type: 'wipe', seconds: 1 } },
      { id: 'c', from: 0, to: 2, transition: { type: 'reverb', seconds: 1 } },
    ] })!;
    expect(stored.cuts[0]!.transition).toEqual({ type: 'dip', seconds: 5, color: '#abcdef' });
    expect(stored.cuts[1]!.transition, 'a wipe with no template is no wipe').toBeUndefined();
    expect(stored.cuts[2]!.transition).toBeUndefined();
  });
});

describe('a cut\'s sound unlinked (milestone 49)', () => {
  it('leads under the previous shot and trails under the next: J and L cuts', () => {
    // The second cut plays file seconds 1-2.5 at timeline 2-3.5; its sound leads by 0.5 and trails by 0.4.
    const t = withCutSound(track(), 1, { lead: 0.5, tail: 0.4 });
    const audio = trackAudio(t)[1]!;
    expect(audio.value).toMatchObject({ inPoint: 0.5, outPoint: 2.9, delay: 1.5 });
    expect(audio.span).toEqual({ start: 1.5, end: 3.9 });
    // The lead is bounded by what the file has before the in point, and by the timeline's own start.
    const early = withCutSound(track(), 0, { lead: 5 });
    expect(trackAudio(early)[0]!.value).toMatchObject({ inPoint: 0, delay: 0 });
    // Muted is silence with the numbers kept; linked again is the picture's own window.
    expect(trackAudio(withCutSound(t, 1, { muted: true }))).toHaveLength(2);
    expect(withCutSound(t, 1, null).cuts[1]!.sound).toBeUndefined();
    expect(sanitizeCutTrack({ cuts: [{ id: 'a', from: 1, to: 2, sound: { lead: 99, muted: true } }] })!.cuts[0]!.sound).toEqual({ lead: 10, muted: true });
  });
});

describe('silence removal (milestone 49)', () => {
  it('cuts the quiet stretches out: a covered cut goes, a straddled one splits, and the rest ripple', () => {
    // Quiet across 1.5-2.6 of the timeline: the tail of cut 1 and the head of cut 2.
    const cut = withSilencesCut(track(), [{ start: 1.5, end: 2.6 }]);
    expect(cut.cuts).toEqual([
      { id: id(1), from: 0, to: 1.5 },
      { id: id(2), from: 1.6, to: 2.5 },
      { id: id(3), from: 0.5, to: 1.5 },
    ]);
    // A range over a whole cut removes it; slivers go with the silence rather than surviving.
    const gone = withSilencesCut(track(), [{ start: 1.99, end: 4.5 }]);
    expect(gone.cuts).toEqual([{ id: id(1), from: 0, to: 1.99 }]);
    const t = track();
    expect(withSilencesCut(t, []), 'nothing found is the track untouched').toBe(t);
  });

  it('keeps the first piece\'s sound and the last piece\'s transition across a split', () => {
    const dressed: CutTrack = { cuts: [{ id: id(1), from: 0, to: 2, sound: { lead: 0.5 }, transition: { type: 'dissolve', seconds: 0.5 } }, { id: id(2), from: 0, to: 1 }] };
    const cut = withSilencesCut(dressed, [{ start: 0.8, end: 1.2 }]);
    expect(cut.cuts[0]).toEqual({ id: id(1), from: 0, to: 0.8, sound: { lead: 0.5 } });
    expect(cut.cuts[1]).toEqual({ id: id(1), from: 1.2, to: 2, transition: { type: 'dissolve', seconds: 0.5 } });
  });
});

describe('relinking by remembered path (milestone 49)', () => {
  it('heals a cut whose clip moved, by the path the cut remembers, and says nothing when nothing changed', () => {
    const t: CutTrack = { cuts: [{ id: 'stale', from: 0, to: 2, path: '/old/a.mp4' }, { id: 'fine', from: 0, to: 1 }] };
    const healed = healedTrack(t, (cut) => (cut.id === 'stale' ? { id: 'fresh', path: '/new/a.mp4' } : null));
    expect(healed.cuts[0]).toMatchObject({ id: 'fresh', path: '/new/a.mp4', from: 0, to: 2 });
    expect(healed.cuts[1]!.id).toBe('fine');
    // Nothing to heal is the same track, by identity: no undo step for a heal that healed nothing.
    expect(healedTrack(t, () => null)).toBe(t);
    expect(healedTrack(t, (cut) => ({ id: cut.id }))).toBe(t);
  });

  it('keeps the remembered path through a drop, a split and a silence cut', () => {
    const dropped = cutFromClip('abc', 4, '/shots/a.mp4');
    expect(dropped.path).toBe('/shots/a.mp4');
    const t: CutTrack = { cuts: [dropped] };
    expect(splitAt(t, 2).cuts.map((c) => c.path)).toEqual(['/shots/a.mp4', '/shots/a.mp4']);
    expect(withSilencesCut(t, [{ start: 1, end: 2 }]).cuts.map((c) => c.path)).toEqual(['/shots/a.mp4', '/shots/a.mp4']);
    expect(sanitizeCutTrack({ cuts: [{ id: 'a', from: 0, to: 1, path: ' /kept/here.mp4 ' }] })!.cuts[0]!.path).toBe('/kept/here.mp4');
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

describe('speed changes (milestone 56)', () => {
  const fast = (): CutTrack => ({ cuts: [{ id: id(1), from: 0, to: 2, speed: { rate: 2 } }, { id: id(2), from: 1, to: 2.5 }] });

  it('takes a cut\'s timeline length from its rate, and maps a moment back into the file through it', () => {
    const t = fast();
    expect(cutSeconds(t.cuts[0]!)).toBe(1);
    expect(cutWindows(t)).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2.5 }]);
    expect(trackDuration(t)).toBe(2.5);
    // Half a second into a 2× cut is a second into the file; the neighbour is untouched.
    expect(trackSourceAt(t, 0.5)).toEqual({ id: id(1), index: 0, seconds: 1 });
    expect(trackSourceAt(t, 1.25)).toEqual({ id: id(2), index: 1, seconds: 1.25 });
    const slow: Cut = { id: id(1), from: 1, to: 2, speed: { rate: 0.25 } };
    expect(cutSeconds(slow)).toBe(4);
    expect(cutSourceTime(slow, 2)).toBe(1.5);
    expect(cutTimelineTime(slow, 1.5)).toBe(2);
  });

  it('ramps linearly in timeline time: the file is consumed as the integral of the rate, and the inverse agrees', () => {
    // From 1× to 3× over a 4-second window: the mean is 2×, so it takes 2 s on the timeline.
    const ramp: Cut = { id: id(1), from: 0, to: 4, speed: { rate: 1, to: 3 } };
    expect(cutSeconds(ramp)).toBe(2);
    expect(cutRateAt(ramp, 0)).toBe(1);
    expect(cutRateAt(ramp, 1)).toBe(2);
    expect(cutRateAt(ramp, 2)).toBe(3);
    // r₁t + (r₂−r₁)t²/2T at t = 1: 1 + 2·1/4 = 1.5 s of the file.
    expect(cutSourceTime(ramp, 1)).toBeCloseTo(1.5, 9);
    expect(cutSourceTime(ramp, 2)).toBeCloseTo(4, 9);
    for (const t of [0, 0.3, 1, 1.7, 2]) expect(cutTimelineTime(ramp, cutSourceTime(ramp, t))).toBeCloseTo(t, 9);
    // Past either edge the edge holds, as a dissolve's clone-padding does.
    expect(cutSourceTime(ramp, -1)).toBe(0);
    expect(cutSourceTime(ramp, 5)).toBe(4);
  });

  it('splits a ramp into two ramps meeting at the rate it had there, so what plays is unchanged', () => {
    const t: CutTrack = { cuts: [{ id: id(1), from: 0, to: 4, speed: { rate: 1, to: 3, smooth: true } }] };
    const split = splitAt(t, 1);
    expect(split.cuts).toHaveLength(2);
    expect(split.cuts[0]).toEqual({ id: id(1), from: 0, to: 1.5, speed: { rate: 1, to: 2, smooth: true } });
    expect(split.cuts[1]).toEqual({ id: id(1), from: 1.5, to: 4, speed: { rate: 2, to: 3, smooth: true } });
    // The two pieces take exactly the time the whole did, and meet at the moment of the split.
    expect(cutWindows(split)).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }]);
    // A constant speed splits as it always did, the speed kept on both sides.
    const two = splitAt(fast(), 0.5);
    expect(two.cuts.slice(0, 2).map((c) => [c.from, c.to, c.speed?.rate])).toEqual([[0, 1, 2], [1, 2, 2]]);
  });

  it('plays the sound at the rate too, and a ramp as slices of constant speed that never drift from the picture', () => {
    const [piece] = trackAudio(fast());
    expect(piece).toEqual({
      cut: 0,
      value: expect.objectContaining({ id: id(1), inPoint: 0, outPoint: 2, delay: 0 }),
      span: { start: 0, end: 1 },
      speed: 2,
    });
    // The second cut, in real time, carries no speed at all.
    expect(trackAudio(fast())[1]!.speed).toBeUndefined();
    const ramp: CutTrack = { cuts: [{ id: id(1), from: 0, to: 4, speed: { rate: 1, to: 3 } }] };
    const slices = trackAudio(ramp);
    expect(slices.length).toBeGreaterThanOrEqual(2);
    // Each slice picks up the file where the last left it, at the mean rate of its stretch,
    // and together they cover the whole window on the whole timeline.
    slices.forEach((slice, k) => {
      expect(slice.cut).toBe(0);
      if (k > 0) expect(slice.value.inPoint).toBe(slices[k - 1]!.value.outPoint);
      expect(slice.speed).toBeCloseTo((slice.value.outPoint - slice.value.inPoint) / (slice.span.end! - slice.span.start!), 3);
    });
    expect(slices[0]!.value.inPoint).toBe(0);
    expect(slices[slices.length - 1]!.value.outPoint).toBe(4);
    expect(slices[slices.length - 1]!.span.end).toBe(2);
    // Rates rise along the ramp.
    expect(slices[0]!.speed!).toBeLessThan(slices[slices.length - 1]!.speed!);
  });

  it('is set and cleared on a cut, kept inside the limits, and real time is no speed at all', () => {
    const t = track();
    expect(withCutSpeed(t, 1, { rate: 4 }).cuts[1]!.speed).toEqual({ rate: 4 });
    expect(withCutSpeed(t, 1, { rate: 99 }).cuts[1]!.speed).toEqual({ rate: 4 });
    expect(withCutSpeed(t, 1, { rate: 0.5, to: 2 }).cuts[1]!.speed).toEqual({ rate: 0.5, to: 2 });
    // A ramp to the same rate is the rate; 1× with nothing else is no speed.
    expect(withCutSpeed(t, 1, { rate: 2, to: 2 }).cuts[1]!.speed).toEqual({ rate: 2 });
    expect(withCutSpeed(t, 1, { rate: 1 }).cuts[1]!.speed).toBeUndefined();
    expect(withCutSpeed(t, 1, { rate: 1, smooth: true }).cuts[1]!.speed).toEqual({ rate: 1, smooth: true });
    expect(withCutSpeed(withCutSpeed(t, 1, { rate: 2 }), 1, null).cuts[1]!.speed).toBeUndefined();
    expect(withCutSpeed(t, 9, { rate: 2 })).toBe(t);
  });

  it('survives a stored track with its limits applied', () => {
    const stored = sanitizeCutTrack({ cuts: [
      { id: id(1), from: 0, to: 2, speed: { rate: 8, to: 0.1, smooth: true } },
      { id: id(2), from: 0, to: 1, speed: { rate: 1 } },
      { id: id(3), from: 0, to: 1, speed: 'fast' },
    ] })!;
    expect(stored.cuts[0]!.speed).toEqual({ rate: 4, to: 0.25, smooth: true });
    expect(stored.cuts[1]!.speed).toBeUndefined();
    expect(stored.cuts[2]!.speed).toBeUndefined();
  });
});

describe('freeze frames (milestone 56)', () => {
  it('holds the frame under the playhead for the asked time, the shot going on from that very frame', () => {
    const t = track();
    const frozen = withFreezeAt(t, 1, 2);
    // Three cuts become five: the first split in two around the hold.
    expect(frozen.cuts).toHaveLength(5);
    expect(frozen.cuts[0]).toEqual({ id: id(1), from: 0, to: 1 });
    expect(frozen.cuts[1]).toEqual({ id: id(1), from: 1, to: 1 + MIN_CUT_SECONDS, hold: 2 });
    expect(frozen.cuts[2]).toEqual({ id: id(1), from: 1, to: 2 });
    // The hold takes its own time on the timeline and shows its one frame throughout.
    expect(cutWindows(frozen)[1]).toEqual({ start: 1, end: 3 });
    expect(trackSourceAt(frozen, 2.5)).toEqual({ id: id(1), index: 1, seconds: 1 });
    expect(cutRateAt(frozen.cuts[1]!, 1)).toBe(0);
    // Too near a boundary to split, the hold goes in at the boundary, of the frame the later shot starts on.
    const atHead = withFreezeAt(t, 2.01, 1);
    expect(atHead.cuts).toHaveLength(4);
    expect(atHead.cuts[1]).toEqual({ id: id(2), from: 1, to: 1 + MIN_CUT_SECONDS, hold: 1 });
    // Off the track there is nothing to freeze, and the same track says so.
    expect(withFreezeAt(t, 99, 1)).toBe(t);
  });

  it('has no sound, no speed to set, splits into two holds, and its length is trimmed as a hold', () => {
    const frozen = withFreezeAt(track(), 1, 2);
    expect(trackAudio(frozen).map((p) => p.span)).toEqual([{ start: 0, end: 1 }, { start: 3, end: 4 }, { start: 4, end: 5.5 }, { start: 5.5, end: 6.5 }]);
    expect(withCutSpeed(frozen, 1, { rate: 2 })).toBe(frozen);
    expect(withCutHold(frozen, 1, 0.5).cuts[1]!.hold).toBe(0.5);
    expect(withCutHold(frozen, 1, 999).cuts[1]!.hold).toBe(60);
    expect(withCutHold(frozen, 0, 1)).toBe(frozen);
    const halves = splitAt(frozen, 2);
    expect(halves.cuts[1]!.hold).toBe(1);
    expect(halves.cuts[2]!.hold).toBe(1);
    // Silence removal leaves a hold alone: it has no sound to be quiet in.
    expect(withSilencesCut(frozen, [{ start: 1.5, end: 2.5 }]).cuts[1]).toEqual(frozen.cuts[1]);
  });

  it('is read back from a stored track, within its limits and with no sound or speed', () => {
    const stored = sanitizeCutTrack({ cuts: [{ id: id(1), from: 1, to: 1.05, hold: 500, speed: { rate: 2 }, sound: { muted: true } }] })!;
    expect(stored.cuts[0]).toEqual({ id: id(1), from: 1, to: 1.05, hold: 60 });
  });
});

describe('a stored window a hair under the minimum', () => {
  it('is kept: from + MIN_CUT_SECONDS can read a billionth short once subtracted, as a freeze frame\'s window does', () => {
    const frozen = withFreezeAt({ cuts: [{ id: id(1), from: 0, to: 0.8 }] }, 0.3, 1);
    expect(frozen.cuts).toHaveLength(3);
    expect(sanitizeCutTrack(frozen)!.cuts).toHaveLength(3);
    expect(sanitizeCutTrack({ cuts: [{ id: id(1), from: 0.3, to: 0.35 }] })!.cuts).toHaveLength(1);
  });
});
