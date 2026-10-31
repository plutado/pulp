/**
 * A right-click menu in the window (milestone 39, ADR 0017). It draws a list of
 * `MenuItemSpec`s — the same description the application menu is built from,
 * already resolved — at a point, and calls back with the command that was
 * chosen. It knows nothing about layers or the stage: what to offer is decided
 * in src/core/stage-menu.ts and what a command does in ./stage-menu.ts.
 *
 * One menu is open at a time and it owns the window while it is: a click
 * anywhere else, Escape, a scroll, a resize or another right-click closes it.
 * The keyboard walks it — Up and Down move, Right opens a submenu and Left
 * leaves it, Enter chooses, Escape closes — and focus goes back where it came
 * from, so the stage keeps its arrow keys afterwards.
 */

import type { MenuCommand, MenuItemSpec } from '../core/menu';

/** How far a submenu overlaps its parent, so the pointer can cross without falling off the item. */
const SUBMENU_OVERLAP_PX = 4;
/** Kept clear of the window's edges, so a menu never sits half off-screen. */
const EDGE_MARGIN_PX = 8;

let root: HTMLDivElement | null = null;
let onChoose: ((command: MenuCommand, arg: string | null) => void) | null = null;
let returnFocus: HTMLElement | null = null;

function element(): HTMLDivElement {
  if (root) return root;
  root = document.createElement('div');
  root.className = 'context-menu-layer';
  root.hidden = true;
  document.body.append(root);
  return root;
}

/** Is a right-click menu open? */
function contextMenuOpen(): boolean {
  return root !== null && !root.hidden;
}

export function closeContextMenu(): void {
  if (!root || root.hidden) return;
  root.hidden = true;
  root.replaceChildren();
  onChoose = null;
  const back = returnFocus;
  returnFocus = null;
  // The stage's arrow keys and Escape belong to the overlay; give them back.
  if (back && back.isConnected) back.focus({ preventScroll: true });
}

function choose(item: MenuItemSpec): void {
  const command = item.command;
  const arg = item.arg ?? null;
  const callback = onChoose;
  closeContextMenu();
  if (command && callback) callback(command, arg);
}

/** The pressable items of one panel, in order: what the arrow keys walk. */
function itemsOf(panel: HTMLElement): HTMLButtonElement[] {
  return [...panel.querySelectorAll<HTMLButtonElement>(':scope > button:not([disabled])')];
}

function moveFocus(panel: HTMLElement, delta: number): void {
  const items = itemsOf(panel);
  if (items.length === 0) return;
  const at = items.findIndex((el) => el === document.activeElement);
  const next = at < 0 ? (delta > 0 ? 0 : items.length - 1) : (at + delta + items.length) % items.length;
  items[next]!.focus();
}

/** Put a panel inside the window: flipped back from the right or bottom edge rather than cut off. */
function place(panel: HTMLElement, x: number, y: number, flipFrom?: { left: number; right: number }): void {
  panel.style.left = '0px';
  panel.style.top = '0px';
  const box = panel.getBoundingClientRect();
  let left = x;
  if (left + box.width > window.innerWidth - EDGE_MARGIN_PX) {
    // A submenu flips to the other side of its parent; a root menu simply slides back in.
    left = flipFrom ? flipFrom.left - box.width + SUBMENU_OVERLAP_PX : window.innerWidth - box.width - EDGE_MARGIN_PX;
  }
  let top = y;
  if (top + box.height > window.innerHeight - EDGE_MARGIN_PX) top = Math.max(EDGE_MARGIN_PX, window.innerHeight - box.height - EDGE_MARGIN_PX);
  panel.style.left = `${Math.max(EDGE_MARGIN_PX, left)}px`;
  panel.style.top = `${Math.max(EDGE_MARGIN_PX, top)}px`;
}

function closeSubmenus(panel: HTMLElement): void {
  for (const open of panel.querySelectorAll<HTMLElement>(':scope > button[aria-expanded="true"]')) open.setAttribute('aria-expanded', 'false');
  for (const child of element().querySelectorAll<HTMLElement>('.context-menu.submenu')) {
    if (child.dataset.parent === panel.dataset.panel) child.remove();
  }
}

let panelCount = 0;

/** One panel of items; a submenu is another panel, opened beside its parent. */
function buildPanel(items: readonly MenuItemSpec[], depth: number): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = depth === 0 ? 'context-menu' : 'context-menu submenu';
  panel.setAttribute('role', 'menu');
  panel.dataset.panel = String(++panelCount);
  panel.dataset.depth = String(depth);
  for (const item of items) {
    if (item.type === 'separator') {
      const line = document.createElement('div');
      line.className = 'context-sep';
      line.setAttribute('role', 'separator');
      panel.append(line);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', item.submenu ? 'menuitem' : 'menuitem');
    button.textContent = item.label ?? '';
    if (item.command) button.dataset.command = item.command;
    if (item.arg !== undefined) button.dataset.arg = item.arg;
    // `enabled` is filled in by whoever built the list (src/core/stage-menu.ts), as the
    // application menu's own items are resolved before they are shown.
    button.disabled = item.enabled === false || item.disabled === true;
    if (item.submenu) {
      button.classList.add('has-submenu');
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      const open = (focusFirst: boolean): void => {
        if (button.disabled) return;
        closeSubmenus(panel);
        button.setAttribute('aria-expanded', 'true');
        const child = buildPanel(item.submenu!, depth + 1);
        child.dataset.parent = panel.dataset.panel!;
        element().append(child);
        const box = button.getBoundingClientRect();
        place(child, box.right - SUBMENU_OVERLAP_PX, box.top, { left: box.left, right: box.right });
        if (focusFirst) itemsOf(child)[0]?.focus();
      };
      button.addEventListener('pointerenter', () => open(false));
      button.addEventListener('focus', () => open(false));
      button.addEventListener('click', () => open(true));
      button.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(true);
        }
      });
    } else {
      // Moving onto a plain item puts away whatever submenu was open beside it.
      button.addEventListener('pointerenter', () => closeSubmenus(panel));
      button.addEventListener('focus', () => closeSubmenus(panel));
      button.addEventListener('click', () => choose(item));
    }
    panel.append(button);
  }
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(panel, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(panel, -1);
    } else if (e.key === 'ArrowLeft' && depth > 0) {
      e.preventDefault();
      const parent = element().querySelector<HTMLElement>(`.context-menu[data-panel="${panel.dataset.parent}"]`);
      const opener = parent?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]');
      panel.remove();
      opener?.setAttribute('aria-expanded', 'false');
      opener?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeContextMenu();
    }
  });
  return panel;
}

export interface ContextMenuOptions {
  /** Where the pointer was, in client coordinates. */
  x: number;
  y: number;
  items: readonly MenuItemSpec[];
  run: (command: MenuCommand, arg: string | null) => void;
  /** Where the keyboard goes when the menu closes: the element the menu was opened from. */
  focusBack?: HTMLElement | null;
}

/** Open a menu at a point. An empty list opens nothing, so there is never an empty box. */
export function openContextMenu(options: ContextMenuOptions): boolean {
  closeContextMenu();
  if (options.items.length === 0) return false;
  const layer = element();
  onChoose = options.run;
  returnFocus = options.focusBack ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const panel = buildPanel(options.items, 0);
  layer.replaceChildren(panel);
  layer.hidden = false;
  place(panel, options.x, options.y);
  // The first item takes the keyboard, so the menu can be walked without the pointer.
  itemsOf(panel)[0]?.focus();
  return true;
}

export function initContextMenu(): void {
  // Anything that moves the window out from under the menu closes it.
  for (const type of ['pointerdown', 'wheel'] as const) {
    document.addEventListener(type, (e) => {
      if (!contextMenuOpen()) return;
      if (e.target instanceof Node && root!.contains(e.target)) return;
      closeContextMenu();
    }, true);
  }
  window.addEventListener('resize', closeContextMenu);
  window.addEventListener('blur', closeContextMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && contextMenuOpen()) {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
    }
  }, true);
}
