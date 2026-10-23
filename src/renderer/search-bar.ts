/** The search bar region: scope chip, sort, filter chips and the recent-search
 * history. The input element itself stays wired in main.ts; everything here reads
 * and writes the shared state. */

import { effect } from '@preact/signals';
import { FILTER_CHIPS, setScope, setSort, toggleFilter, type SortKey } from '../core/app-state';
import { appState, dispatch } from './store';
import { setIcon, type IconName } from './icons';

const SCOPE_ICONS: Record<NonNullable<import('../core/app-state').Scope['kind']>, IconName> = {
  favorites: 'star',
  recent: 'clock',
  'built-in': 'package',
  folder: 'folder',
};

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

function refreshHistory(list: string[]): void {
  const datalist = $('search-history');
  datalist.replaceChildren(
    ...list.map((q) => {
      const option = document.createElement('option');
      option.value = q;
      return option;
    }),
  );
}

export function initSearchBar(): void {
  const chip = $('scope-chip');
  const chipLabel = $('scope-chip-label');
  effect(() => {
    const scope = appState.value.scope;
    chip.hidden = scope === null;
    chipLabel.textContent = scope ? `in: ${scope.label}` : '';
    const slot = $('scope-chip-icon');
    slot.querySelector('svg')?.remove();
    if (scope?.kind) setIcon(slot, SCOPE_ICONS[scope.kind]);
  });
  $('scope-chip-clear').addEventListener('click', () => dispatch((s) => setScope(s, null)));

  for (const def of FILTER_CHIPS) {
    const button = $(`chip-${def.id}`);
    button.addEventListener('click', () => dispatch((s) => toggleFilter(s, def.id)));
  }
  effect(() => {
    const active = appState.value.filters;
    for (const def of FILTER_CHIPS) $(`chip-${def.id}`).setAttribute('aria-pressed', String(active.includes(def.id)));
  });

  const sort = $('sort') as HTMLSelectElement;
  sort.addEventListener('change', () => dispatch((s) => setSort(s, sort.value as SortKey)));
  effect(() => {
    sort.value = appState.value.sort;
  });

  // The last eight committed searches feed the input's native suggestion list.
  void window.pulp.getRecentSearches().then(refreshHistory);
  const search = $('search') as HTMLInputElement;
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    if (q) void window.pulp.addRecentSearch(q).then(refreshHistory);
  });
}
