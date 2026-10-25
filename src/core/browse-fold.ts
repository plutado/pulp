/**
 * One section open at a time (milestone 24): the fold arithmetic behind the
 * browse tree. The tree's folded state is a set of node ids; these functions
 * answer what that set becomes when something opens, in the two manners the
 * setting chooses between — free folding, where nodes open and close alone,
 * and the accordion, where opening a section or a group folds the others at
 * its level so the tree stays short. Pure; the panel renders the set.
 */

import type { TreeNode } from './browse-tree';

/** The ids of the foldable nodes beside `id` — same parent, children of their own — or null when `id` is not in the tree. */
function foldableSiblings(tree: readonly TreeNode[], id: string): string[] | null {
  const search = (nodes: readonly TreeNode[]): string[] | null => {
    if (nodes.some((n) => n.id === id)) return nodes.filter((n) => n.id !== id && n.children.length > 0).map((n) => n.id);
    for (const node of nodes) {
      const found = search(node.children);
      if (found) return found;
    }
    return null;
  };
  return search(tree);
}

/**
 * The folded set after a fold toggle. Folding is always free; opening under
 * the accordion also folds the node's foldable siblings, so one section or
 * group stands open at each level.
 */
export function toggleFolded(tree: readonly TreeNode[], folded: ReadonlySet<string>, id: string, accordion: boolean): ReadonlySet<string> {
  const next = new Set(folded);
  if (!folded.has(id)) {
    next.add(id);
    return next;
  }
  next.delete(id);
  if (accordion) for (const sibling of foldableSiblings(tree, id) ?? []) next.add(sibling);
  return next;
}

/**
 * The folded set after choosing a node in the find field: every ancestor on
 * `path` opens, so the choice is on screen where the tree says it lives. A
 * find is a jump, not a reorganisation, so it only ever opens — what else was
 * open stays open, accordion or not.
 */
export function unfoldPath(folded: ReadonlySet<string>, path: readonly string[]): ReadonlySet<string> {
  if (!path.some((id) => folded.has(id))) return folded;
  const next = new Set(folded);
  for (const id of path) next.delete(id);
  return next;
}

/** Every foldable node's id, anywhere in the tree. */
function foldableIds(tree: readonly TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.children.length > 0) out.push(node.id);
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * The node a predicate picks out, with the ids of its ancestors, outermost
 * first. Null when nothing answers.
 */
export function nodePath(tree: readonly TreeNode[], want: (node: TreeNode) => boolean): { node: TreeNode; path: string[] } | null {
  const walk = (nodes: readonly TreeNode[], path: string[]): { node: TreeNode; path: string[] } | null => {
    for (const node of nodes) {
      if (want(node)) return { node, path };
      const deeper = walk(node.children, [...path, node.id]);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(tree, []);
}

/**
 * The folded set that shows one path and nothing else: everything foldable is
 * folded except the ancestors named. This is what the tree looks like under the
 * accordion when a category is chosen, or on launch with one already active —
 * the panel opens on where you are rather than on everything at once.
 */
export function foldAllExcept(tree: readonly TreeNode[], open: readonly string[]): ReadonlySet<string> {
  const keep = new Set(open);
  return new Set(foldableIds(tree).filter((id) => !keep.has(id)));
}
