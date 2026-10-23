/**
 * Recently used colors: shared across templates, most recent first, no
 * duplicates, capped. Pure; the main process stores the list in settings.
 */

import { parseColorText } from './color';

export const RECENT_COLORS_MAX = 8;

/** The list with `hex` moved to the front; invalid input leaves it unchanged. */
export function addRecentColor(list: readonly string[], hex: string, max = RECENT_COLORS_MAX): string[] {
  const color = parseColorText(hex);
  if (!color) return [...list];
  return [color, ...list.filter((c) => c !== color)].slice(0, max);
}

/** A stored list cleaned up: valid colors only, normalized, deduplicated, capped. */
export function sanitizeRecentColors(value: unknown, max = RECENT_COLORS_MAX): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const color = typeof item === 'string' ? parseColorText(item) : null;
    if (color && !out.includes(color)) out.push(color);
    if (out.length === max) break;
  }
  return out;
}
