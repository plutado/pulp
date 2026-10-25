import { describe, expect, it } from 'vitest';
import { frameHash, framesToCheck, hammingDistance, HASH_TOLERANCE, looksSame } from '../src/core/visual-hash';

/** A frame of RGBA bytes, painted by a function of the pixel's place. */
function frame(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y);
      const i = (y * w + x) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
    }
  }
  return out;
}
const SIZE = 64;
const halfLit = (x: number, y: number): [number, number, number, number] => (y < SIZE / 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]);

describe('frameHash', () => {
  it('is sixteen hex characters, and the same picture always hashes the same', () => {
    const a = frameHash(frame(SIZE, SIZE, halfLit), SIZE, SIZE);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(frameHash(frame(SIZE, SIZE, halfLit), SIZE, SIZE)).toBe(a);
  });

  it('sees the same composition at another resolution', () => {
    const small = frameHash(frame(32, 32, (x, y) => (y < 16 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 32, 32);
    const large = frameHash(frame(256, 256, (x, y) => (y < 128 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 256, 256);
    expect(small).toBe(large);
  });

  it('forgives a shade of noise, which is what antialiasing is', () => {
    const clean = frameHash(frame(SIZE, SIZE, halfLit), SIZE, SIZE);
    const noisy = frameHash(frame(SIZE, SIZE, (x, y) => {
      const [r, g, b, a] = halfLit(x, y);
      const n = ((x * 7 + y * 13) % 5) - 2;
      return [Math.max(0, Math.min(255, r + n)), Math.max(0, Math.min(255, g + n)), Math.max(0, Math.min(255, b + n)), a];
    }), SIZE, SIZE);
    expect(looksSame(noisy, clean)).toBe(true);
  });

  it('catches a moved element, a changed tone and a dropped one', () => {
    const titleHigh = frameHash(frame(SIZE, SIZE, (x, y) => (y > 8 && y < 20 ? [255, 255, 255, 255] : [0, 0, 0, 255])), SIZE, SIZE);
    const titleLow = frameHash(frame(SIZE, SIZE, (x, y) => (y > 40 && y < 52 ? [255, 255, 255, 255] : [0, 0, 0, 255])), SIZE, SIZE);
    const nothing = frameHash(frame(SIZE, SIZE, () => [0, 0, 0, 255]), SIZE, SIZE);
    expect(looksSame(titleLow, titleHigh), 'the same bar, moved down the frame').toBe(false);
    expect(looksSame(nothing, titleHigh), 'the bar gone altogether').toBe(false);
  });

  it('reads transparency as dark, since what a template leaves clear is part of its look', () => {
    const opaque = frameHash(frame(SIZE, SIZE, (x, y) => (y < 32 ? [255, 255, 255, 255] : [255, 255, 255, 255])), SIZE, SIZE);
    const halfClear = frameHash(frame(SIZE, SIZE, (x, y) => [255, 255, 255, y < 32 ? 255 : 0]), SIZE, SIZE);
    expect(looksSame(halfClear, opaque)).toBe(false);
  });

  it('measures how far apart two hashes are, and refuses to compare different shapes', () => {
    expect(hammingDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('0000000000000001', '0000000000000000')).toBe(1);
    expect(hammingDistance('abc', 'abcd')).toBe(64);
    expect(HASH_TOLERANCE).toBeLessThan(64);
  });

  it('checks the start, the middle and the end of a clip, and never the same frame twice', () => {
    expect(framesToCheck(150)).toEqual([1, 74, 148]);
    // A very short clip has fewer distinct frames to offer, and says so rather than repeating one.
    expect(framesToCheck(2)).toEqual([0, 1]);
    expect(framesToCheck(1)).toEqual([0]);
  });
});
