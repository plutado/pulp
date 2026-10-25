import { describe, expect, it } from 'vitest';
import { motionDraw, motionProgress, motionStart, MOTION_IN_SECONDS, SCALE_FROM, SLIDE_DISTANCE } from '../src/core/layer-motion';
import type { LayerMotion } from '../src/core/layers';

const at = (time: number, duration = 4) => ({ time, duration });
const motion = (over: Partial<LayerMotion> = {}): LayerMotion => ({ type: 'fade', delay: 0, ...over });
const column = { distance: 100, direction: 'column' as const };

describe("a layer's own motion", () => {
  it('leaves a template layer alone: it keeps the movement of its position', () => {
    expect(motionDraw(motion({ type: 'template' }), at(1), column)).toBeNull();
    expect(motionDraw(motion({ type: 'template', delay: 2 }), at(3), column)).toBeNull();
  });

  it('fades in over half a second from its delay, and stays in', () => {
    const m = motion({ delay: 1 });
    expect(motionDraw(m, at(0.9), column)!.alpha).toBe(0);
    expect(motionDraw(m, at(1), column)!.alpha).toBe(0);
    expect(motionDraw(m, at(1.25), column)!.alpha).toBeCloseTo(0.5, 10); // half way, eased symmetrically
    expect(motionDraw(m, at(1 + MOTION_IN_SECONDS), column)!.alpha).toBe(1);
    expect(motionDraw(m, at(3.9), column)!.alpha).toBe(1);
    // A fade moves nothing and scales nothing.
    expect(motionDraw(m, at(1.25), column)).toMatchObject({ dx: 0, dy: 0, scale: 1 });
  });

  it('holds a delay back so the entrance always finishes inside the template', () => {
    // A 4 s template: the latest a layer may start is 3.5 s, whatever the delay says.
    expect(motionStart(motion({ delay: 9 }), at(0, 4))).toBe(4 - MOTION_IN_SECONDS);
    expect(motionDraw(motion({ delay: 9 }), at(4, 4), column)!.alpha).toBe(1);
    // Even a template shorter than the entrance has the layer in by its end.
    expect(motionStart(motion({ delay: 2 }), at(0, 0.3))).toBe(0);
    expect(motionDraw(motion({ delay: 2 }), at(0.3, 0.3), column)!.alpha).toBe(1);
    // A negative delay is simply none.
    expect(motionStart(motion({ delay: -3 }), at(0))).toBe(0);
  });

  it('slides along the block: a column rises into place, a row comes in from the left', () => {
    const rising = motionDraw(motion({ type: 'slide' }), at(0), column)!;
    expect(rising).toMatchObject({ alpha: 0, dx: 0, scale: 1 });
    expect(rising.dy).toBe(SLIDE_DISTANCE * 100); // a layer's own size below its place
    expect(motionDraw(motion({ type: 'slide' }), at(MOTION_IN_SECONDS), column)!.dy).toBe(0);
    const row = motionDraw(motion({ type: 'slide' }), at(0), { distance: 80, direction: 'row' })!;
    expect(row).toMatchObject({ dy: 0, scale: 1 });
    expect(row.dx).toBe(-SLIDE_DISTANCE * 80);
    // The travel is the layer's own size, so a bigger line slides further and reads the same.
    expect(motionDraw(motion({ type: 'slide' }), at(0), { distance: 200, direction: 'column' })!.dy).toBe(200);
  });

  it('scales up into place, from the same fraction whatever the layer', () => {
    expect(motionDraw(motion({ type: 'scale' }), at(0), column)).toMatchObject({ alpha: 0, dx: 0, dy: 0, scale: SCALE_FROM });
    expect(motionDraw(motion({ type: 'scale' }), at(MOTION_IN_SECONDS), column)).toMatchObject({ alpha: 1, scale: 1 });
    expect(motionDraw(motion({ type: 'scale' }), at(0.25), column)!.scale).toBeCloseTo(SCALE_FROM + (1 - SCALE_FROM) * 0.5, 10);
  });

  it('none is a layer that arrives with no movement at all, which a delay still holds off', () => {
    // The default: simply there, from the first frame.
    expect(motionDraw(motion({ type: 'none' }), at(0), column)).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1 });
    // With a delay it appears at once when its turn comes, rather than easing in.
    const held = motion({ type: 'none', delay: 2 });
    expect(motionDraw(held, at(1.99), column)!.alpha).toBe(0);
    expect(motionDraw(held, at(2), column)!.alpha).toBe(1);
    expect(motionDraw(held, at(2.01), column)!.alpha).toBe(1);
  });

  it('measures the entrance as a share of it, whatever the type', () => {
    expect(motionProgress(motion({ delay: 1 }), at(0.5))).toBe(0);
    expect(motionProgress(motion({ delay: 1 }), at(1.25))).toBe(0.5);
    expect(motionProgress(motion({ delay: 1 }), at(5))).toBe(1);
  });
});
