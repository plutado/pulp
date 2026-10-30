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
 *
 * Typing in the find field filters the tree itself rather than offering a list beside
 * it (src/core/browse-filter.ts): what no longer matches disappears, what remains keeps
 * its section and group so it is plain where each lives, the matched letters are lit,
 * and every section holding a match is open for as long as the search lasts. Clearing
 * the field puts the tree back exactly as it was, folds included.
 *
 * Under the accordion the tree shows only where you are: on launch everything is folded
 * but the path to the active category, or Quick access when nothing is active, and
 * choosing a category opens its path and folds the rest.
 */

import { render } from 'preact';
import { computed, signal } from '@preact/signals';
import { sameScope, setScope } from '../core/app-state';
import { filterTree, labelPieces, matchedNodes, type FilteredNode } from '../core/browse-filter';
import { foldAllExcept, nodePath, toggleFolded } from '../core/browse-fold';
import type { TreeNode } from '../core/browse-tree';
import { appState, browseTree, dispatch } from './store';
import { Icon, scopeIcon } from './icons';
import { itemCount } from '../core/display';

const activeScope = computed(() => appState.value.scope);
/** Folded sections and groups, by node id; the tree starts fully open. */
const folded = signal<ReadonlySet<string>>(new Set());

/**
 * One section open at a time (milestone 24): opening a section or a group
 * folds the others at its level, so the tree stays short. On by default;
 * `browseAccordion: false` in settings.json folds and unfolds freely. The
 * boot reads the setting (src/renderer/main.ts).
 */
export const browseAccordion = signal(true);

function toggleFold(id: string): void {
  folded.value = toggleFolded(browseTree.value, folded.value, id, browseAccordion.value);
}

/**
 * Find a category as you type: the query filters the tree below (see the head
 * of this file). Empty means no search, and the tree is whatever the folds say.
 */
const findQuery = signal('');

/** The tree as it is drawn: filtered while a search is on, whole otherwise. */
const shownTree = computed(() => filterTree(browseTree.value, findQuery.value));
const searching = computed(() => findQuery.value.trim() !== '');

function setFindQuery(value: string): void {
  findQuery.value = value;
}

/**
 * Choose a category: set the scope, and under the accordion fold the tree back
 * to the path that holds it, so the panel shows where you now are. The search,
 * having been answered, is cleared.
 */
function chooseNode(id: string, scope: NonNullable<TreeNode['scope']>): void {
  dispatch((s) => setScope(s, scope));
  showOnly(id);
  setFindQuery('');
}

/** Fold everything but the path to a node; free folding leaves the folds alone. */
function showOnly(id: string): void {
  if (!browseAccordion.value) return;
  const found = nodePath(browseTree.value, (n) => n.id === id);
  if (found) folded.value = foldAllExcept(browseTree.value, found.path);
}

/**
 * The tree the panel opens on: the path to the active category, or Quick
 * access alone when nothing is active. Called once the library is there, and
 * whenever the scope changes from outside the panel (a chip, a card).
 */
export function browseFoldToActive(): void {
  if (!browseAccordion.value) return;
  const tree = browseTree.value;
  if (tree.length === 0) return;
  const scope = activeScope.value;
  const found = scope ? nodePath(tree, (n) => n.scope !== null && sameScope(n.scope, scope)) : null;
  folded.value = foldAllExcept(tree, found ? found.path : ['quick']);
}

function onFindKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && findQuery.value !== '') {
    setFindQuery('');
  } else if (e.key === 'Enter') {
    // Enter takes the first category that actually answered — not the section or group kept
    // above it to say where it lives.
    const first = matchedNodes(shownTree.value)[0];
    if (!first?.scope) return;
    chooseNode(first.id, first.scope);
  } else if (e.key === 'ArrowDown') {
    // Into the tree: the first row that can be chosen takes the focus.
    const row = document.querySelector<HTMLButtonElement>('#browse-tree .browse-node');
    row?.focus();
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
}

function Find() {
  const nothing = searching.value && shownTree.value.length === 0;
  return (
    <div class="find-field">
      <input
        type="text"
        placeholder="Find a category"
        aria-label="Find a category"
        aria-controls="browse-tree"
        value={findQuery.value}
        onInput={(e) => setFindQuery((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={onFindKeyDown}
      />
      {nothing && <p class="find-none" role="status">No category matches</p>}
    </div>
  );
}

/** The label, with the letters a search matched lit. */
function Label({ node }: { node: FilteredNode }) {
  return (
    <span class="label">
      {labelPieces(node.label, node.ranges).map((piece, i) => (piece.hit ? <mark key={i}>{piece.text}</mark> : <span key={i}>{piece.text}</span>))}
    </span>
  );
}

/** A group's icon: its own scope's, or the one its children carry. */
function groupIcon(node: TreeNode) {
  return node.scope ? scopeIcon(node.scope.kind, node.scope.group) : scopeIcon(node.iconKind, undefined);
}

/**
 * A section: a heading, not a row. The whole heading folds; nothing about it
 * highlights. The categories (milestone 34) are the panel's top level rather
 * than a section of it: no heading, never folded, their rows simply first.
 */
function Section({ node }: { node: FilteredNode }) {
  if (node.fixed) {
    return (
      <li role="none" class="tree-section tree-top" data-section={node.id}>
        <Rows nodes={node.children} depth={1} />
      </li>
    );
  }
  // A section holding a match stays open for as long as the search lasts, whatever the folds say.
  const open = searching.value || !folded.value.has(node.id);
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
  node: FilteredNode;
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
      aria-label={`${node.label}, ${itemCount(node.count)}`}
      data-node={node.id}
      data-filter={scope?.filter}
      data-count={node.count}
      data-foldable={foldable ? 'true' : undefined}
      data-tip={node.description ?? scope?.root}
      onClick={() => {
        if (!scope) {
          toggleFold(node.id);
          return;
        }
        // Clicking the active one clears the scope; any other takes it, and the tree folds to it.
        if (active) dispatch((s) => setScope(s, null));
        else chooseNode(node.id, scope);
      }}
    >
      {depth === 1 && <Icon name={groupIcon(node)} />}
      <Label node={node} />
      <span class="count" aria-hidden="true">{node.count}</span>
    </button>
  );
}

/** A row that holds children: a twisty in the gutter, then the row itself. */
function Group({ node, depth }: RowProps) {
  const open = searching.value || !folded.value.has(node.id);
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

function Rows({ nodes, depth }: { nodes: FilteredNode[]; depth: 1 | 2 }) {
  return (
    <ul role="group" class={depth === 2 ? 'tree-rows nested' : 'tree-rows'}>
      {nodes.map((node) => (node.children.length > 0 ? <Group key={node.id} node={node} depth={depth} /> : <Item key={node.id} node={node} depth={depth} />))}
    </ul>
  );
}

function Tree() {
  return (
    <ul role="group" class="tree-rows sections">
      {shownTree.value.map((section) => (
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
      // While a search holds the sections open, folding keys have nothing to say.
      if (searching.value) return;
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

export function mountBrowse(find: HTMLElement, container: HTMLElement): void {
  render(<Find />, find);
  container.addEventListener('keydown', onKeyDown);
  render(<Tree />, container);
}
