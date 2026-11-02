/**
 * Roving focus on a group of elements (milestone 8's accessibility pass): one
 * tab stop for the group, and the arrows move between its items.
 *
 * A row of seven filter chips that are seven tab stops is seven presses to get
 * past; the pattern every toolbar, tablist and listbox uses instead is one
 * stop for the group and arrows inside it. The arithmetic — which item a key
 * moves to — is `src/core/roving.ts`, so a row of chips and a grid of cards
 * agree; this is the DOM around it: who holds the tab stop, and moving the
 * focus when a key says so.
 */

import { isRovingKey, rovingTarget, type RovingShape } from '../core/roving';

export interface RovingOptions {
  shape: RovingShape;
  /** The items, found fresh on every key: a group may gain and lose them. */
  items: () => HTMLElement[];
  /** Which item holds the tab stop when focus is elsewhere; the first by default. */
  current?: () => number;
  /** A grid's columns, read when a key arrives rather than kept. */
  columns?: () => number;
}

/** Put the tab stop on one item and take it off the rest, so the group is one stop. */
export function paintRovingStops(items: readonly HTMLElement[], at: number): void {
  const stop = items.length === 0 ? -1 : Math.max(0, Math.min(items.length - 1, at));
  items.forEach((item, i) => {
    item.tabIndex = i === stop ? 0 : -1;
  });
}

/**
 * Wire a group: the arrows move focus between its items, Home and End go to
 * the ends, and the item focus lands on takes the group's tab stop, so coming
 * back to the group by tabbing returns to where it was left.
 */
export function mountRovingGroup(container: HTMLElement, options: RovingOptions): void {
  const refresh = (): void => {
    const items = options.items();
    const focused = items.findIndex((item) => item === document.activeElement);
    paintRovingStops(items, focused === -1 ? (options.current?.() ?? 0) : focused);
  };
  container.addEventListener('keydown', (e) => {
    if (!isRovingKey(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
    const items = options.items();
    const at = items.findIndex((item) => item === document.activeElement);
    const target = rovingTarget(e.key, { count: items.length, index: at, shape: options.shape, columns: options.columns?.() });
    if (target === null) return;
    e.preventDefault();
    items[target]?.focus();
    paintRovingStops(items, target);
  });
  // Focus moving by any means — a click, a tab, a key above — leaves the stop where it landed.
  container.addEventListener('focusin', refresh);
  refresh();
}
