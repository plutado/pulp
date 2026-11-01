/**
 * Keyframes (milestone 51): where a layer stands at a moment, from its keys.
 * The preview and the render both draw through the bridge's mirror of this
 * arithmetic, so a mistake here shows as a layer that lands somewhere else in
 * the file than it stood on the stage — the kind of thing only a test catches.
 */

import { describe, expect, it } from 'vitest';
import {
  cubicBezier, DEFAULT_KEY_EASING, easeKey, IDENTITY_KEY, KEY_LIMITS, keyedPoseAt, keyMovedTo, sanitizeKeys, withKeyAt,
  type LayerKey,
} from '../src/core/layer-keys';

const key = (at: number, over: Partial<LayerKey> = {}): LayerKey => ({ at, ...IDENTITY_KEY, easing: 'linear', ...over });

describe('the pose at a moment', () => {
  it('holds the first key before it, the last after it, and travels between', () => {
    const keys = [key(1, { dx: -0.2 }), key(3, { dx: 0.2, scale: 2, rotate: 90, opacity: 0.5 })];
    expect(keyedPoseAt(keys, 0)).toMatchObject({ dx: -0.2, scale: 1, rotate: 0, opacity: 1 });
    expect(keyedPoseAt(keys, 5)).toMatchObject({ dx: 0.2, scale: 2, rotate: 90, opacity: 0.5 });
    const mid = keyedPoseAt(keys, 2)!;
    expect(mid.dx).toBeCloseTo(0, 9);
    expect(mid.scale).toBeCloseTo(1.5, 9);
    expect(mid.rotate).toBeCloseTo(45, 9);
    expect(mid.opacity).toBeCloseTo(0.75, 9);
    expect(keyedPoseAt([], 1)).toBeNull();
  });

  it('eases by the earlier key, and a hold stays put until the next', () => {
    const eased = [key(0, { dx: 0, easing: 'ease-in' }), key(2, { dx: 1 })];
    const atQuarter = keyedPoseAt(eased, 0.5)!.dx;
    expect(atQuarter, 'an ease in starts slow').toBeLessThan(0.25);
    const held = [key(0, { dx: 0, easing: 'hold' }), key(2, { dx: 1 })];
    expect(keyedPoseAt(held, 1.9)!.dx).toBe(0);
    expect(keyedPoseAt(held, 2)!.dx).toBe(1);
  });

  it('takes a curve of the key\'s own', () => {
    const linearish = [key(0, { dx: 0, easing: 'curve', curve: [0, 0, 1, 1] }), key(2, { dx: 1 })];
    expect(keyedPoseAt(linearish, 1)!.dx).toBeCloseTo(0.5, 3);
    const snappy = [key(0, { dx: 0, easing: 'curve', curve: [0, 1, 0, 1] }), key(2, { dx: 1 })];
    expect(keyedPoseAt(snappy, 0.5)!.dx, 'a fast-out curve is well ahead of linear').toBeGreaterThan(0.6);
  });
});

describe('the easings themselves', () => {
  it('pin both ends and order the middles the way their names say', () => {
    for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      expect(easeKey(easing, undefined, 0), easing).toBeCloseTo(0, 6);
      expect(easeKey(easing, undefined, 1), easing).toBeCloseTo(1, 6);
    }
    expect(easeKey('ease-in', undefined, 0.5)).toBeLessThan(0.5);
    expect(easeKey('ease-out', undefined, 0.5)).toBeGreaterThan(0.5);
    expect(easeKey('ease-in-out', undefined, 0.5)).toBeCloseTo(0.5, 2);
    expect(easeKey('hold', undefined, 0.99)).toBe(0);
    // The bezier solves x for t and answers with y: CSS's own curve arithmetic.
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 3);
    expect(cubicBezier(0.42, 0, 1, 1, 0.25)).toBeLessThan(0.15);
  });
});

describe('writing and reading keys', () => {
  it('writes a key at its time, replacing one within half a frame, in order', () => {
    const keys = withKeyAt([key(2)], key(0, { dx: 0.1 }));
    expect(keys.map((k) => k.at)).toEqual([0, 2]);
    const replaced = withKeyAt(keys, key(0.004, { dx: 0.5 }));
    expect(replaced).toHaveLength(2);
    expect(replaced[0]!.dx).toBe(0.5);
  });

  it('moves a key in time with its pose and easing, back into order (milestone 51)', () => {
    const keys = [key(0, { dx: 0.1, easing: 'hold' }), key(2, { dx: 0.2 })];
    const moved = keyMovedTo(keys, 0, 3);
    expect(moved.map((k) => k.at)).toEqual([2, 3]);
    expect(moved[1]).toMatchObject({ dx: 0.1, easing: 'hold' });
  });

  it('replaces a key a move lands on, as writing one there would, and never goes below zero', () => {
    const keys = [key(0, { dx: 0.1 }), key(2, { dx: 0.2 })];
    const landed = keyMovedTo(keys, 0, 2.004);
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ at: 2.004, dx: 0.1 });
    expect(keyMovedTo(keys, 0, -5)[0]!.at).toBe(0);
    expect(keyMovedTo(keys, 7, 1), 'a missing index moves nothing').toEqual(keys);
  });

  it('keeps every field in range, sorted and counted', () => {
    const read = sanitizeKeys([
      { at: 2, dx: 5, dy: -5, scale: 99, rotate: 999999, opacity: 7 },
      { at: 0, easing: 'ease-out' },
      { at: 2.0000001, dx: 0 },
      { at: -1 },
      'not a key',
    ]);
    expect(read!.map((k) => k.at)).toEqual([0, 2]);
    expect(read![0]).toMatchObject({ easing: 'ease-out', dx: 0, scale: 1, opacity: 1 });
    expect(read![1]).toMatchObject({ dx: 1, dy: -1, scale: KEY_LIMITS.scale.max, rotate: 3600, opacity: 1, easing: DEFAULT_KEY_EASING });
    expect(sanitizeKeys('nope')).toBeUndefined();
    expect(sanitizeKeys([])).toEqual([]);
    // A curve is kept only on a key that travels by one, its points held to the solvable range.
    const curved = sanitizeKeys([{ at: 0, easing: 'curve', curve: [9, 9, -1, 'x'] }])!;
    expect(curved[0]!.curve).toEqual([1, 3, 0, 1]);
    expect(sanitizeKeys([{ at: 0, easing: 'linear', curve: [0, 0, 1, 1] }])![0]!.curve).toBeUndefined();
  });
});
