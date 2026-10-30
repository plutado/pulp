/**
 * The browse tree (docs/ui-layout.md, milestones 10, 24 and 34). It opens on
 * what things are: plain categories — Lower thirds, Titles and openers,
 * Matching sets, Animated backgrounds, Overlays and frames, Music — with the
 * taxonomy's types beneath the ones that gather several (src/core/categories.ts).
 * Then Quick access (Favorites, Recently used) and My folders. Themes and
 * styles are not trees here: they are the "For…" and "Look" chips in the
 * search bar, which narrow whatever category is chosen.
 *
 * Every node carries the count of entries it would scope to. Counts come from
 * the entries passed in — the typed query and the chips applied, the scope
 * not — in one pass. Empty categories and types are left out: the tree is a
 * map of what the library has, not of the whole vocabulary. The fixed places —
 * Favorites, Recently used, Untyped, folders — are always there and dim at
 * zero. Pure.
 */

import type { Scope } from './app-state';
import { BROWSE_CATEGORIES, categoryScope, MATCHING_SETS, typeScope } from './categories';
import { rootLabel } from './display';
import type { LibraryEntry } from './library-types';
import { entryType } from './taxonomy';

export interface TreeNode {
  /** Unique within the tree: "category:lower-thirds", "type:wipe", "pack:news", "root:/path", "untyped"… */
  id: string;
  label: string;
  /** Entries this node would scope to. */
  count: number;
  /** Null for a heading that only groups children. */
  scope: Scope | null;
  /** For a group with no scope of its own: what its children are, so the UI need not guess its icon. */
  iconKind?: Scope['kind'];
  /** One line on what lives here, for the tooltip and the results heading. */
  description?: string;
  /** Never folds and draws no heading: the categories are the panel's top level, not a section of it. */
  fixed?: true;
  children: TreeNode[];
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function buildBrowseTree(entries: readonly LibraryEntry[], roots: readonly string[], builtInRoot: string | undefined): TreeNode[] {
  const byType = new Map<string, number>();
  const byRoot = new Map<string, number>();
  const byPack = new Map<string, { name: string; count: number }>();
  let untyped = 0;
  let favorites = 0;
  let recent = 0;

  for (const entry of entries) {
    const type = entryType(entry);
    if (type) bump(byType, type);
    else untyped += 1;
    bump(byRoot, entry.root);
    if (entry.kind === 'template' && entry.pack) {
      const p = byPack.get(entry.pack.slug) ?? { name: entry.pack.name, count: 0 };
      p.count += 1;
      byPack.set(entry.pack.slug, p);
    }
    if (entry.favorite) favorites += 1;
    if (entry.lastUsed) recent += 1;
  }

  // What it is, at the top. A category of one type is the type with the plainer name; one of
  // several opens on the types it gathers; Matching sets opens on the packs.
  const categoryNodes: TreeNode[] = [];
  for (const category of BROWSE_CATEGORIES) {
    if (category.id === MATCHING_SETS) {
      const packs = [...byPack.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
      if (packs.length === 0) continue;
      categoryNodes.push({
        id: `category:${category.id}`,
        label: category.label,
        description: category.description,
        count: packs.reduce((n, [, p]) => n + p.count, 0),
        scope: null,
        iconKind: 'pack',
        children: packs.map(([slug, p]) => ({ id: `pack:${slug}`, label: p.name, count: p.count, scope: { label: p.name, filter: `pack:${slug}`, kind: 'pack' as const }, children: [] })),
      });
      continue;
    }
    const count = category.types.reduce((n, t) => n + (byType.get(t) ?? 0), 0);
    if (count === 0) continue;
    const scope = categoryScope(category);
    const children = category.types.length < 2
      ? []
      : category.types.filter((t) => (byType.get(t) ?? 0) > 0).map((t): TreeNode => ({ id: `type:${t}`, label: typeScope(t).label, count: byType.get(t) ?? 0, scope: typeScope(t), children: [] }));
    categoryNodes.push({ id: `category:${category.id}`, label: category.label, description: category.description, count, scope, children });
  }
  // Always present: the place for what has no type yet, dimmed when nothing is there.
  categoryNodes.push({ id: 'untyped', label: 'Untyped', description: 'Items no folder or manifest has said the type of yet.', count: untyped, scope: { label: 'Untyped', filter: 'type:untyped', kind: 'untyped' }, children: [] });
  const categories: TreeNode = { id: 'categories', label: 'Categories', count: entries.length, scope: null, fixed: true, children: categoryNodes };

  const quick: TreeNode = {
    id: 'quick',
    label: 'Quick access',
    count: entries.length,
    scope: null,
    children: [
      { id: 'favorites', label: 'Favorites', count: favorites, scope: { label: 'Favorites', filter: 'favorite:yes', kind: 'favorites' }, children: [] },
      { id: 'recent', label: 'Recently used', count: recent, scope: { label: 'Recently used', filter: 'recent:yes', kind: 'recent' }, children: [] },
    ],
  };

  const folders: TreeNode = {
    id: 'folders',
    label: 'My folders',
    count: roots.length,
    scope: null,
    children: roots.map((root) => {
      const label = rootLabel(root, builtInRoot);
      return { id: `root:${root}`, label, count: byRoot.get(root) ?? 0, scope: { label, root, kind: root === builtInRoot ? 'built-in' : 'folder' }, children: [] };
    }),
  };

  return [categories, quick, folders];
}
