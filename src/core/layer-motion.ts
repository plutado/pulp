/**
 * A layer's own motion (milestone 23, the last item). By default the template
 * owns how a layer arrives: a layer takes the movement of the stack position it
 * is in, which is what lets a line added in the middle move as the middle line
 * of the design does. This module is the other case — the person overrides one
 * layer and says how *it* comes in: Fade, Slide, Scale or None, after a delay.
 *
 * Two rules shape the arithmetic, and both are about staying inside the
 * author's design:
 *
 * - **The entrance is the person's; the exit stays the template's.** An
 *   override says how a layer arrives, not how it leaves. Whatever it computes
 *   is multiplied by the block's *envelope* — the most the template is showing
 *   any of the block's layers at this frame (`layoutBlock` in
 *   src/core/layer-layout.ts) — so when the graphic goes, the layer goes with
 *   it. No layer can be left on screen after the template has cleared.
 * - **The entrance always finishes inside the template's own time.** A delay
 *   longer than the template is long would leave a layer that never arrives, so
 *   the start is held back to `duration - MOTION_IN_SECONDS`: the layer is
 *   always fully in by the last frame.
 *
 * The distance a slide travels and the size a scale grows from are relative to
 * the layer itself, so an override reads the same at every resolution and on a
 * line of any size, with nothing to plumb through from the frame.
 *
 * The bridge script (`BRIDGE_SCRIPT` in src/core/runtime.ts) carries the same
 * arithmetic for template pages, as it does for the layout: **change both or
 * neither.** This copy is the one with unit tests.
 */

import type { LayerDraw } from './layer-layout';
import type { LayerMotion } from './layers';

/** How long an overridden layer takes to come in, in seconds. */
export const MOTION_IN_SECONDS = 0.5;

/** How far a slide travels, as a multiple of the layer's own size. */
export const SLIDE_DISTANCE = 1;

/** The size a scale grows from. */
export const SCALE_FROM = 0.8;

/** The same easing the sample templates move with, so an overridden layer sits among them. */
export function easeInOutSine(x: number): number {
  return (1 - Math.cos(Math.PI * x)) / 2;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** This frame's place in the template's timeline: what an override is timed against. */
export interface MotionAt {
  /** Seconds from the start of the template. */
  time: number;
  /** The template's whole length in seconds. */
  duration: number;
}

export interface MotionContext {
  /** The layer's own size in pixels — a line's type size, a picture's height — which a slide and a scale are relative to. */
  distance: number;
  /** The block's stacking direction: a column rises into place, a row comes in from the left. */
  direction: 'column' | 'row';
}

/**
 * How long the entrance takes here: half a second, or the whole template when
 * it is shorter than that. A two-frame graphic still gets its whole fade rather
 * than being cut off part way through one.
 */
export function motionIn(at: MotionAt): number {
  return Math.min(MOTION_IN_SECONDS, Math.max(0, at.duration));
}

/**
 * When an overridden layer starts coming in: its delay, held back so the
 * entrance always finishes within the template's own length. A template shorter
 * than the entrance itself starts at zero and is in by its last frame.
 */
export function motionStart(motion: LayerMotion, at: MotionAt): number {
  const latest = Math.max(0, at.duration - motionIn(at));
  return Math.min(Math.max(0, motion.delay), latest);
}

/** How far into its entrance an overridden layer is at this frame: 0 before it starts, 1 once it is in. */
export function motionProgress(motion: LayerMotion, at: MotionAt): number {
  const start = motionStart(motion, at);
  const over = motionIn(at);
  if (over <= 0) return at.time >= start ? 1 : 0;
  return clamp01((at.time - start) / over);
}

/**
 * What an overridden layer is drawn with at this frame, before the block's
 * envelope is applied. `template` has nothing to say here — the layer keeps
 * what the template gave its position — so it answers null, and so does
 * anything unknown.
 *
 * `none` is not "always on": it is the layer arriving with no movement at all,
 * so a delay still holds it off and it then appears at once. With the default
 * delay of zero that is simply a layer that is there from the first frame.
 */
export function motionDraw(motion: LayerMotion, at: MotionAt, context: MotionContext): LayerDraw | null {
  if (motion.type === 'template') return null;
  if (motion.type === 'none') {
    return { alpha: at.time >= motionStart(motion, at) ? 1 : 0, dx: 0, dy: 0, scale: 1 };
  }
  const eased = easeInOutSine(motionProgress(motion, at));
  if (motion.type === 'fade') return { alpha: eased, dx: 0, dy: 0, scale: 1 };
  if (motion.type === 'slide') {
    const travel = (1 - eased) * SLIDE_DISTANCE * context.distance;
    // A column rises into place from below; a row comes in from the left.
    return context.direction === 'column'
      ? { alpha: eased, dx: 0, dy: travel, scale: 1 }
      : { alpha: eased, dx: -travel, dy: 0, scale: 1 };
  }
  if (motion.type === 'scale') return { alpha: eased, dx: 0, dy: 0, scale: SCALE_FROM + (1 - SCALE_FROM) * eased };
  return null;
}
