/**
 * A graphic's length and the parts that stretch (milestone 30). The mapping
 * decides what every frame of a render draws, so the cases that matter are the
 * ends — a template that says nothing must render exactly as it always did —
 * and the join between the parts, where a jump would show as a stutter.
 */

import { describe, expect, it } from 'vitest';
import {
  entranceSeconds,
  exitSeconds,
  lengthFrameCount,
  lengthParts,
  maximumLength,
  MAX_LENGTH_SECONDS,
  minimumLength,
  readStructure,
  resolveLength,
  SCALE_LIMITS,
  STRUCTURE_LIMITS,
  templateTimeAt,
  type TemplateStructure,
} from '../src/core/timing';

/** A six-second lower third: one second in, four seconds of hold, one second out. */
const DURATION = 6;
const STRUCTURE: TemplateStructure = { kind: 'hold', holdFrom: 1, holdTo: 5 };

describe('the structure a template declares', () => {
  it('is read when it is usable, and refused with a reason when it is not', () => {
    expect(readStructure({ holdFrom: 1, holdTo: 5 }, 6)).toEqual({ structure: STRUCTURE });
    // Saying nothing is not an error: most templates will not, and they keep their fixed length.
    expect(readStructure(undefined, 6)).toEqual({ structure: null });
    expect(readStructure(null, 6)).toEqual({ structure: null });
    // A hold outside the template's own time, or back to front, is a mistake worth naming.
    expect(readStructure({ holdFrom: -1, holdTo: 5 }, 6).problem).toContain('holdFrom');
    expect(readStructure({ holdFrom: 1, holdTo: 7 }, 6).problem).toContain('holdTo');
    expect(readStructure({ holdFrom: 4, holdTo: 2 }, 6).problem).toContain('after holdFrom');
    expect(readStructure({ holdFrom: 1 }, 6).problem).toContain('holdTo');
    expect(readStructure('later', 6).problem).toContain('holdFrom and holdTo');
    // A hold too short to stretch is no hold.
    expect(readStructure({ holdFrom: 1, holdTo: 1 + STRUCTURE_LIMITS.minHold / 2 }, 6).problem).toContain('so there is a hold to stretch');
    expect(readStructure({ holdFrom: 1, holdTo: 1 + STRUCTURE_LIMITS.minHold }, 6).structure).toEqual({ kind: 'hold', holdFrom: 1, holdTo: 1.05 });
  });

  it('measures the parts that keep their speed', () => {
    expect(entranceSeconds(STRUCTURE)).toBe(1);
    expect(exitSeconds(STRUCTURE, DURATION)).toBe(1);
    // The shortest it can be asked for is its entrance and exit plus the least hold.
    expect(minimumLength(STRUCTURE, DURATION)).toBe(2 + STRUCTURE_LIMITS.minHold);
    // A template that is all entrance and exit still has a floor.
    expect(minimumLength({ kind: 'hold', holdFrom: 2.9, holdTo: 3.1 }, 6)).toBe(5.85);
  });
});

describe('the length a render runs at', () => {
  it('is the template\'s own unless something may stretch and a length was asked for', () => {
    expect(resolveLength(DURATION, STRUCTURE, undefined)).toBe(6);
    expect(resolveLength(DURATION, STRUCTURE, 20)).toBe(20);
    // A template with no structure keeps its own length whatever is asked.
    expect(resolveLength(DURATION, null, 20)).toBe(6);
    // Nonsense is no answer at all, so the template's own length stands.
    for (const asked of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveLength(DURATION, STRUCTURE, asked), String(asked)).toBe(6);
    }
    // Shorter than the parts allow is held at the floor rather than squeezing the entrance.
    expect(resolveLength(DURATION, STRUCTURE, 0.5)).toBe(minimumLength(STRUCTURE, DURATION));
  });

  it('counts frames of the length, not of the template', () => {
    expect(lengthFrameCount(6, 30)).toBe(180);
    expect(lengthFrameCount(20, 30)).toBe(600);
    expect(lengthFrameCount(0.01, 30)).toBe(1);
  });
});

describe('where a moment of the chosen length lands on the template', () => {
  const at = (time: number, length: number) => templateTimeAt(time, DURATION, STRUCTURE, length);

  it('changes nothing for a template that declares no structure', () => {
    for (const t of [0, 1, 3, 5.999, 6]) {
      expect(templateTimeAt(t, DURATION, null, 20), `${t}s`).toBe(t);
    }
    // Nor at the template's own length, which is the case every existing render is.
    for (const t of [0, 0.5, 1, 3, 5, 6]) expect(at(t, DURATION), `${t}s`).toBe(t);
  });

  it('plays the entrance and the exit at the speed they were designed at', () => {
    // Twenty seconds: the first second is still the first second of the entrance.
    expect(at(0, 20)).toBe(0);
    expect(at(0.5, 20)).toBe(0.5);
    expect(at(1, 20)).toBe(1);
    // The last second is still the exit, ending exactly where the template ends.
    expect(at(19, 20)).toBe(5);
    expect(at(19.5, 20)).toBe(5.5);
    expect(at(20, 20)).toBe(6);
    // The same holds when the graphic is shortened.
    expect(at(0.5, 3)).toBe(0.5);
    expect(at(2.5, 3)).toBe(5.5);
  });

  it('stretches only the hold, and joins the parts without a jump', () => {
    // Eighteen seconds of hold stand in for the template's four: the middle of one is the
    // middle of the other.
    expect(at(10, 20)).toBeCloseTo(3, 6);
    expect(at(1, 20)).toBe(1);
    expect(at(19, 20)).toBe(5);
    // Approaching a join from either side gives the same answer, so nothing stutters there.
    expect(at(1 - 1e-6, 20)).toBeCloseTo(at(1 + 1e-6, 20), 4);
    expect(at(19 - 1e-6, 20)).toBeCloseTo(at(19 + 1e-6, 20), 4);
    // Time runs forward throughout: every step forward in the length is a step forward here.
    let last = -1;
    for (let t = 0; t <= 20; t += 0.1) {
      const own = at(t, 20);
      expect(own, `${t}s`).toBeGreaterThanOrEqual(last);
      last = own;
    }
  });

  it('holds its ground outside the length, and when the hold is squeezed away', () => {
    expect(at(-5, 20)).toBe(0);
    expect(at(99, 20)).toBe(6);
    // A length of exactly the entrance plus the exit leaves no hold: the join is the hold's start.
    const squeezed = templateTimeAt(1, DURATION, STRUCTURE, 2);
    expect(squeezed).toBe(1);
  });

  it('works for a template that is nearly all hold, and one that is nearly none', () => {
    // A background with a one-frame entrance: almost everything stretches.
    const loop: TemplateStructure = { kind: 'hold', holdFrom: 0.1, holdTo: 5.9 };
    expect(templateTimeAt(0.05, 6, loop, 60)).toBe(0.05);
    expect(templateTimeAt(30, 6, loop, 60)).toBeCloseTo(3, 6);
    expect(templateTimeAt(60, 6, loop, 60)).toBe(6);
    // A transition that is all movement: the hold is a sliver, so a longer length mostly waits there.
    const wipe: TemplateStructure = { kind: 'hold', holdFrom: 0.45, holdTo: 0.55 };
    expect(templateTimeAt(0.2, 1, wipe, 5)).toBe(0.2);
    expect(templateTimeAt(2.5, 1, wipe, 5)).toBeCloseTo(0.5, 6);
    expect(templateTimeAt(5, 1, wipe, 5)).toBe(1);
  });
});

describe('the parts of a chosen length', () => {
  it('says where the shading goes on the scrub bar', () => {
    expect(lengthParts(DURATION, STRUCTURE, 20)).toEqual({ entrance: 1, holdFrom: 1, holdTo: 19, exit: 1, length: 20 });
    // At the template's own length the parts are where the template put them.
    expect(lengthParts(DURATION, STRUCTURE, 6)).toEqual({ entrance: 1, holdFrom: 1, holdTo: 5, exit: 1, length: 6 });
    // With no structure the whole length is one part, which is all a scrub bar can say about it.
    expect(lengthParts(DURATION, null, 6)).toEqual({ entrance: 0, holdFrom: 0, holdTo: 6, exit: 0, length: 6 });
    // Squeezed to the floor, the hold is a sliver rather than a negative.
    const tight = lengthParts(DURATION, STRUCTURE, 2);
    expect(tight.holdTo).toBeGreaterThanOrEqual(tight.holdFrom);
  });
});

describe('a graphic that repeats, and one that plays faster or slower (milestone 30)', () => {
  const LOOP: TemplateStructure = { kind: 'loop' };
  const SCALE: TemplateStructure = { kind: 'scale' };

  it('is read from the manifest, and cannot be two things at once', () => {
    expect(readStructure({ loop: true }, 6)).toEqual({ structure: LOOP });
    expect(readStructure({ scale: true }, 1.4)).toEqual({ structure: SCALE });
    expect(readStructure({ loop: true, scale: true }, 6).problem).toContain('only be one');
    expect(readStructure({ loop: true, holdFrom: 1, holdTo: 5 }, 6).problem).toContain('only be one of the three');
    expect(readStructure({ loop: 'yes' }, 6).problem).toContain('loop must be true');
    expect(readStructure({ scale: 1 }, 6).problem).toContain('scale must be true');
  });

  it('repeats a loop to any length, ending where the template ends', () => {
    // Six seconds of graphic over twenty: three full passes and a bit of a fourth.
    expect(templateTimeAt(0, 6, LOOP, 20)).toBe(0);
    expect(templateTimeAt(3, 6, LOOP, 20)).toBe(3);
    expect(templateTimeAt(6, 6, LOOP, 20)).toBe(0);
    expect(templateTimeAt(7.5, 6, LOOP, 20)).toBe(1.5);
    expect(templateTimeAt(19, 6, LOOP, 20)).toBe(1);
    // The very last moment is the template's own last moment, not the start of another pass.
    expect(templateTimeAt(20, 6, LOOP, 20)).toBe(6);
    // A loop has no entrance to protect, so it may be asked for less than it was designed at.
    expect(resolveLength(6, LOOP, 2)).toBe(2);
    expect(templateTimeAt(1.5, 6, LOOP, 2)).toBe(1.5);
    // Shading says it is all hold: every moment of it may be repeated.
    expect(lengthParts(6, LOOP, 20)).toEqual({ entrance: 0, holdFrom: 0, holdTo: 20, exit: 0, length: 20 });
  });

  it('scales a transition rather than stretching part of it', () => {
    // A 1.4 s wipe asked to take 2.8 s plays every moment at half speed.
    expect(templateTimeAt(0, 1.4, SCALE, 2.8)).toBe(0);
    expect(templateTimeAt(1.4, 1.4, SCALE, 2.8)).toBeCloseTo(0.7, 6);
    expect(templateTimeAt(2.8, 1.4, SCALE, 2.8)).toBeCloseTo(1.4, 6);
    // And asked to take half as long, twice as fast.
    expect(templateTimeAt(0.35, 1.4, SCALE, 0.7)).toBeCloseTo(0.7, 6);
    // How far it may be pushed is bounded both ways, so it never becomes a still or a flicker.
    expect(resolveLength(1.4, SCALE, 99)).toBe(1.4 * SCALE_LIMITS.max);
    expect(resolveLength(1.4, SCALE, 0.01)).toBeCloseTo(1.4 / SCALE_LIMITS.max, 6);
    expect(maximumLength(SCALE, 1.4)).toBe(5.6);
    expect(maximumLength(LOOP, 6)).toBe(MAX_LENGTH_SECONDS);
    // There is no part of it that behaves differently, so the bar shades nothing.
    expect(lengthParts(1.4, SCALE, 2.8)).toEqual({ entrance: 0, holdFrom: 0, holdTo: 0, exit: 0, length: 2.8 });
  });
});
