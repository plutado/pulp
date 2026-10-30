import { describe, expect, it } from 'vitest';
import type { FilterChipId, Scope } from '../src/core/app-state';
import type { LibraryIndex } from '../src/core/library-types';
import { emptyResults, resultsLabel, type ResultsContext } from '../src/core/results-empty';

const bare: LibraryIndex = { roots: ['/lib'], templates: [], media: [], problems: [], builtAt: '2026-10-25T00:00:00Z' };
const full: LibraryIndex = { ...bare, media: [{ kind: 'media', key: 'a', id: 'a', path: '/lib/a.png', root: '/lib', name: 'a', mediaKind: 'image', ext: '.png', size: 1, mtimeMs: 0, tags: [] }] };
const scope: Scope = { label: 'Lower third', filter: 'type:lower-third', kind: 'type' };

const ask = (over: Partial<ResultsContext> = {}) => emptyResults({ index: full, query: '', scope: null, filters: [], ...over });

describe('why the results are empty', () => {
  it('says nothing at all while the library is still being read', () => {
    expect(emptyResults({ index: null, query: 'x', scope: null, filters: [] })).toBeNull();
  });

  it('an empty library is about the library, whatever else is set', () => {
    for (const over of [{}, { query: 'news' }, { scope }, { filters: ['alpha'] as FilterChipId[] }]) {
      const empty = emptyResults({ index: bare, query: '', scope: null, filters: [], ...over });
      expect(empty?.reason, JSON.stringify(over)).toBe('library');
      expect(empty?.actions.map((a) => a.id)).toEqual(['add-folder', 'add-sample-media']);
    }
    expect(emptyResults({ index: bare, query: '', scope: null, filters: [] })?.title).toBe('Nothing in the library yet');
  });

  it('a search that matches nothing offers to clear what narrowed it, and quotes what was typed', () => {
    const typed = ask({ query: 'northwind' })!;
    expect(typed.reason).toBe('search');
    expect(typed.title).toBe('No matches for “northwind”');
    expect(typed.actions.map((a) => a.id)).toEqual(['clear-search']);
    // The For… and Look chips narrow like the others, and are cleared with them (milestone 34).
    const chipped = ask({ forTheme: 'wedding' })!;
    expect(chipped.reason).toBe('search');
    expect(chipped.actions).toEqual([{ id: 'clear-filters', label: 'Clear filter' }]);
    expect(ask({ forTheme: 'wedding', look: 'elegant' })!.actions.map((a) => a.label)).toEqual(['Clear filters']);
    // Whitespace alone is not a search.
    expect(ask({ query: '   ' })!.reason).toBe('none');
  });

  it('counts the chips when it offers to clear them, and offers each thing that narrows separately', () => {
    expect(ask({ filters: ['alpha'] })!.actions.map((a) => a.label)).toEqual(['Clear filter']);
    expect(ask({ filters: ['alpha', 'favorites'] })!.actions.map((a) => a.label)).toEqual(['Clear filters']);
    const both = ask({ query: 'x', filters: ['alpha'], scope })!;
    expect(both.actions.map((a) => a.id)).toEqual(['clear-search', 'clear-filters', 'clear-scope']);
    expect(both.detail).toContain('Lower third');
  });

  it('an empty corner of the library says so, and offers the whole library', () => {
    const only = ask({ scope })!;
    expect(only.reason).toBe('scope');
    expect(only.title).toBe('Nothing in Lower third yet');
    expect(only.actions.map((a) => a.id)).toEqual(['clear-scope']);
  });

  it('falls back to a plain line when nothing narrows a library that has things in it', () => {
    const none = ask()!;
    expect(none.reason).toBe('none');
    expect(none.title).toBe('Nothing to show');
    expect(none.actions).toEqual([]);
  });

  it('labels the region with its count, singular and plural', () => {
    expect(resultsLabel(0)).toBe('Results · 0 items');
    expect(resultsLabel(1)).toBe('Results · 1 item');
    expect(resultsLabel(42)).toBe('Results · 42 items');
  });
});
