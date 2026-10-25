import { describe, expect, it } from 'vitest';
import { easeInOutSine, MOTION_SECONDS, motionDraw, SCALE_FROM, SLIDE_FRACTION, type MotionTiming } from '../src/core/layer-motion';
import type { LayerMotion } from '../src/core/layers';

/** A 5 s graphic at 25 fps on a 1080-short frame; the last frame's time is 4.96 s. */
const timing = (time: number, over: Partial<MotionTiming> = {}): MotionTiming => ({ time, duration: 5, fps: 25, short: 1080, ...over });
const at = (motion: LayerMotion, delay: number, time: number, over: Partial<MotionTiming> = {}) => motionDraw({ motion, motionDelay: delay }, timing(time, over));
const END = 5 - 1 / 25;

describe('a layer\'s own motion', () => {
  it('leaves a template-owned layer alone', () => {
    expect(at('template', 0, 2)).toBeUndefined();
    expect(at('template', 3, 0)).toBeUndefined();
  });

  it('fades in from its delay, holds, and is gone exactly on the last frame', () => {
    expect(at('fade', 0, 0)!.alpha).toBe(0);
    expect(at('fade', 0, MOTION_SECONDS / 2)!.alpha).toBeCloseTo(0.5);
    expect(at('fade', 0, 2.5)!.alpha).toBe(1);
    expect(at('fade', 0, END)!.alpha).toBe(0);
    // A delay shifts the in and leaves the out where it was.
    expect(at('fade', 1, 1)!.alpha).toBe(0);
    expect(at('fade', 1, 0.9)!.alpha).toBe(0);
    expect(at('fade', 1, 1 + MOTION_SECONDS)!.alpha).toBe(1);
    expect(at('fade', 1, END)!.alpha).toBe(0);
  });

  it('eases: halfway through the in is half the alpha, and the curve is the sine every template uses', () => {
    expect(easeInOutSine(0)).toBe(0);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5);
    expect(easeInOutSine(1)).toBe(1);
    expect(easeInOutSine(-3)).toBe(0);
    expect(easeInOutSine(7)).toBe(1);
    expect(at('fade', 0, MOTION_SECONDS * 0.25)!.alpha).toBeCloseTo(easeInOutSine(0.25));
  });

  it('none is a hard cut: there from its delay, gone on the last frame, never eased', () => {
    expect(at('none', 0, 0)).toEqual({ alpha: 1 });
    expect(at('none', 2, 1.99)).toEqual({ alpha: 0 });
    expect(at('none', 2, 2)).toEqual({ alpha: 1 });
    expect(at('none', 0, END - 0.01)).toEqual({ alpha: 1 });
    expect(at('none', 0, END)).toEqual({ alpha: 0 });
  });

  it('slide enters rising from below and sinks away, its travel a fraction of the short side', () => {
    const entering = at('slide', 0, 0)!;
    expect(entering.alpha).toBe(0);
    expect(entering.dy).toBeCloseTo(SLIDE_FRACTION * 1080);
    expect(at('slide', 0, 2.5)!.dy).toBeCloseTo(0);
    const leaving = at('slide', 0, END)!;
    expect(leaving.alpha).toBe(0);
    expect(leaving.dy).toBeCloseTo(SLIDE_FRACTION * 1080);
    // Halfway in: halfway up.
    expect(at('slide', 0, MOTION_SECONDS / 2)!.dy).toBeCloseTo(SLIDE_FRACTION * 1080 * 0.5);
  });

  it('scale grows in from its smaller start and shrinks back at the end, fading with it', () => {
    expect(at('scale', 0, 0)!.scale).toBeCloseTo(SCALE_FROM);
    expect(at('scale', 0, 2.5)!.scale).toBe(1);
    expect(at('scale', 0, END)!.scale).toBeCloseTo(SCALE_FROM);
    expect(at('scale', 0, 2.5)!.alpha).toBe(1);
  });

  it('finishes inside the graphic however long the delay: the run shortens rather than spilling past the end', () => {
    // Delay right at the end: the layer still reaches zero on the last frame.
    expect(at('fade', 60, END)!.alpha).toBe(0);
    // A delay past the end is clamped to it.
    expect(at('none', 60, END - 0.01)!.alpha).toBe(0);
    // A one-second graphic: in and out each take what room there is, and the ends still read zero.
    const shortEnd = 1 - 1 / 25;
    expect(at('fade', 0, 0, { duration: 1 })!.alpha).toBe(0);
    expect(at('fade', 0, shortEnd / 2, { duration: 1 })!.alpha).toBe(1);
    expect(at('fade', 0, shortEnd, { duration: 1 })!.alpha).toBe(0);
  });
});
