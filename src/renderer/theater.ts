/**
 * Theater (milestone 38): the picture as big as the window allows without
 * leaving the app. The browse panel folds to its icon rail, the results strip
 * hides and the drawer closes, so the stage runs from the rail to the window's
 * right edge and down to the transport row — which stays, its scrub bar still
 * under the picture. Toggled off, everything comes back as it was: the panel's
 * state, the results, an open drawer. A snapshot, not a setting.
 *
 * With the stage in a window of its own (milestone 43), theater is that
 * window filling its display with the picture alone, and off again: the main
 * window is for browsing then, and has nothing to fold.
 *
 * Toggled by the button on the stage's corner and by the bare `T`, which
 * cannot be a menu accelerator — a bare key registered there would shadow
 * typing (docs/ui-layout.md) — so the window listens, and stands aside
 * wherever a key means text: fields, dialogs, and the start screen. The
 * stage's own window listens for the key too, since its keys reach no other.
 */

import { bindAttr } from './i18n';
import { setIcon } from './icons';
import { closeInspector, openInspector } from './inspector-tabs';
import { patchLayout } from './shell';
import { findControl, onStageWindow, stageIsOut } from './stage-window';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

/** The window as it was when theater came on, to put back; null is theater off. */
let before: { browseCollapsed: boolean; resultsCollapsed: boolean; drawerOpen: boolean } | null = null;

/** The stage's own window is full screen: theater, while the stage is out. */
let fullScreenOut = false;

/** Theater is on, in whichever form the stage's place gives it. */
export function theaterOn(): boolean {
  return stageIsOut() ? fullScreenOut : before !== null;
}

function apply(): void {
  const on = theaterOn();
  // Said on the window too (milestone 41): the results' heading stays as a thin bar when the
  // results are collapsed, so the way back stays with it — but theater wants the picture alone.
  $('app').classList.toggle('theater', on && !stageIsOut());
  // The button is on the stage's corner, wherever the stage is.
  const button = findControl('theater');
  if (!button) return;
  button.setAttribute('aria-pressed', String(on));
  bindAttr(button, 'aria-label', on ? 'theater.button.off.aria-label' : stageIsOut() ? 'theater.button.display.aria-label' : 'theater.button.window.aria-label');
  setIcon(button, on ? 'corners-in' : 'corners-out', 20);
}

/** Theater off in the main window: the panels back as they were. */
function restorePanels(): void {
  if (before === null) return;
  const was = before;
  before = null;
  patchLayout({ browseCollapsed: was.browseCollapsed, resultsCollapsed: was.resultsCollapsed });
  if (was.drawerOpen) openInspector();
}

function toggleTheater(): void {
  if (stageIsOut()) {
    void window.pulp.setStageWindowFullScreen(!fullScreenOut);
    return;
  }
  const app = $('app');
  if (before === null) {
    before = {
      browseCollapsed: app.classList.contains('browse-collapsed'),
      resultsCollapsed: app.classList.contains('results-collapsed'),
      drawerOpen: app.classList.contains('inspector-open'),
    };
    closeInspector();
    patchLayout({ browseCollapsed: true, resultsCollapsed: true });
  } else {
    restorePanels();
  }
  apply();
}

/** The bare `T`, wherever a key does not mean text. */
function onKey(e: KeyboardEvent): void {
  if ((e.key !== 't' && e.key !== 'T') || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, select, [contenteditable]') || target?.closest?.('dialog[open]')) return; // i18n-exempt(technical)
  if (!document.getElementById('start-screen')?.hidden) return;
  toggleTheater();
  e.preventDefault();
}

export function initTheater(): void {
  $('theater').addEventListener('click', toggleTheater);
  document.addEventListener('keydown', onKey);
  // The stage leaving for its own window (milestone 43): the main window is for browsing now, so
  // theater there ends and the panels come back; the window listens for the key itself; and its
  // full screen, by any means, is what the button shows.
  onStageWindow((doc) => {
    if (doc) {
      restorePanels();
      doc.addEventListener('keydown', onKey);
    } else {
      fullScreenOut = false;
    }
    apply();
  });
  window.pulp.onStageWindowFullScreen((on) => {
    fullScreenOut = on;
    apply();
  });
  apply();
}
