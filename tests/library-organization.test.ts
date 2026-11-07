/**
 * The library's own organization (milestone 32): when a stock library comes with an index — names,
 * categories, keywords, thumbnails — Pulp reads it, so the items browse and search the way the
 * collection was organized, mapped onto Pulp's taxonomy rather than only by folder name. Every
 * file here is generated (tests/stock-fixture.ts).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBrowseTree, type TreeNode } from '../src/core/browse-tree';
import { formatRows } from '../src/core/item-info';
import { parseCatalog } from '../src/core/library-catalog';
import { LibraryStore } from '../src/core/library-store';
import type { MediaEntry } from '../src/core/library-types';
import { searchLibrary } from '../src/core/search';
import { CATALOG_MISSING, snapshotTree, writeCatalogFixture, writeStockFixture } from './stock-fixture';

describe('reading the catalog\'s organization', () => {
  it('reads a category as a chain of levels, under the usual column names and separators', () => {
    expect(parseCatalog('Path,Category\na.png,Backgrounds > Fire\n', 'catalog.csv')[0]!.category).toEqual(['Backgrounds', 'Fire']);
    expect(parseCatalog('Path,Folder\na.png,Music/Calm\n', 'catalog.csv')[0]!.category).toEqual(['Music', 'Calm']);
    expect(parseCatalog('Path,Section\na.png,Overlays | Dust\n', 'catalog.csv')[0]!.category).toEqual(['Overlays', 'Dust']);
    expect(parseCatalog('[{"path":"a.png","category":["Backgrounds","Fire"]}]', 'catalog.json')[0]!.category).toEqual(['Backgrounds', 'Fire']);
    expect(parseCatalog('[{"path":"a.png","categories":"Stills"}]', 'catalog.json')[0]!.category).toEqual(['Stills']);
    expect(parseCatalog('Path,Name\na.png,A\n', 'catalog.csv')[0]!.category).toEqual([]);
  });
});

describe('a library organized by its catalog', () => {
  let base = '';
  afterEach(async () => { if (base) await rm(base, { recursive: true, force: true }); base = ''; });

  const setUp = async (format: 'csv' | 'json' = 'csv') => {
    base = await mkdtemp(join(tmpdir(), 'pulp-organized-'));
    const lib = join(base, 'Stock');
    await writeStockFixture(lib);
    await writeCatalogFixture(lib, format);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    return { lib, store };
  };

  for (const format of ['csv', 'json'] as const) {
    it(`gives a file that is here its ${format} catalog name, keywords and category, mapped onto the taxonomy`, async () => {
      const { lib, store } = await setUp(format);
      const before = await snapshotTree(lib);
      const index = store.toIndex();
      // The catalog renames the file; it browses under the collection's own name.
      const soft = index.media.find((m) => m.path === join(lib, 'Sound Effects', 'Whoosh Soft.wav'))!;
      expect(soft.name).toBe('Soft Pass By');
      // Its category and keywords are tags beside the folder's, so search sees all of it...
      expect(soft.tags).toEqual(expect.arrayContaining(['sound-effects', 'whoosh', 'whooshes']));
      expect(soft.category).toEqual(['Whooshes']);
      // ...and the category is mapped onto the taxonomy: "Whooshes" is the whoosh type, which
      // the folder alone ("Sound Effects") never gave.
      expect(soft.type).toBe('whoosh');
      // Found by the collection's name and still by the file's own.
      expect(searchLibrary(index, 'soft pass').map((h) => h.entry.key)).toContain(soft.key);
      expect(searchLibrary(index, 'whoosh soft').map((h) => h.entry.key)).toContain(soft.key);
      // The Info tab says the collection's own category, in its own words.
      expect(formatRows(soft)).toContainEqual(expect.objectContaining({ value: 'Whooshes' }));
      // A missing item carries its category too, hierarchy kept.
      const night = index.media.find((m) => m.name === 'Night Sky (4K)')!;
      expect(night.category).toEqual(['Color Washes', 'Night']);
      expect(night.tags).toEqual(expect.arrayContaining(['color-washes', 'night']));
      expect(formatRows(night)).toContainEqual(expect.objectContaining({ value: 'Color Washes › Night' }));
      // A file the catalog does not name keeps its folder's ways.
      const texture = index.media.find((m) => m.path === join(lib, 'Textures', 'Paper Grain.png'))!;
      expect(texture.name).toBe('Paper Grain');
      expect(texture.category).toBeUndefined();
      // Nothing was written into the library to read any of it.
      expect(await snapshotTree(lib)).toEqual(before);
      store.close();
    });
  }

  it('maps a category onto a type over the folder\'s word, and its words onto the themes', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-organized-'));
    const lib = join(base, 'Stock');
    await writeStockFixture(lib);
    await writeFile(join(lib, 'catalog.csv'), [
      'Path,Keywords,Category',
      'Backgrounds/Blue Wash.png,wedding,Overlays',
    ].join('\r\n') + '\r\n');
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const wash = store.toIndex().media.find((m) => m.name === 'Blue Wash')!;
    // The folder says still background; the collection says overlay, and the collection wins —
    // held to what a still can be, as any folder name is.
    expect(wash.type).toBe('overlay');
    expect(wash.themes).toContain('wedding');
    store.close();
  });

  it('keeps unchanged items across rescans, and reads an item again when its catalog row changes', async () => {
    const { lib, store } = await setUp();
    const again = await store.scanRoots([lib]);
    expect(again.loaded).toBe(0);

    // The collection renames one item: only it and the catalog-timed missing rows are read again.
    const text = (await import('node:fs/promises')).readFile;
    const edited = (await text(join(lib, 'catalog.csv'), 'utf8')).replace('Soft Pass By', 'Gentle Pass By');
    await writeFile(join(lib, 'catalog.csv'), edited);
    const third = await store.scanRoots([lib]);
    expect(third.loaded).toBe(1 + CATALOG_MISSING.length);
    expect(store.toIndex().media.find((m) => m.path === join(lib, 'Sound Effects', 'Whoosh Soft.wav'))!.name).toBe('Gentle Pass By');
    store.close();
  });

  it('browses under the library\'s node by its own sections: the catalog\'s categories, else its folders', async () => {
    const { lib, store } = await setUp();
    const index = store.toIndex();
    const stock = [{ path: lib, name: 'Motion Stock', addedAt: '', online: true, items: index.media.length }];
    const tree = buildBrowseTree(index.media, index.roots, undefined, stock);
    const library = tree.find((n) => n.id === 'stock')!.children.find((n) => n.id === `stock:${lib}`)!;
    const sections = library.children.map((n: TreeNode) => ({ label: n.label, count: n.count }));
    // The collection's own words, sorted: a cataloged item sits in its category, not its folder;
    // a file the catalog does not name keeps its folder as its section.
    expect(sections).toEqual([
      { label: 'Backgrounds', count: 1 }, // Warm Glow, uncataloged
      { label: 'Color Washes', count: 2 }, // Blue Wash, and Night Sky though missing
      { label: 'Sound Effects', count: 1 }, // Impact Low, uncataloged
      { label: 'Textures', count: 1 },
      { label: 'Whooshes', count: 2 },
    ]);
    // A section narrows to the library and its tag, and is not a library itself (no Remove menu).
    const washes = library.children.find((n) => n.label === 'Color Washes')!;
    expect(washes.scope).toMatchObject({ label: 'Color Washes', root: lib, filter: 'tag:color-washes', kind: 'folder' });
    const hits = searchLibrary(index, 'tag:color-washes').filter((h) => h.entry.root === lib && h.entry.kind === 'media');
    expect(hits.map((h) => (h.entry as MediaEntry).name).sort()).toEqual(['Blue Wash', 'Night Sky (4K)']);
    // An ordinary folder of one's own gets no section rows.
    const folders = buildBrowseTree(index.media, index.roots, undefined, []).find((n) => n.id === 'folders')!;
    expect(folders.children.every((n) => n.children.length === 0)).toBe(true);
    store.close();
  });
});
