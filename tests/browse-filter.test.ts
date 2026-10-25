import { describe, expect, it } from 'vitest';
import { filterTree, highlightRanges, labelPieces, matchedNodes, selectableNodes } from '../src/core/browse-filter';
import { foldAllExcept, nodePath } from '../src/core/browse-fold';
import type { TreeNode } from '../src/core/browse-tree';

const node = (id: string, label: string, children: TreeNode[] = [], scope = true): TreeNode => ({
  id, label, count: 1, scope: scope ? { label, filter: id } : null, children,
});
const tree: TreeNode[] = [
  node('quick', 'Quick access', [node('favorites', 'Favorites'), node('recent', 'Recently used')], false),
  node('types', 'Types', [
    node('group:titles', 'Titles and text', [node('type:lower-third', 'Lower third'), node('type:title', 'Title')]),
    node('group:transitions', 'Transitions', [node('type:wipe', 'Wipe')]),
  ], false),
  node('themes', 'Themes', [node('themes:sports', 'Sports', [node('theme:football', 'Football')])], false),
];

describe('highlightRanges', () => {
  it('lights a start, then word starts, then a substring', () => {
    expect(highlightRanges('Lower third', 'low')).toEqual([[0, 3]]);
    expect(highlightRanges('Lower third', 'lo th')).toEqual([[0, 2], [6, 8]]);
    expect(highlightRanges('Lower third', 'wer')).toEqual([[2, 5]]);
    expect(highlightRanges('Lower third', 'upper')).toBeNull();
    expect(highlightRanges('Lower third', '   ')).toBeNull();
  });
});

describe('filterTree', () => {
  it('keeps a match and the section and group it lives under, and nothing else', () => {
    const filtered = filterTree(tree, 'lower');
    expect(filtered.map((s) => s.id)).toEqual(['types']);
    expect(filtered[0]!.children.map((g) => g.id)).toEqual(['group:titles']);
    expect(filtered[0]!.children[0]!.children.map((t) => t.id)).toEqual(['type:lower-third']);
    // The section and group are kept to say where the match lives, so they light nothing.
    expect(filtered[0]!.ranges).toEqual([]);
    expect(filtered[0]!.children[0]!.ranges).toEqual([]);
    expect(filtered[0]!.children[0]!.children[0]!.ranges).toEqual([[0, 5]]);
  });

  it('keeps a group that matches by its own name, with everything under it', () => {
    const filtered = filterTree(tree, 'transitions');
    const group = filtered[0]!.children[0]!;
    expect(group.id).toBe('group:transitions');
    expect(group.ranges).toEqual([[0, 11]]);
    expect(group.children.map((c) => c.id)).toEqual(['type:wipe']);
  });

  it('never answers with a heading that has no scope of its own', () => {
    // "Quick access" matches by name, but it is a heading: only what is under it can be chosen.
    const filtered = filterTree(tree, 'quick');
    expect(filtered).toEqual([]);
    expect(selectableNodes(filterTree(tree, 'fav')).map((n) => n.id)).toEqual(['favorites']);
  });

  it('answers the whole tree for an empty query, and nothing for a miss', () => {
    expect(filterTree(tree, '').map((s) => s.id)).toEqual(['quick', 'types', 'themes']);
    expect(filterTree(tree, 'nothing here')).toEqual([]);
  });

  it('lists what can be chosen in the order it is drawn', () => {
    expect(selectableNodes(filterTree(tree, 't')).map((n) => n.id)).toContain('type:title');
  });

  it('answers with the nodes that matched, not the ones kept to hold them', () => {
    // "lower" keeps the Types section and the Titles group to say where the match lives; the
    // group can still be clicked, but it is not what the typing asked for, so Enter skips it.
    const filtered = filterTree(tree, 'lower');
    expect(selectableNodes(filtered).map((n) => n.id)).toEqual(['group:titles', 'type:lower-third']);
    expect(matchedNodes(filtered).map((n) => n.id)).toEqual(['type:lower-third']);
    // When a group is itself the answer, it is the first match.
    expect(matchedNodes(filterTree(tree, 'transitions')).map((n) => n.id)).toEqual(['group:transitions']);
  });
});

describe('labelPieces', () => {
  it('splits a label into what matched and what did not', () => {
    expect(labelPieces('Lower third', [[0, 3]])).toEqual([{ text: 'Low', hit: true }, { text: 'er third', hit: false }]);
    expect(labelPieces('Lower third', [])).toEqual([{ text: 'Lower third', hit: false }]);
    expect(labelPieces('Lower third', [[0, 2], [6, 8]])).toEqual([
      { text: 'Lo', hit: true }, { text: 'wer ', hit: false }, { text: 'th', hit: true }, { text: 'ird', hit: false },
    ]);
  });
});

describe('showing only where you are', () => {
  it('finds a node and the ancestors above it', () => {
    const found = nodePath(tree, (n) => n.id === 'type:wipe');
    expect(found?.path).toEqual(['types', 'group:transitions']);
    expect(nodePath(tree, (n) => n.id === 'nowhere')).toBeNull();
  });

  it('folds everything but the path, so the panel opens on where you are', () => {
    const folded = foldAllExcept(tree, ['types', 'group:transitions']);
    expect(folded.has('types')).toBe(false);
    expect(folded.has('group:transitions')).toBe(false);
    expect(folded.has('quick')).toBe(true);
    expect(folded.has('themes')).toBe(true);
    expect(folded.has('group:titles')).toBe(true);
    // A leaf is not foldable, so it is never in the set.
    expect(folded.has('type:wipe')).toBe(false);
  });

  it('with nothing active, only Quick access stands open', () => {
    const folded = foldAllExcept(tree, ['quick']);
    expect(folded.has('quick')).toBe(false);
    expect([...folded].sort()).toEqual(['group:titles', 'group:transitions', 'themes', 'themes:sports', 'types']);
  });
});
