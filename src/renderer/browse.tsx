/**
 * The browse panel: the tree from core/browse-tree rendered from the shared state.
 *
 * Three levels, told apart by structure rather than by type size (docs/ui-style.md):
 * a section (Quick access, Types, Themes, Styles, Packs, Folders) is a small muted
 * heading above a divider and is not a row; its entries are rows with an icon, a
 * disclosure twisty where they hold children; a group's children indent one step
 * behind a guide line, drop the icon and sit a shade quieter. Every selectable row
 * highlights across the panel's full width; a heading never does.
 *
 * Clicking a row sets the scope, clicking the active one clears it; a group with no
 * scope of its own (a theme group) folds instead. Keyboard: Up and Down move through
 * the visible rows, Home and End jump, Left folds or steps out to the parent, Right
 * unfolds or steps in, Enter or Space activates.
 */

import { render } from 'preact';
import { computed, signal } from '@preact/signals';
import { sameScope, setScope } from '../core/app-state';
import type { TreeNode } from '../core/browse-tree';
import { appState, browseTree, dispatch } from './store';
import { Icon, scopeIcon } from './icons';

const activeScope = computed(() => appState.value.scope);
/** Folded sections and groups, by node id; the tree starts fully open. */
const folded = signal<ReadonlySet<string>>(new Set());

function toggleFold(id: string): void {
  const next = new Set(folded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  folded.value = next;
}

/** A group's icon: its own scope's, or the one its children carry. */
function groupIcon(node: TreeNode) {
  return node.scope ? scopeIcon(node.scope.kind, node.scope.group) : scopeIcon(node.iconKind, undefined);
}

/** A section: a heading, not a row. The whole heading folds; nothing about it highlights. */
function Section({ node }: { node: TreeNode }) {
  const open = !folded.value.has(node.id);
  return (
    <li role="none" class="tree-section">
      <button type="button" class="section-heading" role="treeitem" aria-expanded={open} data-node={node.id} data-foldable="true" onClick={() => toggleFold(node.id)}>
        <Icon name={open ? 'caret-down' : 'caret-right'} />
        <span class="label">{node.label}</span>
      </button>
      {open && <Rows nodes={node.children} depth={1} />}
    </li>
  );
}

interface RowProps {
  node: TreeNode;
  depth: 1 | 2;
}

/** The selectable part of a row; the wrapper around it carries the highlight. */
function NodeButton({ node, depth, open }: RowProps & { open?: boolean }) {
  const scope = node.scope;
  const active = scope ? sameScope(activeScope.value, scope) : false;
  const foldable = node.children.length > 0;
  return (
    <button
      type="button"
      class={`browse-node${active ? ' active' : ''}${node.count === 0 ? ' empty' : ''}`}
      role="treeitem"
      aria-pressed={scope ? active : undefined}
      aria-expanded={foldable ? open : undefined}
      aria-label={`${node.label}, ${node.count}`}
      data-node={node.id}
      data-filter={scope?.filter}
      data-count={node.count}
      data-foldable={foldable ? 'true' : undefined}
      data-tip={scope?.root}
      onClick={() => (scope ? dispatch((s) => setScope(s, active ? null : scope)) : toggleFold(node.id))}
    >
      {depth === 1 && <Icon name={groupIcon(node)} />}
      <span class="label">{node.label}</span>
      <span class="count" aria-hidden="true">{node.count}</span>
    </button>
  );
}

/** A row that holds children: a twisty in the gutter, then the row itself. */
function Group({ node, depth }: RowProps) {
  const open = !folded.value.has(node.id);
  const active = node.scope ? sameScope(activeScope.value, node.scope) : false;
  return (
    <li role="none">
      <div class={`node-row lvl-${depth}${active ? ' active' : ''}`}>
        {/* Redundant with the row's aria-expanded and the Left and Right keys, so it stays out of the tab order. */}
        <button type="button" class="twisty" tabIndex={-1} aria-hidden="true" onClick={() => toggleFold(node.id)}>
          <Icon name={open ? 'caret-down' : 'caret-right'} />
        </button>
        <NodeButton node={node} depth={depth} open={open} />
      </div>
      {open && <Rows nodes={node.children} depth={2} />}
    </li>
  );
}

/** A row with nothing under it: the twisty gutter stays empty, so the icons line up. */
function Item({ node, depth }: RowProps) {
  const active = node.scope ? sameScope(activeScope.value, node.scope) : false;
  return (
    <li role="none">
      <div class={`node-row lvl-${depth}${active ? ' active' : ''}`}>
        <span class="twisty-slot" aria-hidden="true" />
        <NodeButton node={node} depth={depth} />
      </div>
    </li>
  );
}

function Rows({ nodes, depth }: { nodes: TreeNode[]; depth: 1 | 2 }) {
  return (
    <ul role="group" class={depth === 2 ? 'tree-rows nested' : 'tree-rows'}>
      {nodes.map((node) => (node.children.length > 0 ? <Group key={node.id} node={node} depth={depth} /> : <Item key={node.id} node={node} depth={depth} />))}
    </ul>
  );
}

function Tree() {
  return (
    <ul role="group" class="tree-rows sections">
      {browseTree.value.map((section) => (
        <Section key={section.id} node={section} />
      ))}
    </ul>
  );
}

/** The row of the list item a row belongs to — its parent in the tree, or null at the top. */
function parentRow(row: HTMLElement): HTMLButtonElement | null {
  const parentItem = row.closest('li')?.parentElement?.closest('li');
  return parentItem?.querySelector<HTMLButtonElement>(':scope > .section-heading, :scope > .node-row > .browse-node') ?? null;
}

/** Roving keyboard focus over the visible rows; the container is the tree. */
function onKeyDown(e: KeyboardEvent): void {
  const tree = e.currentTarget as HTMLElement;
  const rows = [...tree.querySelectorAll<HTMLButtonElement>('button[role=treeitem]')];
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  const focus = (i: number) => {
    rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();
    e.preventDefault();
  };
  switch (e.key) {
    case 'ArrowDown':
      return focus(current + 1);
    case 'ArrowUp':
      return focus(current - 1);
    case 'Home':
      return focus(0);
    case 'End':
      return focus(rows.length - 1);
    case 'ArrowRight':
    case 'ArrowLeft': {
      const row = rows[current];
      if (!row) return;
      e.preventDefault();
      const id = row.dataset.node;
      const open = row.dataset.foldable === 'true' && id !== undefined && !folded.value.has(id);
      if (e.key === 'ArrowRight') {
        // Unfold what is folded; step into what is already open; do nothing on a leaf.
        if (row.dataset.foldable === 'true' && !open && id) toggleFold(id);
        else if (open) focus(current + 1);
        return;
      }
      // Left folds what is open, and otherwise steps out to the parent.
      if (open && id) toggleFold(id);
      else parentRow(row)?.focus();
      return;
    }
  }
}

export function mountBrowse(container: HTMLElement): void {
  container.addEventListener('keydown', onKeyDown);
  render(<Tree />, container);
}
