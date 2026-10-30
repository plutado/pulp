import { describe, expect, it } from 'vitest';
import { buildBrowseTree } from '../src/core/browse-tree';
import { findBrowseNodes, matchRank } from '../src/core/browse-find';
import type { MediaEntry, TemplateEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';

function template(key: string, over: Record<string, unknown> = {}, entry: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = validManifest({ id: `test.${key}`, name: key, ...over });
  const made: TemplateEntry = { kind: 'template', key, id: `id-${key}`, dir: `/lib/${key}`, root: '/lib', manifest, tags: [...manifest.tags], warnings: [], ...entry };
  if (made.manifest.themes) made.themes = [...made.manifest.themes];
  return made;
}
function media(key: string, over: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key, id: `id-${key}`, path: `/media/${key}.mov`, root: '/media', name: key, mediaKind: 'video', ext: '.mov', size: 1, mtimeMs: 0, tags: [], ...over };
}

const tree = buildBrowseTree(
  [
    template('strap', { category: 'lower-third', themes: ['news'], styles: ['clean'] }, { favorite: true }),
    template('holiday-card', { category: 'title', themes: ['holiday'] }),
    media('swipe', { type: 'whoosh', mediaKind: 'audio', themes: ['sports'] }),
  ],
  ['/app/templates', '/lib', '/media'],
  '/app/templates',
);

describe('matchRank', () => {
  it('ranks a start above a word start above a substring, and refuses the rest', () => {
    expect(matchRank('Lower third', 'low')).toBe(0);
    expect(matchRank('Lower third', 'third')).toBe(1);
    expect(matchRank('Lower third', 'lo th')).toBe(1);
    expect(matchRank('Lower third', 'wer')).toBe(2);
    expect(matchRank('Lower third', 'upper')).toBeNull();
    expect(matchRank('Lower third', '  ')).toBeNull();
    expect(matchRank('LOWER THIRD', 'lower t')).toBe(0);
  });
});

describe('findBrowseNodes', () => {
  it('finds categories, types, folders and the Quick access entries, each labelled with where it lives', () => {
    const favorites = findBrowseNodes(tree, 'fav');
    expect(favorites[0]).toMatchObject({ id: 'favorites', label: 'Favorites', place: 'Quick access', count: 1 });
    expect(findBrowseNodes(tree, 'lower')[0]).toMatchObject({ id: 'category:lower-thirds', label: 'Lower thirds', place: 'Categories' });
    expect(findBrowseNodes(tree, 'titles')[0]).toMatchObject({ id: 'category:titles-openers', place: 'Categories' });
    // Themes and styles are the For… and Look chips now (milestone 34), not places in the tree.
    expect(findBrowseNodes(tree, 'holiday')).toEqual([]);
    expect(findBrowseNodes(tree, 'clean')).toEqual([]);
    expect(findBrowseNodes(tree, 'media').map((m) => `${m.id} · ${m.place}`)).toContain('root:/media · My folders');
  });

  it('carries the node\'s own scope, so choosing a match scopes exactly as the tree does', () => {
    const match = findBrowseNodes(tree, 'whoosh')[0]!;
    expect(match.scope).toMatchObject({ filter: 'type:whoosh', kind: 'type' });
  });

  it('gives the path of ancestors, outermost first, so the tree can unfold to the choice', () => {
    const match = findBrowseNodes(tree, 'whoosh')[0]!;
    expect(match.path[0]).toBe('categories');
    expect(match.path.length).toBe(2); // the categories, then the category
    expect(findBrowseNodes(tree, 'fav')[0]!.path).toEqual(['quick']);
  });

  it('puts better answers first and keeps tree order within a rank', () => {
    // "s" starts Sound effects and sits inside others; starts come first, in tree order.
    const labels = findBrowseNodes(tree, 's').map((m) => `${m.label} · ${m.place}`);
    const starts = labels.filter((l) => l.toLowerCase().startsWith('s'));
    expect(labels.slice(0, starts.length)).toEqual(starts);
  });

  it('answers nothing for an empty query, and stops at the limit', () => {
    expect(findBrowseNodes(tree, '')).toEqual([]);
    expect(findBrowseNodes(tree, '   ')).toEqual([]);
    expect(findBrowseNodes(tree, 'e', 2)).toHaveLength(2);
  });

  it('never offers a heading with no scope of its own, but still finds what lives under it', () => {
    // Matching sets is a heading (scope null); its packs are findable.
    for (const m of findBrowseNodes(tree, 'o', 50)) expect(m.scope, m.id).toBeTruthy();
  });
});
