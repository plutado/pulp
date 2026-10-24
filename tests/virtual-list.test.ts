import { describe, expect, it } from 'vitest';
import { virtualWindow, type VirtualInput } from '../src/core/virtual-list';

/** A list view: one item per row, 44 px rows, a 440 px viewport, no overscan unless a test asks for it. */
const list = (over: Partial<VirtualInput> = {}): VirtualInput => ({ total: 1000, columns: 1, rowHeight: 44, viewportHeight: 440, scrollTop: 0, overscan: 0, ...over });

describe('virtualWindow', () => {
  it('renders the rows the viewport covers and pads for the rest', () => {
    const top = virtualWindow(list());
    expect(top).toEqual({ start: 0, end: 10, topPad: 0, bottomPad: 990 * 44, rows: 1000, totalHeight: 44_000 });

    // Scrolled by exactly five rows: five rows above are spacer, ten are rendered.
    const scrolled = virtualWindow(list({ scrollTop: 220 }));
    expect(scrolled).toMatchObject({ start: 5, end: 15, topPad: 220, bottomPad: (1000 - 15) * 44 });
    // The spacers and the rendered rows together always measure the whole list.
    expect(scrolled.topPad + (scrolled.end - scrolled.start) * 44 + scrolled.bottomPad).toBe(scrolled.totalHeight);
  });

  it('renders the row a partial scroll straddles', () => {
    const w = virtualWindow(list({ scrollTop: 10 }));
    // Row 0 is still partly visible and row 10 has come into view at the bottom.
    expect(w).toMatchObject({ start: 0, end: 11 });
  });

  it('keeps overscan rows beyond each edge, clamped at the ends', () => {
    expect(virtualWindow(list({ scrollTop: 440, overscan: 2 }))).toMatchObject({ start: 8, end: 22, topPad: 8 * 44 });
    // Nothing to overscan into above the first row.
    expect(virtualWindow(list({ scrollTop: 0, overscan: 2 }))).toMatchObject({ start: 0, end: 12, topPad: 0 });
    // Or below the last.
    expect(virtualWindow(list({ scrollTop: 44_000, overscan: 2 }))).toMatchObject({ start: 988, end: 1000, bottomPad: 0 });
  });

  it('lays a grid out in rows of its column count', () => {
    const w = virtualWindow({ total: 53, columns: 4, rowHeight: 140, viewportHeight: 560, scrollTop: 0, overscan: 0 });
    expect(w).toMatchObject({ start: 0, end: 16, rows: 14, totalHeight: 14 * 140 });
    // The last row is short: the window stops at the last item, not at the column boundary.
    expect(virtualWindow({ total: 53, columns: 4, rowHeight: 140, viewportHeight: 140, scrollTop: 13 * 140, overscan: 0 })).toMatchObject({ start: 52, end: 53, bottomPad: 0 });
  });

  it('survives an unmeasured viewport, a stale scroll position and nonsense input', () => {
    // Before the first layout the height is 0: show the overscan rows rather than nothing.
    expect(virtualWindow(list({ viewportHeight: 0, overscan: 2 }))).toMatchObject({ start: 0, end: 3 });
    // A scroll position left over from a longer list clamps back into range.
    expect(virtualWindow(list({ total: 12, scrollTop: 40_000 }))).toMatchObject({ start: 2, end: 12, bottomPad: 0 });
    // Overscroll bounce.
    expect(virtualWindow(list({ scrollTop: -120 }))).toMatchObject({ start: 0, topPad: 0 });
    expect(virtualWindow(list({ total: 0 }))).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0, rows: 0, totalHeight: 0 });
    expect(virtualWindow(list({ scrollTop: Number.NaN, rowHeight: 0, columns: 0 }))).toMatchObject({ start: 0 });
  });
});
