/**
 * Pulp's application menu in the main process (milestone 27): turns the pure
 * description (`src/core/menu.ts`) into an Electron menu, and keeps it in step
 * with what the window can do.
 *
 * The whole menu is rebuilt when the state changes rather than having its
 * items poked one by one: it is a few dozen items, the state changes when a
 * selection or a region does and not on a keystroke, and Open Recent is a
 * submenu whose contents change anyway. The window sends the state only when
 * it differs from the last one it sent, so a rebuild means something moved.
 */

import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from '../core/display';
import {
  buildMenu, EMPTY_MENU_STATE, itemChecked, itemEnabled, itemLabel, resolveMenu,
  type MenuCommand, type MenuItemSpec, type MenuSection, type MenuState,
} from '../core/menu';

let current: MenuState = EMPTY_MENU_STATE;
let target: BrowserWindow | null = null;

/** A menu item's click: the window does it, by doing what its own button does. */
function run(command: MenuCommand, arg?: string): void {
  target?.webContents.send('menu:command', command, arg ?? null);
}

function toElectron(items: readonly MenuItemSpec[], state: MenuState): MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.type === 'separator') return { type: 'separator' };
    const built: MenuItemConstructorOptions = {};
    if (item.role) built.role = item.role as MenuItemConstructorOptions['role'];
    if (item.label !== undefined) built.label = itemLabel(item, state);
    if (item.accelerator) built.accelerator = item.accelerator;
    // Shown without being registered, so the window keeps the key (Undo in a text field).
    if (item.displayOnly) built.registerAccelerator = false;
    if (item.submenu) built.submenu = toElectron(item.submenu, state);
    if (item.type === 'checkbox' || item.type === 'radio') {
      built.type = item.type;
      built.checked = itemChecked(item, state);
    }
    if (item.command) {
      const { command, arg } = item;
      built.click = () => run(command, arg);
    }
    // A role does its own thing and knows when it can; everything else asks the state.
    if (!item.role) built.enabled = itemEnabled(item, state);
    return built;
  });
}

function install(state: MenuState): void {
  const sections = buildMenu({
    mac: process.platform === 'darwin',
    development: !app.isPackaged,
    // The name people know it by, not the package name: `app.getName()` answers "pulp".
    appName: APP_NAME,
    state,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(sections.map((s) => ({ label: s.label, submenu: toElectron(s.items, state) }))));
}

/** Put the menu up, before the window loads, so there is never a moment of Electron's own. */
export function initMenu(window: BrowserWindow): void {
  target = window;
  install(current);
}

/** The window says what it can do now; the menu follows. */
export function setMenuState(state: MenuState): void {
  current = state;
  install(state);
}

/** The menu as it stands — labels, enabled, checked — for the window's shortcut list. */
export function menuSections(): MenuSection[] {
  const sections = buildMenu({ mac: process.platform === 'darwin', development: !app.isPackaged, appName: APP_NAME, state: current });
  return resolveMenu(sections, current);
}
