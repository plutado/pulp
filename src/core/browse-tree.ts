/**
 * The browse tree (docs/ui-layout.md, milestone 10): Quick access (Favorites, Recently
 * used), Types (group → type, plus Untyped), Themes (built-in groups plus Custom), Styles,
 * and Folders, each node with the count of entries it would scope to. Counts come from the
 * entries passed in — the typed query and chips applied, the scope not — in one pass.
 * Empty taxonomy nodes are left out: the tree is a map of what the library has, not of
 * the whole vocabulary. The fixed places — Favorites, Recently used, Untyped, folders —
 * are always there and dim at zero. Pure.
 */

import type { Scope } from './app-state';
import { rootLabel, styleLabel, themeLabel, typeLabel } from './display';
import type { LibraryEntry } from './library-types';
import { entryType, groupChildThemes, isBuiltInTheme, STYLES, THEME_GROUPS, themeGroupOf, TYPE_GROUPS, TYPES, typeInfo } from './taxonomy';

export interface TreeNode {
  /** Unique within the tree: "type:wipe", "group:transitions", "theme:news", "root:/path", "untyped"… */
  id: string;
  label: string;
  /** Entries this node would scope to. */
  count: number;
  /** Null for a heading that only groups children. */
  scope: Scope | null;
  /** For a group with no scope of its own: what its children are, so the UI need not guess its icon. */
  iconKind?: Scope['kind'];
  children: TreeNode[];
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function buildBrowseTree(entries: readonly LibraryEntry[], roots: readonly string[], builtInRoot: string | undefined): TreeNode[] {
  const byType = new Map<string, number>();
  const byGroup = new Map<string, number>();
  const byTheme = new Map<string, number>();
  const byThemeGroup = new Map<string, number>();
  const byStyle = new Map<string, number>();
  const byRoot = new Map<string, number>();
  const byPack = new Map<string, { name: string; count: number }>();
  let untyped = 0;
  let favorites = 0;
  let recent = 0;

  for (const entry of entries) {
    const type = entryType(entry);
    if (type) {
      bump(byType, type);
      const group = typeInfo(type)?.group;
      if (group) bump(byGroup, group);
    } else {
      untyped += 1;
    }
    const groupsSeen = new Set<string>();
    for (const theme of entry.themes ?? []) {
      bump(byTheme, theme);
      const group = themeGroupOf(theme);
      if (group !== undefined && !groupsSeen.has(group)) {
        groupsSeen.add(group);
        bump(byThemeGroup, group);
      }
    }
    if (entry.kind === 'template') for (const style of entry.manifest.styles ?? []) bump(byStyle, style);
    bump(byRoot, entry.root);
    if (entry.kind === 'template' && entry.pack) {
      const p = byPack.get(entry.pack.slug) ?? { name: entry.pack.name, count: 0 };
      p.count += 1;
      byPack.set(entry.pack.slug, p);
    }
    if (entry.favorite) favorites += 1;
    if (entry.lastUsed) recent += 1;
  }

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

  const typeGroups: TreeNode[] = TYPE_GROUPS.filter((g) => (byGroup.get(g.id) ?? 0) > 0).map((g) => ({
    id: `group:${g.id}`,
    label: g.label,
    count: byGroup.get(g.id) ?? 0,
    scope: { label: g.label, filter: `type:${g.id}`, kind: 'group', group: g.id },
    children: TYPES.filter((t) => t.group === g.id && (byType.get(t.id) ?? 0) > 0).map((t) => ({
      id: `type:${t.id}`,
      label: typeLabel(t.id),
      count: byType.get(t.id) ?? 0,
      scope: { label: typeLabel(t.id), filter: `type:${t.id}`, kind: 'type', group: g.id },
      children: [],
    })),
  }));
  // Always present: the place for what has no type yet, dimmed when nothing is there.
  typeGroups.push({ id: 'untyped', label: 'Untyped', count: untyped, scope: { label: 'Untyped', filter: 'type:untyped', kind: 'untyped' }, children: [] });
  const types: TreeNode = { id: 'types', label: 'Types', count: entries.length - untyped, scope: null, children: typeGroups };

  // A theme group is a node of its own, not just a heading: it holds the items carrying
  // the theme that means the group ("sports") as well as everything under its children,
  // and its count is of entries, not of themes, so an item in two of them counts once.
  const themeGroups: TreeNode[] = THEME_GROUPS.map((g): TreeNode => ({
    id: `themes:${g.id}`,
    label: g.label,
    count: byThemeGroup.get(g.id) ?? 0,
    scope: { label: g.label, filter: `theme:${g.id}`, kind: 'theme' },
    iconKind: 'theme',
    children: groupChildThemes(g)
      .filter((t) => (byTheme.get(t.id) ?? 0) > 0)
      .map((t) => ({ id: `theme:${t.id}`, label: themeLabel(t.id), count: byTheme.get(t.id) ?? 0, scope: { label: themeLabel(t.id), filter: `theme:${t.id}`, kind: 'theme' }, children: [] })),
  })).filter((g) => g.count > 0);
  const customThemes = [...byTheme.keys()].filter((t) => !isBuiltInTheme(t)).sort((a, b) => a.localeCompare(b));
  if (customThemes.length > 0) {
    themeGroups.push({
      id: 'themes:custom',
      label: 'Custom',
      count: customThemes.reduce((n, t) => n + (byTheme.get(t) ?? 0), 0),
      scope: null,
      iconKind: 'theme',
      children: customThemes.map((t) => ({ id: `theme:${t}`, label: themeLabel(t), count: byTheme.get(t) ?? 0, scope: { label: themeLabel(t), filter: `theme:${t}`, kind: 'theme' }, children: [] })),
    });
  }
  const themes: TreeNode = { id: 'themes', label: 'Themes', count: byTheme.size, scope: null, children: themeGroups };

  const styles: TreeNode = {
    id: 'styles',
    label: 'Styles',
    count: byStyle.size,
    scope: null,
    children: STYLES.filter((s) => (byStyle.get(s.id) ?? 0) > 0).map((s) => ({
      id: `style:${s.id}`,
      label: styleLabel(s.id),
      count: byStyle.get(s.id) ?? 0,
      scope: { label: styleLabel(s.id), filter: `style:${s.id}`, kind: 'style' },
      children: [],
    })),
  };

  const packs: TreeNode = {
    id: 'packs',
    label: 'Packs',
    count: byPack.size,
    scope: null,
    children: [...byPack.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([slug, p]) => ({ id: `pack:${slug}`, label: p.name, count: p.count, scope: { label: p.name, filter: `pack:${slug}`, kind: 'pack' as const }, children: [] })),
  };

  const folders: TreeNode = {
    id: 'folders',
    label: 'Folders',
    count: roots.length,
    scope: null,
    children: roots.map((root) => {
      const label = rootLabel(root, builtInRoot);
      return { id: `root:${root}`, label, count: byRoot.get(root) ?? 0, scope: { label, root, kind: root === builtInRoot ? 'built-in' : 'folder' }, children: [] };
    }),
  };

  // Sections with nothing under them are left out, except the fixed entry points (Quick access, Types with Untyped, Folders).
  return [quick, types, themes, styles, packs, folders].filter((section) => section.id === 'quick' || section.id === 'folders' || section.children.length > 0);
}
