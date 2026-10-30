/** The search bar region: scope chip, sort, filter chips, the grid/list toggle
 * with the thumbnail size, and the recent-search history. The input element
 * itself stays wired in main.ts; everything here reads and writes the shared
 * state. */

import { effect } from '@preact/signals';
import { FILTER_CHIPS, setFor, setLook, setScope, setSort, toggleFilter, type SortKey } from '../core/app-state';
import { forOptions, lookOptions, scopeCategory, type ChipOption } from '../core/categories';
import { resultsKind, THUMB_SIZES, withThumbSize, withViewMode, type ResultsViewState, type ViewMode } from '../core/results-view';
import { appState, dispatch, facets, results, resultsView } from './store';
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

/** An option row: the label and, when it is known, how many items carry it. */
function optionFor(option: ChipOption): HTMLOptionElement {
  const el = document.createElement('option');
  el.value = option.id;
  el.textContent = option.count > 0 ? `${option.label} (${option.count})` : option.label;
  return el;
}

/**
 * The "For…" and "Look" chips (milestone 34): a theme and a style the results
 * are narrowed to, offered as selects dressed as chips. Each lists what the
 * library has, with counts, grouped the way the themes are; the one chosen
 * stays listed however the counts move, so it can always be cleared.
 */
function initNarrowingChips(): void {
  const forSelect = $('for-select') as HTMLSelectElement;
  const lookSelect = $('look-select') as HTMLSelectElement;
  forSelect.addEventListener('change', () => dispatch((s) => setFor(s, forSelect.value || null)));
  lookSelect.addEventListener('change', () => dispatch((s) => setLook(s, lookSelect.value || null)));
  effect(() => {
    const entries = facets.value;
    const { forTheme, look } = appState.value;
    const head = forSelect.options[0]!;
    forSelect.replaceChildren(head);
    for (const group of forOptions(entries, forTheme)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.label;
      for (const option of group.options) optgroup.append(optionFor(option));
      forSelect.append(optgroup);
    }
    forSelect.value = forTheme ?? '';
    head.textContent = forTheme ? 'For: any' : 'For…';
    forSelect.parentElement?.classList.toggle('set', forTheme !== null);

    const lookHead = lookSelect.options[0]!;
    lookSelect.replaceChildren(lookHead);
    for (const option of lookOptions(entries, look)) lookSelect.append(optionFor(option));
    lookSelect.value = look ?? '';
    lookHead.textContent = look ? 'Look: any' : 'Look';
    lookSelect.parentElement?.classList.toggle('set', look !== null);
  });
}

export function initSearchBar(): void {
  const chip = $('scope-chip');
  const chipLabel = $('scope-chip-label');
  const description = $('results-description');
  effect(() => {
    const scope = appState.value.scope;
    chip.hidden = scope === null;
    chipLabel.textContent = scope ? `in: ${scope.label}` : '';
    // One line on what the chosen category holds, under the results heading (milestone 34).
    const category = scopeCategory(scope);
    description.textContent = category ? (scope?.kind === 'type' ? `${category.label} · ${category.description}` : category.description) : '';
    description.title = description.textContent ?? '';
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
  initNarrowingChips();

  // The last eight committed searches feed the input's native suggestion list.
  void window.pulp.getRecentSearches().then(refreshHistory);
  const search = $('search') as HTMLInputElement;
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    if (q) void window.pulp.addRecentSearch(q).then(refreshHistory);
  });
}
