/**
 * Scan and rescan timing on a synthetic library of thousands of tiny files.
 * The numbers are printed; the assertions are loose ceilings so a slow CI
 * runner does not fail the build. Targets (an Apple M3 Max) are recorded in
 * docs/system-design.md.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibraryStore } from '../src/core/library-store';
import { rawManifest } from './fixtures';

const DIRS = 50;
const MEDIA_PER_DIR = 100;
const TEMPLATES = 100;
const EXTS = ['.mov', '.mp4', '.png', '.wav', '.jpg'];

let dir = '';
let root = '';

async function buildSyntheticLibrary(): Promise<number> {
  root = join(dir, 'library');
  const writes: Promise<unknown>[] = [];
  for (let d = 0; d < DIRS; d++) {
    const folder = join(root, `Set ${String(d).padStart(2, '0')}`, d % 2 ? 'Footage' : 'Stills');
    await mkdir(folder, { recursive: true });
    for (let f = 0; f < MEDIA_PER_DIR; f++) {
      writes.push(writeFile(join(folder, `clip-${d}-${f}${EXTS[f % EXTS.length]!}`), Buffer.alloc(8 + (f % 7))));
    }
  }
  for (let t = 0; t < TEMPLATES; t++) {
    const folder = join(root, 'Templates', `tpl-${String(t).padStart(3, '0')}`);
    await mkdir(folder, { recursive: true });
    writes.push(writeFile(join(folder, 'template.json'), JSON.stringify(rawManifest({ id: `perf.tpl-${t}`, name: `Template ${t}` }))));
    writes.push(writeFile(join(folder, 'index.html'), '<!doctype html><html><head></head><body></body></html>'));
  }
  await Promise.all(writes);
  return DIRS * MEDIA_PER_DIR + TEMPLATES;
}

const ms = (t: number) => `${t.toFixed(0)} ms`;

describe('library scan performance', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-perf-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  it('scans thousands of items quickly and rescans unchanged ones faster', async () => {
    const t0 = performance.now();
    const items = await buildSyntheticLibrary();
    const built = performance.now() - t0;

    const store = new LibraryStore(join(dir, 'library.sqlite'));
    try {
      store.setRoots([root]);
      const first = await store.scanRoots([root]);
      expect(first).toMatchObject({ visited: items, loaded: items, kept: 0 });

      const second = await store.scanRoots([root]);
      expect(second).toMatchObject({ visited: items, loaded: 0, kept: items, removed: 0 });

      // Touch 10 files and add 10 more.
      await new Promise((r) => setTimeout(r, 20));
      for (let f = 0; f < 10; f++) await writeFile(join(root, 'Set 00', 'Stills', `clip-0-${f}${EXTS[f % EXTS.length]!}`), Buffer.alloc(100));
      for (let f = 0; f < 10; f++) await writeFile(join(root, 'Set 01', 'Footage', `new-${f}.mov`), Buffer.alloc(8));
      const third = await store.scanRoots([root]);
      expect(third).toMatchObject({ loaded: 20, kept: items - 10, removed: 0 });

      const t1 = performance.now();
      const index = store.toIndex();
      const toIndex = performance.now() - t1;
      expect(index.media).toHaveLength(DIRS * MEDIA_PER_DIR + 10);
      expect(index.templates).toHaveLength(TEMPLATES);

      console.info(
        `library perf (${items} items, ${process.platform} ${process.arch}): build fixture ${ms(built)}; ` +
          `first scan ${ms(first.ms)}; unchanged rescan ${ms(second.ms)}; 20-file change ${ms(third.ms)}; toIndex ${ms(toIndex)}`,
      );

      // Ceilings for CI; the targets in the docs are far lower.
      expect(first.ms).toBeLessThan(15_000);
      expect(second.ms).toBeLessThan(5_000);
      expect(third.ms).toBeLessThan(5_000);
      expect(toIndex).toBeLessThan(2_000);
    } finally {
      store.close();
    }
  }, 120_000);
});
