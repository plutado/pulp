/**
 * Theater (milestone 38): the picture as big as the window allows without
 * leaving the app. The browse panel folds to its icon rail, the results strip
 * hides and the drawer closes, so the stage runs from the rail to the window's
 * right edge and down to the transport row — which stays, its scrub bar still
 * under the picture. Toggled off, everything comes back as it was: the panel's
 * state, the results, an open drawer. A snapshot, not a setting.
 *
 * Toggled by the button on the stage's corner and by the bare `T`, which
 * cannot be a menu accelerator — a bare key registered there would shadow
 * typing (docs/ui-layout.md) — so the window listens, and stands aside
 * wherever a key means text: fields, dialogs, and the start screen.
 */

import { setIcon } from './icons';
import { closeInspector, openInspector } from './inspector-tabs';
import { patchLayout } from './shell';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

/** The window as it was when theater came on, to put back; null is theater off. */
let before: { browseCollapsed: boolean; resultsCollapsed: boolean; drawerOpen: boolean } | null = null;

function apply(): void {
  const on = before !== null;
  // Said on the window too (milestone 41): the results' heading stays as a thin bar when the
  // results are collapsed, so the way back stays with it — but theater wants the picture alone.
  $('app').classList.toggle('theater', on);
  const button = $('theater');
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', on ? 'Theater off: bring the panels back' : 'Theater: the stage takes the window');
  setIcon(button, on ? 'corners-in' : 'corners-out', 20);
}

function toggleTheater(): void {
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
    const was = before;
    before = null;
    patchLayout({ browseCollapsed: was.browseCollapsed, resultsCollapsed: was.resultsCollapsed });
    if (was.drawerOpen) openInspector();
  }
  apply();
}

export function initTheater(): void {
  $('theater').addEventListener('click', toggleTheater);
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 't' && e.key !== 'T') || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable]') || target?.closest?.('dialog[open]')) return;
    if (!document.getElementById('start-screen')?.hidden) return;
    toggleTheater();
    e.preventDefault();
  });
  apply();
}
