/**
 * The polished set (milestone 61, docs/art-direction.md), the pure part: what
 * belongs to it, how its posters are framed, and where it stands in the
 * results.
 *
 * - **Framing.** Every polished piece is drawn in the same 100-unit box at the
 *   center of the frame and names the same poster moment (`posterAt`), so its
 *   poster takes one fixed crop instead of being cropped to what it draws: the
 *   grid reads as one set, each piece at the size it shares with the others,
 *   on the studio backdrop the results draw behind it.
 * - **Order.** Within Objects and Design elements, under the default order
 *   (relevance) and with no words typed to rank by, the polished pieces lead.
 *   Everything else keeps its place: a search, another order, or any other
 *   part of the library is untouched.
 */

import type { LibraryEntry } from './library-types';
import type { CropRect } from './poster';

export const POLISHED_STYLE = 'polished';

/** The browse categories whose polished pieces lead (src/core/categories.ts). */
export const POLISHED_LEAD_CATEGORIES: readonly string[] = ['objects', 'design-elements'];

/** A template drawn to the art direction: it carries the Polished look. */
export function isPolished(entry: LibraryEntry): boolean {
  return entry.kind === 'template' && (entry.manifest.styles ?? []).includes(POLISHED_STYLE);
}

/**
 * The one crop every polished poster takes: the middle of the frame, half its
 * short side tall, at the cards' 16:9 — the drawing box plus a margin, the
 * same for every piece so they read at one size. Even sides, as video sizes
 * must be.
 */
export function studioCrop(frame: { width: number; height: number }): CropRect {
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const height = even(Math.min(frame.width, frame.height) * 0.5);
  const width = even(Math.min(frame.width, (height * 16) / 9));
  return { x: even((frame.width - width) / 2), y: even((frame.height - height) / 2), width, height };
}

/**
 * Put the polished pieces first, keeping each group's own order, when the
 * results are scoped inside a category where they lead, ordered by relevance,
 * with no free text: there is no ranking then for the lead to disturb.
 */
export function polishedFirst(
  entries: readonly LibraryEntry[],
  context: { scopeGroup: string | undefined; sort: string; freeText: string },
): LibraryEntry[] {
  if (context.sort !== 'relevance' || context.freeText.trim() !== '') return [...entries];
  if (context.scopeGroup === undefined || !POLISHED_LEAD_CATEGORIES.includes(context.scopeGroup)) return [...entries];
  return [...entries.filter(isPolished), ...entries.filter((e) => !isPolished(e))];
}
