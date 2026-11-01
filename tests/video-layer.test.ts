/**
 * Video layers (milestone 26): which frame of a clip belongs to a moment of
 * the graphic. The preview and the render both ask this, so a mistake here
 * shows as a clip that scrubs differently from the file that is written —
 * the kind of thing only a test catches.
 */

import { describe, expect, it } from 'vitest';
import {
  clipAudible,
  clipFrameAt,
  clipMediaTimeAt,
  clipFramePlan,
  clipPassSeconds,
  clipValueFromText,
  clipValueToText,
  clipProxySize,
  clipWindow,
  CLIP_LIMITS,
  CLIP_PROXY_SIZES,
  EMPTY_CLIP,
  sanitizeClipValue,
  type ClipSource,
  type ClipValue,
} from '../src/core/video-layer';

/** A two-second clip at 30 fps: 60 frames, 0 to 59. */
const SOURCE: ClipSource = { frames: 60, fps: 30 };
const clip = (over: Partial<ClipValue> = {}): ClipValue => ({ ...EMPTY_CLIP, id: 'abc', ...over });

describe('the window of a clip a layer plays', () => {
  it('takes the whole clip unless it is told otherwise', () => {
    expect(clipWindow(clip(), SOURCE)).toEqual({ first: 0, last: 59, frames: 60 });
    expect(clipWindow(clip({ inPoint: 10, outPoint: 19 }), SOURCE)).toEqual({ first: 10, last: 19, frames: 10 });
  });

  it('clamps to the clip, and never collapses to nothing', () => {
    // An out point past the end, or the -1 that means "to the end", is the last frame.
    expect(clipWindow(clip({ outPoint: 999 }), SOURCE).last).toBe(59);
    expect(clipWindow(clip({ outPoint: -1 }), SOURCE).last).toBe(59);
    // In after out is a mis-set pair; one frame is better than a layer that silently vanishes.
    expect(clipWindow(clip({ inPoint: 40, outPoint: 20 }), SOURCE)).toEqual({ first: 20, last: 20, frames: 1 });
    expect(clipWindow(clip({ inPoint: 500 }), SOURCE)).toEqual({ first: 59, last: 59, frames: 1 });
    // A clip with no frames yet (not probed) has no window, and nothing is drawn.
    expect(clipWindow(clip(), { frames: 0, fps: 30 }).frames).toBe(0);
    expect(clipFrameAt(0, clip(), { frames: 0, fps: 30 })).toBeNull();
  });
});

describe('which frame belongs to a moment', () => {
  it('walks the clip forward at its own rate', () => {
    expect(clipFrameAt(0, clip(), SOURCE)).toBe(0);
    expect(clipFrameAt(0.5, clip(), SOURCE)).toBe(15);
    expect(clipFrameAt(1.9999, clip(), SOURCE)).toBe(59);
    // The render's rate is not the clip's: at 60 fps the same clip still plays in two seconds.
    expect(clipFramePlan(clip(), SOURCE, 120, 60).filter((f) => f !== null)).toHaveLength(120);
    expect(clipFramePlan(clip(), SOURCE, 120, 60)[119]).toBe(59);
  });

  it('starts from the in point and stops at the out point', () => {
    const window = clip({ inPoint: 30, outPoint: 44, ending: 'once' });
    expect(clipFrameAt(0, window, SOURCE)).toBe(30);
    expect(clipFrameAt(0.4, window, SOURCE)).toBe(42);
    // Fifteen frames at 30 fps is half a second, and then it is over.
    expect(clipFrameAt(0.49, window, SOURCE)).toBe(44);
    expect(clipFrameAt(0.5, window, SOURCE)).toBeNull();
  });

  it('loops its window, or plays once and clears', () => {
    const looping = clip({ inPoint: 10, outPoint: 19 });
    // Ten frames, a third of a second, over and over.
    expect(clipFrameAt(0, looping, SOURCE)).toBe(10);
    expect(clipFrameAt(1 / 3, looping, SOURCE)).toBe(10);
    expect(clipFrameAt(2 / 3 + 1 / 30, looping, SOURCE)).toBe(11);
    expect(clipFrameAt(60, looping, SOURCE)).not.toBeNull();
    // An effect that has played is gone, rather than frozen on its last frame.
    const once = clip({ ending: 'once' });
    expect(clipFrameAt(1.99, once, SOURCE)).toBe(59);
    expect(clipFrameAt(2, once, SOURCE)).toBeNull();
    expect(clipFrameAt(200, once, SOURCE)).toBeNull();
  });

  it('waits out a start delay, then plays from its first frame', () => {
    const delayed = clip({ delay: 1, ending: 'once' });
    expect(clipFrameAt(0, delayed, SOURCE)).toBeNull();
    expect(clipFrameAt(0.999, delayed, SOURCE)).toBeNull();
    expect(clipFrameAt(1, delayed, SOURCE)).toBe(0);
    expect(clipFrameAt(1.5, delayed, SOURCE)).toBe(15);
    expect(clipFrameAt(3, delayed, SOURCE)).toBeNull();
  });

  it('runs at the chosen speed', () => {
    expect(clipFrameAt(0.5, clip({ speed: 2 }), SOURCE)).toBe(30);
    expect(clipFrameAt(1, clip({ speed: 0.5, ending: 'once' }), SOURCE)).toBe(15);
    // Half speed takes twice as long to finish.
    expect(clipPassSeconds(clip({ speed: 0.5 }), SOURCE)).toBe(4);
    expect(clipPassSeconds(clip({ speed: 2 }), SOURCE)).toBe(1);
    // Out-of-range or nonsense speeds fall back rather than dividing by zero or running backwards.
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clipFrameAt(0.5, clip({ speed }), SOURCE), String(speed)).toBe(15);
    }
    expect(clipFrameAt(0.5, clip({ speed: 1000 }), SOURCE)).toBe(clipFrameAt(0.5, clip({ speed: CLIP_LIMITS.speed.max }), SOURCE));
  });

  it('draws nothing for a layer with no clip, or a hidden one', () => {
    expect(clipFrameAt(0, { ...EMPTY_CLIP }, SOURCE)).toBeNull();
    expect(clipFrameAt(0, clip({ hidden: true }), SOURCE)).toBeNull();
    expect(clipFrameAt(Number.NaN, clip(), SOURCE)).toBeNull();
  });

  it('plans a whole render in one go, marking the frames the layer is absent for', () => {
    // A one-second render at 30 fps of a clip delayed half a second and played once.
    const plan = clipFramePlan(clip({ delay: 0.5, ending: 'once' }), SOURCE, 30, 30);
    expect(plan).toHaveLength(30);
    expect(plan.slice(0, 15).every((f) => f === null), 'absent until the delay is up').toBe(true);
    expect(plan[15]).toBe(0);
    expect(plan[29]).toBe(14);
    expect(clipFramePlan(clip(), SOURCE, 0, 30)).toEqual([]);
  });
});

describe('reading and writing a clip value', () => {
  it('takes a bare id, a hidden marker, or nothing', () => {
    expect(sanitizeClipValue('abc123')).toEqual({ ...EMPTY_CLIP, id: 'abc123' });
    expect(sanitizeClipValue('  abc123  ')).toEqual({ ...EMPTY_CLIP, id: 'abc123' });
    expect(sanitizeClipValue('hidden')).toEqual({ ...EMPTY_CLIP, hidden: true });
    expect(sanitizeClipValue('')).toBeNull();
    expect(sanitizeClipValue(null)).toBeNull();
    expect(sanitizeClipValue(42)).toBeUndefined();
    expect(sanitizeClipValue({ id: '' })).toBeNull();
  });

  it('clamps every setting it is given', () => {
    const value = sanitizeClipValue({ id: 'x', inPoint: -5, outPoint: 12.7, ending: 'nonsense', speed: 99, delay: -3 });
    expect(value).toEqual({ id: 'x', inPoint: 0, outPoint: 12, ending: 'loop', speed: CLIP_LIMITS.speed.max, delay: 0, hidden: false, volume: 1, muted: false });
    expect(sanitizeClipValue({ id: 'x', delay: 1.23456 })?.delay).toBe(1.235);
    expect(sanitizeClipValue({ id: 'x', ending: 'once' })?.ending).toBe('once');
    expect(sanitizeClipValue({ id: 'x', speed: 0.01 })?.speed).toBe(CLIP_LIMITS.speed.min);
  });

  it('writes a short form and reads it back unchanged', () => {
    const cases: ClipValue[] = [
      clip(),
      clip({ inPoint: 10, outPoint: 40 }),
      clip({ ending: 'once', speed: 2, delay: 1.5 }),
      clip({ inPoint: 3, outPoint: 9, ending: 'once', speed: 0.5, delay: 0.25 }),
      clip({ volume: 0.4 }),
      clip({ muted: true, volume: 0.75 }),
      { ...EMPTY_CLIP, hidden: true },
    ];
    for (const value of cases) {
      expect(clipValueFromText(clipValueToText(value)), clipValueToText(value)).toEqual(value);
    }
    // Defaults are left out, so the common case stays readable in a CSV cell.
    expect(clipValueToText(clip())).toBe('abc');
    expect(clipValueToText(clip({ ending: 'once', delay: 2 }))).toBe('abc ending=once delay=2');
    expect(clipValueToText(null)).toBe('');
    expect(clipValueFromText('')).toBeNull();
    // Junk between the fields is ignored rather than failing the row.
    expect(clipValueFromText('abc ending=once what speed=')).toMatchObject({ id: 'abc', ending: 'once', speed: 1 });
  });

  it('keeps the layer\'s sound settings in range (milestone 48)', () => {
    // Volume is 0 to 1, a hundredth at a time; mute is a flag beside it, so unmuting restores the level.
    expect(sanitizeClipValue({ id: 'x' })).toMatchObject({ volume: 1, muted: false });
    expect(sanitizeClipValue({ id: 'x', volume: 0.5, muted: true })).toMatchObject({ volume: 0.5, muted: true });
    expect(sanitizeClipValue({ id: 'x', volume: 7 })?.volume).toBe(1);
    expect(sanitizeClipValue({ id: 'x', volume: -2 })?.volume).toBe(0);
    expect(sanitizeClipValue({ id: 'x', volume: 0.333333 })?.volume).toBe(0.33);
    expect(sanitizeClipValue({ id: 'x', volume: 'loud', muted: 'yes' })).toMatchObject({ volume: 1, muted: false });
  });

  it('keeps a voice treatment on the clip\'s own track (milestone 53)', () => {
    expect(sanitizeClipValue({ id: 'x', voice: { treatment: 'podcast', amount: 0.7 } })?.voice).toEqual({ treatment: 'podcast', amount: 0.7 });
    expect(sanitizeClipValue({ id: 'x', voice: 'reverb' })?.voice).toBeUndefined();
    expect(sanitizeClipValue({ id: 'x' })?.voice).toBeUndefined();
    const treated = clip({ voice: { treatment: 'podcast', amount: 0.7 } });
    expect(clipValueToText(treated)).toBe('abc voice=podcast:0.7');
    expect(clipValueFromText(clipValueToText(treated))).toEqual(treated);
  });

  it('says whether a layer asks for its sound at all (milestone 48)', () => {
    expect(clipAudible(clip())).toBe(true);
    expect(clipAudible(null)).toBe(false);
    expect(clipAudible({ ...EMPTY_CLIP })).toBe(false); // no clip chosen
    expect(clipAudible(clip({ hidden: true }))).toBe(false);
    expect(clipAudible(clip({ muted: true }))).toBe(false);
    expect(clipAudible(clip({ volume: 0 }))).toBe(false);
  });
});

describe('where a moment lands in the clip\'s own sound (milestone 48)', () => {
  // A 30-frame clip at 30 fps: one second of material.
  const source: ClipSource = { frames: 30, fps: 30 };

  it('follows the picture: the same arithmetic as clipFrameAt, kept continuous', () => {
    expect(clipMediaTimeAt(0, clip(), source)).toBe(0);
    expect(clipMediaTimeAt(0.5, clip(), source)).toBeCloseTo(0.5, 9);
    // The in point offsets into the file, so the sound starts where the picture does.
    expect(clipMediaTimeAt(0, clip({ inPoint: 15 }), source)).toBeCloseTo(0.5, 9);
    // Speed scales how fast the file is traversed.
    expect(clipMediaTimeAt(0.25, clip({ speed: 2 }), source)).toBeCloseTo(0.5, 9);
  });

  it('is silent before the delay, loops with the window, and ends with a once clip', () => {
    expect(clipMediaTimeAt(0.5, clip({ delay: 1 }), source)).toBeNull();
    expect(clipMediaTimeAt(1.25, clip({ delay: 1 }), source)).toBeCloseTo(0.25, 9);
    // A loop comes round: 1.25 s into a one-second window is 0.25 s again.
    expect(clipMediaTimeAt(1.25, clip(), source)).toBeCloseTo(0.25, 9);
    // Played once, it is silent after its pass — the picture clears there too.
    expect(clipMediaTimeAt(1.25, clip({ ending: 'once' }), source)).toBeNull();
    // Hidden draws nothing and says nothing.
    expect(clipMediaTimeAt(0.5, clip({ hidden: true }), source)).toBeNull();
  });

  it('respects the window: a trimmed clip\'s sound stays inside its in and out points', () => {
    const windowed = clip({ inPoint: 10, outPoint: 19 }); // a third of a second of material
    expect(clipMediaTimeAt(0, windowed, source)).toBeCloseTo(10 / 30, 9);
    // Past one pass it loops back to the window's start, never before frame 10.
    const at = clipMediaTimeAt(0.4, windowed, source)!;
    expect(at).toBeGreaterThanOrEqual(10 / 30);
    expect(at).toBeLessThan(20 / 30);
  });
});

describe('proxy sizes (milestone 26)', () => {
  it('takes the smallest step that covers what is drawn, so a 4K clip scrubs small', () => {
    expect(clipProxySize(1)).toBe(240);
    expect(clipProxySize(240)).toBe(240);
    expect(clipProxySize(241)).toBe(480);
    expect(clipProxySize(1080)).toBe(1080);
    // Beyond the largest step it stops there: one careless layer cannot ask for a 8K decode.
    expect(clipProxySize(99_999)).toBe(CLIP_PROXY_SIZES[CLIP_PROXY_SIZES.length - 1]);
    // Steady across a nudge, which is the point: no re-decode for a window a few pixels wider.
    expect(clipProxySize(300)).toBe(clipProxySize(320));
  });
});
