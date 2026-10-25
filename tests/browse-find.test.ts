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
  it('finds nodes across every taxonomy, each labelled with the section it lives in', () => {
    const favorites = findBrowseNodes(tree, 'fav');
    expect(favorites[0]).toMatchObject({ id: 'favorites', label: 'Favorites', place: 'Quick access', count: 1 });
    expect(findBrowseNodes(tree, 'lower')[0]).toMatchObject({ id: 'type:lower-third', label: 'Lower third', place: 'Types' });
    expect(findBrowseNodes(tree, 'holiday')[0]).toMatchObject({ place: 'Themes' });
    expect(findBrowseNodes(tree, 'clean')[0]).toMatchObject({ id: 'style:clean', place: 'Styles' });
    // "media" is also a theme group's label, which ranks equal and sits earlier in the tree; the folder is still found.
    expect(findBrowseNodes(tree, 'media').map((m) => `${m.id} · ${m.place}`)).toContain('root:/media · Folders');
  });

  it('carries the node\'s own scope, so choosing a match scopes exactly as the tree does', () => {
    const match = findBrowseNodes(tree, 'whoosh')[0]!;
    expect(match.scope).toMatchObject({ filter: 'type:whoosh', kind: 'type' });
  });

  it('gives the path of ancestors, outermost first, so the tree can unfold to the choice', () => {
    const match = findBrowseNodes(tree, 'whoosh')[0]!;
    expect(match.path[0]).toBe('types');
    expect(match.path.length).toBe(2); // the section, then the type group
    expect(findBrowseNodes(tree, 'fav')[0]!.path).toEqual(['quick']);
  });

  it('puts better answers first and keeps tree order within a rank', () => {
    // "s" starts Sports (theme) and the Styles' entries, and sits inside others; starts come first, in tree order.
    const labels = findBrowseNodes(tree, 's').map((m) => `${m.label} · ${m.place}`);
    const starts = labels.filter((l) => l.toLowerCase().startsWith('s'));
    expect(labels.slice(0, starts.length)).toEqual(starts);
  });

  it('answers nothing for an empty query, and stops at the limit', () => {
    expect(findBrowseNodes(tree, '')).toEqual([]);
    expect(findBrowseNodes(tree, '   ')).toEqual([]);
    expect(findBrowseNodes(tree, 'e', 3)).toHaveLength(3);
  });

  it('never offers a heading with no scope of its own, but still finds what lives under it', () => {
    // "Custom" is a heading (scope null); its child themes are findable.
    for (const m of findBrowseNodes(tree, 'o', 50)) expect(m.scope, m.id).toBeTruthy();
  });
});
