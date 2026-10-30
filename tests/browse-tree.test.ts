import { describe, expect, it } from 'vitest';
import { buildBrowseTree, type TreeNode } from '../src/core/browse-tree';
import type { MediaEntry, TemplateEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';

function template(key: string, over: Record<string, unknown> = {}, entry: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = validManifest({ id: `test.${key}`, name: key, ...over });
  return { kind: 'template', key, id: `id-${key}`, dir: `/lib/${key}`, root: '/lib', manifest, tags: [...manifest.tags], warnings: [], ...entry };
}
function media(key: string, over: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key, id: `id-${key}`, path: `/media/${key}.mov`, root: '/media', name: key, mediaKind: 'video', ext: '.mov', size: 1, mtimeMs: 0, tags: [], ...over };
}
const find = (nodes: TreeNode[], id: string): TreeNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = find(n.children, id);
    if (hit) return hit;
  }
  return undefined;
};

describe('buildBrowseTree (milestone 34: what things are, at the top)', () => {
  const entries = [
    template('strap', { category: 'lower-third', themes: ['news'], styles: ['clean'] }, { favorite: true }),
    template('wipe', { category: 'transition', type: 'glitch', themes: ['news', 'my-show'], styles: ['grunge', 'clean'] }, { lastUsed: '2026-10-23T00:00:00Z' }),
    template('odd', { category: 'other' }),
    media('swipe', { type: 'whoosh', mediaKind: 'audio', themes: ['sports'] }),
    media('loose'),
  ];
  for (const e of entries) if (e.kind === 'template' && e.manifest.themes) e.themes = [...e.manifest.themes];
  const tree = buildBrowseTree(entries, ['/app/templates', '/lib', '/media'], '/app/templates');

  it('opens on the categories, then Quick access and My folders; no Themes, Styles or Packs trees', () => {
    expect(tree.map((s) => s.id)).toEqual(['categories', 'quick', 'folders']);
    // The categories are the panel's top level: fixed, so they never fold and draw no heading.
    expect(tree[0]?.fixed).toBe(true);
    expect(tree[1]?.label).toBe('Quick access');
    expect(tree[2]?.label).toBe('My folders');
    expect(find(tree, 'favorites')?.count).toBe(1);
    expect(find(tree, 'recent')?.count).toBe(1);
    expect(find(tree, 'folders')?.children.map((n) => [n.label, n.count])).toEqual([['Built-in templates', 0], ['Lib', 3], ['Media', 2]]);
    expect(find(tree, 'root:/media')?.scope).toMatchObject({ root: '/media', kind: 'folder' });
  });

  it('shows only the categories the entries have, in the stock-library order, plus Untyped', () => {
    const categories = find(tree, 'categories')!;
    expect(categories.children.map((n) => n.id)).toEqual(['category:lower-thirds', 'category:transitions-wipes', 'category:sound-effects', 'untyped']);
    // A category of one type is that type with the plainer name: a leaf, scoped exactly as the type.
    expect(find(tree, 'category:lower-thirds')).toMatchObject({ label: 'Lower thirds', count: 1, children: [], scope: { filter: 'type:lower-third', kind: 'category', group: 'lower-thirds' } });
    expect(find(tree, 'category:lower-thirds')?.description).toMatch(/bottom of the frame/);
    // A category of several types scopes to all of them as alternatives and opens on the ones present.
    const transitions = find(tree, 'category:transitions-wipes')!;
    expect(transitions.scope?.filter).toBe('type:wipe type:reveal type:flash type:glitch');
    expect(transitions.children.map((n) => n.id)).toEqual(['type:glitch']);
    expect(find(tree, 'type:glitch')).toMatchObject({ label: 'Glitch', count: 1, scope: { filter: 'type:glitch', kind: 'type', group: 'transitions-wipes' } });
    expect(find(tree, 'type:wipe')).toBeUndefined(); // no entry of that type
    expect(find(tree, 'untyped')).toMatchObject({ label: 'Untyped', count: 2, scope: { filter: 'type:untyped', kind: 'untyped' } }); // "other" template and the loose clip
  });

  it('gathers packs under Matching sets, and leaves it out when there are none', () => {
    const packed = buildBrowseTree(
      [template('a', {}, { pack: { name: 'News Pack', slug: 'news-pack' } }), template('b', {}, { pack: { name: 'News Pack', slug: 'news-pack' } }), template('c', {}, { pack: { name: 'Holiday', slug: 'holiday' } }), media('x')],
      ['/lib', '/media'],
      undefined,
    );
    const sets = find(packed, 'category:matching-sets')!;
    expect(sets).toMatchObject({ label: 'Matching sets', count: 3, scope: null, iconKind: 'pack' });
    expect(sets.children.map((n) => [n.label, n.count])).toEqual([['Holiday', 1], ['News Pack', 2]]);
    expect(find(packed, 'pack:news-pack')?.scope).toEqual({ label: 'News Pack', filter: 'pack:news-pack', kind: 'pack' });
    expect(find(tree, 'category:matching-sets')).toBeUndefined();
  });

  it('keeps Untyped and the fixed sections, dimmed at zero, when the library is bare', () => {
    const bare = buildBrowseTree([media('x')], ['/media'], undefined);
    expect(bare.map((s) => s.id)).toEqual(['categories', 'quick', 'folders']);
    expect(find(bare, 'categories')?.children.map((n) => n.id)).toEqual(['untyped']);
    const empty = buildBrowseTree([], [], undefined);
    expect(find(empty, 'untyped')?.count).toBe(0);
    expect(find(empty, 'favorites')?.count).toBe(0);
  });
});
