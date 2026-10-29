import { describe, expect, it } from 'vitest';
import {
  combineShapes, DEFAULT_SPAN, DEFAULT_TRANSITION, isTemplateMovement, isWholeGraphic, MIN_ON_SCREEN, SCALE_FROM,
  SLIDE_DISTANCE, spanAt, spanWindow, transitionSeconds, transitionShape, transitionsAt,
  type LayerSpan, type LayerTransition, type LayerTransitions, type TransitionShape,
} from '../src/core/layer-time';

const span = (over: Partial<LayerSpan> = {}): LayerSpan => ({ ...DEFAULT_SPAN, ...over });

describe('when a layer is on screen (milestone 28)', () => {
  it('is the whole graphic until a layer says otherwise', () => {
    expect(isWholeGraphic(undefined)).toBe(true);
    expect(isWholeGraphic(span())).toBe(true);
    expect(spanWindow(undefined, 6)).toEqual({ from: 0, to: 6 });
    // A layer with no span of its own is on screen at every moment of any length.
    expect(spanAt(undefined, { elapsed: 0, length: 6 })).toBe(1);
    expect(spanAt(undefined, { elapsed: 5.9, length: 6 })).toBe(1);
    expect(isWholeGraphic(span({ start: 2 }))).toBe(false);
    expect(isWholeGraphic(span({ end: 4 }))).toBe(false);
  });

  it('comes at its start and goes at its end, which is the moment it has gone', () => {
    const s = span({ start: 2, end: 4 });
    const at = (elapsed: number) => spanAt(s, { elapsed, length: 6 });
    expect([at(0), at(1.999)]).toEqual([0, 0]);
    expect([at(2), at(3), at(3.999)]).toEqual([1, 1, 1]);
    // Four seconds is when it leaves, so it is not drawn there.
    expect([at(4), at(5.9)]).toEqual([0, 0]);
  });

  it('runs to the end of the graphic when it names no end, whatever the length is', () => {
    const s = span({ start: 1 });
    expect(spanWindow(s, 6)).toEqual({ from: 1, to: 6 });
    // The same stored span against a graphic stretched to twenty: it still runs to the end.
    expect(spanWindow(s, 20)).toEqual({ from: 1, to: 20 });
    expect(spanAt(s, { elapsed: 19.9, length: 20 })).toBe(1);
  });

  it('never outlasts the graphic: an end past it is the end of it', () => {
    expect(spanWindow(span({ start: 1, end: 30 }), 6)).toEqual({ from: 1, to: 6 });
    expect(spanAt(span({ start: 1, end: 30 }), { elapsed: 6, length: 6 })).toBe(0);
  });

  it('always leaves the layer on screen for a moment, so a span can never hide it outright', () => {
    // A start past the end of the graphic is held back to the last moment of it; hiding a layer
    // is a different thing, and says so.
    const late = spanWindow(span({ start: 90 }), 6);
    expect(late).toEqual({ from: 6 - MIN_ON_SCREEN, to: 6 });
    expect(spanAt(span({ start: 90 }), { elapsed: 5.99, length: 6 })).toBe(1);
    // An end at or before the start is pushed out to the least time on screen.
    expect(spanWindow(span({ start: 2, end: 2 }), 6)).toEqual({ from: 2, to: 2 + MIN_ON_SCREEN });
    expect(spanWindow(span({ start: 2, end: 0.5 }), 6)).toEqual({ from: 2, to: 2 + MIN_ON_SCREEN });
  });

  it('holds a graphic shorter than the least time on screen together rather than dividing by it', () => {
    expect(spanWindow(span({ start: 1 }), 0.02)).toEqual({ from: 0, to: 0.02 });
    expect(spanWindow(span({ start: 1, end: 2 }), 0)).toEqual({ from: 0, to: 0 });
    expect(spanAt(span({ start: 1 }), { elapsed: 0, length: 0.02 })).toBe(1);
  });

  it('reads a moment it cannot place as on screen rather than hiding the layer', () => {
    expect(spanAt(span({ start: 1, end: 2 }), { elapsed: Number.NaN, length: 6 })).toBe(1);
    expect(spanWindow(span({ start: Number.NaN, end: 4 }), 6)).toEqual({ from: 0, to: 4 });
    expect(spanWindow(span({ start: 1, end: Number.POSITIVE_INFINITY }), 6)).toEqual({ from: 1, to: 6 });
    expect(spanWindow(span({ start: 1 }), Number.NaN)).toEqual({ from: 0, to: 0 });
  });
});

describe('how a layer arrives and how it leaves (milestone 28)', () => {
  const column = { distance: 100, direction: 'column' as const };
  const ends = (over: Partial<LayerTransitions> = {}): LayerTransitions => ({
    in: { ...DEFAULT_TRANSITION }, out: { ...DEFAULT_TRANSITION }, ...over,
  });
  const t = (over: Partial<LayerTransition> = {}): LayerTransition => ({ ...DEFAULT_TRANSITION, ...over });
  const at = (elapsed: number, length = 6) => ({ elapsed, length });

  it('leaves a layer alone while the template owns both ends', () => {
    expect(isTemplateMovement(undefined)).toBe(true);
    expect(isTemplateMovement(ends())).toBe(true);
    expect(transitionsAt(undefined, ends(), at(1), column)).toEqual({ entrance: null, exit: null });
    // One end of its own is enough to be a transition; the other stays the template's and answers null.
    const fadeIn = ends({ in: t({ type: 'fade' }) });
    expect(isTemplateMovement(fadeIn)).toBe(false);
    expect(transitionsAt(undefined, fadeIn, at(3), column).exit).toBeNull();
  });

  it('fades in over its own seconds from the layer\'s start, and stays in', () => {
    const span = { start: 1, end: null };
    const e = (elapsed: number) => transitionsAt(span, ends({ in: t({ type: 'fade', seconds: 0.5 }) }), at(elapsed), column).entrance!;
    expect(e(0.9).alpha).toBe(0);
    expect(e(1).alpha).toBe(0);
    expect(e(1.25).alpha).toBeCloseTo(0.5, 10); // half way, eased symmetrically
    expect(e(1.5).alpha).toBe(1);
    expect(e(5.9).alpha).toBe(1);
    // A fade moves nothing and scales nothing.
    expect(e(1.25)).toMatchObject({ dx: 0, dy: 0, scale: 1 });
  });

  it('fades out into the layer\'s end, which may be the end of the graphic', () => {
    const e = (elapsed: number) => transitionsAt(undefined, ends({ out: t({ type: 'fade', seconds: 1 }) }), at(elapsed), column).exit!;
    expect(e(1).alpha).toBe(1);
    expect(e(5).alpha).toBe(1);
    expect(e(5.5).alpha).toBeCloseTo(0.5, 10);
    expect(e(6).alpha).toBe(0);
    // With an end of its own it is the end that is faded into, not the graphic's.
    const early = transitionsAt({ start: 0, end: 3 }, ends({ out: t({ type: 'fade', seconds: 1 }) }), at(3), column).exit!;
    expect(early.alpha).toBe(0);
  });

  it('holds both ends inside the layer\'s own time on screen, shortening them in proportion', () => {
    const room = { from: 0, to: 6 };
    expect(transitionSeconds(ends({ in: t({ type: 'fade', seconds: 1 }), out: t({ type: 'fade', seconds: 2 }) }), room)).toEqual({ in: 1, out: 2 });
    // One second of room, three seconds asked for: each gets its share rather than one eating the other.
    const squeezed = transitionSeconds(ends({ in: t({ type: 'fade', seconds: 1 }), out: t({ type: 'fade', seconds: 2 }) }), { from: 0, to: 1 });
    expect(squeezed.in).toBeCloseTo(1 / 3, 10);
    expect(squeezed.out).toBeCloseTo(2 / 3, 10);
    // An end the template still owns asks for nothing, so the other may have all the room.
    expect(transitionSeconds(ends({ in: t({ type: 'fade', seconds: 4 }) }), { from: 0, to: 2 })).toEqual({ in: 2, out: 0 });
  });

  it('slides from an edge, with the stack by default: up from below in a column, in from the left in a row', () => {
    const rising = transitionShape(t({ type: 'slide' }), 0, column);
    expect(rising).toMatchObject({ alpha: 0, dx: 0, scale: 1 });
    expect(rising.dy).toBe(SLIDE_DISTANCE * 100); // a layer's own size below its place
    expect(transitionShape(t({ type: 'slide' }), 1, column).dy).toBe(0);
    const row = transitionShape(t({ type: 'slide' }), 0, { distance: 80, direction: 'row' });
    expect(row).toMatchObject({ dy: 0, scale: 1 });
    expect(row.dx).toBe(-SLIDE_DISTANCE * 80);
    // The travel is the layer's own size, so a bigger line slides further and reads the same.
    expect(transitionShape(t({ type: 'slide' }), 0, { distance: 200, direction: 'column' }).dy).toBe(200);
    // Named edges say where it comes from, whatever the stack does.
    expect(transitionShape(t({ type: 'slide', direction: 'top' }), 0, column).dy).toBe(-100);
    expect(transitionShape(t({ type: 'slide', direction: 'right' }), 0, column).dx).toBe(100);
    expect(transitionShape(t({ type: 'slide', direction: 'left' }), 0, { distance: 100, direction: 'row' }).dx).toBe(-100);
  });

  it('scales up into place, from the same fraction whatever the layer', () => {
    expect(transitionShape(t({ type: 'scale' }), 0, column)).toMatchObject({ alpha: 0, dx: 0, dy: 0, scale: SCALE_FROM });
    expect(transitionShape(t({ type: 'scale' }), 1, column)).toMatchObject({ alpha: 1, scale: 1 });
    expect(transitionShape(t({ type: 'scale' }), 0.5, column).scale).toBeCloseTo(SCALE_FROM + (1 - SCALE_FROM) * 0.5, 10);
  });

  it('wipes without fading, uncovering the layer from an edge', () => {
    const half = transitionShape(t({ type: 'wipe', direction: 'left' }), 0.5, column);
    expect(half).toMatchObject({ alpha: 1, dx: 0, dy: 0, scale: 1 });
    expect(half.wipe!.from).toBe('left');
    expect(half.wipe!.shown).toBeCloseTo(0.5, 10); // eased symmetrically, as every end is
    // With the stack: up from the bottom in a column, in from the left in a row.
    expect(transitionShape(t({ type: 'wipe' }), 0.25, column).wipe!.from).toBe('bottom');
    expect(transitionShape(t({ type: 'wipe' }), 0.25, { distance: 1, direction: 'row' }).wipe!.from).toBe('left');
    expect(transitionShape(t({ type: 'wipe' }), 1, column).wipe!.shown).toBe(1);
  });

  it('none is a layer with no movement at all, which its own start still holds off', () => {
    expect(transitionShape(t({ type: 'none' }), 0, column)).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1 });
    expect(transitionShape(t({ type: 'none' }), 1, column)).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1 });
    // The span is what holds it off now, and it then appears at once rather than easing in.
    const span = { start: 2, end: null };
    const both = ends({ in: t({ type: 'none' }) });
    expect(spanAt(span, at(1.99))).toBe(0);
    expect(transitionsAt(span, both, at(2), column).entrance!.alpha).toBe(1);
  });

  it('puts one end over the other: alphas and scales multiply, offsets add, the narrower wipe wins', () => {
    const base: TransitionShape = { alpha: 0.5, dx: 10, dy: 0, scale: 2 };
    expect(combineShapes(base, { alpha: 0.5, dx: -4, dy: 3, scale: 0.5 })).toEqual({ alpha: 0.25, dx: 6, dy: 3, scale: 1 });
    const wiped = combineShapes({ ...base, wipe: { from: 'left' as const, shown: 0.8 } }, { alpha: 1, dx: 0, dy: 0, scale: 1, wipe: { from: 'top', shown: 0.3 } });
    expect(wiped.wipe).toEqual({ from: 'top', shown: 0.3 });
    // One wipe and one plain end keeps the wipe.
    expect(combineShapes(base, { alpha: 1, dx: 0, dy: 0, scale: 1, wipe: { from: 'right', shown: 0.4 } }).wipe).toEqual({ from: 'right', shown: 0.4 });
  });
});
