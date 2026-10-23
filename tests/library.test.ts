import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderTags, mediaKindForPath, normalizeTag, scanLibrary } from '../src/core/library';
import { compare, parseComparison, parseQuery, searchLibrary, tagCounts } from '../src/core/search';
import { rawManifest } from './fixtures';

let root: string;

async function writeTemplate(dir: string, overrides: Record<string, unknown> = {}, withEntry = true): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'template.json'), JSON.stringify(rawManifest(overrides)));
  if (withEntry) await writeFile(join(dir, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
}

async function touch(path: string, bytes = 4): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, Buffer.alloc(bytes));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulp-lib-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('helpers', () => {
  it('normalizeTag', () => {
    expect(normalizeTag('  Lower Thirds ')).toBe('lower-thirds');
    expect(normalizeTag('B_Roll / Drone!')).toBe('b-roll-drone');
    expect(normalizeTag('4K')).toBe('4k');
  });

  it('folderTags uses the folders between root and item', () => {
    expect(folderTags('/lib', join('/lib', 'Stock', 'City Night'))).toEqual(['stock', 'city-night']);
    expect(folderTags('/lib', '/lib')).toEqual([]);
    expect(folderTags('/lib', '/elsewhere')).toEqual([]);
  });

  it('mediaKindForPath', () => {
    expect(mediaKindForPath('a/clip.MOV')).toBe('video');
    expect(mediaKindForPath('still.tif')).toBe('image');
    expect(mediaKindForPath('vo.wav')).toBe('audio');
    expect(mediaKindForPath('notes.txt')).toBeNull();
  });
});

describe('scanLibrary', () => {
  it('indexes templates and media with folder tags', async () => {
    await writeTemplate(join(root, 'Titles', 'basic'));
    await touch(join(root, 'Stock', 'City Night', 'skyline.mov'), 100);
    await touch(join(root, 'Stock', 'still.png'));
    await touch(join(root, 'Audio', 'hit.wav'));
    await touch(join(root, 'readme.txt'));

    const index = await scanLibrary([root]);
    expect(index.problems).toEqual([]);
    expect(index.templates).toHaveLength(1);
    expect(index.templates[0]?.manifest.id).toBe('test.basic-title');
    expect(index.templates[0]?.tags).toEqual(['title', 'minimal', 'titles']);

    const byName = Object.fromEntries(index.media.map((m) => [m.name, m]));
    expect(Object.keys(byName).sort()).toEqual(['hit', 'skyline', 'still']);
    expect(byName.skyline).toMatchObject({ mediaKind: 'video', ext: '.mov', size: 100, tags: ['stock', 'city-night'] });
    expect(byName.hit?.mediaKind).toBe('audio');
  });

  it('does not index files inside a template folder as media', async () => {
    await writeTemplate(join(root, 'tpl'));
    await touch(join(root, 'tpl', 'assets', 'logo.png'));
    const index = await scanLibrary([root]);
    expect(index.media).toEqual([]);
  });

  it('reports invalid manifests and missing entry files without throwing', async () => {
    await writeTemplate(join(root, 'bad'), { fps: -1 });
    await writeTemplate(join(root, 'noentry'), { id: 'test.no-entry' }, false);
    await mkdir(join(root, 'broken'));
    await writeFile(join(root, 'broken', 'template.json'), '{ not json');

    const index = await scanLibrary([root]);
    expect(index.templates).toEqual([]);
    const messages = index.problems.map((p) => p.message);
    expect(messages).toContain('invalid template manifest');
    expect(messages).toContain('entry file "index.html" does not exist');
    expect(index.problems.find((p) => p.path.includes('bad'))?.issues?.[0]?.path).toBe('fps');
  });

  it('keeps the first template when ids collide', async () => {
    await writeTemplate(join(root, 'a'));
    await writeTemplate(join(root, 'b'));
    const index = await scanLibrary([root]);
    expect(index.templates).toHaveLength(1);
    expect(index.templates[0]?.dir).toBe(join(root, 'a'));
    expect(index.problems[0]?.message).toMatch(/duplicate template id/);
  });

  it('reports missing roots and scans the rest', async () => {
    await touch(join(root, 'clip.mp4'));
    const index = await scanLibrary([join(root, 'missing'), root]);
    expect(index.problems).toEqual([{ path: join(root, 'missing'), message: 'library root does not exist' }]);
    expect(index.media).toHaveLength(1);
  });

  it('skips hidden files, node_modules and symlinks', async () => {
    await touch(join(root, '.cache', 'x.mov'));
    await touch(join(root, '.hidden.mov'));
    await touch(join(root, 'node_modules', 'pkg', 'demo.mp4'));
    await touch(join(root, 'real', 'clip.mov'));
    await symlink(join(root, 'real'), join(root, 'link'));
    const index = await scanLibrary([root]);
    expect(index.media.map((m) => m.path)).toEqual([join(root, 'real', 'clip.mov')]);
  });

  it('respects maxDepth and maxFiles', async () => {
    await touch(join(root, 'a', 'b', 'c', 'deep.mov'));
    await touch(join(root, 'top.mov'));
    expect((await scanLibrary([root], { maxDepth: 1 })).media.map((m) => m.name)).toEqual(['top']);

    for (let i = 0; i < 5; i++) await touch(join(root, `f${i}.wav`));
    const limited = await scanLibrary([root], { maxFiles: 3 });
    expect(limited.media).toHaveLength(3);
    expect(limited.problems.filter((p) => p.message.startsWith('stopped after'))).toHaveLength(1);
  });

  it('deduplicates roots', async () => {
    await touch(join(root, 'x.mov'));
    const index = await scanLibrary([root, root + '/']);
    expect(index.roots).toHaveLength(1);
    expect(index.media).toHaveLength(1);
  });
});

describe('searchLibrary', () => {
  async function buildIndex() {
    await writeTemplate(join(root, 'Titles', 'basic'));
    await writeTemplate(join(root, 'News', 'lt'), {
      id: 'test.news-lower-third',
      name: 'News Lower Third',
      category: 'lower-third',
      tags: ['news', 'broadcast'],
      description: 'Breaking news strap',
    });
    await touch(join(root, 'News', 'Footage', 'anchor desk.mov'));
    await touch(join(root, 'Music', 'news theme.wav'));
    return scanLibrary([root]);
  }

  it('returns everything, sorted by name, for an empty query', async () => {
    const index = await buildIndex();
    const names = searchLibrary(index, '').map((h) => (h.entry.kind === 'template' ? h.entry.manifest.name : h.entry.name));
    expect(names).toEqual(['anchor desk', 'Basic Title', 'News Lower Third', 'news theme']);
  });

  it('requires all free-text terms to match', async () => {
    const index = await buildIndex();
    expect(searchLibrary(index, 'news lower').map((h) => h.entry.key)).toEqual([index.templates[1]?.key]);
    expect(searchLibrary(index, 'news zebra')).toEqual([]);
  });

  it('ranks exact names and tags above substring matches', async () => {
    const index = await buildIndex();
    const hits = searchLibrary(index, 'news');
    expect(hits[0]?.entry.kind).toBe('template');
    expect(hits).toHaveLength(3);
  });

  it('filters by tag, type and category', async () => {
    const index = await buildIndex();
    expect(searchLibrary(index, 'tag:footage').map((h) => h.entry.kind)).toEqual(['media']);
    expect(searchLibrary(index, 'type:template')).toHaveLength(2);
    expect(searchLibrary(index, 'type:audio')).toHaveLength(1);
    expect(searchLibrary(index, 'type:media news')).toHaveLength(2);
    expect(searchLibrary(index, 'category:lower-third')).toHaveLength(1);
    expect(searchLibrary(index, 'tag:"Lower Thirds"')).toEqual([]);
  });

  it('matches quoted phrases', async () => {
    const index = await buildIndex();
    expect(searchLibrary(index, '"anchor desk"')).toHaveLength(1);
    expect(searchLibrary(index, '"desk anchor"')).toHaveLength(0);
  });

  it('counts tags', async () => {
    const index = await buildIndex();
    const counts = tagCounts(index);
    expect(counts[0]).toEqual({ tag: 'news', count: 2 });
  });

  it('filters by duration, size, frame rate, resolution, codec and alpha', async () => {
    const index = await buildIndex();
    // Templates answer from their manifests (2 s, 1920x1080, 30 fps, alpha); media from probed metadata.
    const anchor = index.media.find((m) => m.name === 'anchor desk')!;
    anchor.meta = { duration: 12.5, width: 3840, height: 2160, fps: 29.97, codec: 'prores', alpha: true };
    const theme = index.media.find((m) => m.name === 'news theme')!;
    theme.meta = { duration: 90, audioCodec: 'pcm_s16le', channels: 2, sampleRate: 48000 };
    const names = (q: string) => searchLibrary(index, q).map((h) => (h.entry.kind === 'template' ? h.entry.manifest.name : h.entry.name)).sort();

    expect(names('duration:>5')).toEqual(['anchor desk', 'news theme']);
    expect(names('duration:<=2')).toEqual(['Basic Title', 'News Lower Third']);
    expect(names('duration:10-20')).toEqual(['anchor desk']);
    expect(names('width:>=1920')).toEqual(['Basic Title', 'News Lower Third', 'anchor desk']);
    expect(names('height:2160')).toEqual(['anchor desk']);
    expect(names('fps:29.97')).toEqual(['anchor desk']);
    expect(names('res:1080p')).toEqual(['Basic Title', 'News Lower Third']);
    expect(names('res:4k')).toEqual(['anchor desk']);
    expect(names('res:2160')).toEqual(['anchor desk']);
    expect(names('codec:prores')).toEqual(['anchor desk']);
    expect(names('codec:PRORES type:video')).toEqual(['anchor desk']);
    expect(names('alpha:yes')).toEqual(['Basic Title', 'News Lower Third', 'anchor desk']);
    expect(names('alpha:no')).toEqual([]); // the audio file has no picture, so it neither has nor lacks alpha
    expect(names('news duration:>60')).toEqual(['news theme']);
    // Media without metadata does not match a metadata filter, and the codec is searchable as text.
    anchor.meta = undefined;
    expect(names('codec:prores')).toEqual([]);
    theme.meta = undefined;
    expect(names('duration:>5')).toEqual([]);
  });

  it('parses comparisons and leaves odd values as plain terms', () => {
    expect(parseComparison('>=1920')).toEqual({ op: '>=', value: 1920 });
    expect(parseComparison('5-10')).toEqual({ op: 'range', value: 5, to: 10 });
    expect(parseComparison('29.97')).toEqual({ op: '=', value: 29.97 });
    expect(parseComparison('long')).toBeNull();
    expect(compare(10, { op: 'range', value: 5, to: 10 })).toBe(true);
    expect(compare(undefined, { op: '>', value: 0 })).toBe(false);
    const q = parseQuery('duration:long res:HD alpha:No codec:H264');
    expect(q.terms).toEqual(['duration:long']);
    expect(q.resolutions).toEqual(['720p']);
    expect(q.alpha).toBe(false);
    expect(q.codecs).toEqual(['h264']);
  });
});
