/**
 * The inspector drawer (milestone 38): Parameters, Output and Info are three
 * buttons in the transport row. Choosing one opens the drawer, which rises from
 * the row over the results — never over the stage, so the picture stays in view
 * while a title is typed. Choosing the active tab again, the close button or
 * Esc closes it; the pin keeps it open while other items are chosen, for a run
 * of edits. The drawer's height and last tab are kept in settings.json through
 * the shell; whether it is open is not kept — it starts closed.
 *
 * Panes are hidden, never unmounted, so field state and listeners survive
 * switching — and everything in them stays readable and pressable while the
 * drawer is closed, which the end-to-end tests lean on.
 */

import { INSPECTOR_TABS, type InspectorTab } from '../core/layout';
import { setIcon } from './icons';
import { onLayoutApplied, patchLayout } from './shell';

export type { InspectorTab };

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

let open = false;
let active: InspectorTab = 'parameters';
let pinned = false;

function apply(): void {
  $('app').classList.toggle('inspector-open', open);
  for (const tab of INSPECTOR_TABS) {
    const chosen = tab === active;
    $(`tab-${tab}`).setAttribute('aria-selected', String(chosen));
    $(`pane-${tab}`).hidden = !chosen;
  }
}

/** Prime the active tab without opening or persisting: what selecting an item does. */
export function showInspectorTab(name: InspectorTab): void {
  if (name === active) return;
  active = name;
  apply();
}

/** Open the drawer on this tab (or where it was), remembering a chosen tab. */
export function openInspector(name?: InspectorTab): void {
  const was = active;
  if (name) active = name;
  open = true;
  // The drawer lives over the results, so hidden results come back with it.
  if ($('app').classList.contains('results-collapsed')) $('results-toggle').click();
  apply();
  if (name && name !== was) patchLayout({ inspectorTab: name });
}

export function closeInspector(): void {
  if (!open) return;
  open = false;
  apply();
}

/** Choosing another item in the results closes the drawer — unless the pin holds it through a run of edits. */
export function closeInspectorUnlessPinned(): void {
  if (!pinned) closeInspector();
}

/** The row's tab buttons: open on this tab, switch to it, or choose it again to close. */
function toggleTab(name: InspectorTab): void {
  if (open && name === active) closeInspector();
  else openInspector(name);
}

export function initInspectorTabs(): void {
  for (const tab of INSPECTOR_TABS) {
    $(`tab-${tab}`).addEventListener('click', () => toggleTab(tab));
  }
  $('inspector-close').addEventListener('click', closeInspector);
  const pin = $('inspector-pin');
  pin.addEventListener('click', () => {
    pinned = !pinned;
    pin.setAttribute('aria-pressed', String(pinned));
    setIcon(pin, pinned ? 'push-pin-fill' : 'push-pin', 16);
  });
  document.addEventListener('keydown', (e) => {
    // A dialog's own Escape is the dialog's; the drawer answers everywhere else.
    if (e.key !== 'Escape' || !open || (e.target as Element | null)?.closest?.('dialog[open]')) return;
    closeInspector();
  });
  // The saved layout carries the last tab; it arrives through the shell after first paint.
  // Adopted only when the stored value itself changes: any pane resize re-applies the layout,
  // and must not drag the tab back from wherever a selection has primed it since.
  let seenTab: InspectorTab | null = null;
  onLayoutApplied((l) => {
    if (seenTab === l.inspectorTab) return;
    seenTab = l.inspectorTab;
    if (l.inspectorTab === active) return;
    active = l.inspectorTab;
    apply();
  });
  apply();
}
