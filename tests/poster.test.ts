import { describe, expect, it } from 'vitest';
import {
  choosePosterFrame, contentCrop, isNearlyUniform, measureFrame, posterCandidateFrames, posterFromFrameArgs, posterScore, PROBE_HEIGHT, PROBE_WIDTH, probeFrameArgs,
  type FrameMeasure,
} from '../src/core/poster';

/** A probe-sized frame: transparent, with a rectangle of pixels painted by a function of x and y. */
function frame(paint: (x: number, y: number) => [number, number, number, number] | null, width = PROBE_WIDTH, height = PROBE_HEIGHT): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = paint(x, y);
      if (!px) continue;
      out.set(px, (y * width + x) * 4);
    }
  }
  return out;
}

const measure = (coverage: number, spread: number): FrameMeasure => ({ coverage, spread, bbox: null });

describe('the poster frame (milestone 34)', () => {
  it('looks at the frames the hover strip does, or the one moment the manifest names', () => {
    expect(posterCandidateFrames(150, 30)).toEqual([0, 21, 43, 64, 85, 106, 128, 149]);
    expect(posterCandidateFrames(150, 30, 2)).toEqual([60]);
    expect(posterCandidateFrames(150, 30, 99)).toEqual([149]); // past the end: the last frame
    expect(posterCandidateFrames(4, 30)).toEqual([0, 1, 2, 3]); // a short run repeats no frame
  });

  it('measures what a frame shows: nothing, one flat colour, or a picture', () => {
    const empty = measureFrame(frame(() => null), PROBE_WIDTH, PROBE_HEIGHT);
    expect(empty).toEqual({ coverage: 0, spread: 0, bbox: null });
    expect(isNearlyUniform(empty)).toBe(true);

    // A flat bar across the bottom third: drawn, but one tone.
    const bar = measureFrame(frame((_x, y) => (y >= 18 ? [40, 40, 200, 255] : null)), PROBE_WIDTH, PROBE_HEIGHT);
    expect(bar.coverage).toBeCloseTo(9 / 27, 5);
    expect(bar.spread).toBeCloseTo(0, 6);
    expect(bar.bbox).toEqual({ left: 0, top: 18, right: 47, bottom: 26 });
    expect(isNearlyUniform(bar)).toBe(true);

    // The same bar with text drawn on it varies in tone, and reads as a picture.
    const text = measureFrame(frame((x, y) => (y >= 18 ? (x % 3 === 0 && y % 2 === 0 ? [255, 255, 255, 255] : [20, 20, 20, 255]) : null)), PROBE_WIDTH, PROBE_HEIGHT);
    expect(text.spread).toBeGreaterThan(0.3);
    expect(isNearlyUniform(text)).toBe(false);
    expect(posterScore(text)).toBeGreaterThan(posterScore(bar));

    // Faint pixels are not drawn.
    const faint = measureFrame(frame(() => [255, 255, 255, 10]), PROBE_WIDTH, PROBE_HEIGHT);
    expect(faint.coverage).toBe(0);
  });

  it('takes the frame that shows the most, and among near-equals the one nearest the middle', () => {
    expect(choosePosterFrame([measure(0, 0), measure(0.1, 0.2), measure(0.6, 0.5), measure(0.1, 0.1)])).toBe(2);
    // All alike: the middle, which is what the poster always was.
    expect(choosePosterFrame([measure(1, 0.4), measure(1, 0.41), measure(1, 0.4), measure(1, 0.4), measure(1, 0.4)])).toBe(2);
    expect(choosePosterFrame([measure(1, 0.4), measure(1, 0.4), measure(1, 0.4), measure(1, 0.4)])).toBe(1); // even count: the earlier of the two middles
    expect(choosePosterFrame([])).toBe(0);
  });

  it('crops a transparent poster to what it draws, with a margin, even sides and a floor on its size', () => {
    const full = { width: 1920, height: 1080 };
    // A lower third in the bottom-left: probe box columns 2..30, rows 18..24.
    const crop = contentCrop({ left: 2, top: 18, right: 30, bottom: 24 }, full)!;
    expect(crop).not.toBeNull();
    expect(crop.width % 2).toBe(0);
    expect(crop.height % 2).toBe(0);
    expect(crop.x).toBeLessThan(2 * 40); // the margin pulls it left of the drawn part
    expect(crop.x + crop.width).toBeGreaterThan(31 * 40); // and past its right edge
    expect(crop.y + crop.height).toBe(1080); // clamped at the bottom of the frame
    expect(crop.width).toBeGreaterThanOrEqual(640); // never narrower than a third of the frame

    // A small bug in a corner grows to the floor, about its own centre, and stays inside the frame.
    const bug = contentCrop({ left: 44, top: 1, right: 46, bottom: 3 }, full)!;
    expect(bug.width).toBe(640);
    expect(bug.x + bug.width).toBeLessThanOrEqual(1920);
    expect(bug.y).toBe(0);

    // Nothing drawn, or a drawing that fills the frame: no crop.
    expect(contentCrop(null, full)).toBeNull();
    expect(contentCrop({ left: 0, top: 0, right: 47, bottom: 26 }, full)).toBeNull();
    expect(contentCrop({ left: 1, top: 1, right: 45, bottom: 25 }, full), 'nearly the whole frame').toBeNull();
  });

  it('builds the ffmpeg runs: the probe reads raw pixels back, the poster crops only when told to', () => {
    expect(probeFrameArgs()).toEqual(['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', 'pipe:0', '-vf', 'scale=48:27', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']);
    const plain = posterFromFrameArgs('/cache/x.png', null);
    expect(plain.join(' ')).not.toContain('crop=');
    expect(plain.slice(-3)).toEqual(['-f', 'image2', '/cache/x.png']);
    const cropped = posterFromFrameArgs('/cache/x.png', { x: 10, y: 20, width: 640, height: 360 });
    expect(cropped[cropped.indexOf('-vf') + 1]).toMatch(/^crop=640:360:10:20,scale=/);
  });
});
