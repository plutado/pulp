/**
 * Find a category as you type (milestone 24): the matching behind the browse
 * panel's find field. It searches the browse tree itself — types, themes,
 * styles, packs, folders and the Quick access entries — never the library's
 * items; the search bar above the results keeps finding those.
 *
 * A match carries the node's scope, so choosing it selects the node exactly as
 * clicking it in the tree does, and the path of its ancestors, so the tree can
 * unfold to show where the choice landed. Pure.
 */

import type { Scope } from './app-state';
import type { TreeNode } from './browse-tree';

export interface FindMatch {
  /** The tree node's id ("type:wipe", "themes:holiday"), unique in the tree. */
  id: string;
  label: string;
  /** Where it lives: the section's label ("Types", "Themes", "Quick access"…). */
  place: string;
  count: number;
  scope: Scope;
  /** Ancestor node ids, outermost first, for unfolding the tree to the choice. */
  path: string[];
}

/** Matches on offer at once; past this the person types another letter. */
export const FIND_LIMIT = 8;

/**
 * How well a label answers the query, best first: the label starts with it,
 * then every word of the query starts a word of the label ("lo th" finds
 * "Lower third"), then the query is simply somewhere in the label. Null is no
 * match. Case never matters.
 */
export function matchRank(label: string, query: string): number | null {
  const l = label.toLowerCase();
  const q = query.toLowerCase().trim();
  if (q === '') return null;
  if (l.startsWith(q)) return 0;
  const words = l.split(/\s+/);
  const asked = q.split(/\s+/);
  if (asked.every((a) => words.some((w) => w.startsWith(a)))) return 1;
  if (l.includes(q)) return 2;
  return null;
}

/**
 * The nodes that answer the query, best answers first and tree order within a
 * rank, at most `limit`. Every node that can be chosen in the tree can be
 * found — a section heading has no scope and only lends its label as the
 * match's place.
 */
export function findBrowseNodes(tree: readonly TreeNode[], query: string, limit = FIND_LIMIT): FindMatch[] {
  if (query.trim() === '') return [];
  const out: (FindMatch & { rank: number; order: number })[] = [];
  let order = 0;
  const walk = (nodes: readonly TreeNode[], place: string, path: string[]): void => {
    for (const node of nodes) {
      order += 1;
      if (node.scope) {
        const rank = matchRank(node.label, query);
        if (rank !== null) out.push({ id: node.id, label: node.label, place, count: node.count, scope: node.scope, path, rank, order });
      }
      walk(node.children, place, [...path, node.id]);
    }
  };
  for (const section of tree) walk(section.children, section.label, [section.id]);
  return out
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(({ rank: _rank, order: _order, ...match }) => match);
}
