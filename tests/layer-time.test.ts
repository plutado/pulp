import { describe, expect, it } from 'vitest';
import { DEFAULT_SPAN, isWholeGraphic, MIN_ON_SCREEN, spanAt, spanWindow, type LayerSpan } from '../src/core/layer-time';

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
