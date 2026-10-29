/**
 * When a layer is on screen (milestone 28). A layer is drawn for the whole of
 * the graphic unless it says otherwise; this module is the otherwise — a
 * **start** and an **end** of its own, in seconds.
 *
 * Both are seconds of the graphic **as it is watched**, not of the template's
 * own clock. Milestone 30 let the two differ: a lower third designed at six
 * seconds may be asked to run for twenty, and someone who wants a line to
 * arrive five seconds in means five seconds into the twenty they are watching.
 * A video layer is already timed this way (`frameState` in src/core/runtime.ts),
 * and this keeps the one clock a person can see for everything they set.
 *
 * Two rules, both so that a span can shorten a layer's time on screen without
 * ever taking it away altogether:
 *
 * - **A layer never outlasts the graphic.** An end past the graphic's length is
 *   the graphic's length, which is also what no end at all means.
 * - **A layer is always on screen for a moment.** A start past the end of the
 *   graphic, or an end at or before the start, would leave a layer that is
 *   never drawn and no way to tell that from a bug. Both are held back to leave
 *   `MIN_ON_SCREEN`, the same reasoning as milestone 23's entrance always
 *   finishing inside the template and milestone 30's least hold. A layer meant
 *   to be gone is hidden, which is a different thing and says so.
 *
 * Pure, and the one place the window is worked out, so the stage, the render
 * and the layer's own bar cannot disagree about when it is there. The bridge
 * script (`BRIDGE_SCRIPT` in src/core/runtime.ts) carries the same arithmetic
 * for template pages, as it does for the layout: **change both or neither.**
 * This copy is the one with unit tests.
 */

/** When a layer comes and goes, in seconds of the graphic as it is watched. */
export interface LayerSpan {
  /** Seconds from the start of the graphic; 0 is the first frame. */
  start: number;
  /** Seconds at which it leaves, or null to stay as long as the graphic does. */
  end: number | null;
}

/** The whole graphic: what a layer that says nothing gets, and what the fields reset to. */
export const DEFAULT_SPAN: LayerSpan = { start: 0, end: null };

/** The least time a span may leave a layer on screen. Shorter than a frame or two is not a span. */
export const MIN_ON_SCREEN = 0.05;

/** This frame's place in the graphic as it is watched; both in seconds of the chosen length. */
export interface WatchedAt {
  elapsed: number;
  length: number;
}

/** True when a span leaves the layer on screen for the whole graphic, as every layer was before this. */
export function isWholeGraphic(span: LayerSpan | undefined): boolean {
  return !span || (span.start <= 0 && span.end === null);
}

/**
 * The window a layer is actually drawn in, held inside the graphic: `from` to
 * `to` in seconds of the chosen length. A span asking for more than the graphic
 * has, or for nothing at all, is brought back to something a person can see.
 */
export function spanWindow(span: LayerSpan | undefined, length: number): { from: number; to: number } {
  const whole = Math.max(0, Number.isFinite(length) ? length : 0);
  if (!span) return { from: 0, to: whole };
  const start = Number.isFinite(span.start) ? Math.max(0, span.start) : 0;
  // Far enough back that there is always a moment left to be seen in.
  const from = Math.min(start, Math.max(0, whole - MIN_ON_SCREEN));
  if (span.end === null || !Number.isFinite(span.end)) return { from, to: whole };
  return { from, to: Math.min(whole, Math.max(span.end, from + MIN_ON_SCREEN)) };
}

/**
 * Whether the layer is on screen at this moment: 1 while it is, 0 before its
 * start and from its end onwards. The end is the moment it has gone, so a layer
 * ending at three seconds is not drawn at three seconds.
 */
export function spanAt(span: LayerSpan | undefined, at: WatchedAt): number {
  if (!span) return 1;
  const { from, to } = spanWindow(span, at.length);
  if (!Number.isFinite(at.elapsed)) return 1;
  return at.elapsed >= from && at.elapsed < to ? 1 : 0;
}

/** Seconds, to the millisecond: a span is shown and stored as a tidy number, as a length is. */
export function roundSeconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * How a layer arrives and how it leaves (milestone 28). `template` is the
 * default and the point of a block: the layer takes the movement of the stack
 * position it is in, so the design stays the author's. The rest are the
 * person's own for this layer, at either end.
 *
 * This takes over milestone 23's entrance-only `motion`, which said the same
 * thing about arriving and nothing at all about leaving; a stored `motion` is
 * read as an entrance and its delay as a start (`readTransitions` in
 * src/core/layers.ts).
 */
export const LAYER_TRANSITIONS = ['template', 'fade', 'slide', 'scale', 'wipe', 'none'] as const;
export type LayerTransitionType = (typeof LAYER_TRANSITIONS)[number];

/**
 * Which edge a slide travels from and a wipe opens from — where the layer
 * comes from, and for the exit where it goes back to, so a layer leaves the
 * way it arrived. `auto` is the way the stack itself goes: up from below in a
 * column, in from the left in a row, which is what milestone 23's slide did.
 */
export const TRANSITION_DIRECTIONS = ['auto', 'top', 'bottom', 'left', 'right'] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

export interface LayerTransition {
  type: LayerTransitionType;
  /** Seconds it takes. Held inside the layer's own time on screen when there is not room for it. */
  seconds: number;
  /** Which edge it travels from; nothing to a fade, a scale or none. */
  direction: TransitionDirection;
}

/** A layer's two ends. Both `template` is what every layer had before this, and what it keeps. */
export interface LayerTransitions {
  in: LayerTransition;
  out: LayerTransition;
}

/** Half a second, the length milestone 23's entrance always took, and the way the stack goes. */
export const DEFAULT_TRANSITION: LayerTransition = { type: 'template', seconds: 0.5, direction: 'auto' };
export const DEFAULT_TRANSITIONS: LayerTransitions = { in: { ...DEFAULT_TRANSITION }, out: { ...DEFAULT_TRANSITION } };

export const TRANSITION_LIMITS = { seconds: { min: 0.05, max: 10 } } as const;

/** How far a slide travels, as a multiple of the layer's own size; the size a scale grows from. */
export const SLIDE_DISTANCE = 1;
export const SCALE_FROM = 0.8;

/** True when neither end is the person's, so the template's own movement stands at both. */
export function isTemplateMovement(t: LayerTransitions | undefined): boolean {
  return !t || (t.in.type === 'template' && t.out.type === 'template');
}

/** The same easing the sample templates move with, so a layer of one's own sits among them. */
export function easeInOutSine(x: number): number {
  return (1 - Math.cos(Math.PI * x)) / 2;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * What a transition is drawn with: the same numbers a template asks for a
 * layer, plus the fraction of it a wipe is showing. Both ends answer in these,
 * and the host multiplies one into the other.
 */
export interface TransitionShape {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  /** How much of the layer is uncovered, and which edge it grows from; absent unless it is a wipe. */
  wipe?: { from: Exclude<TransitionDirection, 'auto'>; shown: number };
}

export interface TransitionContext {
  /** The layer's own size in pixels — a line's type size, a picture's height — which a slide is relative to. */
  distance: number;
  /** The block's stacking direction, which `auto` follows. */
  direction: 'column' | 'row';
}

/**
 * How long each end actually takes. Both are held inside the layer's own time
 * on screen: a two-second entrance on a layer that is there for one second
 * would never finish, and two ends that together ask for more than there is
 * are shortened in proportion rather than one eating the other.
 */
export function transitionSeconds(t: LayerTransitions | undefined, window: { from: number; to: number }): { in: number; out: number } {
  const room = Math.max(0, window.to - window.from);
  const asked = {
    in: t && t.in.type !== 'template' ? Math.max(0, t.in.seconds) : 0,
    out: t && t.out.type !== 'template' ? Math.max(0, t.out.seconds) : 0,
  };
  const total = asked.in + asked.out;
  if (total <= room || total <= 0) return asked;
  const factor = room / total;
  return { in: asked.in * factor, out: asked.out * factor };
}

/** Where a slide starts from, as an offset that eases away to nothing. */
function travel(direction: TransitionDirection, stack: 'column' | 'row', distance: number): { dx: number; dy: number } {
  const from = direction === 'auto' ? (stack === 'column' ? 'bottom' : 'left') : direction;
  if (from === 'top') return { dx: 0, dy: -distance };
  if (from === 'bottom') return { dx: 0, dy: distance };
  if (from === 'left') return { dx: -distance, dy: 0 };
  return { dx: distance, dy: 0 };
}

const FULLY_THERE: TransitionShape = { alpha: 1, dx: 0, dy: 0, scale: 1 };

/**
 * One end's shape at a progress of 0 (not arrived, or gone) to 1 (fully
 * there). The exit runs the same shapes backwards, so a layer leaves the way
 * it came.
 */
export function transitionShape(transition: LayerTransition, progress: number, context: TransitionContext): TransitionShape {
  const p = clamp01(progress);
  if (transition.type === 'template') return FULLY_THERE;
  // No movement at all: the span already says when the layer is there, and it simply is.
  if (transition.type === 'none') return FULLY_THERE;
  const eased = easeInOutSine(p);
  if (transition.type === 'fade') return { alpha: eased, dx: 0, dy: 0, scale: 1 };
  if (transition.type === 'scale') return { alpha: eased, dx: 0, dy: 0, scale: SCALE_FROM + (1 - SCALE_FROM) * eased };
  if (transition.type === 'slide') {
    const { dx, dy } = travel(transition.direction, context.direction, (1 - eased) * SLIDE_DISTANCE * context.distance);
    return { alpha: eased, dx, dy, scale: 1 };
  }
  // A wipe keeps the layer whole and uncovers it: nothing fades, so it reads on any background.
  const from = transition.direction === 'auto' ? (context.direction === 'column' ? 'bottom' : 'left') : transition.direction;
  return { alpha: 1, dx: 0, dy: 0, scale: 1, wipe: { from, shown: eased } };
}

/**
 * What the person's own transitions say about this frame, or null at an end
 * the template still owns. Two shapes rather than one, because the ends are
 * chosen separately: the entrance **replaces** the template's movement for
 * this layer, while the exit is multiplied into whatever was already there.
 */
export function transitionsAt(
  span: LayerSpan | undefined,
  transitions: LayerTransitions | undefined,
  at: WatchedAt,
  context: TransitionContext,
): { entrance: TransitionShape | null; exit: TransitionShape | null } {
  if (isTemplateMovement(transitions) || !transitions) return { entrance: null, exit: null };
  const window = spanWindow(span, at.length);
  const seconds = transitionSeconds(transitions, window);
  const elapsed = Number.isFinite(at.elapsed) ? at.elapsed : window.from;
  const entrance = transitions.in.type === 'template'
    ? null
    : transitionShape(transitions.in, seconds.in <= 0 ? 1 : (elapsed - window.from) / seconds.in, context);
  const exit = transitions.out.type === 'template'
    ? null
    : transitionShape(transitions.out, seconds.out <= 0 ? 1 : (window.to - elapsed) / seconds.out, context);
  return { entrance, exit };
}

/** One shape over another: alphas and scales multiply, offsets add, and the narrower wipe wins. */
export function combineShapes<T extends { alpha: number; dx: number; dy: number; scale: number; wipe?: TransitionShape['wipe'] }>(base: T, over: TransitionShape): T {
  const wipe = base.wipe && over.wipe ? (base.wipe.shown <= over.wipe.shown ? base.wipe : over.wipe) : (base.wipe ?? over.wipe);
  return {
    ...base,
    alpha: base.alpha * over.alpha,
    dx: base.dx + over.dx,
    dy: base.dy + over.dy,
    scale: base.scale * over.scale,
    ...(wipe ? { wipe } : {}),
  };
}
