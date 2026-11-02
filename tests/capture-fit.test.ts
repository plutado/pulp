/**
 * Fitting a capture window to a small screen on Linux (src/core/capture-fit.ts):
 * which window to make and at what scale, so the frame comes out whole.
 */

import { describe, expect, it } from 'vitest';
import { captureFit, frameFitsScreen, MAX_CAPTURE_SCALE } from '../src/core/capture-fit';

const hd = { width: 1920, height: 1080 };

describe('fitting a frame to a screen', () => {
  it('leaves a frame alone on every platform but Linux, and on Linux when it fits', () => {
    for (const platform of ['darwin', 'win32'] as const) expect(captureFit(hd, hd, platform)).toEqual({ window: hd, scale: 1 });
    expect(captureFit(hd, { width: 2000, height: 1200 }, 'linux')).toEqual({ window: hd, scale: 1 });
    expect(captureFit(hd, null, 'linux')).toEqual({ window: hd, scale: 1 });
    // One pixel under the screen is enough: it is the screen's own size that is shrunk.
    expect(captureFit({ width: 1919, height: 1079 }, hd, 'linux')?.scale).toBe(1);
    expect(frameFitsScreen(hd, hd)).toBe(false);
    expect(frameFitsScreen({ width: 1919, height: 1080 }, hd)).toBe(false);
  });

  it('halves a screen-sized frame, and divides a larger one by the first factor that fits', () => {
    // 1080p on a 1080p desktop: the case the issue was filed for.
    expect(captureFit(hd, hd, 'linux')).toEqual({ window: { width: 960, height: 540 }, scale: 2 });
    // 4K on a 1080p desktop: halved it is still the screen's size, so thirds.
    expect(captureFit({ width: 3840, height: 2160 }, hd, 'linux')).toEqual({ window: { width: 1280, height: 720 }, scale: 3 });
    // 8K on a 1080p desktop.
    expect(captureFit({ width: 7680, height: 4320 }, hd, 'linux')).toEqual({ window: { width: 1536, height: 864 }, scale: 5 });
    // A tall frame on a small laptop screen.
    expect(captureFit({ width: 1080, height: 1920 }, { width: 1366, height: 768 }, 'linux')).toEqual({ window: { width: 360, height: 640 }, scale: 3 });
  });

  it('only ever divides exactly, and says when nothing does', () => {
    for (const fit of [captureFit(hd, hd, 'linux')!, captureFit({ width: 3840, height: 2160 }, hd, 'linux')!]) {
      expect(fit.window.width * fit.scale).toBe(fit.scale === 2 ? 1920 : 3840);
      expect(fit.window.height * fit.scale).toBe(fit.scale === 2 ? 1080 : 2160);
    }
    // 1921 × 1081 shares no factor with anything: no window paints it whole from inside a 1080p screen.
    expect(captureFit({ width: 1921, height: 1081 }, hd, 'linux')).toBeNull();
    expect(MAX_CAPTURE_SCALE).toBeGreaterThanOrEqual(8);
  });
});
