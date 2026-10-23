/**
 * The browse panel: the tree from core/browse-tree rendered from the shared state.
 * Clicking a node sets the scope, clicking the active node clears it; section headings
 * fold. Keyboard: Up and Down move through the visible rows, Home and End jump, Left
 * folds the heading a row belongs to, Right unfolds it, Enter or Space activates.
 */

import { render } from 'preact';
import { computed, signal } from '@preact/signals';
import { sameScope, setScope } from '../core/app-state';
import type { TreeNode } from '../core/browse-tree';
import { appState, browseTree, dispatch } from './store';
import { Icon, scopeIcon } from './icons';

const activeScope = computed(() => appState.value.scope);
/** Folded headings, by node id; the tree starts fully open. */
const folded = signal<ReadonlySet<string>>(new Set());

function toggleFold(id: string): void {
  const next = new Set(folded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  folded.value = next;
}

function Heading({ node, depth }: { node: TreeNode; depth: number }) {
  const open = !folded.value.has(node.id);
  return (
    <li role="none">
      <button
        type="button"
        class="tree-heading"
        role="treeitem"
        aria-expanded={open}
        data-node={node.id}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => toggleFold(node.id)}
      >
        <Icon name={open ? 'caret-down' : 'caret-right'} />
        <span class="label">{node.label}</span>
      </button>
      {open && <Rows nodes={node.children} depth={depth + 1} />}
    </li>
  );
}

function Leaf({ node, depth }: { node: TreeNode; depth: number }) {
  const scope = node.scope!;
  const active = sameScope(activeScope.value, scope);
  return (
    <li role="none">
      <button
        type="button"
        class={`browse-node${active ? ' active' : ''}${node.count === 0 ? ' empty' : ''}`}
        role="treeitem"
        aria-pressed={active}
        aria-label={`${scope.label}, ${node.count}`}
        data-node={node.id}
        data-filter={scope.filter}
        data-count={node.count}
        data-tip={scope.root}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => dispatch((s) => setScope(s, active ? null : scope))}
      >
        <Icon name={scopeIcon(scope.kind, scope.group)} />
        <span class="label">{scope.label}</span>
        <span class="count" aria-hidden="true">{node.count}</span>
      </button>
      {node.children.length > 0 && <Rows nodes={node.children} depth={depth + 1} />}
    </li>
  );
}

function Rows({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
  return (
    <ul role="group" class="tree-rows">
      {nodes.map((node) => (node.scope ? <Leaf key={node.id} node={node} depth={depth} /> : <Heading key={node.id} node={node} depth={depth} />))}
    </ul>
  );
}

function Tree() {
  return <Rows nodes={browseTree.value} depth={0} />;
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
    case 'ArrowDown': return focus(current + 1);
    case 'ArrowUp': return focus(current - 1);
    case 'Home': return focus(0);
    case 'End': return focus(rows.length - 1);
    case 'ArrowRight':
    case 'ArrowLeft': {
      // The heading this row belongs to: itself if it is one, else the nearest heading above.
      const row = rows[current];
      const heading = row?.classList.contains('tree-heading') ? row : row?.closest('ul')?.parentElement?.querySelector<HTMLButtonElement>(':scope > button.tree-heading');
      if (!heading) return;
      const id = heading.dataset.node!;
      const open = !folded.value.has(id);
      if (e.key === 'ArrowLeft' && open) toggleFold(id);
      if (e.key === 'ArrowRight' && !open) toggleFold(id);
      if (e.key === 'ArrowLeft') heading.focus();
      e.preventDefault();
      return;
    }
  }
}

export function mountBrowse(container: HTMLElement): void {
  container.addEventListener('keydown', onKeyDown);
  render(<Tree />, container);
}
