/**
 * Filtering the browse tree as a category is typed (milestone 24's find field,
 * refined). Rather than offering matches in a list beside the tree, the tree
 * itself becomes the answer: every node that no longer matches disappears, the
 * ones that remain keep their section and their group so it is plain where each
 * lives, and because everything else is gone they sit at the top of the panel
 * with nothing to scroll. Pure; the panel renders what these answer.
 */

import type { TreeNode } from './browse-tree';

/** A half-open range of a label, for drawing the letters that matched. */
export type Range = readonly [start: number, end: number];

export interface FilteredNode extends TreeNode {
  children: FilteredNode[];
  /** The letters of this node's own label that matched; empty when it is kept only for its children. */
  ranges: Range[];
}

/**
 * Which letters of a label a query matched, in the same three tiers the find
 * field ranks by: the label starts with it, every word of the query starts a
 * word of the label, or it is simply somewhere inside. Null is no match.
 */
export function highlightRanges(label: string, query: string): Range[] | null {
  const l = label.toLowerCase();
  const q = query.toLowerCase().trim();
  if (q === '') return null;
  if (l.startsWith(q)) return [[0, q.length]];

  // Word starts: every word of the query must begin a word of the label, and each
  // one lights the letters it matched.
  const asked = q.split(/\s+/).filter(Boolean);
  const ranges: Range[] = [];
  const taken = new Set<number>();
  let everyWordLanded = true;
  for (const word of asked) {
    let landed = false;
    const wordStart = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = wordStart.exec(l)) !== null) {
      if (taken.has(m.index) || !m[0].startsWith(word)) continue;
      taken.add(m.index);
      ranges.push([m.index, m.index + word.length]);
      landed = true;
      break;
    }
    if (!landed) {
      everyWordLanded = false;
      break;
    }
  }
  if (everyWordLanded && ranges.length > 0) return ranges.slice().sort((a, b) => a[0] - b[0]);

  const at = l.indexOf(q);
  return at >= 0 ? [[at, at + q.length]] : null;
}

/**
 * The tree with everything that does not answer the query taken out. A node is
 * kept when its own label matches, or when something under it does — so a
 * section heading stays to say where its matches live, and a group stays around
 * its matching types. A node kept only for its children lights no letters.
 *
 * An empty query answers the tree unchanged, so the caller can render one thing.
 */
export function filterTree(tree: readonly TreeNode[], query: string): FilteredNode[] {
  if (query.trim() === '') return tree.map(withNoRanges);
  const keep = (node: TreeNode): FilteredNode | null => {
    const ranges = highlightRanges(node.label, query);
    // A node with no scope of its own (a heading, a bare group) is never an answer by itself:
    // it is only ever kept to hold the answers beneath it.
    const matches = ranges !== null && node.scope !== null;
    // A node that answers keeps everything under it: asking for "Transitions" means wanting the
    // transition types, not an empty group. A node kept only for its children keeps the matches.
    const children = matches ? node.children.map(withNoRanges) : node.children.map(keep).filter((c): c is FilteredNode => c !== null);
    if (!matches && children.length === 0) return null;
    return { ...node, children, ranges: matches ? ranges : [] };
  };
  return tree.map(keep).filter((n): n is FilteredNode => n !== null);
}

function withNoRanges(node: TreeNode): FilteredNode {
  return { ...node, children: node.children.map(withNoRanges), ranges: [] };
}

/**
 * The nodes that answered the query, in the order they are drawn: the ones
 * whose own label matched, not the sections and groups kept around them to say
 * where they live. This is what Enter takes.
 */
export function matchedNodes(tree: readonly FilteredNode[]): FilteredNode[] {
  return selectableNodes(tree).filter((node) => node.ranges.length > 0);
}

/** Every node in a filtered tree that can be chosen, in the order it is drawn. */
export function selectableNodes(tree: readonly FilteredNode[]): FilteredNode[] {
  const out: FilteredNode[] = [];
  const walk = (nodes: readonly FilteredNode[]): void => {
    for (const node of nodes) {
      if (node.scope) out.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** The label split into the pieces that matched and the pieces that did not, for drawing. */
export function labelPieces(label: string, ranges: readonly Range[]): { text: string; hit: boolean }[] {
  if (ranges.length === 0) return [{ text: label, hit: false }];
  const pieces: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) pieces.push({ text: label.slice(at, start), hit: false });
    pieces.push({ text: label.slice(start, end), hit: true });
    at = end;
  }
  if (at < label.length) pieces.push({ text: label.slice(at), hit: false });
  return pieces;
}
