/**
 * The results region's view: grid or list, how big the cards are, what a card
 * badges and what a list row puts in its columns (docs/ui-layout.md). Pure — the
 * renderer turns this into elements, settings.json keeps the state, and the card
 * geometry below is what the virtualized list measures rows with, so the
 * stylesheet sizes cards from these numbers rather than the other way round.
 */

import { unreadableNote } from './unreadable-media';
import { versionLabel } from './music-groups';
import { entryLabel } from './app-state';
import { orientationOf, templateDefaultSize, templateOrientations } from './aspect';
import { dimensionsLabel, mediaKindLabel, runningTime, themeLabel, typeLabel } from './display';
import { tr } from './i18n';
import type { LibraryEntry } from './library-types';
import { resolutionTag } from './media-meta';
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

export type BadgeId = 'alpha' | 'loop' | 'resolution' | 'vertical' | 'square' | 'pack' | 'sound' | 'clip-set' | 'archive' | 'versions' | 'stems' | 'missing' | 'unreadable' | 'preview';

/**
 * The badges that are words, drawn as outlined tags; the rest are icons with their meaning in the
 * tooltip, set apart after the tags (milestone 66). Only the resolution is a word now: the duration
 * left the row for a pill over the thumbnail (entryRunningTime).
 */
export const TAG_BADGES: readonly BadgeId[] = ['resolution'];

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

export function hasAlpha(entry: LibraryEntry): boolean {
  return entry.kind === 'template' ? entry.manifest.alpha : entry.meta?.alpha === true;
}

/**
 * How long an item runs, as the clock reading a card shows over its thumbnail ("0:04"); undefined
 * for a still or anything with no length yet (milestone 66).
 */
export function entryRunningTime(entry: LibraryEntry): string | undefined {
  const seconds = entryDuration(entry);
  return seconds !== undefined && seconds > 0 ? runningTime(seconds) : undefined;
}

/**
 * The badges on a card, in a fixed order: the tags first (TAG_BADGES), then the icons. "Loop" comes
 * from the taxonomy type rather than a manifest field: an animated loop is what a looping item
 * declares itself to be, for templates and for media typed from their folders alike.
 */
export function entryBadges(entry: LibraryEntry): ResultBadge[] {
  const badges: ResultBadge[] = [];
  const { width, height } = entrySize(entry);
  const tag = resolutionTag(width, height);
  if (tag && width && height) badges.push({ id: 'resolution', label: tag, tip: dimensionsLabel(width, height) });
  if (hasAlpha(entry)) badges.push({ id: 'alpha', label: tr('results.badge.alpha'), tip: tr('results.badge.alpha.tip') });
  if (entryType(entry) === 'animated-loop') badges.push({ id: 'loop', label: tr('results.badge.loop'), tip: tr('results.badge.loop.tip') });
  // A file Pulp cannot read, listed with what it needs (milestone 32).
  if (entry.kind === 'media' && entry.unreadable) badges.push({ id: 'unreadable', label: tr('results.badge.unreadable'), tip: unreadableNote(entry.path.split(/[\\/]/).pop()!, entry.unreadable.ext, entry.unreadable.encrypted) });
  // Listed by the library's catalog, not on this computer (milestone 32).
  if (entry.kind === 'media' && entry.missing) badges.push({ id: 'missing', label: tr('results.badge.missing'), tip: tr('results.badge.missing.tip') });
  // Music and sound effects in a stock library (milestone 32).
  if (entry.kind === 'media' && entry.versions?.length) badges.push({ id: 'versions', label: tr('results.badge.versions', { count: entry.versions.length }), tip: tr('results.badge.versions.tip', { lengths: entry.versions.map((v) => versionLabel(v.label, tr('music.version.full'))).join(', ') }) });
  if (entry.kind === 'media' && entry.stemParts?.length) badges.push({ id: 'stems', label: tr('results.badge.stems', { count: entry.stemParts.length }), tip: tr('results.badge.stems.tip', { stems: entry.stemParts.map((v) => v.label).join(', ') }) });
  if (entry.kind === 'media' && entry.pairedSound) badges.push({ id: 'sound', label: tr('results.badge.sound'), tip: tr('results.badge.paired-sound.tip') });
  // In a zip archive, not unpacked yet (milestone 32): browsed as it is, unpacked when it is used.
  if (entry.kind === 'media' && entry.archive && !entry.archive.unpacked) badges.push({ id: 'archive', label: tr('results.badge.archive'), tip: tr('results.badge.archive.tip', { zip: entry.archive.zip.split(/[\\/]/).pop()! }) });
  // Browsed from the library's own small preview (milestone 32): the full file is read when it is used.
  if (entry.kind === 'media' && entry.preview && !entry.missing) badges.push({ id: 'preview', label: tr('results.badge.preview'), tip: tr('results.badge.preview.tip') });
  // A clip set (milestone 32): one item made of an intro, a loop and an outro, that stretches.
  if (entry.kind === 'media' && entry.clipSet) badges.push({ id: 'clip-set', label: tr('results.badge.clip-set'), tip: tr('results.badge.clip-set.tip', { parts: clipSetPartsLabel(entry.clipSet) }) });
  const orientation = entryOrientationBadge(entry);
  if (orientation) badges.push(orientation);
  if (entry.kind === 'template' && entry.pack) badges.push({ id: 'pack', label: entry.pack.name, tip: tr('results.badge.pack.tip', { name: entry.pack.name }) });
  // A template that carries its own sound (milestone 16) says so on its card, with how many variations.
  if (entry.kind === 'template' && entry.manifest.sound) {
    const count = entry.manifest.sound.variants.length;
    badges.push({ id: 'sound', label: tr('results.badge.sound'), tip: count > 1 ? tr('results.badge.sound.tip-variations', { count }) : tr('results.badge.sound.tip') });
  }
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
    if (shapes.includes('portrait')) return { id: 'vertical', label: tr('results.badge.vertical'), tip: shapes.length > 1 ? tr('results.badge.vertical.tip-also', { aspects: tall.join(', ') }) : tr('results.badge.vertical') };
    if (shapes.includes('square')) return { id: 'square', label: tr('results.badge.square'), tip: shapes.length > 1 ? tr('results.badge.square.tip-also') : tr('results.badge.square') };
    return null;
  }
  const { width, height } = entrySize(entry);
  if (!width || !height) return null;
  const o = orientationOf(width, height);
  return o === 'portrait' ? { id: 'vertical', label: tr('results.badge.vertical'), tip: tr('results.badge.vertical') } : o === 'square' ? { id: 'square', label: tr('results.badge.square'), tip: tr('results.badge.square') } : null;
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
    duration: seconds !== undefined && seconds > 0 ? runningTime(seconds) : '',
    // An untyped media file still says what kind it is; an untyped template says nothing rather than guessing.
    type: type ? typeLabel(type) : entry.kind === 'media' ? mediaKindLabel(entry.mediaKind) : '',
    themes: (entry.themes ?? []).map(themeLabel).join(', '),
    file: entry.kind === 'media' ? baseName(entry.path) : baseName(entry.lottie?.path ?? entry.dir),
  };
}

/** A set's parts as a list in the interface's language: "intro, loop and outro". */
export function clipSetPartsLabel(set: { intro?: string; outro?: string }): string {
  return set.intro && set.outro ? tr('clip-set.parts.all') : set.intro ? tr('clip-set.parts.intro') : tr('clip-set.parts.outro');
}
