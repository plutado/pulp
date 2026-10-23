import { describe, expect, it } from 'vitest';
import { addRecentSearch, RECENT_SEARCHES_MAX, sanitizeRecentSearches } from '../src/core/recent-searches';

describe('addRecentSearch', () => {
  it('adds to the front, trims, dedupes and caps', () => {
    expect(addRecentSearch([], '  lower third  ')).toEqual(['lower third']);
    expect(addRecentSearch(['a', 'b'], 'b')).toEqual(['b', 'a']);
    const full = Array.from({ length: RECENT_SEARCHES_MAX }, (_, i) => `q${i}`);
    const added = addRecentSearch(full, 'new');
    expect(added).toHaveLength(RECENT_SEARCHES_MAX);
    expect(added[0]).toBe('new');
    expect(added).not.toContain(`q${RECENT_SEARCHES_MAX - 1}`);
  });

  it('ignores empty queries and keeps identity when unchanged', () => {
    const list = ['a'];
    expect(addRecentSearch(list, '   ')).toBe(list);
    expect(addRecentSearch(list, 'a')).toBe(list);
  });
});

describe('sanitizeRecentSearches', () => {
  it('drops garbage and caps the list', () => {
    expect(sanitizeRecentSearches(undefined)).toEqual([]);
    expect(sanitizeRecentSearches(['a', 7, '', '  ', 'b'])).toEqual(['a', 'b']);
    expect(sanitizeRecentSearches(Array.from({ length: 20 }, (_, i) => `q${i}`))).toHaveLength(RECENT_SEARCHES_MAX);
  });
});
