/**
 * Laying one captured frame over another (milestone 50): the arithmetic the
 * burned-in captions rest on, in both layouts the capture probe can measure.
 */

import { describe, expect, it } from 'vitest';
import { compositeOver } from '../src/core/composite';

const px = (...pixels: number[][]) => new Uint8Array(pixels.flat());

describe('over, premultiplied', () => {
  const format = { premultiplied: true };

  it('leaves the picture alone under a clear pixel and replaces it under an opaque one', () => {
    const under = px([10, 20, 30, 255], [10, 20, 30, 255]);
    compositeOver(under, px([0, 0, 0, 0], [200, 100, 50, 255]), format);
    expect([...under]).toEqual([10, 20, 30, 255, 200, 100, 50, 255]);
  });

  it('adds the premultiplied colour to what the alpha leaves of the picture', () => {
    // Half-covered red (premultiplied: 128,0,0,128) over opaque blue: half red, half blue, opaque.
    const under = px([0, 0, 255, 255]);
    compositeOver(under, px([128, 0, 0, 128]), format);
    expect(under[0]).toBe(128);
    expect(under[2]).toBeGreaterThanOrEqual(126);
    expect(under[2]).toBeLessThanOrEqual(128);
    expect(under[3]).toBe(255);
  });

  it('over a clear picture is the pixel itself', () => {
    const under = px([0, 0, 0, 0]);
    compositeOver(under, px([64, 32, 16, 64]), format);
    expect([...under]).toEqual([64, 32, 16, 64]);
  });
});

describe('over, straight alpha', () => {
  const format = { premultiplied: false };

  it('weights each colour by its coverage and unites the alpha', () => {
    // Half red over opaque blue: half and half, opaque.
    const under = px([0, 0, 255, 255]);
    compositeOver(under, px([255, 0, 0, 128]), format);
    expect(under[0]).toBeGreaterThanOrEqual(127);
    expect(under[0]).toBeLessThanOrEqual(129);
    expect(under[2]).toBeGreaterThanOrEqual(126);
    expect(under[2]).toBeLessThanOrEqual(128);
    expect(under[3]).toBe(255);
  });

  it('keeps a straight colour over a clear picture, at its own alpha', () => {
    const under = px([0, 0, 0, 0]);
    compositeOver(under, px([200, 100, 50, 64]), format);
    expect([...under]).toEqual([200, 100, 50, 64]);
  });

  it('ignores a ragged tail rather than reading past a pixel', () => {
    const under = new Uint8Array([1, 2, 3, 4, 9, 9]);
    compositeOver(under, new Uint8Array([5, 6, 7, 255, 1]), format);
    expect([...under]).toEqual([5, 6, 7, 255, 9, 9]);
  });
});
