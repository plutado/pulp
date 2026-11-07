/**
 * Known as well as owned (milestone 32): a stock library's own catalog lists the whole collection;
 * what is on this computer is listed as ever, what is not is listed grayed out and refused for use,
 * and becomes the same item once its file arrives. Every file here is generated.
 */

import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCatalog, parseCsv } from '../src/core/library-catalog';
import { LibraryStore } from '../src/core/library-store';
import { searchLibrary, searchMedia } from '../src/core/search';
import { entryBadges } from '../src/core/results-view';
import { buildBrowseTree } from '../src/core/browse-tree';
import { CATALOG_MISSING, snapshotTree, STOCK_FIXTURE_FILES, writeCatalogFixture, writeStockFixture } from './stock-fixture';

describe('reading a catalog', () => {
  it('reads CSV with quotes, any column order and the usual column names', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
    expect(parseCatalog('Title,File,Tags\n"Night, Sky",Backgrounds\\Night.png,night;stars\n', 'catalog.csv'))
      .toEqual([{ path: 'Backgrounds/Night.png', name: 'Night, Sky', keywords: ['night', 'stars'] }]);
  });

  it('reads JSON as an array or as items, keywords as a list or a string', () => {
    expect(parseCatalog('[{"path":"a.png","keywords":"x, y"}]', 'catalog.json')).toEqual([{ path: 'a.png', keywords: ['x', 'y'] }]);
    expect(parseCatalog('{"items":[{"file":"b.wav","title":"B","tags":["z"]}]}', 'catalog.json')).toEqual([{ path: 'b.wav', name: 'B', keywords: ['z'] }]);
  });

  it('leaves out a path that would leave the library, and a file with no path column', () => {
    expect(parseCatalog('path\n../outside.png\n/abs.png\nC:/x.png\nok/fine.png\n', 'catalog.csv').map((r) => r.path)).toEqual(['ok/fine.png']);
    expect(parseCatalog('name,keywords\nA,b\n', 'catalog.csv')).toEqual([]);
  });
});

describe('a library with its own catalog', () => {
  let base = '';
  afterEach(async () => { if (base) await rm(base, { recursive: true, force: true }); base = ''; });

  for (const format of ['csv', 'json'] as const) {
    it(`lists everything its ${format} catalog names: what is here as ever, what is not as missing`, async () => {
      base = await mkdtemp(join(tmpdir(), 'pulp-catalog-'));
      const lib = join(base, 'Stock');
      await writeStockFixture(lib);
      await writeCatalogFixture(lib, format);
      const before = await snapshotTree(lib);
      const store = new LibraryStore(':memory:');
      store.setRoots([lib]);
      await store.scanRoots([lib]);
      const index = store.toIndex();
      // Every file on disk, plus the two the catalog names that are not.
      expect(index.media).toHaveLength(STOCK_FIXTURE_FILES.length + CATALOG_MISSING.length);
      const missing = index.media.filter((m) => m.missing);
      expect(missing.map((m) => m.path).sort()).toEqual(CATALOG_MISSING.map((p) => join(lib, ...p.split('/'))).sort());
      const night = missing.find((m) => m.name === 'Night Sky (4K)')!;
      // Named and tagged by the catalog, typed by its folder, refused for use as an offline item is.
      expect(night.tags).toEqual(expect.arrayContaining(['backgrounds', 'night', 'stars']));
      expect(night.offline).toBe(true);
      expect(entryBadges(night).map((b) => b.id)).toContain('missing');
      // Searchable as part of the collection, but never offered to place.
      expect(searchLibrary(index, 'stars').map((h) => h.entry.key)).toEqual([night.key]);
      expect(searchMedia(index, { query: 'night' })).toEqual([]);
      // Files that are here are not marked, and were not made missing by being in the catalog.
      expect(index.media.filter((m) => !m.missing).every((m) => !m.offline)).toBe(true);
      // Never probed or thumbnailed: there is nothing to read.
      expect(store.pendingMetadata(100).some((m) => m.missing)).toBe(false);
      expect(store.pendingThumbnails(100).some((m) => (m as { missing?: true }).missing)).toBe(false);
      // Nothing written into the library to know it.
      expect(await snapshotTree(lib)).toEqual(before);
      store.close();
    });
  }

  it('says on the library how much of it is missing, and makes a missing file the same item once it arrives', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-catalog-'));
    const lib = join(base, 'Stock');
    await writeStockFixture(lib);
    await writeCatalogFixture(lib);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const night = store.toIndex().media.find((m) => m.name === 'Night Sky (4K)')!;
    store.setUserData(night.key, { favorite: true });

    const tree = buildBrowseTree(store.toIndex().media, store.toIndex().roots, undefined, [{ path: lib, name: 'Stock', addedAt: '', online: true, items: 7, missing: 2 }]);
    expect(tree.find((n) => n.id === 'stock')!.children[0]!.description).toContain('Of its 7 items, 2 are listed by its catalog but not on this computer.');

    // The file is downloaded where the catalog said.
    await copyFile(join(lib, 'Backgrounds', 'Blue Wash.png'), night.path);
    await store.scanRoots([lib]);
    const back = store.toIndex().media.find((m) => m.key === night.key)!;
    expect(back.missing).toBeUndefined();
    expect(back.offline).toBeUndefined();
    expect(back.favorite, 'what was said about it kept').toBe(true);
    expect(store.toIndex().media.filter((m) => m.path === night.path), 'one item, not two').toHaveLength(1);
    expect(store.toIndex().media.filter((m) => m.missing)).toHaveLength(1);
    store.close();
  });
});
