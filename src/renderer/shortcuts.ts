/**
 * The keyboard-shortcut list, read back off the menu itself rather than written
 * out again, so it cannot drift from the keys (milestone 27). Its own module
 * because two places open it: the Help menu and the start screen's Learn
 * section (milestone 31).
 */

import { acceleratorLabel, shortcutList } from '../core/menu';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export async function showShortcuts(): Promise<void> {
  const sections = await window.pulp.menuSections();
  const mac = window.pulp.platform === 'darwin';
  const list = $('shortcuts-list');
  list.replaceChildren();
  for (const group of shortcutList(sections)) {
    const head = document.createElement('h3');
    head.textContent = group.section;
    const rows = document.createElement('dl');
    rows.className = 'shortcut-rows';
    for (const { label, accelerator } of group.shortcuts) {
      const name = document.createElement('dt');
      name.textContent = label;
      const key = document.createElement('dd');
      key.textContent = acceleratorLabel(accelerator, mac);
      rows.append(name, key);
    }
    list.append(head, rows);
  }
  $<HTMLDialogElement>('shortcuts-dialog').showModal();
}
