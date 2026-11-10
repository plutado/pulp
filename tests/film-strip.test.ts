/**
 * A film strip on the timeline (milestone 87): how a clip is sampled, how its
 * tiles are laid out and found, and which frame goes in each slot along a
 * shot — through a trim, a speed, a ramp and a freeze frame, as the shot
 * plays them. The pictures themselves are read back off the track in
 * tests/e2e/ui.e2e.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  cutFilmSlots, DEFAULT_FILM_STRIP, FILM_COLUMNS, FILM_MAX_FRAMES, FILM_MIN_FRAMES, FILM_TILE_HEIGHT, filmFrameAt, filmFramesArgs, filmLayout,
  filmSlots, filmStripPlan, filmTileArgs, filmTileRect, sanitizeFilmStripMode,
} from '../src/core/film-strip';
import { cutSeconds, cutSourceTime } from '../src/core/cut-track';
import { sanitizePlayer } from '../src/core/player';

describe('sampling a clip', () => {
  it('takes four frames a second, never fewer than the fewest nor more than the most, nor faster than the clip', () => {
    expect(filmStripPlan(30, 1920, 1080).count).toBe(120);
    expect(filmStripPlan(2, 1920, 1080).count).toBe(FILM_MIN_FRAMES);
    expect(filmStripPlan(600, 1920, 1080).count).toBe(FILM_MAX_FRAMES);
    // A two-second clip at ten a second has twenty frames: a strip of thirty-two would repeat them.
    expect(filmStripPlan(2, 1920, 1080, 10).count).toBe(20);
    const plan = filmStripPlan(30, 1920, 1080);
    expect(plan.rate).toBeCloseTo(4, 6);
    expect(plan.count / plan.rate).toBeCloseTo(30, 6);
  });

  it('keeps the clip\'s shape at the strip\'s height, in even pixels', () => {
    expect(filmStripPlan(10, 1920, 1080)).toMatchObject({ tileWidth: 72, tileHeight: FILM_TILE_HEIGHT });
    expect(filmStripPlan(10, 1080, 1920).tileWidth).toBe(22);
    expect(filmStripPlan(10, 0, 0).tileWidth % 2).toBe(0);
  });

  it('decodes raw tiles, whose count is exact from the bytes, then tiles them in rows of sixteen', () => {
    const plan = filmStripPlan(30, 1920, 1080);
    const args = filmFramesArgs('/lib/a.mov', plan);
    expect(args.join(' ')).toContain('fps=4,scale=72:40');
    expect(args.slice(-5)).toEqual(['-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    expect(filmFramesArgs('/lib/a.webm', plan, 'libvpx-vp9')).toContain('libvpx-vp9');
    expect(filmLayout(120)).toEqual({ columns: FILM_COLUMNS, rows: 8 });
    expect(filmLayout(5)).toEqual({ columns: 5, rows: 1 });
    expect(filmTileArgs(72, 40, 120).join(' ')).toContain('-video_size 72x40');
    expect(filmTileArgs(72, 40, 120).join(' ')).toContain('tile=16x8');
  });
});

describe('finding a frame in the strip', () => {
  const strip = { rate: 4, count: 120, tileWidth: 72, tileHeight: 40, columns: 16 };

  it('takes the frame nearest a second of the file, held to the strip', () => {
    expect(filmFrameAt(strip, 0)).toBe(0);
    expect(filmFrameAt(strip, 2.1)).toBe(8);
    expect(filmFrameAt(strip, 2.2)).toBe(9);
    expect(filmFrameAt(strip, -3)).toBe(0);
    expect(filmFrameAt(strip, 900)).toBe(119);
  });

  it('finds its tile row by row', () => {
    expect(filmTileRect(strip, 0)).toEqual({ x: 0, y: 0, width: 72, height: 40 });
    expect(filmTileRect(strip, 17)).toEqual({ x: 72, y: 40, width: 72, height: 40 });
  });
});

describe('the pictures along a shot', () => {
  const plain = { from: 0, to: 10 };

  it('shows nothing when off, one picture at the in point for the first frame, and a picture per slot for a strip', () => {
    expect(cutFilmSlots(plain, 400, 40, 'off')).toEqual([]);
    expect(cutFilmSlots({ from: 3, to: 10 }, 400, 40, 'first')).toEqual([{ x: 0, seconds: 3 }]);
    const strip = cutFilmSlots(plain, 400, 40, 'continuous');
    expect(strip).toHaveLength(10);
    expect(strip.map((s) => s.seconds)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // One more, cut short at the end, when the slots do not divide the shot.
    expect(cutFilmSlots(plain, 410, 40, 'continuous')).toHaveLength(11);
  });

  it('follows a trim: the first picture is the in point, and the rest are the file\'s seconds from there', () => {
    expect(cutFilmSlots({ from: 4, to: 8 }, 160, 40, 'continuous').map((s) => s.seconds)).toEqual([4, 5, 6, 7]);
  });

  it('follows a speed: at twice the rate the same width covers twice the file', () => {
    const fast = { from: 0, to: 8, speed: { rate: 2 } };
    expect(cutSeconds(fast)).toBe(4);
    expect(cutFilmSlots(fast, 160, 40, 'continuous').map((s) => s.seconds)).toEqual([0, 2, 4, 6]);
  });

  it('follows a ramp by the same arithmetic the shot plays by', () => {
    const ramp = { from: 0, to: 6, speed: { rate: 1, to: 3 } };
    const slots = cutFilmSlots(ramp, 300, 30, 'continuous');
    slots.forEach((slot, k) => expect(slot.seconds).toBeCloseTo(cutSourceTime(ramp, (k * 30 / 300) * cutSeconds(ramp)), 9));
    // The pictures come faster as the ramp rises: the file seconds between slots grow.
    expect(slots[9]!.seconds - slots[8]!.seconds).toBeGreaterThan(slots[1]!.seconds - slots[0]!.seconds);
  });

  it('repeats its one frame for a freeze', () => {
    const freeze = { from: 2.5, to: 2.54, hold: 3 };
    expect(new Set(cutFilmSlots(freeze, 300, 30, 'continuous').map((s) => s.seconds))).toEqual(new Set([2.5]));
  });

  it('repeats frames as a shot widens past the strip\'s own frames, and thins them out as it narrows', () => {
    const strip = { rate: 4, count: 40, tileWidth: 72, tileHeight: 40, columns: 16 };
    const frames = (width: number) => cutFilmSlots(plain, width, 40, 'continuous').map((s) => filmFrameAt(strip, s.seconds));
    const wide = frames(4000);
    expect(wide.length).toBe(100);
    expect(new Set(wide).size).toBeLessThan(wide.length);
    const narrow = frames(160);
    expect(narrow).toEqual([0, 10, 20, 30]);
  });

  it('leaves out a slot over nothing', () => {
    expect(filmSlots(100, 25, 'continuous', (f) => (f < 0.5 ? f * 10 : null)).map((s) => s.x)).toEqual([0, 25]);
  });
});

describe('the choice', () => {
  it('is one of three, continuous to start with, and kept with the player\'s settings', () => {
    expect(DEFAULT_FILM_STRIP).toBe('continuous');
    expect(sanitizeFilmStripMode('first')).toBe('first');
    expect(sanitizeFilmStripMode('sideways')).toBe('continuous');
    expect(sanitizePlayer({ filmStrip: 'off' }).filmStrip).toBe('off');
    expect(sanitizePlayer({}).filmStrip).toBe('continuous');
  });
});
