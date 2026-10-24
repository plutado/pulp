/**
 * The results region's view: grid or list, how big the cards are, what a card
 * badges and what a list row puts in its columns (docs/ui-layout.md). Pure — the
 * renderer turns this into elements, settings.json keeps the state, and the card
 * geometry below is what the virtualized list measures rows with, so the
 * stylesheet sizes cards from these numbers rather than the other way round.
 */

import { entryLabel } from './app-state';
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

/** A card's full cell height for a card width, thumbnails being 16:9. */
export function cardHeight(cardWidth: number): number {
  const thumb = Math.round(((cardWidth - CARD_PADDING * 2) * 9) / 16);
  return CARD_PADDING * 2 + thumb + CARD_GAP + CARD_TEXT_HEIGHT;
}

/** How many cards of this width fit across; at least one, however narrow the region. */
export function columnsFor(width: number, cardWidth: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(cardWidth) || cardWidth <= 0) return 1;
  return Math.max(1, Math.floor(width / cardWidth));
}

// What a card and a row show.

export type BadgeId = 'alpha' | 'loop' | 'duration' | 'resolution' | 'pack';

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
  return entry.kind === 'template' ? { width: entry.manifest.width, height: entry.manifest.height } : { width: entry.meta?.width, height: entry.meta?.height };
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
  if (entry.kind === 'template' && entry.pack) badges.push({ id: 'pack', label: entry.pack.name, tip: `From the pack ${entry.pack.name}` });
  return badges;
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
