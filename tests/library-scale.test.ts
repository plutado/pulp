/**
 * A library of 100,000 items (milestone 58): indexing, search and scrolling
 * timed against a generated library, with budgets this test holds.
 *
 * The budgets are ceilings for a slow CI runner — what would mean something
 * had gone super-linear, not what a laptop takes. The laptop's numbers are
 * printed on every run (`--silent=false` to see them) and recorded in
 * docs/system-design.md; `tests/library-perf.test.ts` is the same shape at
 * 5,000 items for the quick, everyday run.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibraryStore } from '../src/core/library-store';
import { searchLibrary } from '../src/core/search';
import { createFacetSelector, createResultsSelector, createTreeSelector, initialAppState } from '../src/core/app-state';
import { virtualWindow } from '../src/core/virtual-list';
import { rawManifest } from './fixtures';

const DIRS = 200;
const MEDIA_PER_DIR = 499;
const TEMPLATES = 200;
const ITEMS = DIRS * MEDIA_PER_DIR + TEMPLATES;
const EXTS = ['.mov', '.mp4', '.png', '.wav', '.jpg'];
const THEMES = ['News', 'Sport', 'Wedding', 'Travel', 'Product', 'Interview'];

/** Ceilings a slow runner stays under; the targets are a tenth of these (docs/system-design.md). */
const BUDGET = {
  firstScanMs: 120_000,
  rescanMs: 60_000,
  toIndexMs: 10_000,
  serializeMs: 5_000,
  searchMs: 2_000,
  keystrokeMs: 5_000,
  scrollWindowsMs: 1_000,
} as const;

let dir = '';
let root = '';

async function buildLibrary(): Promise<void> {
  root = join(dir, 'library');
  for (let d = 0; d < DIRS; d++) {
    // Folders named for what they hold, so the folder tags and the inferred themes have something to do.
    const folder = join(root, THEMES[d % THEMES.length]!, `Shoot ${String(d).padStart(3, '0')}`, d % 2 ? 'Footage' : 'Stills');
    await mkdir(folder, { recursive: true });
    const writes: Promise<unknown>[] = [];
    for (let f = 0; f < MEDIA_PER_DIR; f++) writes.push(writeFile(join(folder, `clip-${d}-${f}${EXTS[f % EXTS.length]!}`), Buffer.alloc(8 + (f % 7))));
    await Promise.all(writes);
  }
  for (let t = 0; t < TEMPLATES; t++) {
    const folder = join(root, 'Templates', `tpl-${String(t).padStart(3, '0')}`);
    await mkdir(folder, { recursive: true });
    await Promise.all([
      writeFile(join(folder, 'template.json'), JSON.stringify(rawManifest({ id: `scale.tpl-${t}`, name: `Template ${t}` }))),
      writeFile(join(folder, 'index.html'), '<!doctype html><html><head></head><body></body></html>'),
    ]);
  }
}

const ms = (t: number) => `${t.toFixed(0)} ms`;
const timed = async <T>(work: () => T | Promise<T>): Promise<{ value: T; ms: number }> => {
  const started = performance.now();
  const value = await work();
  return { value, ms: performance.now() - started };
};

describe('a library of 100,000 items (milestone 58)', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-scale-'));
  });

  // A hundred thousand files take a while to remove on Windows: well past the default 10 s.
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }, 180_000);

  it('indexes, searches and scrolls within its budgets', async () => {
    const built = await timed(buildLibrary);
    const store = new LibraryStore(join(dir, 'library.sqlite'));
    try {
      store.setRoots([root]);

      // Indexing: every item visited and loaded from cold, nothing truncated at the file cap, and a
      // rescan that finds nothing changed keeping every row without reading a file.
      const first = await store.scanRoots([root]);
      expect(first).toMatchObject({ visited: ITEMS, loaded: ITEMS, kept: 0 });
      const second = await store.scanRoots([root]);
      expect(second).toMatchObject({ visited: ITEMS, loaded: 0, kept: ITEMS, removed: 0 });
      const index = await timed(() => store.toIndex());
      expect(index.value.media).toHaveLength(DIRS * MEDIA_PER_DIR);
      expect(index.value.templates).toHaveLength(TEMPLATES);
      expect(index.value.problems, 'nothing stopped at the cap or failed to read').toEqual([]);
      // The index crosses to the window as a message: its size is what that costs.
      const serialized = await timed(() => JSON.stringify(index.value).length);

      // Search: a name, a filter, a theme, the empty query that lists everything.
      const searches = {
        name: await timed(() => searchLibrary(index.value, 'clip-12')),
        filter: await timed(() => searchLibrary(index.value, 'type:video duration:<5')),
        theme: await timed(() => searchLibrary(index.value, 'theme:news')),
        everything: await timed(() => searchLibrary(index.value, '')),
      };
      expect(searches.name.value.length).toBeGreaterThan(0);
      expect(searches.everything.value).toHaveLength(ITEMS);

      // A keystroke as the window does it: the results, the facets and the browse tree, each
      // through its own memo, over the whole library.
      const results = createResultsSelector();
      const facets = createFacetSelector();
      const tree = createTreeSelector();
      const state = { ...initialAppState, index: index.value };
      const keystroke = await timed(() => {
        const s = { ...state, query: 'clip' };
        return { results: results(s), facets: facets(s), tree: tree(s) };
      });
      expect(keystroke.value.results.entries.length).toBeGreaterThan(0);
      // And the same keystroke again is the memo answering, not a search.
      const again = await timed(() => results({ ...state, query: 'clip' }));
      expect(again.ms).toBeLessThan(50);

      // Scrolling: the window of cards for two thousand scroll positions down the whole list, six
      // across — arithmetic over the count alone, so the list's length never enters it.
      const total = keystroke.value.results.entries.length;
      const scroll = await timed(() => {
        let rendered = 0;
        for (let i = 0; i < 2000; i++) {
          const win = virtualWindow({ total, columns: 6, rowHeight: 180, viewportHeight: 900, scrollTop: (i / 2000) * (total / 6) * 180 });
          rendered += win.end - win.start;
        }
        return rendered / 2000;
      });
      // Thirty-odd cards a window, however long the list.
      expect(scroll.value).toBeLessThan(60);

      console.info(
        `library scale (${ITEMS} items, ${process.platform} ${process.arch}): build fixture ${ms(built.ms)}; first scan ${ms(first.ms)}; ` +
          `unchanged rescan ${ms(second.ms)}; toIndex ${ms(index.ms)}; serialize ${ms(serialized.ms)} (${(serialized.value / 1e6).toFixed(0)} MB); ` +
          `search name ${ms(searches.name.ms)} (${searches.name.value.length} hits), filter ${ms(searches.filter.ms)}, theme ${ms(searches.theme.ms)} (${searches.theme.value.length} hits), ` +
          `everything ${ms(searches.everything.ms)}; keystroke (results+facets+tree) ${ms(keystroke.ms)}; 2000 scroll windows ${ms(scroll.ms)}; ` +
          `heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`,
      );

      expect(first.ms).toBeLessThan(BUDGET.firstScanMs);
      expect(second.ms).toBeLessThan(BUDGET.rescanMs);
      expect(index.ms).toBeLessThan(BUDGET.toIndexMs);
      expect(serialized.ms).toBeLessThan(BUDGET.serializeMs);
      for (const [name, search] of Object.entries(searches)) expect(search.ms, `search: ${name}`).toBeLessThan(BUDGET.searchMs);
      expect(keystroke.ms).toBeLessThan(BUDGET.keystrokeMs);
      expect(scroll.ms).toBeLessThan(BUDGET.scrollWindowsMs);
    } finally {
      store.close();
    }
  }, 900_000);
});
