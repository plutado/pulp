/**
 * Motion tracking (milestone 76): the tracker over synthetic frames, the track
 * kept with the clip, and a layer's keys baked from it through the cut and the
 * letterbox. Every frame here is painted in the test, so what the tracker must
 * find is known to the pixel.
 */

import { describe, expect, it } from 'vitest';
import { IDENTITY_KEY, KEY_LIMITS, type LayerKey } from '../src/core/layer-keys';
import {
  LOST_CONFIDENCE, newTrackId, POINT_PATCH_FRACTION, samplesFromPoints, sanitizeMotionTracks, splitGrayFrames, TRACK_LIMITS,
  trackFramesArgs, trackPatch, trackPositionAt, trackProxySize, trackSpliced, type MotionTrack,
} from '../src/core/motion-track';
import { cutPictureBox, framePointOnPicture, pinKeys, thinKeys, trackPointOnFrame } from '../src/core/track-pin';

/** A gray frame with a painter: the background mid-gray with a little noise, so a flat region is not a perfect match everywhere. */
function frame(width: number, height: number, paint: (x: number, y: number) => number | null, seed = 1): Uint8Array {
  const data = new Uint8Array(width * height);
  let s = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const noise = (s % 7) - 3;
      const v = paint(x, y);
      data[y * width + x] = Math.max(0, Math.min(255, (v ?? 100) + (v === null ? noise : 0)));
    }
  }
  return data;
}

/** A bright square of `side` whose center moves along `path`: frame i's center is path(i). */
function squareClip(count: number, width: number, height: number, side: number, path: (i: number) => { x: number; y: number }): { width: number; height: number; frames: Uint8Array[] } {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const c = path(i);
    frames.push(frame(width, height, (x, y) => (Math.abs(x + 0.5 - c.x) <= side / 2 && Math.abs(y + 0.5 - c.y) <= side / 2 ? 240 : null), i + 1));
  }
  return { width, height, frames };
}

describe('the tracker', () => {
  it('follows a square moving at a steady speed to within a pixel, forward and back from where it was picked', () => {
    const path = (i: number) => ({ x: 40 + i * 6, y: 60 + i * 2 });
    const clip = squareClip(30, 320, 180, 20, path);
    const start = { index: 10, ...path(10) };
    const points = trackPatch(clip, start, { patch: { w: 15, h: 15 } });
    expect(points).toHaveLength(30);
    for (const p of points) {
      const want = path(p.index);
      expect(Math.abs(p.x - want.x), `frame ${p.index} x`).toBeLessThan(1);
      expect(Math.abs(p.y - want.y), `frame ${p.index} y`).toBeLessThan(1);
      expect(p.c, `frame ${p.index} confidence`).toBeGreaterThan(0.9);
    }
    expect(points[10]).toMatchObject({ index: 10, c: 1 });
  });

  it('follows a square that speeds up and turns, predicting from its motion', () => {
    const path = (i: number) => ({ x: 60 + i * i * 0.35, y: 100 - Math.sin(i / 5) * 30 });
    const clip = squareClip(25, 320, 180, 18, path);
    const points = trackPatch(clip, { index: 0, ...path(0) }, { patch: { w: 13, h: 13 }, radius: 14 });
    for (const p of points) {
      const want = path(p.index);
      expect(Math.hypot(p.x - want.x, p.y - want.y), `frame ${p.index}`).toBeLessThan(1.2);
    }
  });

  it('holds the point and says so when the target vanishes, and picks it up again where it was', () => {
    const path = (i: number) => ({ x: 50 + i * 4, y: 90 });
    const clip = squareClip(12, 200, 120, 16, path);
    // Frames 5 and 6 are empty: the square is gone.
    clip.frames[5] = frame(200, 120, () => null, 99);
    clip.frames[6] = frame(200, 120, () => null, 98);
    const points = trackPatch(clip, { index: 0, ...path(0) }, { patch: { w: 11, h: 11 }, radius: 16 });
    expect(points[5]!.c).toBeLessThan(LOST_CONFIDENCE);
    expect(points[5]!.x).toBeCloseTo(points[4]!.x, 5);
    // Back at frame 7 within reach of where it was held, and found again.
    expect(points[7]!.c).toBeGreaterThan(0.8);
    expect(Math.abs(points[7]!.x - path(7).x)).toBeLessThan(1);
  });

  it('follows a red square over green, which luma alone could not tell apart (tracked in color)', () => {
    // (255, 0, 0) and (0, 128, 0) are within a few levels of each other in BT.601 luma.
    const width = 160, height = 90;
    const path = (i: number) => ({ x: 12 + i * 4, y: 45 });
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 20; i++) {
      const f = new Uint8Array(width * height * 3);
      const c = path(i);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const red = Math.abs(x + 0.5 - c.x) <= 12 && Math.abs(y + 0.5 - c.y) <= 12;
          const at = (y * width + x) * 3;
          f[at] = red ? 255 : 0;
          f[at + 1] = red ? 0 : 128;
          f[at + 2] = 0;
        }
      }
      frames.push(f);
    }
    const points = trackPatch({ width, height, frames, channels: 3 }, { index: 0, ...path(0) }, { patch: { w: 9, h: 9 }, radius: 16 });
    for (const p of points) expect(Math.abs(p.x - path(p.index).x), `frame ${p.index}`).toBeLessThan(1);
  });

  it('tracks one way only when asked, as re-tracking from a fixed frame does', () => {
    const path = (i: number) => ({ x: 30 + i * 5, y: 50 });
    const clip = squareClip(10, 160, 100, 12, path);
    const forward = trackPatch(clip, { index: 4, ...path(4) }, { patch: { w: 9, h: 9 }, backward: false });
    expect(forward.map((p) => p.index)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('turns proxy points into the clip\'s own seconds and picture fractions, and splits raw frames', () => {
    const frames = splitGrayFrames(new Uint8Array(320 * 180 * 3 + 100), 320, 180);
    expect(frames.frames).toHaveLength(3);
    const samples = samplesFromPoints([{ index: 0, x: 160, y: 90, c: 1 }, { index: 3, x: 80, y: 45, c: 0.5 }], frames, 2, 30);
    expect(samples).toEqual([{ at: 2, x: 0.5, y: 0.5, c: 1 }, { at: 2.1, x: 0.25, y: 0.25, c: 0.5 }]);
    expect(trackProxySize({ width: 1920, height: 1080 })).toEqual({ width: 320, height: 180 });
    expect(trackProxySize({ width: 160, height: 160 })).toEqual({ width: 160, height: 160 });
    const args = trackFramesArgs('/clips/a.mp4', 1.5, 2, { width: 320, height: 180 });
    expect(args).toEqual(expect.arrayContaining(['-ss', '1.500000', '-i', '/clips/a.mp4', '-t', '2.000000', '-f', 'rawvideo', 'pipe:1']));
    expect(args.join(' ')).toContain('scale=320:180:flags=bilinear,format=rgb24');
    expect(splitGrayFrames(new Uint8Array(4 * 2 * 3 * 2), 4, 2, 3).frames).toHaveLength(2);
  });
});

describe('a track kept with the clip', () => {
  const track = (over: Partial<MotionTrack> = {}): MotionTrack => ({
    id: 'track_1', clip: 'clip-a', kind: 'point', size: { w: POINT_PATCH_FRACTION, h: POINT_PATCH_FRACTION }, from: 0, to: 1, fps: 10,
    samples: [{ at: 0, x: 0.1, y: 0.5, c: 1 }, { at: 0.5, x: 0.3, y: 0.5, c: 1 }, { at: 1, x: 0.5, y: 0.5, c: 0.2 }],
    ...over,
  });

  it('sanitizes: ids, windows and samples in range, one sample per moment, nothing else kept', () => {
    expect(sanitizeMotionTracks(null)).toBeNull();
    expect(sanitizeMotionTracks([])).toBeNull();
    expect(sanitizeMotionTracks([track()])).toEqual([track()]);
    const kept = sanitizeMotionTracks([track({ samples: [{ at: 0.5, x: 2, y: -1, c: 3 }, { at: 0, x: 0.1, y: 0.5, c: 1 }, { at: 0.5, x: 0.4, y: 0.4, c: 0.5 }] })])!;
    expect(kept[0]!.samples).toEqual([{ at: 0, x: 0.1, y: 0.5, c: 1 }, { at: 0.5, x: 0.4, y: 0.4, c: 0.5 }]);
    expect(sanitizeMotionTracks([{ ...track(), id: '1bad' }, { ...track(), clip: '' }, track({ id: 'ok' }), track({ id: 'ok' })])!.map((t) => t.id)).toEqual(['ok']);
    expect(sanitizeMotionTracks([track({ kind: 'box' as const, size: { w: 5, h: 0.001 } })])![0]!.size).toEqual({ w: TRACK_LIMITS.size.max, h: TRACK_LIMITS.size.min });
  });

  it('names a new track unlike any taken, reads a position between samples, and splices a fix from a moment on', () => {
    expect(newTrackId([])).toBe('track_1');
    expect(newTrackId(['track_1', 'track_3'])).toBe('track_2');
    expect(trackPositionAt(track(), 0.25)).toMatchObject({ x: 0.2, y: 0.5 });
    expect(trackPositionAt(track(), -1)!.x).toBe(0.1);
    expect(trackPositionAt(track(), 9)!.x).toBe(0.5);
    const fixed = trackSpliced(track(), 0.5, [{ at: 0.5, x: 0.9, y: 0.9, c: 1 }, { at: 1, x: 0.95, y: 0.9, c: 1 }]);
    expect(fixed.samples).toEqual([{ at: 0, x: 0.1, y: 0.5, c: 1 }, { at: 0.5, x: 0.9, y: 0.9, c: 1 }, { at: 1, x: 0.95, y: 0.9, c: 1 }]);
  });
});

describe('pinning a layer to a track', () => {
  it('maps the picture into the frame as the stage letterboxes it, both ways', () => {
    const box = cutPictureBox({ width: 1920, height: 1080 }, { width: 160, height: 160 });
    expect(box).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(trackPointOnFrame({ x: 0.5, y: 0.25 }, box)).toEqual({ x: 960, y: 270 });
    expect(framePointOnPicture({ x: 960, y: 270 }, box)).toEqual({ x: 0.5, y: 0.25 });
  });

  it('bakes linear keys that keep the layer where it stood and move it as the target moves', () => {
    const track: MotionTrack = {
      id: 'track_1', clip: 'c', kind: 'point', size: { w: 0.05, h: 0.05 }, from: 0, to: 2, fps: 2,
      samples: [0, 0.5, 1, 1.5, 2].map((at) => ({ at, x: 0.1 + at * 0.2, y: 0.5, c: 1 })),
    };
    const keys = pinKeys({
      track, cut: { from: 0, to: 2 }, cutStart: 3, frame: { width: 1000, height: 500 }, clip: { width: 1000, height: 500 },
      at: 4, pose: { dx: 0.05, dy: -0.1, scale: 1.5, rotate: 10, opacity: 0.8 },
    });
    // The cut starts at 3 s on the timeline, so clip second 1 (the pin moment, 4 s) is the anchor: the pose there is kept.
    expect(keys.map((k) => k.at)).toEqual([3, 5]); // a straight line thins to its ends
    expect(keys[0]).toMatchObject({ dy: -0.1, scale: 1.5, rotate: 10, opacity: 0.8, easing: 'linear' });
    expect(keys[0]!.dx).toBeCloseTo(0.05 - 0.2, 5);
    expect(keys[1]!.dx).toBeCloseTo(0.05 + 0.2, 5);
    expect(keys[1]!.dy).toBe(-0.1);
  });

  it('with a second track, the two points\' distance scales the layer and their bearing turns it', () => {
    const first: MotionTrack = { id: 'a', clip: 'c', kind: 'point', size: { w: 0.05, h: 0.05 }, from: 0, to: 1, fps: 1, samples: [{ at: 0, x: 0.4, y: 0.5, c: 1 }, { at: 1, x: 0.4, y: 0.5, c: 1 }] };
    // The second point starts a tenth to the right of the first, and ends two tenths above it.
    const second: MotionTrack = { ...first, id: 'b', samples: [{ at: 0, x: 0.5, y: 0.5, c: 1 }, { at: 1, x: 0.4, y: 0.3, c: 1 }] };
    const keys = pinKeys({ track: first, second, cut: { from: 0, to: 1 }, cutStart: 0, frame: { width: 1000, height: 1000 }, clip: { width: 1000, height: 1000 }, at: 0, pose: { ...IDENTITY_KEY } });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({ dx: 0, dy: 0, scale: 1, rotate: 0 });
    expect(keys[1]!.scale).toBeCloseTo(2, 5);
    expect(keys[1]!.rotate).toBeCloseTo(-90, 5);
  });

  it('follows the cut\'s own speed into timeline seconds, and never writes more keys than a layer may hold', () => {
    const samples = Array.from({ length: 300 }, (_, i) => ({ at: i / 30, x: 0.5 + 0.3 * Math.sin(i / 9), y: 0.5 + 0.3 * Math.cos(i / 7), c: 1 }));
    const track: MotionTrack = { id: 't', clip: 'c', kind: 'point', size: { w: 0.05, h: 0.05 }, from: 0, to: 10, fps: 30, samples };
    const keys = pinKeys({ track, cut: { from: 0, to: 10, speed: { rate: 2 } }, cutStart: 1, frame: { width: 1920, height: 1080 }, clip: { width: 1920, height: 1080 }, at: 1, pose: { ...IDENTITY_KEY }, tolerance: 0 });
    expect(keys.length).toBeLessThanOrEqual(KEY_LIMITS.count);
    expect(keys.length).toBeGreaterThan(20);
    // Twice the speed: the last sample, clip second 299/30, lands at timeline 1 + 299/60.
    expect(keys[keys.length - 1]!.at).toBeCloseTo(1 + 299 / 60, 3);
    expect(keys.every((k, i) => i === 0 || k.at > keys[i - 1]!.at)).toBe(true);
  });

  it('thins keys to the few the motion needs, keeping the ends and every bend', () => {
    const key = (at: number, dx: number, dy = 0): LayerKey => ({ ...IDENTITY_KEY, at, dx, dy, easing: 'linear' });
    const straight = [key(0, 0), key(1, 0.1), key(2, 0.2), key(3, 0.3)];
    expect(thinKeys(straight, 0.001, 120).map((k) => k.at)).toEqual([0, 3]);
    const bent = [key(0, 0), key(1, 0.1), key(2, 0.2), key(3, 0.2), key(4, 0.2)];
    expect(thinKeys(bent, 0.001, 120).map((k) => k.at)).toEqual([0, 2, 4]);
    const many = Array.from({ length: 500 }, (_, i) => key(i, Math.sin(i), Math.cos(i * 1.3)));
    const capped = thinKeys(many, 0, 50);
    expect(capped.length).toBeLessThanOrEqual(50);
    expect(capped[0]!.at).toBe(0);
    expect(capped[capped.length - 1]!.at).toBe(499);
  });
});
