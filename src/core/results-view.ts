/**
 * The results region's view: grid or list, how big the cards are, what a card
 * badges and what a list row puts in its columns (docs/ui-layout.md). Pure — the
 * renderer turns this into elements, settings.json keeps the state, and the card
 * geometry below is what the virtualized list measures rows with, so the
 * stylesheet sizes cards from these numbers rather than the other way round.
 */

import { entryLabel } from './app-state';
import { orientationOf, templateDefaultSize, templateOrientations } from './aspect';
import { clockLabel, dimensionsLabel, mediaKindLabel, themeLabel, typeLabel } from './display';
import type { LibraryEntry } from './library-types';
import { resolutionLabel } from './media-meta';
import { entryType } from './taxonomy';

export type ViewMode = 'grid' | 'list';

/**
 * Which stored toggle a result set uses. Audio has nothing to show in a
 * thumbnail, so an all-audio list stays a list; anything visual starts as a grid
 * (David, 2026-10-23). A mixed set counts as visual.
 */
export type ResultsKind = 'visual' | 'audio';

export interface ResultsViewState {
  /** Grid or list, remembered per kind. */
  mode: Record<ResultsKind, ViewMode>;
  /** Card width in px, one of THUMB_SIZES. */
  thumbSize: number;
}

/** The steps the thumbnail-size control offers, smallest first. */
export const THUMB_SIZES = [120, 160, 200, 260] as const;

export const DEFAULT_RESULTS_VIEW: ResultsViewState = { mode: { visual: 'grid', audio: 'list' }, thumbSize: 160 };

const MODES: ViewMode[] = ['grid', 'list'];

function mode(raw: unknown, fallback: ViewMode): ViewMode {
  return MODES.includes(raw as ViewMode) ? (raw as ViewMode) : fallback;
}

/** Tolerates missing or damaged settings: every field falls back to its default, the size snaps to a step. */
export function sanitizeResultsView(raw: unknown): ResultsViewState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { mode?: Partial<Record<ResultsKind, unknown>>; thumbSize?: unknown };
  const m = r.mode && typeof r.mode === 'object' ? r.mode : {};
  return {
    mode: { visual: mode(m.visual, DEFAULT_RESULTS_VIEW.mode.visual), audio: mode(m.audio, DEFAULT_RESULTS_VIEW.mode.audio) },
    thumbSize: snapThumbSize(r.thumbSize),
  };
}

/** The nearest offered size; the default for anything unreadable. */
export function snapThumbSize(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_RESULTS_VIEW.thumbSize;
  return THUMB_SIZES.reduce((best, size) => (Math.abs(size - raw) < Math.abs(best - raw) ? size : best), THUMB_SIZES[0]);
}

/** Audio only when there is something to show and all of it is audio. */
export function resultsKind(entries: readonly LibraryEntry[]): ResultsKind {
  return entries.length > 0 && entries.every((e) => e.kind === 'media' && e.mediaKind === 'audio') ? 'audio' : 'visual';
}

export function viewModeFor(state: ResultsViewState, entries: readonly LibraryEntry[]): ViewMode {
  return state.mode[resultsKind(entries)];
}

/** Same object when nothing changes, so an unchanged state never causes a re-render or a save. */
export function withViewMode(state: ResultsViewState, kind: ResultsKind, next: ViewMode): ResultsViewState {
  return state.mode[kind] === next ? state : { ...state, mode: { ...state.mode, [kind]: next } };
}

export function withThumbSize(state: ResultsViewState, px: number): ResultsViewState {
  const thumbSize = snapThumbSize(px);
  return state.thumbSize === thumbSize ? state : { ...state, thumbSize };
}

// Card geometry. The stylesheet reads the card height as a custom property, so
// these numbers and the CSS cannot drift apart; the thumbnail takes whatever the
// text block leaves, which absorbs the rounding.

/** Breathing room around a card, inside its cell: cards carry their own gap so rows pitch exactly. */
export const CARD_PADDING = 4;
/** The gap between a card's thumbnail and its text block. */
export const CARD_GAP = 4;
/** Name line plus badge row under the thumbnail. */
export const CARD_TEXT_HEIGHT = 40;
/** One list row, thumbnail included. */
export const LIST_ROW_HEIGHT = 44;

/** The shape thumbnails take when nothing says otherwise: 16:9, as height over width. */
export const LANDSCAPE_RATIO = 9 / 16;
/** The tallest a card's picture is allowed to be: a full 9:16. Anything taller is letterboxed inside that. */
export const PORTRAIT_RATIO = 16 / 9;

/** The picture's own shape: a template's default size, a media file's probed one; null until known. */
export function entryShape(entry: LibraryEntry): { width: number; height: number } | null {
  const { width, height } = entrySize(entry);
  return width && height ? { width, height } : null;
}

/**
 * The CSS `aspect-ratio` a thumbnail takes. In a grid whose pitch is a tall
 * one — everything shown is square or taller — a card is drawn in its own
 * shape. In a grid at the landscape pitch every picture box is 16:9 and a
 * taller picture is contained inside it, which is what keeps a mixed grid
 * tight (see `gridRatio`).
 */
export function thumbAspect(entry: LibraryEntry, gridRatio: number = PORTRAIT_RATIO): string {
  if (gridRatio <= LANDSCAPE_RATIO) return '16 / 9';
  const shape = entryShape(entry);
  if (!shape) return '16 / 9';
  const ratio = Math.min(PORTRAIT_RATIO, Math.max(LANDSCAPE_RATIO, shape.height / shape.width));
  return ratio === shape.height / shape.width ? `${shape.width} / ${shape.height}` : ratio === PORTRAIT_RATIO ? '9 / 16' : '16 / 9';
}

/**
 * The tallest picture shape in a set, as height over width, between a
 * landscape 16:9 and a portrait 9:16.
 */
export function tallestRatio(entries: readonly LibraryEntry[]): number {
  let tallest = LANDSCAPE_RATIO;
  for (const entry of entries) {
    const shape = entryShape(entry);
    if (!shape) continue;
    tallest = Math.max(tallest, Math.min(PORTRAIT_RATIO, shape.height / shape.width));
    if (tallest >= PORTRAIT_RATIO) break;
  }
  return tallest;
}

/**
 * The one row pitch a grid is laid out on, as height over width.
 *
 * The windowing math needs every row the same height, and taking that from the
 * tallest picture anywhere in the results made a mixed grid loose: one square
 * logo in the library gave every wide card a square cell, so each picture and
 * its text sat in the top half with a band of nothing beneath.
 *
 * So the tall pitch is used only when **everything shown is square or taller** —
 * the Vertical chip pressed, a portrait folder, a library of square art — where
 * the height is what every card needs. The moment one wide item is shown the
 * grid goes to 16:9 and the taller pictures are contained inside that box,
 * keeping their shape badge (`thumbAspect`). An item whose shape is not known
 * yet is drawn 16:9, so it counts as a wide one.
 */
export function gridRatio(entries: readonly LibraryEntry[]): number {
  let tallest = LANDSCAPE_RATIO;
  let known = 0;
  for (const entry of entries) {
    const shape = entryShape(entry);
    if (!shape) return LANDSCAPE_RATIO;
    known += 1;
    const ratio = Math.min(PORTRAIT_RATIO, shape.height / shape.width);
    if (ratio < 1) return LANDSCAPE_RATIO;
    tallest = Math.max(tallest, ratio);
  }
  return known > 0 ? tallest : LANDSCAPE_RATIO;
}

/**
 * How many empty slots follow the last card: the cells left in its row, and
 * then whole rows down to the bottom of the region. A grid that ends halfway
 * across reads as unfinished; slots waiting to fill read as a grid.
 *
 * Only what is on screen is counted — the region must not grow a scrollbar for
 * outlines that hold nothing.
 */
export function trailingSlots(options: {
  count: number;
  columns: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
}): number {
  const { count, columns, rowHeight, viewportHeight, scrollTop } = options;
  if (columns < 1 || rowHeight <= 0) return 0;
  const rest = count % columns;
  const fillRow = rest === 0 ? 0 : columns - rest;
  const contentHeight = Math.ceil(count / columns) * rowHeight;
  const below = scrollTop + viewportHeight - contentHeight;
  const extraRows = below > 0 ? Math.ceil(below / rowHeight) : 0;
  return fillRow + extraRows * columns;
}

/** The picture's height inside a card of this width, for the tallest ratio the grid holds. */
export function thumbHeight(cardWidth: number, ratio = LANDSCAPE_RATIO): number {
  return Math.round((cardWidth - CARD_PADDING * 2) * ratio);
}

/** A card's full cell height for a card width; 16:9 pictures unless the grid holds something taller. */
export function cardHeight(cardWidth: number, ratio = LANDSCAPE_RATIO): number {
  return CARD_PADDING * 2 + thumbHeight(cardWidth, ratio) + CARD_GAP + CARD_TEXT_HEIGHT;
}

/** How many cards of this width fit across; at least one, however narrow the region. */
export function columnsFor(width: number, cardWidth: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(cardWidth) || cardWidth <= 0) return 1;
  return Math.max(1, Math.floor(width / cardWidth));
}

// What a card and a row show.

export type BadgeId = 'alpha' | 'loop' | 'duration' | 'resolution' | 'vertical' | 'square' | 'pack';

export interface ResultBadge {
  id: BadgeId;
  label: string;
  /** Tooltip: what the badge means, or the long form of what it shortens. */
  tip: string;
}

/** Seconds an item runs for: a template's declared duration, a media file's probed one. */
export function entryDuration(entry: LibraryEntry): number | undefined {
  return entry.kind === 'template' ? entry.manifest.duration : entry.meta?.duration;
}

function entrySize(entry: LibraryEntry): { width?: number; height?: number } {
  return entry.kind === 'template' ? templateDefaultSize(entry.manifest) : { width: entry.meta?.width, height: entry.meta?.height };
}

function hasAlpha(entry: LibraryEntry): boolean {
  return entry.kind === 'template' ? entry.manifest.alpha : entry.meta?.alpha === true;
}

/**
 * The badges on a card, in a fixed order. "Loop" comes from the taxonomy type
 * rather than a manifest field: an animated loop is what a looping item declares
 * itself to be, for templates and for media typed from their folders alike.
 */
export function entryBadges(entry: LibraryEntry): ResultBadge[] {
  const badges: ResultBadge[] = [];
  if (hasAlpha(entry)) badges.push({ id: 'alpha', label: 'Alpha', tip: 'Transparent background' });
  if (entryType(entry) === 'animated-loop') badges.push({ id: 'loop', label: 'Loop', tip: 'Made to loop seamlessly' });
  const seconds = entryDuration(entry);
  if (seconds !== undefined && seconds > 0) badges.push({ id: 'duration', label: clockLabel(seconds), tip: 'Duration' });
  const { width, height } = entrySize(entry);
  const short = resolutionLabel(width, height);
  if (short && width && height) badges.push({ id: 'resolution', label: short, tip: dimensionsLabel(width, height) });
  const orientation = entryOrientationBadge(entry);
  if (orientation) badges.push(orientation);
  if (entry.kind === 'template' && entry.pack) badges.push({ id: 'pack', label: entry.pack.name, tip: `From the pack ${entry.pack.name}` });
  return badges;
}

/**
 * A vertical or square item is recognizable without reading its size: a badge for
 * portrait and square shapes. A template that draws for several shapes badges
 * the tallest it offers, since that is what the landscape poster does not show.
 */
function entryOrientationBadge(entry: LibraryEntry): ResultBadge | null {
  if (entry.kind === 'template') {
    const shapes = templateOrientations(entry.manifest);
    const tall = entry.manifest.aspects.filter((a) => { const [w, h] = a.split(':').map(Number); return w !== undefined && h !== undefined && w < h; });
    if (shapes.includes('portrait')) return { id: 'vertical', label: 'Vertical', tip: shapes.length > 1 ? `Draws tall as well (${tall.join(', ')})` : 'Vertical' };
    if (shapes.includes('square')) return { id: 'square', label: 'Square', tip: shapes.length > 1 ? 'Draws square as well (1:1)' : 'Square' };
    return null;
  }
  const { width, height } = entrySize(entry);
  if (!width || !height) return null;
  const o = orientationOf(width, height);
  return o === 'portrait' ? { id: 'vertical', label: 'Vertical', tip: 'Vertical' } : o === 'square' ? { id: 'square', label: 'Square', tip: 'Square' } : null;
}

/** The list view's columns (docs/ui-layout.md): name, duration, type, themes, file. */
export interface ListRow {
  name: string;
  duration: string;
  type: string;
  themes: string;
  /** The file a media item is, or the folder a template lives in. */
  file: string;
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function listRow(entry: LibraryEntry): ListRow {
  const seconds = entryDuration(entry);
  const type = entryType(entry);
  return {
    name: entryLabel(entry).name,
    duration: seconds !== undefined && seconds > 0 ? clockLabel(seconds) : '',
    // An untyped media file still says what kind it is; an untyped template says nothing rather than guessing.
    type: type ? typeLabel(type) : entry.kind === 'media' ? mediaKindLabel(entry.mediaKind) : '',
    themes: (entry.themes ?? []).map(themeLabel).join(', '),
    file: entry.kind === 'media' ? baseName(entry.path) : baseName(entry.dir),
  };
}
