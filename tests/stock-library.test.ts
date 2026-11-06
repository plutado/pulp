/**
 * Stock libraries (milestone 32): a folder or a drive of owned stock media, read where it lies and
 * never copied, that stays listed while its drive is not connected and comes back when it is.
 * Every file here is generated (tests/stock-fixture.ts).
 */

import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryStore } from '../src/core/library-store';
import { buildBrowseTree, type TreeNode } from '../src/core/browse-tree';
import { setCurrentLocale, SOURCE_LOCALE } from '../src/core/i18n';
import { canAddLibrary, defaultLibraryName, driveOf, sanitizeStockLibraries, type StockLibraryState } from '../src/core/stock-library';
import { searchLibrary } from '../src/core/search';
import { snapshotTree, STOCK_FIXTURE_FILES, writeStockFixture } from './stock-fixture';

describe('where a stock library lives', () => {
  it('knows a removable drive by the platform\'s conventions, and the system disk as no drive', () => {
    expect(driveOf('/Volumes/Stock 2019/Motion')).toEqual({ name: 'Stock 2019', root: '/Volumes/Stock 2019' });
    expect(driveOf('/media/alex/STOCK/clips')).toEqual({ name: 'STOCK', root: '/media/alex/STOCK' });
    expect(driveOf('/run/media/alex/STOCK')).toEqual({ name: 'STOCK', root: '/run/media/alex/STOCK' });
    expect(driveOf('E:\\Stock\\Backgrounds')).toEqual({ name: 'E:', root: 'E:\\' });
    expect(driveOf('C:\\Users\\alex\\Stock')).toBeUndefined();
    expect(driveOf('/Users/alex/Stock')).toBeUndefined();
  });

  it('is named after its folder, or its drive when it is the drive\'s root', () => {
    expect(defaultLibraryName('/Volumes/Stock 2019/Motion Pack')).toBe('Motion Pack');
    expect(defaultLibraryName('/Volumes/Stock 2019/')).toBe('Stock 2019');
    expect(defaultLibraryName('E:\\')).toBe('E:');
  });

  it('refuses one already added, one inside or around another, and Pulp\'s own folders', () => {
    const existing = [{ path: '/Volumes/Stock/Motion', name: 'Motion', addedAt: '' }];
    const own = ['/Users/alex/Library/Application Support/Pulp'];
    expect(canAddLibrary('/Volumes/Stock/Sounds', existing, own)).toEqual({ ok: true });
    expect(canAddLibrary('/Volumes/Stock/Motion/', existing, own)).toEqual({ ok: false, why: 'already' });
    expect(canAddLibrary('/Volumes/Stock/Motion/Backgrounds', existing, own)).toEqual({ ok: false, why: 'inside' });
    expect(canAddLibrary('/Volumes/Stock', existing, own)).toEqual({ ok: false, why: 'contains' });
    expect(canAddLibrary('/Users/alex/Library/Application Support/Pulp/thumbnails', existing, own)).toEqual({ ok: false, why: 'own' });
  });

  it('reads back from settings only what is well formed, each library once', () => {
    expect(sanitizeStockLibraries([{ path: '/a' }, { path: '/a', name: 'again' }, { name: 'no path' }, 'junk', { path: '/b', name: ' Bee ', addedAt: 'x' }]))
      .toEqual([{ path: '/a', name: 'a', addedAt: '' }, { path: '/b', name: 'Bee', addedAt: 'x' }]);
    expect(sanitizeStockLibraries(undefined)).toEqual([]);
  });
});

describe('a stock library in the library', () => {
  let base = '';
  afterEach(async () => {
    setCurrentLocale(SOURCE_LOCALE);
    if (base) await rm(base, { recursive: true, force: true });
  });

  const stockNode = (tree: TreeNode[], path: string) => tree.find((n) => n.id === 'stock')?.children.find((n) => n.id === `stock:${path}`);
  const state = (store: LibraryStore, path: string, drive?: string): StockLibraryState => {
    const root = store.roots().find((r) => r.path === path)!;
    return { path, name: 'Motion Stock', addedAt: '', online: root.online, items: STOCK_FIXTURE_FILES.length, ...(drive ? { drive } : {}) };
  };

  it('is read where it lies: every item points into it, and not one byte of it changes', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-stock-'));
    const library = join(base, 'Motion Stock');
    await writeStockFixture(library);
    const before = await snapshotTree(library);

    const store = new LibraryStore(':memory:');
    store.setRoots([library]);
    await store.scanRoots([library]);
    const index = store.toIndex();

    expect(index.media.map((m) => m.path).sort()).toEqual(STOCK_FIXTURE_FILES.map((f) => join(library, f)).sort());
    for (const m of index.media) expect(m.root).toBe(library);
    // Its own folders become its tags, so the collection browses the way it was organized.
    expect(index.media.find((m) => m.name.startsWith('Whoosh'))!.tags).toContain('sound-effects');
    // Nothing added, changed, moved or touched: no sidecar, no cache, no copy.
    expect(await snapshotTree(library)).toEqual(before);
    store.close();
  });

  it('stays listed while its drive is not connected, says so plainly, and comes back when it is', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-stock-'));
    const library = join(base, 'Motion Stock');
    const unplugged = join(base, 'elsewhere');
    await writeStockFixture(library);
    const store = new LibraryStore(':memory:');
    store.setRoots([library]);
    await store.scanRoots([library]);
    const whoosh = store.toIndex().media.find((m) => m.name.startsWith('Whoosh'))!;
    store.setUserData(whoosh.key, { favorite: true });

    // The drive is ejected: the folder is gone from where it was.
    await rename(library, unplugged);
    await store.scanRoots([library]);
    const away = store.toIndex();
    expect(away.media).toHaveLength(STOCK_FIXTURE_FILES.length);
    expect(away.media.every((m) => m.offline === true), 'every item listed, offline').toBe(true);
    // Still found by a search, as an offline item.
    expect(searchLibrary(away, 'whoosh').map((h) => h.entry.key)).toContain(whoosh.key);

    const tree = buildBrowseTree(away.media, away.roots, undefined, [state(store, library, 'Stock 2019')]);
    const node = stockNode(tree, library)!;
    expect(node.offline).toBe(true);
    expect(node.count).toBe(STOCK_FIXTURE_FILES.length);
    expect(node.description).toBe(`The drive “Stock 2019” is not connected. Connect it to use this library; its ${STOCK_FIXTURE_FILES.length} items stay listed meanwhile.`);
    // A library that is not on a removable drive says where its folder was.
    expect(stockNode(buildBrowseTree(away.media, away.roots, undefined, [state(store, library)]), library)!.description).toContain(library);
    // And not among My folders as well.
    expect(tree.find((n) => n.id === 'folders')!.children.map((c) => c.id)).not.toContain(`root:${library}`);

    // In German too.
    setCurrentLocale('de');
    expect(node.description).toContain('ist nicht verbunden');
    setCurrentLocale(SOURCE_LOCALE);

    // Plugged back in: everything is back, the favorite kept, nothing in it changed.
    await rename(unplugged, library);
    const before = await snapshotTree(library);
    await store.scanRoots([library]);
    const back = store.toIndex();
    expect(back.media.some((m) => m.offline)).toBe(false);
    expect(back.media.find((m) => m.key === whoosh.key)!.favorite).toBe(true);
    const again = stockNode(buildBrowseTree(back.media, back.roots, undefined, [state(store, library, 'Stock 2019')]), library)!;
    expect(again.offline).toBeUndefined();
    expect(again.description).toContain('never copies');
    expect(await snapshotTree(library)).toEqual(before);
    store.close();
  });
});
