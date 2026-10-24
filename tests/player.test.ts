import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER, markPercent, playheadAt, SAFE_AREAS, sanitizePlayer, steppedFrame, trimmedAway, VERTICAL_ZONES, verticalZonesFor } from '../src/core/player';

describe('playback', () => {
  // 180 frames at 30 fps: a six-second template.
  const head = (elapsedMs: number, loop: boolean, from = 0) => playheadAt(from, elapsedMs, 30, 180, loop);

  it('advances at the output rate from where play started', () => {
    expect(head(0, true)).toBe(0);
    expect(head(1000, true)).toBe(30);
    expect(head(1016, true)).toBe(30); // part of a frame is not a frame
    expect(head(1000, true, 60)).toBe(90);
  });

  it('wraps when looping and runs out when not', () => {
    expect(head(6000, true)).toBe(0);
    expect(head(7000, true)).toBe(30);
    // Null is "the end": the stage stops on the last frame instead of starting over.
    expect(head(6000, false)).toBeNull();
    expect(head(5999, false)).toBe(179);
    expect(playheadAt(0, 100, 30, 0, true)).toBeNull();
  });
});

describe('frame step', () => {
  it('moves one frame and wraps at the ends while looping', () => {
    expect(steppedFrame(10, 1, 180, true)).toBe(11);
    expect(steppedFrame(10, -1, 180, true)).toBe(9);
    expect(steppedFrame(179, 1, 180, true)).toBe(0);
    expect(steppedFrame(0, -1, 180, true)).toBe(179);
  });

  it('sticks at the ends when looping is off', () => {
    expect(steppedFrame(179, 1, 180, false)).toBe(179);
    expect(steppedFrame(0, -1, 180, false)).toBe(0);
    expect(steppedFrame(0, -1, 0, false)).toBe(0);
  });
});

describe('marks on the scrub bar', () => {
  it('places a frame along the bar, both ends included', () => {
    expect(markPercent(0, 180)).toBe(0);
    expect(markPercent(179, 180)).toBe(100);
    expect(markPercent(89, 180)).toBeCloseTo(49.72, 2);
    // A one-frame template has no travel to place anything along.
    expect(markPercent(0, 1)).toBe(0);
    expect(markPercent(500, 180)).toBe(100);
  });

  it('dims what a render would drop, and nothing for an open end', () => {
    expect(trimmedAway(null, null, 180)).toEqual({ before: 0, after: 0 });
    expect(trimmedAway(0, 179, 180)).toEqual({ before: 0, after: 0 });
    const away = trimmedAway(45, 134, 180);
    expect(away.before).toBeCloseTo(25.14, 2);
    expect(away.after).toBeCloseTo(25.14, 2);
    expect(trimmedAway(45, null, 180).after).toBe(0);
  });
});

describe('preferences', () => {
  it('fall back to the defaults when the file is missing or damaged', () => {
    expect(sanitizePlayer(undefined)).toEqual(DEFAULT_PLAYER);
    expect(sanitizePlayer({ background: 'plaid', customBackground: 'red', volume: 'loud' })).toEqual(DEFAULT_PLAYER);
    // Looping is on unless it was turned off; safe areas are off unless turned on.
    expect(sanitizePlayer({}).loop).toBe(true);
    expect(sanitizePlayer({ loop: false }).loop).toBe(false);
    expect(sanitizePlayer({}).safeAreas).toBe(false);
  });

  it('keeps what it can read, clamped', () => {
    expect(sanitizePlayer({ background: 'custom', customBackground: '#AABBCC', volume: 0.4, muted: true, safeAreas: true })).toEqual({
      loop: true,
      background: 'custom',
      customBackground: '#aabbcc',
      safeAreas: true,
      volume: 0.4,
      muted: true,
      audition: false,
    });
    expect(sanitizePlayer({ volume: 4 }).volume).toBe(1);
    expect(sanitizePlayer({ volume: -1 }).volume).toBe(0);
  });
});

describe('safe areas', () => {
  it('are the broadcast insets, as fractions of the frame', () => {
    expect(SAFE_AREAS.map((a) => [a.id, a.inset])).toEqual([
      ['action', 0.035],
      ['title', 0.05],
    ]);
  });

  it('add the zones a tall frame keeps clear, for portrait shapes only', () => {
    expect(VERTICAL_ZONES.map((z) => z.id)).toEqual(['header', 'controls', 'caption']);
    for (const z of VERTICAL_ZONES) {
      // Inside the frame, and named for what sits there rather than for any one app.
      expect(z.left + z.width, z.id).toBeLessThanOrEqual(1);
      expect(z.top + z.height, z.id).toBeLessThanOrEqual(1);
      expect(z.label).not.toMatch(/tiktok|instagram|youtube|reels|shorts/i);
    }
    const [header, controls, caption] = VERTICAL_ZONES;
    expect(header.top + header.height).toBeLessThan(controls.top); // the strip ends before the column starts
    expect(caption.left + caption.width).toBeLessThanOrEqual(controls.left); // the band stops short of the column
    expect(verticalZonesFor(1080, 1920)).toBe(VERTICAL_ZONES);
    expect(verticalZonesFor(1080, 1350)).toBe(VERTICAL_ZONES);
    expect(verticalZonesFor(1920, 1080)).toEqual([]);
    expect(verticalZonesFor(1080, 1080)).toEqual([]);
  });
});
