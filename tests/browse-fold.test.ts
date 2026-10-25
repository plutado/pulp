import { describe, expect, it } from 'vitest';
import { toggleFolded, unfoldPath } from '../src/core/browse-fold';
import type { TreeNode } from '../src/core/browse-tree';

/** A small tree: two sections with two foldable groups each, plus leaves. */
const node = (id: string, children: TreeNode[] = []): TreeNode => ({ id, label: id, count: 1, scope: null, children });
const tree: TreeNode[] = [
  node('quick', [node('favorites'), node('recent')]),
  node('types', [node('group:titles', [node('type:title-card')]), node('group:transitions', [node('type:wipe')]), node('untyped')]),
  node('themes', [node('themes:sports', [node('theme:sports')])]),
];

describe('toggleFolded', () => {
  it('folds and unfolds a node alone when the accordion is off', () => {
    const folded = toggleFolded(tree, new Set(), 'types', false);
    expect([...folded]).toEqual(['types']);
    expect([...toggleFolded(tree, folded, 'types', false)]).toEqual([]);
  });

  it('opening under the accordion folds the foldable siblings at that level', () => {
    const allFolded = new Set(['quick', 'types', 'themes']);
    const opened = toggleFolded(tree, allFolded, 'types', true);
    expect(opened.has('types')).toBe(false);
    expect(opened.has('quick')).toBe(true);
    expect(opened.has('themes')).toBe(true);
    // The same within a section: opening one group folds its foldable siblings, and only them.
    const groups = toggleFolded(tree, new Set(['group:titles']), 'group:titles', true);
    expect(groups.has('group:titles')).toBe(false);
    expect(groups.has('group:transitions')).toBe(true);
    expect(groups.has('untyped'), 'a leaf never folds').toBe(false);
    expect(groups.has('themes'), 'another level is not its business').toBe(false);
  });

  it('folding is always free: closing a node never touches the others', () => {
    const folded = toggleFolded(tree, new Set(), 'types', true);
    expect([...folded]).toEqual(['types']);
  });
});

describe('unfoldPath', () => {
  it('opens every ancestor so the choice is on screen, and touches nothing else', () => {
    const folded = new Set(['types', 'group:transitions', 'themes']);
    const next = unfoldPath(folded, ['types', 'group:transitions']);
    expect(next.has('types')).toBe(false);
    expect(next.has('group:transitions')).toBe(false);
    // A find is a jump, not a reorganisation: what else was folded stays folded, and open stays open.
    expect(next.has('themes')).toBe(true);
  });

  it('answers the same set when nothing on the path is folded', () => {
    const folded = new Set(['themes']);
    expect(unfoldPath(folded, ['types', 'group:titles'])).toBe(folded);
    expect(unfoldPath(folded, ['nowhere'])).toBe(folded);
  });
});
