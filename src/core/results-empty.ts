/**
 * What the results region says when it has nothing to show, and why.
 *
 * An empty region that only says "No matches." leaves the reader to work out
 * whether they typed something too narrow, picked an empty corner of the
 * library, or have no library at all — and gives them nothing to do about it.
 * Each reason has its own words and its own way out. Pure, so the wording is
 * checked without a window.
 */

import type { FilterChipId, Scope } from './app-state';
import { tr } from './i18n';
import type { LibraryIndex } from './library-types';

/** Why the region is empty. */
export type EmptyReason =
  /** No folders, or folders with nothing in them: there is no library yet. */
  | 'library'
  /** Something was typed, or a chip is pressed, and nothing matches it. */
  | 'search'
  /** A browse node is selected and the library has nothing under it. */
  | 'scope'
  /** The library has things and nothing narrows it, yet nothing came back. */
  | 'none';

/** Something the reader can do about it; the region turns each into a button. */
export type EmptyActionId = 'clear-search' | 'clear-filters' | 'clear-scope' | 'add-folder' | 'add-sample-media';

export interface EmptyAction {
  id: EmptyActionId;
  label: string;
}

export interface EmptyResults {
  reason: EmptyReason;
  /** The one line that says what is going on. */
  title: string;
  /** A sentence under it, where there is more worth saying. */
  detail?: string;
  actions: EmptyAction[];
}

export interface ResultsContext {
  index: Pick<LibraryIndex, 'templates' | 'media' | 'roots'> | null;
  query: string;
  scope: Scope | null;
  filters: readonly FilterChipId[];
  /** The "For…" and "Look" chips (milestone 34); chips like the others, cleared with them. */
  forTheme?: string | null;
  look?: string | null;
}

/**
 * Why the results are empty, and what to offer. Returns null while the library
 * is still being read, and for a region that is not empty at all — the caller
 * decides that from the count, since only it knows what matched.
 */
export function emptyResults(context: ResultsContext): EmptyResults | null {
  const { index, scope, filters } = context;
  if (!index) return null;
  const query = context.query.trim();

  // Nothing anywhere: the library itself is what is missing, whatever else is set.
  if (index.templates.length === 0 && index.media.length === 0) {
    return {
      reason: 'library', // i18n-exempt(technical): which reason, not its words
      title: tr('results.empty.library.title'),
      detail: tr('results.empty.library.detail'),
      actions: [
        // The words the Add menu uses, so the same thing is called the same thing (milestone 47).
        { id: 'add-folder', label: tr('results.empty.add-folder') },
        { id: 'add-sample-media', label: tr('results.empty.add-sample-media') },
      ],
    };
  }

  // Something was asked for and nothing answers: offer to undo each thing that narrows it.
  const chips = filters.length + (context.forTheme ? 1 : 0) + (context.look ? 1 : 0);
  if (query !== '' || chips > 0) {
    const actions: EmptyAction[] = [];
    if (query !== '') actions.push({ id: 'clear-search', label: tr('results.empty.clear-search') });
    if (chips > 0) actions.push({ id: 'clear-filters', label: tr('results.empty.clear-filters', { count: chips }) });
    if (scope) actions.push({ id: 'clear-scope', label: tr('results.empty.clear-scope') });
    return {
      reason: 'search', // i18n-exempt(technical): which reason, not its words
      title: query !== '' ? tr('results.empty.search.title-query', { query }) : tr('results.empty.search.title'),
      detail: scope ? tr('results.empty.search.detail-scope', { scope: scope.label }) : undefined,
      actions,
    };
  }

  // A corner of the library with nothing in it.
  if (scope) {
    return {
      reason: 'scope', // i18n-exempt(technical): which reason, not its words
      title: tr('results.empty.scope.title', { scope: scope.label }),
      detail: tr('results.empty.scope.detail'),
      actions: [{ id: 'clear-scope', label: tr('results.empty.clear-scope') }],
    };
  }

  // i18n-exempt(technical): which reason, not its words
  return { reason: 'none', title: tr('results.empty.none.title'), actions: [] };
}

/** The region's own label, which says what it holds whether or not it holds anything. */
export function resultsLabel(count: number): string {
  return tr('results.label', { count });
}
