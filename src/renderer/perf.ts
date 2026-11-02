/**
 * What the window knows about its own speed (milestone 58): how long a
 * keystroke's search takes over the whole library, how long the results'
 * window for a scroll position takes, and how long an arriving index takes to
 * land in the state. Each is recorded where it is done — the store's
 * selectors, the results component, the library load — and read here by Copy
 * diagnostics, which puts them in its Performance section (src/core/perf.ts).
 */

import { TimingRecord, type WindowPerformance } from '../core/perf';

/** A keystroke: the results, the facets and the tree, which are what the window recomputes as you type. */
export const searchTiming = new TimingRecord();
/** A scroll: the window of cards to render for a position. */
export const windowTiming = new TimingRecord();
/** An index arriving: from the main process's message to the state holding it. */
export const receiveTiming = new TimingRecord();

/** Chromium's own figure for the page's heap, where it offers one; null where it does not. */
function rendererHeapMB(): number | null {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return memory && typeof memory.usedJSHeapSize === 'number' ? memory.usedJSHeapSize / 1_000_000 : null;
}

export function windowPerformance(): WindowPerformance {
  return {
    searchMs: searchTiming.value(),
    windowMs: windowTiming.value(),
    receiveMs: receiveTiming.value(),
    rendererHeapMB: rendererHeapMB(),
  };
}
