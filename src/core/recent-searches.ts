/** The last few committed searches, most recent first, kept in settings.json. Pure. */

export const RECENT_SEARCHES_MAX = 8;

/** Records a committed search: trimmed, moved to the front, duplicates dropped, capped. */
export function addRecentSearch(list: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return list;
  const next = [q, ...list.filter((s) => s !== q)].slice(0, RECENT_SEARCHES_MAX);
  return next.length === list.length && next.every((s, i) => s === list[i]) ? list : next;
}

export function sanitizeRecentSearches(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, RECENT_SEARCHES_MAX);
}
