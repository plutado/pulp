/**
 * A layer's own movement, when it overrides the template's (milestone 23).
 *
 * The template owns every layer's movement by default: its per-layer hook
 * (`options.each` in src/core/layer-layout.ts) animates by stack position. A
 * layer set to Fade, Slide, Scale or None replaces that hook's answer for
 * itself with the draw computed here — and nothing else: the layout, the
 * typography and the stack are untouched.
 *
 * The one promise: **an overridden layer finishes inside the template's own in
 * and out.** Its envelope starts no earlier than the graphic's first frame and
 * reaches zero exactly on its last, so no layer can be left on screen after
 * the graphic has gone, whatever delay was chosen. A delay that leaves no room
 * for the full run shortens the run rather than spilling past the end.
 *
 * Pure arithmetic. The host computes it per frame (`blockStates` carries the
 * result on each layer's state as `draw`), so the bridge's mirror of
 * `layoutBlock` needs no copy of this: the draw arrives ready.
 */

import type { LayerDraw } from './layer-layout';
import type { LayerMotion } from './layers';

/** How long an overridden layer's in and its out each take, when the graphic has the room. */
export const MOTION_SECONDS = 0.8;

/** How far a sliding layer travels, as a fraction of the frame's short side. */
export const SLIDE_FRACTION = 0.05;

/** How small a scaling layer starts and ends. */
export const SCALE_FROM = 0.9;

/** The easing every override moves with, the one the bundled templates use. */
export function easeInOutSine(x: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
}

/** What the graphic's timing a motion override needs: the frame's time and where the last frame lies. */
export interface MotionTiming {
  /** Seconds into the graphic. */
  time: number;
  /** The template's declared length, in seconds. */
  duration: number;
  fps: number;
  /** The frame's short side in pixels, which a slide's travel is a fraction of. */
  short: number;
}

/**
 * The draw a motion override asks for at one moment, or undefined when the
 * template keeps the layer (`motion: "template"`). `none` is a hard cut: there
 * from its delay, gone on the last frame. The rest ease in from the delay and
 * ease out so the envelope is zero exactly on the last frame.
 */
export function motionDraw(layer: { motion: LayerMotion; motionDelay: number }, timing: MotionTiming): Partial<LayerDraw> | undefined {
  if (layer.motion === 'template') return undefined;
  const { time, duration, fps, short } = timing;
  // The envelope's end is the last frame's own time, so the final picture holds the promise.
  const end = Math.max(0, duration - 1 / Math.max(1, fps));
  const delay = Math.min(Math.max(0, layer.motionDelay), end);
  if (layer.motion === 'none') return { alpha: time >= delay && time < end ? 1 : 0 };
  // In and out each take their share, shortened together when the delay leaves less than both.
  const run = Math.min(MOTION_SECONDS, Math.max(0, end - delay) / 2);
  const tIn = run > 0 ? easeInOutSine((time - delay) / run) : time >= delay ? 1 : 0;
  const tOut = run > 0 ? easeInOutSine((time - (end - run)) / run) : time >= end ? 1 : 0;
  const alpha = tIn * (1 - tOut);
  if (layer.motion === 'fade') return { alpha };
  if (layer.motion === 'slide') return { alpha, dy: (1 - tIn + tOut) * SLIDE_FRACTION * short };
  return { alpha, scale: SCALE_FROM + (1 - SCALE_FROM) * tIn * (1 - tOut) };
}
