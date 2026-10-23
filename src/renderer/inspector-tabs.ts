/** The inspector's Parameters / Output / Info tabs. Panes are hidden, never unmounted,
 * so field state and listeners survive switching. */

const TABS = ['parameters', 'output', 'info'] as const;
export type InspectorTab = (typeof TABS)[number];

export function showInspectorTab(name: InspectorTab): void {
  for (const tab of TABS) {
    const active = tab === name;
    document.getElementById(`tab-${tab}`)?.setAttribute('aria-selected', String(active));
    const pane = document.getElementById(`pane-${tab}`);
    if (pane) pane.hidden = !active;
  }
}

export function initInspectorTabs(): void {
  for (const tab of TABS) {
    document.getElementById(`tab-${tab}`)?.addEventListener('click', () => showInspectorTab(tab));
  }
}
