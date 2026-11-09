/**
 * Auto-reframe (milestone 77): the subject found in frames the test paints,
 * the crop steadied and starting again at a cut, the keys a cut keeps, and the
 * crop the render and the stage share.
 */

import { describe, expect, it } from 'vitest';
import { cutReframe, reframeCentreAt, sanitizeCutTrack, withCutReframe, withReframeKeyAt } from '../src/core/cut-track';
import { buildRenderPlan } from '../src/core/render-plan';
import {
  centredReframe, clampCenter, coverWindow, coverWindowSize, findSubject, frameDifference, reframeCropFilter, reframeKeysFrom, steadyPath, subjectPath,
} from '../src/core/reframe';
import { rawManifest } from './fixtures';
import { validateManifest } from '../src/core/manifest';

/** An RGB frame painted by a function of (x, y) → [r, g, b], over a mid-gray ground. */
function rgb(width: number, height: number, paint: (x: number, y: number) => [number, number, number] | null): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      const px = paint(x, y) ?? [110, 110, 110];
      data[at] = px[0];
      data[at + 1] = px[1];
      data[at + 2] = px[2];
    }
  }
  return data;
}
const square = (cx: number, cy: number, side: number, color: [number, number, number]) => (x: number, y: number) =>
  (Math.abs(x + 0.5 - cx) <= side / 2 && Math.abs(y + 0.5 - cy) <= side / 2 ? color : null);
const W = 160;
const H = 90;
const frames = (list: Uint8Array[]) => ({ width: W, height: H, frames: list, channels: 3 });

describe('finding the subject', () => {
  it('follows what moves against a still ground', () => {
    const list = Array.from({ length: 12 }, (_, i) => rgb(W, H, square(30 + i * 8, 45, 16, [240, 240, 240])));
    const path = subjectPath(frames(list));
    expect(path.shots).toEqual([0]);
    for (let i = 1; i < list.length; i++) {
      expect(Math.abs(path.points[i]!.x * W - (30 + i * 8)), `frame ${i}`).toBeLessThan(6);
      expect(path.points[i]!.face).toBe(false);
    }
  });

  it('puts a face first: skin somewhere in the frame wins over a brighter moving thing', () => {
    const skin: [number, number, number] = [220, 170, 140];
    const list = Array.from({ length: 6 }, (_, i) => rgb(W, H, (x, y) => square(120, 30, 14, skin)(x, y) ?? square(20 + i * 10, 70, 16, [255, 255, 255])(x, y)));
    const path = subjectPath(frames(list));
    for (const p of path.points) {
      expect(p.face).toBe(true);
      expect(Math.abs(p.x * W - 120)).toBeLessThan(6);
      expect(Math.abs(p.y * H - 30)).toBeLessThan(6);
    }
    // A single still frame with nothing but skin says the same.
    expect(findSubject(list[0]!, null, { width: W, height: H, channels: 3 }).face).toBe(true);
  });

  it('starts a new shot where a frame differs from the last more than a cut does', () => {
    const a = Array.from({ length: 5 }, (_, i) => rgb(W, H, square(20 + i * 4, 45, 16, [240, 240, 240])));
    const b = Array.from({ length: 5 }, (_, i) => rgb(W, H, (x, y) => square(130, 20 + i * 4, 16, [240, 240, 240])(x, y) ?? [30, 30, 30]));
    const path = subjectPath(frames([...a, ...b]));
    expect(path.shots).toEqual([0, 5]);
    expect(frameDifference(a[4]!, b[0]!, W, H, 3)).toBeGreaterThan(40);
    expect(frameDifference(a[3]!, a[4]!, W, H, 3)).toBeLessThan(40);
  });
});

describe('a steady crop', () => {
  const frame = { width: 1080, height: 1920 };
  const clip = { width: 1920, height: 1080 };

  it('knows the window a tall frame takes from a wide picture, and where its center may go', () => {
    const w = coverWindowSize(frame, clip);
    expect(w.h).toBeCloseTo(1, 6);
    expect(w.w).toBeCloseTo(0.3164, 3); // (1080/1920) / (1920/1080)
    expect(clampCenter({ x: 0, y: 0.5 }, w).x).toBeCloseTo(w.w / 2, 6);
    expect(clampCenter({ x: 1, y: 0.5 }, w).x).toBeCloseTo(1 - w.w / 2, 6);
    const win = coverWindow(frame, clip, { x: 0.5, y: 0.5 });
    expect(win).toMatchObject({ y: 0, height: 1080 });
    expect(win.x + win.width / 2).toBeCloseTo(960, 3);
    // A frame the same shape as the picture takes all of it.
    expect(coverWindowSize({ width: 1920, height: 1080 }, clip)).toEqual({ w: 1, h: 1 });
  });

  it('ignores a subject swaying inside the dead zone and follows one that strays, averaged over the window', () => {
    const sway = { points: Array.from({ length: 30 }, (_, i) => ({ x: 0.5 + 0.015 * Math.sin(i), y: 0.5, c: 1, face: false })), shots: [0] };
    const still = steadyPath(sway, { frame, clip, window: 3 });
    expect(new Set(still.map((p) => p.x.toFixed(4))).size).toBe(1);
    const walk = { points: Array.from({ length: 30 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.5, c: 1, face: false })), shots: [0] };
    const moved = steadyPath(walk, { frame, clip, window: 3 });
    expect(moved[29]!.x).toBeGreaterThan(moved[0]!.x + 0.15);
    for (const p of moved) expect(p.x).toBeGreaterThanOrEqual(coverWindowSize(frame, clip).w / 2 - 1e-9);
  });

  it('starts again at a shot boundary rather than easing across it', () => {
    const points = [...Array.from({ length: 10 }, () => ({ x: 0.2, y: 0.5, c: 1, face: false })), ...Array.from({ length: 10 }, () => ({ x: 0.8, y: 0.5, c: 1, face: false }))];
    const steady = steadyPath({ points, shots: [0, 10] }, { frame, clip, window: 5 });
    expect(steady[9]!.x).toBeCloseTo(0.2, 3);
    expect(steady[10]!.x).toBeCloseTo(0.8, 3);
    const keys = reframeKeysFrom(steady, [0, 10], 2, 10);
    // The shot's last frame and the next's first, a frame apart, so the lerp between them is the cut.
    expect(keys.map((k) => k.at)).toEqual([2, 2.9, 3, 3.9]);
    expect(keys.map((k) => k.x)).toEqual([0.2, 0.2, 0.8, 0.8]);
    expect(reframeCentreAt(keys, 2.95).x).toBeCloseTo(0.5, 3);
  });

  it('keeps a key where the path bends and drops the rest', () => {
    const path = Array.from({ length: 40 }, (_, i) => ({ x: i < 20 ? 0.3 : 0.3 + (i - 20) * 0.02, y: 0.5 }));
    const keys = reframeKeysFrom(path, [0], 0, 10);
    expect(keys.length).toBeLessThanOrEqual(4);
    expect(keys[0]).toEqual({ at: 0, x: 0.3, y: 0.5 });
    expect(keys[keys.length - 1]).toEqual({ at: 3.9, x: 0.68, y: 0.5 });
    expect(centredReframe(1.5)).toEqual([{ at: 1.5, x: 0.5, y: 0.5 }]);
  });
});

describe('a cut keeps its reframe', () => {
  const track = { cuts: [{ id: 'clip-a', from: 0, to: 2 }] };

  it('by shape, sanitized, set and taken off, and a key written at the playhead replaces one within a frame', () => {
    const framed = withCutReframe(track, 0, '9:16', [{ at: 1, x: 0.7, y: 0.5 }, { at: 0, x: 0.3, y: 0.5 }, { at: 1, x: 0.71, y: 0.5 }]);
    expect(cutReframe(framed.cuts[0]!, '9:16')).toEqual([{ at: 0, x: 0.3, y: 0.5 }, { at: 1, x: 0.71, y: 0.5 }]);
    expect(cutReframe(framed.cuts[0]!, '1:1')).toBeUndefined();
    const keyed = withReframeKeyAt(framed, 0, '9:16', { at: 1.01, x: 0.9, y: 0.4 }, 30);
    expect(cutReframe(keyed.cuts[0]!, '9:16')).toEqual([{ at: 0, x: 0.3, y: 0.5 }, { at: 1.01, x: 0.9, y: 0.4 }]);
    const off = withCutReframe(keyed, 0, '9:16', null);
    expect(off.cuts[0]!.reframe).toBeUndefined();
    // Read back from a project: only shapes the frames come in, keys in range.
    const read = sanitizeCutTrack({ cuts: [{ id: 'a', from: 0, to: 2, reframe: { '9:16': [{ at: 0.5, x: 2, y: -1 }], 'odd': [{ at: 0, x: 0.5, y: 0.5 }], '1:1': 'nope' } }] });
    expect(read!.cuts[0]!.reframe).toEqual({ '9:16': [{ at: 0.5, x: 1, y: 0 }] });
  });

  it('renders filling the frame, the crop following its keys in the cut\'s own time, and letterboxes a cut without one', () => {
    const filter = reframeCropFilter({ width: 1080, height: 1920 }, [{ at: 2, x: 0.3, y: 0.5 }, { at: 4, x: 0.7, y: 0.5 }], (clipSeconds) => clipSeconds - 2);
    expect(filter.startsWith('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:')).toBe(true);
    expect(filter).toContain("if(lt(t,2),0.3+(0.4)*clip((t-0)/2,0,1),0.7)");
    expect(filter).toContain('*iw-ow/2,0,iw-ow)');
    const one = reframeCropFilter({ width: 1080, height: 1920 }, [{ at: 0, x: 0.5, y: 0.5 }], (s) => s);
    expect(one).toContain("crop=1080:1920:'clip((0.5)*iw-ow/2,0,iw-ow)':'clip((0.5)*ih-oh/2,0,ih-oh)'");
    const manifest = validateManifest(rawManifest({ fps: 30, duration: 4, width: 1080, height: 1920, aspects: ['9:16'] }));
    if (!manifest.ok) throw new Error('fixture manifest invalid');
    const plan = buildRenderPlan({
      manifest: manifest.manifest, presetId: 'prores-4444', outputPath: '/o/t',
      track: { cuts: [{ path: '/lib/a.mp4', from: 2, to: 4, reframe: [{ at: 2, x: 0.3, y: 0.5 }, { at: 4, x: 0.7, y: 0.5 }] }, { path: '/lib/b.mp4', from: 0, to: 1 }] },
    });
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("[1:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:'clip((if(lt(t,2),0.3+(0.4)*clip((t-0)/2,0,1),0.7))*iw-ow/2,0,iw-ow)'");
    expect(graph).toContain('[2:v]fps=30,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:-1:-1:color=black');
  });
});
