/**
 * Windowing math for the results region: which items a scroll position puts in
 * view, and how tall the spacers above and below them have to be so the
 * scrollbar still measures the whole list. Pure, so the grid and the list share
 * one implementation and the DOM test can check it against scroll positions
 * without a browser.
 *
 * Rows pitch exactly `rowHeight` apart — cards carry their own padding instead
 * of a CSS gap (src/core/results-view.ts) — so a row's top is `row * rowHeight`
 * and no measurement of a rendered element is needed.
 */

export interface VirtualInput {
  /** Items in the list. */
  total: number;
  /** Items per row: the grid's column count, 1 in list view. */
  columns: number;
  /** Distance from one row's top to the next, in px. */
  rowHeight: number;
  /** Height of the scrolling viewport in px. */
  viewportHeight: number;
  scrollTop: number;
  /** Rows kept rendered beyond each edge, so a small scroll has something to show. */
  overscan?: number;
}

export interface VirtualWindow {
  /** The items to render: `start` up to but not including `end`. */
  start: number;
  end: number;
  /** Spacer heights above and below the rendered rows, in px. */
  topPad: number;
  bottomPad: number;
  /** Rows the whole list has, and the height it scrolls over. */
  rows: number;
  totalHeight: number;
}

export const DEFAULT_OVERSCAN = 2;

function whole(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

/**
 * The window for one scroll position. A viewport that has not been measured yet
 * (height 0, before the first layout) still renders the overscan rows, so the
 * region shows something rather than going blank if a measurement never arrives.
 */
export function virtualWindow(input: VirtualInput): VirtualWindow {
  const total = Math.max(0, whole(input.total, 0));
  const columns = Math.max(1, whole(input.columns, 1));
  const rowHeight = Number.isFinite(input.rowHeight) && input.rowHeight > 0 ? input.rowHeight : 1;
  const rows = Math.ceil(total / columns);
  const totalHeight = rows * rowHeight;
  if (total === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0, rows: 0, totalHeight: 0 };

  const overscan = Math.max(0, whole(input.overscan ?? DEFAULT_OVERSCAN, DEFAULT_OVERSCAN));
  const viewportHeight = Number.isFinite(input.viewportHeight) && input.viewportHeight > 0 ? input.viewportHeight : 0;
  // Overscroll bounce and a stale scroll position after the list shrank both land outside the range.
  const scrollTop = Math.min(Math.max(Number.isFinite(input.scrollTop) ? input.scrollTop : 0, 0), Math.max(0, totalHeight - viewportHeight));

  const firstVisible = Math.min(rows - 1, Math.floor(scrollTop / rowHeight));
  const lastVisible = Math.max(firstVisible, Math.ceil((scrollTop + viewportHeight) / rowHeight) - 1);
  const firstRow = Math.max(0, firstVisible - overscan);
  const lastRow = Math.min(rows - 1, lastVisible + overscan);

  return {
    start: firstRow * columns,
    end: Math.min(total, (lastRow + 1) * columns),
    topPad: firstRow * rowHeight,
    bottomPad: (rows - 1 - lastRow) * rowHeight,
    rows,
    totalHeight,
  };
}
