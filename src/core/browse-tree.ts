/**
 * The browse tree (docs/ui-layout.md, milestones 10, 24 and 34). It opens on
 * what things are: plain categories — Lower thirds, Titles and openers,
 * Matching sets, Animated backgrounds, Overlays and frames, Music — with the
 * taxonomy's types beneath the ones that gather several (src/core/categories.ts).
 * Then Quick access (Favorites, Recently used, Made for vertical) and My folders. Themes and
 * styles are not trees here: they are the "For…" and "Look" chips in the
 * search bar, which narrow whatever category is chosen.
 *
 * Every node carries the count of entries it would scope to. Counts come from
 * the entries passed in — the typed query and the chips applied, the scope
 * not — in one pass. Empty categories and types are left out: the tree is a
 * map of what the library has, not of the whole vocabulary. The fixed places —
 * Favorites, Recently used, Untyped, folders — are always there and dim at
 * zero. Pure.
 *
 * A node's label and description, and its scope's label, are getters reading the
 * message catalog (milestone 59): the tree is rebuilt only when what it counts
 * changes, so a change of language must reach it when it is drawn, not built.
 */

import { samePlace, type StockLibraryState } from './stock-library';
import type { Scope } from './app-state';
import { BROWSE_CATEGORIES, categoryScope, MATCHING_SETS, typeScope } from './categories';
import { rootLabel, typeLabel } from './display';
import { tr } from './i18n';
import type { LibraryEntry } from './library-types';
import { entryType } from './taxonomy';
import { MADE_FOR_VERTICAL_TAG } from './vertical-layout';

export interface TreeNode {
  /** Unique within the tree: "category:lower-thirds", "type:wipe", "pack:news", "root:/path", "untyped"… */
  id: string;
  readonly label: string;
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
  /** A stock library that cannot be reached now (milestone 32): listed, and saying so on the row. */
  offline?: true;
  children: TreeNode[];
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function buildBrowseTree(entries: readonly LibraryEntry[], roots: readonly string[], builtInRoot: string | undefined, stock: readonly StockLibraryState[] = []): TreeNode[] {
  const byType = new Map<string, number>();
  const byRoot = new Map<string, number>();
  const byPack = new Map<string, { name: string; count: number }>();
  let untyped = 0;
  let favorites = 0;
  let recent = 0;
  let vertical = 0;

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
    if (entry.kind === 'template' && entry.manifest.tags?.includes(MADE_FOR_VERTICAL_TAG)) vertical += 1;
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
        get label() { return category.label; },
        get description() { return category.description; },
        count: packs.reduce((n, [, p]) => n + p.count, 0),
        // Selectable itself (milestone 34's card test): everything from any set, `pack:any`.
        scope: categoryScope(category),
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
      : category.types.filter((t) => (byType.get(t) ?? 0) > 0).map((t): TreeNode => ({ id: `type:${t}`, get label() { return typeLabel(t); }, count: byType.get(t) ?? 0, scope: typeScope(t), children: [] }));
    categoryNodes.push({ id: `category:${category.id}`, get label() { return category.label; }, get description() { return category.description; }, count, scope, children });
  }
  // Always present: the place for what has no type yet, dimmed when nothing is there.
  categoryNodes.push({
    id: 'untyped', get label() { return tr('browse.untyped'); }, get description() { return tr('browse.untyped.description'); }, count: untyped,
    scope: { get label() { return tr('browse.untyped'); }, filter: 'type:untyped', kind: 'untyped' }, children: [],
  });
  const categories: TreeNode = { id: 'categories', get label() { return tr('browse.categories'); }, count: entries.length, scope: null, fixed: true, children: categoryNodes };

  const quick: TreeNode = {
    id: 'quick',
    get label() { return tr('browse.quick'); },
    count: entries.length,
    scope: null,
    children: [
      { id: 'favorites', get label() { return tr('browse.favorites'); }, count: favorites, scope: { get label() { return tr('browse.favorites'); }, filter: 'favorite:yes', kind: 'favorites' }, children: [] },
      { id: 'recent', get label() { return tr('browse.recent'); }, count: recent, scope: { get label() { return tr('browse.recent'); }, filter: 'recent:yes', kind: 'recent' }, children: [] },
      // Designed tall first (milestone 65, docs/vertical-layouts.md): there when the library has any.
      ...(vertical > 0 ? [{
        id: 'vertical', get label() { return tr('browse.vertical'); }, count: vertical,
        get description() { return tr('browse.vertical.description'); },
        scope: { get label() { return tr('browse.vertical'); }, filter: `tag:${MADE_FOR_VERTICAL_TAG}`, kind: 'vertical' as const }, children: [],
      }] : []),
    ],
  };

  // A stock library is a section of its own, not one of My folders.
  const stockRoot = (root: string) => stock.find((l) => samePlace(l.path, root));
  const plainRoots = roots.filter((root) => !stockRoot(root));
  const libraries: TreeNode[] = stock.map((l) => {
    const root = roots.find((r) => samePlace(r, l.path)) ?? l.path;
    const count = byRoot.get(root) ?? l.items;
    return {
      id: `stock:${l.path}`,
      label: l.name,
      count,
      scope: { label: l.name, root, kind: 'stock' as const },
      // What a person needs to hear about a library on a drive that is not there: which drive, and that nothing is lost.
      get description() {
        if (l.online) return tr('browse.stock.online', { path: l.path });
        // The whole library, whatever a search narrows the row's count to.
        return l.drive ? tr('browse.stock.offline.drive', { drive: l.drive, count: l.items }) : tr('browse.stock.offline.folder', { path: l.path, count: l.items });
      },
      ...(l.online ? {} : { offline: true as const }),
      children: [],
    };
  });
  const stockSection: TreeNode[] = libraries.length === 0 ? [] : [{
    id: 'stock',
    get label() { return tr('browse.stock'); },
    count: libraries.reduce((n, l) => n + l.count, 0),
    scope: null,
    iconKind: 'stock',
    children: libraries,
  }];

  const folders: TreeNode = {
    id: 'folders',
    get label() { return tr('browse.folders'); },
    count: plainRoots.length,
    scope: null,
    children: plainRoots.map((root) => {
      // The bundled root is named in the interface's language; a folder's own name is the same in any.
      const label = () => rootLabel(root, builtInRoot);
      return { id: `root:${root}`, get label() { return label(); }, count: byRoot.get(root) ?? 0, scope: { get label() { return label(); }, root, kind: root === builtInRoot ? 'built-in' : 'folder' }, children: [] };
    }),
  };

  return [categories, quick, ...stockSection, folders];
}
