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
