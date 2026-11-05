/**
 * Layouts made for vertical video (milestone 65): where words may sit in a
 * tall frame, and the check that the templates made for it keep them there.
 * docs/vertical-layouts.md says where each kind of element goes and why.
 *
 * Two measures, and a template made for vertical keeps its words inside both:
 *
 * - **The safe box** the published guides agree on — about 900 × 1400 centered
 *   in a 1080 × 1920 frame — clear of the short-video apps' furniture on every
 *   app they cover.
 * - **The vertical zones** the stage draws (milestone 19, `VERTICAL_ZONES` in
 *   src/core/player.ts): the header strip, the controls column and the caption
 *   band. The box is a rectangle and the furniture is not: the column reaches
 *   into the box's right side from mid-frame down, and the caption band into
 *   its bottom, so a word inside the box can still sit under a button.
 *
 * How a check finds the words in a picture drawn on a canvas: it draws the
 * frame twice, the second time with every letter of every word moved one along
 * the alphabet, and the words are wherever the two pictures differ. That sees
 * what is really drawn — an outline, a pop, a highlight sized to its word —
 * and needs nothing from a template beyond what it is already handed.
 */

import type { LibraryEntry } from './library-types';
import type { TemplateManifest } from './manifest';
import { VERTICAL_ZONES } from './player';

/** The tag a template made tall first carries; the library's search and browse read it as any tag. */
export const MADE_FOR_VERTICAL_TAG = 'made-for-vertical';

export function madeForVertical(manifest: Pick<TemplateManifest, 'tags'>): boolean {
  return (manifest.tags ?? []).includes(MADE_FOR_VERTICAL_TAG);
}

/** A shape id ("9:16") or a size that is taller than it is wide. */
export function isTallShape(shape: string | { width: number; height: number } | null | undefined): boolean {
  if (!shape) return false;
  if (typeof shape !== 'string') return shape.height > shape.width;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(shape);
  return !!m && Number(m[2]) > Number(m[1]);
}

/**
 * The work is tall, so the templates made for vertical lead (milestone 65): the session leans to
 * a tall shape — a "New 9:16 project", a platform such as TikTok — or a tall shape was **chosen**
 * for what is on the stage, in the Output tab of a template that draws more than one. Showing a
 * template that draws only one shape, or a media file, or nothing, says nothing either way, so the
 * last answer stands: clicking a hook that draws only 9:16 must not reorder the results under the
 * click. With nothing on the stage, a wide lean is not tall.
 */
export function workIsTall(
  context: { preferredAspect: string | null; platformAspect: string | null; shown: { size: { width: number; height: number } | null; aspects: readonly string[] } | null },
  previous: boolean,
): boolean {
  if (isTallShape(context.preferredAspect) || isTallShape(context.platformAspect)) return true;
  const shown = context.shown;
  if (shown && shown.aspects.length > 1 && shown.size) return isTallShape(shown.size);
  if (shown) return previous;
  return context.preferredAspect !== null || context.platformAspect !== null ? false : previous;
}

/**
 * Put the templates made for vertical first, keeping each group's own order, when the work is tall
 * and the results are in the default order with no words typed — as the polished set leads inside
 * its categories (src/core/polished.ts): there is no ranking then for the lead to disturb.
 */
export function verticalFirst(entries: readonly LibraryEntry[], context: { tallWork: boolean; sort: string; freeText: string }): LibraryEntry[] {
  if (!context.tallWork || context.sort !== 'relevance' || context.freeText.trim() !== '') return [...entries];
  const made = (e: LibraryEntry) => e.kind === 'template' && madeForVertical(e.manifest);
  return [...entries.filter(made), ...entries.filter((e) => !made(e))];
}

/** The frame the check is made at: 9:16 at the size the apps publish their guides for. */
export const VERTICAL_CHECK_SIZE = { width: 1080, height: 1920 } as const;

/** The safe box, as fractions of the frame: 900 × 1400 centered at 1080 × 1920. */
export const VERTICAL_SAFE_BOX = {
  left: 90 / 1080,
  top: 260 / 1920,
  width: 900 / 1080,
  height: 1400 / 1920,
} as const;

/**
 * Type sizes for a phone held at arm's length, as fractions of the frame's
 * short side (the unit a text layer's `size` is in): a headline at least 7% —
 * 76 px across a 1080 frame, about 4.5 mm tall on a phone, read in the first
 * second — and nothing a viewer has to read under 4%.
 */
export const ARM_LENGTH_TYPE = { headline: 0.07, smallest: 0.04 } as const;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Antialiasing and a font hinted a pixel differently on another machine are not a word out of place. */
export const PLACEMENT_TOLERANCE_PX = 2;

/**
 * What is wrong with words drawn at `rect` in a tall frame of this size: each
 * side of the safe box they cross and by how much, and each vertical zone they
 * reach into. Empty when they are clear.
 */
export function placementProblems(rect: PixelRect, width: number, height: number, tolerance = PLACEMENT_TOLERANCE_PX): string[] {
  const problems: string[] = [];
  const box = {
    left: VERTICAL_SAFE_BOX.left * width,
    top: VERTICAL_SAFE_BOX.top * height,
    right: (VERTICAL_SAFE_BOX.left + VERTICAL_SAFE_BOX.width) * width,
    bottom: (VERTICAL_SAFE_BOX.top + VERTICAL_SAFE_BOX.height) * height,
  };
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const past = (by: number, side: string) => {
    if (by > tolerance) problems.push(`${Math.round(by)} px past the safe box's ${side} edge`);
  };
  past(box.left - rect.x, 'left');
  past(box.top - rect.y, 'top');
  past(right - box.right, 'right');
  past(bottom - box.bottom, 'bottom');
  for (const zone of VERTICAL_ZONES) {
    const zx = zone.left * width, zy = zone.top * height;
    const zr = (zone.left + zone.width) * width, zb = (zone.top + zone.height) * height;
    const across = Math.min(right, zr) - Math.max(rect.x, zx);
    const down = Math.min(bottom, zb) - Math.max(rect.y, zy);
    if (across > tolerance && down > tolerance) problems.push(`${Math.round(across)} × ${Math.round(down)} px inside the ${zone.label.toLowerCase()}`);
  }
  return problems;
}

/**
 * The same words with every letter and digit moved one along — "Stop" to
 * "Tupq", "3" to "4", "z" to "a" — so the second picture differs wherever a
 * glyph is, and the words keep their length, their spaces and their shape on
 * the line closely enough that a box sized to them stays where it was.
 */
export function otherWords(text: string): string {
  return text.replace(/[A-Za-z0-9]/g, (c) => {
    if (c === 'z') return 'a';
    if (c === 'Z') return 'A';
    if (c === '9') return '0';
    return String.fromCharCode(c.charCodeAt(0) + 1);
  });
}

/** What of a frame's state carries words: block text layers, text parameters, and a caption line. */
interface WordyState {
  params: Record<string, unknown>;
  blocks?: Record<string, { layers?: { type?: string; text?: unknown }[] }>;
  captions?: { line: { text: string; words: { text: string }[] } | null } | null;
}

/**
 * A frame's state with every word changed (`otherWords`): the text layers in
 * its blocks, its text parameters — every one of them, so a parameter that
 * names a word of the headline (a keyword to highlight) still names it — and
 * the caption line's words. Nothing else differs, so the two pictures differ
 * only where words are drawn.
 */
export function withOtherWords<T extends WordyState>(state: T, textParams: readonly string[]): T {
  const out = JSON.parse(JSON.stringify(state)) as T;
  for (const id of textParams) {
    const value = out.params[id];
    if (typeof value === 'string') out.params[id] = otherWords(value);
  }
  for (const block of Object.values(out.blocks ?? {})) {
    for (const layer of block.layers ?? []) {
      if (layer.type === 'text' && typeof layer.text === 'string') layer.text = otherWords(layer.text);
    }
  }
  const line = out.captions?.line;
  if (line) {
    for (const word of line.words) word.text = otherWords(word.text);
    line.text = line.words.map((w) => w.text).join(' ');
  }
  return out;
}

/**
 * Where two pictures of one size differ, as the smallest rectangle holding
 * every pixel that moved by more than `threshold` in any channel; null when
 * nothing did. The channel order does not matter — both are compared alike.
 */
export function differingRect(a: Uint8Array, b: Uint8Array, width: number, height: number, threshold = 24): PixelRect | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (
        Math.abs(a[i]! - b[i]!) > threshold || Math.abs(a[i + 1]! - b[i + 1]!) > threshold
        || Math.abs(a[i + 2]! - b[i + 2]!) > threshold || Math.abs(a[i + 3]! - b[i + 3]!) > threshold
      ) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The frames whose words are checked: where the graphic has settled. A title
 * that declares a hold is checked at its start, middle and end — what a
 * viewer reads — and not mid-entrance, where a word sliding in from beyond the
 * box is the movement, not its place. Anything else, at its middle.
 */
export function placementFrames(manifest: Pick<TemplateManifest, 'duration' | 'fps' | 'structure'>): number[] {
  const at = (seconds: number) => Math.max(0, Math.min(Math.round(manifest.duration * manifest.fps) - 1, Math.round(seconds * manifest.fps)));
  const s = manifest.structure;
  if (s?.kind === 'hold') return [...new Set([at(s.holdFrom), at((s.holdFrom + s.holdTo) / 2), at(s.holdTo)])];
  return [at(manifest.duration / 2)];
}

/** A caption line long enough to wrap, with a long word in it, timed as speech is. */
const CHECK_WORDS = ['Nobody', 'tells', 'you', 'this', 'part', 'about', 'starting', 'something', 'new'];

/**
 * The caption moments a caption style is checked at: the line above with the
 * first, a middle and the last word being spoken, each caught a twentieth of a
 * second after it began — while a word that jumps or grows is at its largest.
 */
export function placementCaptions(box: PixelRect): { time: number; line: { text: string; start: number; end: number; words: { text: string; start: number; end: number }[] }; spoken: number; box: PixelRect }[] {
  const words = CHECK_WORDS.map((text, i) => ({ text, start: i * 0.35, end: i * 0.35 + 0.3 }));
  const line = { text: CHECK_WORDS.join(' '), start: 0, end: words.at(-1)!.end, words };
  return [0, Math.floor(words.length / 2), words.length - 1].map((spoken) => ({ time: words[spoken]!.start + 0.05, line, spoken, box }));
}
