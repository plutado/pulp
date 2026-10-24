/** The search bar region: scope chip, sort, filter chips, the grid/list toggle
 * with the thumbnail size, and the recent-search history. The input element
 * itself stays wired in main.ts; everything here reads and writes the shared
 * state. */

import { effect } from '@preact/signals';
import { FILTER_CHIPS, setScope, setSort, toggleFilter, type SortKey } from '../core/app-state';
import { resultsKind, THUMB_SIZES, withThumbSize, withViewMode, type ResultsViewState, type ViewMode } from '../core/results-view';
import { appState, dispatch, results, resultsView } from './store';
import { scopeIcon, setIcon } from './icons';

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

/**
 * Grid/list and thumbnail size. The toggle sets the mode for the kind the
 * current results are (audio lists keep their own), so switching back to a set
 * of the other kind finds it as it was left.
 */
function initViewControls(): void {
  /** Apply a pure change and persist it; an unchanged state writes nothing. */
  const update = (change: (state: ResultsViewState) => ResultsViewState) => {
    const next = change(resultsView.value);
    if (next === resultsView.value) return;
    resultsView.value = next;
    void window.pulp.saveResultsView(next);
  };

  const modes = ['grid', 'list'] as const;
  const buttons: Record<ViewMode, HTMLElement> = { grid: $('view-grid'), list: $('view-list') };
  for (const mode of modes) {
    buttons[mode].addEventListener('click', () => update((s) => withViewMode(s, resultsKind(results.value.entries), mode)));
  }

  const size = $('thumb-size') as HTMLInputElement;
  size.max = String(THUMB_SIZES.length - 1);
  size.addEventListener('input', () => update((s) => withThumbSize(s, THUMB_SIZES[Number(size.value)] ?? s.thumbSize)));

  effect(() => {
    const state = resultsView.value;
    const mode = state.mode[resultsKind(results.value.entries)];
    for (const m of modes) buttons[m].setAttribute('aria-pressed', String(m === mode));
    // The size control only means anything for cards.
    size.disabled = mode !== 'grid';
    const step = THUMB_SIZES.indexOf(state.thumbSize as (typeof THUMB_SIZES)[number]);
    size.value = String(step < 0 ? 0 : step);
  });

  void window.pulp.getResultsView().then((saved) => {
    resultsView.value = saved;
  });
}

export function initSearchBar(): void {
  const chip = $('scope-chip');
  const chipLabel = $('scope-chip-label');
  effect(() => {
    const scope = appState.value.scope;
    chip.hidden = scope === null;
    chipLabel.textContent = scope ? `in: ${scope.label}` : '';
    // A folder scope shows its humanized name; the full path is in the tooltip.
    if (scope?.root) chipLabel.dataset.tip = scope.root;
    else delete chipLabel.dataset.tip;
    const slot = $('scope-chip-icon');
    slot.querySelector('svg')?.remove();
    if (scope) setIcon(slot, scopeIcon(scope.kind, scope.group));
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

  initViewControls();

  // The last eight committed searches feed the input's native suggestion list.
  void window.pulp.getRecentSearches().then(refreshHistory);
  const search = $('search') as HTMLInputElement;
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    if (q) void window.pulp.addRecentSearch(q).then(refreshHistory);
  });
}
