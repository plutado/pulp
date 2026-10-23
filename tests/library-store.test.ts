import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryStore } from '../src/core/library-store';
import { rawManifest } from './fixtures';

let dir: string;
let store: LibraryStore;

async function writeTemplate(where: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await mkdir(where, { recursive: true });
  await writeFile(join(where, 'template.json'), JSON.stringify(rawManifest(overrides)));
  await writeFile(join(where, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
}

async function touch(path: string, bytes = 4): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, Buffer.alloc(bytes));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pulp-store-'));
  store = new LibraryStore(':memory:');
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('LibraryStore incremental scans', () => {
  it('loads everything once, then keeps unchanged items without re-reading them', async () => {
    const root = join(dir, 'lib');
    await writeTemplate(join(root, 'Titles', 'basic'));
    await touch(join(root, 'Stock', 'a.mov'));
    await touch(join(root, 'Stock', 'b.mov'));
    store.setRoots([root]);
    const first = await store.scanRoots([root]);
    expect(first).toMatchObject({ roots: 1, visited: 3, loaded: 3, kept: 0, removed: 0 });
    expect(store.itemCount()).toBe(3);

    const second = await store.scanRoots([root]);
    expect(second).toMatchObject({ visited: 3, loaded: 0, kept: 3, removed: 0 });
    expect(store.toIndex().media.map((m) => m.name)).toEqual(['a', 'b']);
  });

  it('reloads only what changed, adds new files and removes deleted ones', async () => {
    const root = join(dir, 'lib');
    await writeTemplate(join(root, 'tpl'), { name: 'Before' });
    await touch(join(root, 'a.mov'), 10);
    await touch(join(root, 'b.mov'), 10);
    store.setRoots([root]);
    await store.scanRoots([root]);

    await sleep(20); // make the mtime move even on coarse filesystems
    await touch(join(root, 'a.mov'), 20); // changed size
    await touch(join(root, 'c.mov')); // new
    await rm(join(root, 'b.mov')); // gone
    await writeFile(join(root, 'tpl', 'template.json'), JSON.stringify(rawManifest({ name: 'After' })));

    const stats = await store.scanRoots([root]);
    expect(stats).toMatchObject({ loaded: 3, kept: 0, removed: 1 });
    const index = store.toIndex();
    expect(index.templates[0]?.manifest.name).toBe('After');
    expect(index.media.map((m) => [m.name, m.size])).toEqual([
      ['a', 20],
      ['c', 4],
    ]);
  });

  it('turns a template whose entry file disappeared into a problem', async () => {
    const root = join(dir, 'lib');
    await writeTemplate(join(root, 'tpl'));
    store.setRoots([root]);
    await store.scanRoots([root]);
    await rm(join(root, 'tpl', 'index.html'));
    const stats = await store.scanRoots([root]);
    expect(stats.loaded).toBe(1);
    const index = store.toIndex();
    expect(index.templates).toEqual([]);
    expect(index.problems.map((p) => p.message)).toEqual(['entry file "index.html" does not exist']);
  });

  it('marks a missing root offline and keeps its items and user data until it returns', async () => {
    const root = join(dir, 'lib');
    await writeTemplate(join(root, 'tpl'));
    await touch(join(root, 'clip.mov'));
    store.setRoots([root]);
    await store.scanRoots([root]);
    const clipKey = store.toIndex().media[0]!.key;
    store.setUserData(clipKey, { tags: ['keeper'], favorite: true });

    await rename(root, join(dir, 'unplugged'));
    await store.scanRoots([root]);
    let index = store.toIndex();
    expect(store.roots()).toEqual([{ path: root, online: false, missingReason: 'library root does not exist' }]);
    expect(index.problems).toEqual([{ path: root, message: 'library root does not exist' }]);
    expect(index.templates[0]?.offline).toBe(true);
    expect(index.media[0]?.offline).toBe(true);
    expect(store.getUserData(clipKey)).toEqual({ tags: ['keeper'], favorite: true });

    await rename(join(dir, 'unplugged'), root);
    const stats = await store.scanRoots([root]);
    expect(stats).toMatchObject({ kept: 2, loaded: 0, removed: 0 });
    index = store.toIndex();
    expect(store.roots()[0]?.online).toBe(true);
    expect(index.problems).toEqual([]);
    expect(index.media[0]?.offline).toBeUndefined();
    expect(store.getUserData(clipKey).favorite).toBe(true);
  });

  it('drops roots that are no longer configured, with their items, but keeps user data', async () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    await touch(join(a, 'x.mov'));
    await touch(join(b, 'y.mov'));
    store.setRoots([a, b]);
    await store.scanRoots([a, b]);
    const yKey = store.toIndex().media.find((m) => m.name === 'y')!.key;
    store.setUserData(yKey, { favorite: true });
    store.setRoots([a]);
    expect(store.toIndex().media.map((m) => m.name)).toEqual(['x']);
    expect(store.getUserData(yKey).favorite).toBe(true);
  });

  it('persists across close and reopen', async () => {
    const root = join(dir, 'lib');
    await writeTemplate(join(root, 'tpl'));
    await touch(join(root, 'clip.mov'));
    const file = join(dir, 'library.sqlite');
    const first = new LibraryStore(file);
    first.setRoots([root]);
    await first.scanRoots([root]);
    first.close();

    const second = new LibraryStore(file);
    try {
      const index = second.toIndex();
      expect(index.templates).toHaveLength(1);
      expect(index.media).toHaveLength(1);
      expect(index.roots).toEqual([root]);
      const stats = await second.scanRoots([root]);
      expect(stats).toMatchObject({ kept: 2, loaded: 0 });
    } finally {
      second.close();
    }
  });
});
