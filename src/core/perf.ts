/**
 * What Copy diagnostics says about speed (milestone 58): how big the library
 * is, how long the last scan and the index took, how long a keystroke's
 * search and a scroll's window take in the window, and what the processes
 * weigh. The facts are gathered by the main process and the window
 * (src/main/library-service.ts, src/renderer/perf.ts); this is the shape they
 * share and the lines they become, which is the part a test can hold.
 *
 * Measured against a generated library of 100,000 items in
 * tests/library-scale.test.ts, which is where the budgets live; the numbers
 * recorded there are in docs/system-design.md.
 */

/** The last, the worst and how many of a repeated thing: a keystroke's search, a scroll's window. */
export interface Timing {
  last: number;
  max: number;
  count: number;
}

/** A running record of one repeated timing, kept by whoever does the thing. */
export class TimingRecord {
  private timing: Timing | null = null;

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const rounded = Math.round(ms * 100) / 100;
    this.timing = this.timing
      ? { last: rounded, max: Math.max(this.timing.max, rounded), count: this.timing.count + 1 }
      : { last: rounded, max: rounded, count: 1 };
  }

  value(): Timing | null {
    return this.timing;
  }
}

export interface ScanTiming {
  visited: number;
  loaded: number;
  kept: number;
  removed: number;
  ms: number;
}

/** One of Electron's processes and what it holds in memory. */
export interface ProcessMemory {
  /** Electron's own word for it: Browser, Tab, GPU, Utility … */
  type: string;
  workingSetMB: number;
}

/** What the main process knows about speed and weight. */
export interface MainPerformance {
  library: { templates: number; media: number; problems: number };
  lastScan: ScanTiming | null;
  /** Building the index the window is handed, and how many bytes it is as sent. */
  indexMs: number;
  indexBytes: number;
  memory: { mainHeapMB: number; processes: ProcessMemory[] };
  uptimeSeconds: number;
}

/** What the window knows: what a keystroke, a scroll and an arriving index cost it. */
export interface WindowPerformance {
  /** A keystroke's results, facets and tree over the whole library. */
  searchMs: Timing | null;
  /** The results' window for a scroll position: which cards to render. */
  windowMs: Timing | null;
  /** An index arriving from the main process and landing in the state. */
  receiveMs: Timing | null;
  rendererHeapMB: number | null;
}

const ms = (value: number): string => `${Math.round(value)} ms`;
const mb = (value: number): string => `${Math.round(value)} MB`;
const timing = (t: Timing | null): string => (t ? `last ${ms(t.last)}, worst ${ms(t.max)} over ${t.count}` : 'not yet');

/**
 * The Performance section's lines, in the order someone reading a bug report
 * wants them: how much there is, how long it took to know, how the window
 * feels, what it all weighs.
 */
export function performanceLines(main: MainPerformance, window: WindowPerformance): string[] {
  const items = main.library.templates + main.library.media;
  const scan = main.lastScan
    ? `${ms(main.lastScan.ms)} (${main.lastScan.visited} visited, ${main.lastScan.loaded} loaded, ${main.lastScan.kept} kept, ${main.lastScan.removed} removed)`
    : 'none this session';
  const processes = main.memory.processes.length > 0
    ? main.memory.processes.map((p) => `${p.type} ${mb(p.workingSetMB)}`).join(', ')
    : 'unknown';
  return [
    `Library size: ${items} items (${main.library.templates} templates, ${main.library.media} media, ${main.library.problems} problems)`,
    `Last scan: ${scan}`,
    `Index: built in ${ms(main.indexMs)}, ${mb(main.indexBytes / 1_000_000)} as sent to the window`,
    `Search per keystroke: ${timing(window.searchMs)}`,
    `Results window per scroll: ${timing(window.windowMs)}`,
    `Index received by the window: ${timing(window.receiveMs)}`,
    `Memory: main heap ${mb(main.memory.mainHeapMB)}, window heap ${window.rendererHeapMB === null ? 'unknown' : mb(window.rendererHeapMB)}; processes: ${processes}`,
    `Up for: ${Math.round(main.uptimeSeconds)} s`,
  ];
}
