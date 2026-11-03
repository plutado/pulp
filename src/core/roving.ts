/**
 * Roving keyboard focus (milestone 8's accessibility pass): which item an
 * arrow key moves to, in a row of controls, a list, or a grid.
 *
 * Four regions share this arithmetic — the inspector's tabs, the filter chips,
 * the results grid and the tray's cards — so Left in a row of chips and Up in
 * a grid of cards behave the same way everywhere, and the behavior is pinned
 * by tests rather than by four hand-written key handlers.
 *
 * The shapes follow the ARIA practices each region is built on: a **row** of
 * controls (a tablist, a toolbar) moves on Left and Right and wraps round,
 * since a row has two ends and nothing beyond them; a **list** moves on Up and
 * Down and does not wrap, since running off the end of a long list by holding
 * a key is a surprise; a **grid** moves one item on Left and Right and one row
 * on Up and Down, and pages by whole screens. Home and End go to the ends in
 * every shape.
 *
 * Pure: the caller focuses whatever index comes back, and `null` means the key
 * was not one of ours and belongs to whoever else is listening.
 */

export type RovingShape = 'row' | 'list' | 'grid';

export interface RovingInput {
  /** Items to move between. Nothing to do when there are none. */
  count: number;
  /** Where focus is now; -1 when it is nowhere yet, so the first key lands on an end. */
  index: number;
  shape: RovingShape;
  /** Items per row; a grid needs it, the other shapes ignore it. */
  columns?: number;
  /** Rows a page key moves, in a grid. Default 1 screen is the caller's business; this is rows. */
  page?: number;
}

/** The keys this answers for; anything else comes back null. */
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function isRovingKey(key: string): boolean {
  return KEYS.has(key);
}

/**
 * Where a key moves focus, or null when the key means nothing in this shape —
 * Up in a row of chips, Left in a list — so the caller leaves it alone.
 */
export function rovingTarget(key: string, input: RovingInput): number | null {
  const count = Math.max(0, Math.floor(input.count));
  if (count === 0 || !isRovingKey(key)) return null;
  const last = count - 1;
  const columns = Math.max(1, Math.floor(input.columns ?? 1));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  // Nowhere yet: Home, End and the first step land on an end rather than on nothing.
  const at = input.index >= 0 && input.index <= last ? Math.floor(input.index) : -1;
  const clamp = (i: number): number => Math.max(0, Math.min(last, i));

  if (key === 'Home') return 0;
  if (key === 'End') return last;

  if (input.shape === 'row') {
    // A row wraps: its two ends are next to each other, and there is nothing past them.
    if (key === 'ArrowRight') return at === -1 ? 0 : (at + 1) % count;
    if (key === 'ArrowLeft') return at === -1 ? last : (at - 1 + count) % count;
    return null;
  }

  if (input.shape === 'list') {
    if (key === 'ArrowDown') return at === -1 ? 0 : clamp(at + 1);
    if (key === 'ArrowUp') return at === -1 ? last : clamp(at - 1);
    return null;
  }

  // A grid: one item across, one row down, a page of rows at a time.
  if (key === 'ArrowRight') return at === -1 ? 0 : clamp(at + 1);
  if (key === 'ArrowLeft') return at === -1 ? last : clamp(at - 1);
  if (at === -1) return key === 'ArrowDown' || key === 'PageDown' ? 0 : last;
  if (key === 'ArrowDown') {
    // The last row is short: a step down from above it lands on its last item rather than nowhere.
    return at + columns > last && at !== last && Math.floor(at / columns) < Math.floor(last / columns) ? last : clamp(at + columns);
  }
  if (key === 'ArrowUp') return at - columns < 0 ? at : at - columns;
  if (key === 'PageDown') return clamp(at + columns * page);
  if (key === 'PageUp') return clamp(at - columns * page);
  return null;
}
