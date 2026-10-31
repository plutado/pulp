/**
 * One search wherever you search (milestone 40): the choosers and the stage's
 * asset list ask the library through `searchMedia`, which is `searchLibrary`
 * over media of a kind — so the query language and the ranking of the search
 * bar hold in a chooser too.
 */

import { describe, expect, it } from 'vitest';
import type { LibraryIndex, MediaEntry } from '../src/core/library-types';
import { PICKER_LIMIT, searchLibrary, searchMedia } from '../src/core/search';

function media(name: string, over: Partial<MediaEntry> = {}): MediaEntry {
  return {
    kind: 'media', key: `k-${name}`, id: `id-${name}`, path: `/lib/${name}`, root: '/lib',
    name, mediaKind: 'image', ext: '.png', size: 10, mtimeMs: 1, tags: [], ...over,
  };
}

const index = (...items: MediaEntry[]): LibraryIndex => ({
  roots: ['/lib'], templates: [], media: items, problems: [], builtAt: '2026-10-31T00:00:00Z',
});

const names = (found: MediaEntry[]) => found.map((m) => m.name);

describe('what a chooser may offer', () => {
  it('offers the kinds asked for and nothing else', () => {
    const lib = index(media('still'), media('clip', { mediaKind: 'video', ext: '.mp4' }), media('sound', { mediaKind: 'audio', ext: '.wav' }));
    expect(names(searchMedia(lib, { kinds: ['image'] }))).toEqual(['still']);
    expect(names(searchMedia(lib, { kinds: ['video'] }))).toEqual(['clip']);
    expect(names(searchMedia(lib, { kinds: ['image', 'video'] }))).toEqual(['clip', 'still']);
    // No kinds named is every kind.
    expect(names(searchMedia(lib, {}))).toEqual(['clip', 'sound', 'still']);
  });

  it('never offers an item whose folder is offline, since it could not be loaded', () => {
    const lib = index(media('here'), media('gone', { offline: true }));
    expect(names(searchMedia(lib, { kinds: ['image'] }))).toEqual(['here']);
  });

  it('narrows and never widens: no query can reach a kind the chooser does not take', () => {
    // The kinds and the offline check are applied to what is searched, not asked of the query, so
    // nothing typed can offer a clip where only a still may be chosen, or an item that is away.
    const lib = index(
      media('still'),
      media('clip', { mediaKind: 'video' }),
      media('sound', { mediaKind: 'audio' }),
      media('away', { offline: true }),
    );
    for (const query of ['', 'type:video', 'type:media', 'type:audio', 'type:video type:image', 'clip', 'sound', 'away', 'recent:yes']) {
      const offered = names(searchMedia(lib, { kinds: ['image'], query }));
      expect(offered.every((n) => n === 'still'), `"${query}" offered ${offered.join(', ') || 'nothing'}`).toBe(true);
    }
  });

  it('offers nothing at all before the library has been read', () => {
    expect(searchMedia(null, { kinds: ['image'] })).toEqual([]);
    expect(searchMedia(undefined)).toEqual([]);
  });

  it('holds to a limit, and hands back everything without one', () => {
    const lib = index(...Array.from({ length: 80 }, (_, i) => media(`still-${String(i).padStart(2, '0')}`)));
    expect(searchMedia(lib, { kinds: ['image'], limit: PICKER_LIMIT })).toHaveLength(PICKER_LIMIT);
    expect(searchMedia(lib, { kinds: ['image'] })).toHaveLength(80);
    expect(searchMedia(lib, { kinds: ['image'], limit: 3 })).toHaveLength(3);
  });
});

describe('the query language a person already knows', () => {
  const lib = index(
    media('logo', { tags: ['brand'] }),
    media('logo-wide', { tags: ['brand', 'wide'] }),
    media('crest', { tags: ['brand'] }),
    media('plate', { mediaKind: 'video', ext: '.mov', tags: ['overlay'], meta: { width: 1920, height: 1080, duration: 3, fps: 25, alpha: true, codec: 'prores' } }),
    media('bars', { mediaKind: 'video', ext: '.mp4', tags: ['test'], meta: { width: 1280, height: 720, duration: 12, fps: 25, alpha: false, codec: 'h264' } }),
  );

  it('narrows a chooser by tag, as the search bar narrows the results', () => {
    expect(names(searchMedia(lib, { kinds: ['image'], query: 'tag:brand' }))).toEqual(['crest', 'logo', 'logo-wide']);
    expect(names(searchMedia(lib, { kinds: ['image'], query: 'tag:wide' }))).toEqual(['logo-wide']);
  });

  it('narrows by what was probed: alpha, duration, size, codec', () => {
    expect(names(searchMedia(lib, { kinds: ['video'], query: 'alpha:yes' }))).toEqual(['plate']);
    expect(names(searchMedia(lib, { kinds: ['video'], query: 'alpha:no' }))).toEqual(['bars']);
    expect(names(searchMedia(lib, { kinds: ['video'], query: 'duration:>5' }))).toEqual(['bars']);
    expect(names(searchMedia(lib, { kinds: ['video'], query: 'codec:prores' }))).toEqual(['plate']);
    expect(names(searchMedia(lib, { kinds: ['video'], query: 'width:>=1920' }))).toEqual(['plate']);
    // These are exactly what the old chooser could not do: it read them as words to find.
    expect(names(searchMedia(lib, { kinds: ['video'], query: 'alpha:yes duration:>5' }))).toEqual([]);
  });

  it('ranks as the search bar ranks: the name itself, then a tag, then a word that starts with it', () => {
    // "logo" is one item's whole name, a word starting another's, and a tag of a third.
    expect(names(searchMedia(lib, { kinds: ['image'], query: 'logo' }))).toEqual(['logo', 'logo-wide']);
    expect(names(searchMedia(lib, { kinds: ['image'], query: 'brand' }))).toEqual(['crest', 'logo', 'logo-wide']);
  });

  it('is the same answer the search bar gives for the same library and query', () => {
    // The guarantee the merge is for: a chooser is the library search, narrowed to what fits here.
    for (const query of ['', 'logo', 'tag:brand', 'alpha:yes', 'duration:>5', 'nothing-matches-this']) {
      const bar = searchLibrary(lib, query).map((h) => h.entry).filter((e) => e.kind === 'media' && e.mediaKind === 'video').map((e) => (e as MediaEntry).name);
      expect(names(searchMedia(lib, { kinds: ['video'], query })), query).toEqual(bar);
    }
  });
});

describe('most recently used first', () => {
  const lib = index(
    media('alpha'),
    media('beta', { lastUsed: '2026-10-30T10:00:00Z' }),
    media('gamma', { lastUsed: '2026-10-31T10:00:00Z' }),
  );

  it('puts what was reached for last at the top, and what was never used after it', () => {
    expect(names(searchMedia(lib, { kinds: ['image'], recentFirst: true }))).toEqual(['gamma', 'beta', 'alpha']);
    // Without it, the library's own order: best match, then by name.
    expect(names(searchMedia(lib, { kinds: ['image'] }))).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('keeps the query\'s own ranking among items used equally long ago', () => {
    const tied = index(media('zebra'), media('apple'), media('mango', { lastUsed: '2026-10-31T10:00:00Z' }));
    // mango first for being used; the other two keep the search's order, which is by name.
    expect(names(searchMedia(tied, { kinds: ['image'], recentFirst: true }))).toEqual(['mango', 'apple', 'zebra']);
  });

  it('narrows before it orders, so a query still decides what is there', () => {
    expect(names(searchMedia(lib, { kinds: ['image'], query: 'beta', recentFirst: true }))).toEqual(['beta']);
  });
});
