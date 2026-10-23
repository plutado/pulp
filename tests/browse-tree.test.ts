import { describe, expect, it } from 'vitest';
import { buildBrowseTree, type TreeNode } from '../src/core/browse-tree';
import type { MediaEntry, TemplateEntry } from '../src/core/library-types';
import type { TemplateManifest } from '../src/core/manifest';
import { rawManifest } from './fixtures';

function template(key: string, over: Record<string, unknown> = {}, entry: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = rawManifest({ id: `test.${key}`, name: key, ...over }) as unknown as TemplateManifest;
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

describe('buildBrowseTree', () => {
  const entries = [
    template('strap', { category: 'lower-third', themes: ['news'], styles: ['clean'] }, { favorite: true }),
    template('wipe', { category: 'transition', type: 'glitch', themes: ['news', 'my-show'], styles: ['grunge', 'clean'] }, { lastUsed: '2026-10-23T00:00:00Z' }),
    template('odd', { category: 'other' }),
    media('swipe', { type: 'whoosh', mediaKind: 'audio', themes: ['sports'] }),
    media('loose'),
  ];
  // Entries carry their merged themes the way the store hands them out.
  for (const e of entries) if (e.kind === 'template' && e.manifest.themes) e.themes = [...e.manifest.themes];
  const tree = buildBrowseTree(entries, ['/app/templates', '/lib', '/media'], '/app/templates');

  it('has the five sections, with Quick access and Folders as fixed entry points', () => {
    expect(tree.map((s) => s.id)).toEqual(['quick', 'types', 'themes', 'styles', 'folders']);
    expect(tree[0]?.label).toBe('Quick access');
    expect(find(tree, 'favorites')?.count).toBe(1);
    expect(find(tree, 'recent')?.count).toBe(1);
    expect(find(tree, 'folders')?.children.map((n) => [n.label, n.count])).toEqual([['Built-in templates', 0], ['Lib', 3], ['Media', 2]]);
    expect(find(tree, 'root:/media')?.scope).toMatchObject({ root: '/media', kind: 'folder' });
  });

  it('shows only the type groups and types the entries have, plus Untyped', () => {
    const types = find(tree, 'types')!;
    expect(types.children.map((n) => n.id)).toEqual(['group:titles', 'group:transitions', 'group:sfx', 'untyped']);
    expect(find(tree, 'group:transitions')).toMatchObject({ count: 1, scope: { filter: 'type:transitions', kind: 'group', group: 'transitions' } });
    expect(find(tree, 'group:transitions')?.children.map((n) => n.id)).toEqual(['type:glitch']);
    expect(find(tree, 'type:lower-third')).toMatchObject({ label: 'Lower third', count: 1, scope: { filter: 'type:lower-third', kind: 'type', group: 'titles' } });
    expect(find(tree, 'type:wipe')).toBeUndefined(); // no entry of that type
    expect(find(tree, 'untyped')).toMatchObject({ label: 'Untyped', count: 2, scope: { filter: 'type:untyped', kind: 'untyped' } }); // "other" template and the loose clip
  });

  it('groups built-in themes and puts custom ones under Custom; styles are templates only', () => {
    const themes = find(tree, 'themes')!;
    expect(themes.children.map((n) => n.id)).toEqual(['themes:media', 'themes:sports', 'themes:custom']);
    expect(find(tree, 'theme:news')).toMatchObject({ label: 'News / broadcast', count: 2, scope: { filter: 'theme:news', kind: 'theme' } });
    expect(find(tree, 'theme:my-show')).toMatchObject({ label: 'My show', count: 1 });
    expect(find(tree, 'styles')?.children.map((n) => [n.id, n.count])).toEqual([['style:clean', 2], ['style:grunge', 1]]);
  });

  it('lists packs the entries came from, and hides the section when there are none', () => {
    const packed = buildBrowseTree(
      [template('a', {}, { pack: { name: 'News Pack', slug: 'news-pack' } }), template('b', {}, { pack: { name: 'News Pack', slug: 'news-pack' } }), template('c', {}, { pack: { name: 'Holiday', slug: 'holiday' } }), media('x')],
      ['/lib', '/media'],
      undefined,
    );
    expect(packed.map((s) => s.id)).toEqual(['quick', 'types', 'packs', 'folders']);
    expect(find(packed, 'packs')?.children.map((n) => [n.label, n.count])).toEqual([['Holiday', 1], ['News Pack', 2]]);
    expect(find(packed, 'pack:news-pack')?.scope).toEqual({ label: 'News Pack', filter: 'pack:news-pack', kind: 'pack' });
    expect(find(tree, 'packs')).toBeUndefined();
  });

  it('drops empty taxonomy sections but keeps Quick access, Untyped and Folders, dimmed at zero', () => {
    const bare = buildBrowseTree([media('x')], ['/media'], undefined);
    expect(bare.map((s) => s.id)).toEqual(['quick', 'types', 'folders']);
    expect(find(bare, 'types')?.children.map((n) => n.id)).toEqual(['untyped']);
    const empty = buildBrowseTree([], [], undefined);
    expect(empty.map((s) => s.id)).toEqual(['quick', 'types', 'folders']);
    expect(find(empty, 'untyped')?.count).toBe(0); // shown, dimmed, like Favorites at zero
    expect(find(empty, 'favorites')?.count).toBe(0);
  });
});
