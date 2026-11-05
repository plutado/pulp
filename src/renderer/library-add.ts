/**
 * Add, in the browse panel's header (milestone 47): one button that opens a
 * menu naming what each choice brings into the library — your media folder,
 * templates from a pack, sample media.
 *
 * It replaced four icon buttons that read "Add folder", "Add sample media…",
 * "Import pack…" and "Export…". They said "add" three times without saying
 * what arrived, "Import" and "Add" meant the same thing in two words, and
 * Export did not belong among them at all: it acts on the templates the
 * results are listing, so it sits in the results' heading now.
 *
 * The menu is built from the application menu's own list (`libraryAddItems`
 * in src/core/menu.ts) and run through the one dispatcher, so File → Add and
 * this button offer the same words and do the same things — the rule ADR 0017
 * set for the stage's right-click menu.
 */

import { libraryAddItems, type MenuCommand } from '../core/menu';
import { openContextMenu } from './context-menu';
import { t } from './i18n';
import { someSampleMediaUnmade } from './sample-hint';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** What the three choices do; the window's own wiring hands them over, dialogs and all. */
export interface LibraryAddActions {
  addFolder: () => void;
  importPack: () => void;
  addSampleMedia: () => void;
}

let actions: LibraryAddActions | null = null;

/** What Add can offer now: sample media only while some of the catalog is unmade (milestone 47). */
export function libraryAddState(): { canAddSampleMedia: boolean } {
  return { canAddSampleMedia: someSampleMediaUnmade.value };
}

/** Run one of the three, from the Add menu or from the application menu's File → Add. */
export function runLibraryAdd(command: MenuCommand): void {
  if (command === 'library.addFolder') actions?.addFolder();
  else if (command === 'pack.import') actions?.importPack();
  else if (command === 'library.addSampleMedia') actions?.addSampleMedia();
}

/**
 * Making the sample media takes a while (clips are rendered), so the button
 * that asked for it says it is working and takes no second press meanwhile.
 */
export function setLibraryAddBusy(busy: boolean): void {
  const button = document.getElementById('library-add') as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

export function openLibraryAddMenu(): void {
  const button = $('library-add');
  const box = button.getBoundingClientRect();
  openContextMenu({
    x: box.left,
    y: box.bottom + 2,
    items: libraryAddItems(libraryAddState(), t),
    run: (command) => runLibraryAdd(command),
    focusBack: button,
  });
}

export function initLibraryAdd(wiring: LibraryAddActions): void {
  actions = wiring;
  $('library-add').addEventListener('click', openLibraryAddMenu);
}
