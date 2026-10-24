/**
 * Shared UI state: one plain object, pure actions and derived values (ADR 0009).
 * No DOM and no Electron; the renderer wraps this in signals (`src/renderer/store.ts`),
 * regions render from it and change it only through the actions here.
 */

import { collectionSummary, emptyCollection, resolveCollection, type Collection, type CollectionItem } from './collection';
import type { LibraryEntry, LibraryIndex } from './library-types';
import { templateDefaultSize } from './aspect';
import { audioLabel, categoryLabel, codecLabel, dimensionsLabel, durationLabel, extensionLabel, frameRateLabel, mediaKindLabel, rootLabel, sizeLabel, typeLabel } from './display';
import { buildBrowseTree, type TreeNode } from './browse-tree';

import { formatTimecode } from './timecode';
import { isFinished, type RenderJobStatus, type RenderQueueSnapshot } from './render-queue';
import { searchLibrary } from './search';

/**
 * A browse node narrowing the results: its label for the scope chip, plus either
 * search filter text (favorites, recent; types and themes in milestone 10) or a
 * library root matched structurally, since a path does not survive query tokenizing.
 */
export interface Scope {
  label: string;
  filter?: string;
  root?: string;
  /** What kind of node this is, so the UI can pick its icon. */
  kind?: 'favorites' | 'recent' | 'built-in' | 'folder' | 'type' | 'group' | 'untyped' | 'theme' | 'style' | 'pack';
  /** For type and group scopes: the type group, which chooses the icon. */
  group?: string;
}

export type SortKey = 'relevance' | 'name' | 'recent' | 'duration';

/** The filter chips in the search bar; each contributes query text while pressed. */
export const FILTER_CHIPS = [
  { id: 'templates', label: 'Templates', filter: 'type:template' },
  { id: 'video', label: 'Video', filter: 'type:video' },
  { id: 'image', label: 'Images', filter: 'type:image' },
  { id: 'audio', label: 'Audio', filter: 'type:audio' },
  { id: 'alpha', label: 'Alpha', filter: 'alpha:yes' },
  { id: 'favorites', label: 'Favorites', filter: 'favorite:yes' },
] as const;
export type FilterChipId = (typeof FILTER_CHIPS)[number]['id'];


export interface AppState {
  index: LibraryIndex | null;
  /** The search field's text. */
  query: string;
  /** The selected browse node, or null for the whole library. */
  scope: Scope | null;
  /** Pressed filter chips. */
  filters: FilterChipId[];
  sort: SortKey;
  /** Key of the entry shown as selected in the results, or null. */
  selectedKey: string | null;
  /** Key of the entry the stage and Info tab show (a template or a media item), or null. */
  shownKey: string | null;
  jobs: RenderQueueSnapshot;
  /** The gathered items and their settings (src/core/collection.ts). */
  collection: Collection;
  /** The collection card whose settings the inspector is editing, or null for the library selection. */
  editing: string | null;
  /** Name of the collection file this came from, for the window title and the next save. */
  collectionName: string;
}

export const initialAppState: AppState = {
  index: null,
  query: '',
  scope: null,
  filters: [],
  sort: 'relevance',
  selectedKey: null,
  shownKey: null,
  jobs: { jobs: [] },
  collection: emptyCollection,
  editing: null,
  collectionName: '',
};

// Actions. Each returns the same object when nothing changes, so an unchanged
// state never causes a re-render.

export function setIndex(s: AppState, index: LibraryIndex | null): AppState {
  return s.index === index ? s : { ...s, index };
}

export function setQuery(s: AppState, query: string): AppState {
  return s.query === query ? s : { ...s, query };
}

export function setScope(s: AppState, scope: Scope | null): AppState {
  return s.scope === scope ? s : { ...s, scope };
}

export function toggleFilter(s: AppState, id: FilterChipId): AppState {
  const filters = s.filters.includes(id) ? s.filters.filter((f) => f !== id) : [...s.filters, id];
  return { ...s, filters };
}

export function setSort(s: AppState, sort: SortKey): AppState {
  return s.sort === sort ? s : { ...s, sort };
}

export function setSelection(s: AppState, selectedKey: string | null): AppState {
  return s.selectedKey === selectedKey ? s : { ...s, selectedKey };
}

export function setCollection(s: AppState, collection: Collection, name?: string): AppState {
  if (s.collection === collection && (name === undefined || name === s.collectionName)) return s;
  return { ...s, collection, ...(name === undefined ? {} : { collectionName: name }) };
}

/** Which collection card the inspector edits; null hands it back to the library selection. */
export function setEditing(s: AppState, editing: string | null): AppState {
  return s.editing === editing ? s : { ...s, editing };
}

/** The card being edited, looked up fresh so a change to the collection is seen. */
export function editingItem(s: Pick<AppState, 'collection' | 'editing'>): CollectionItem | null {
  return s.editing === null ? null : (s.collection.items.find((i) => i.uid === s.editing) ?? null);
}

export function setJobs(s: AppState, jobs: RenderQueueSnapshot): AppState {
  return s.jobs === jobs ? s : { ...s, jobs };
}

export function setShown(s: AppState, shownKey: string | null): AppState {
  return s.shownKey === shownKey ? s : { ...s, shownKey };
}

/** The entry the stage and Info tab show, looked up fresh so a rescan updates it. */
export function shownEntry(s: Pick<AppState, 'index' | 'shownKey'>): LibraryEntry | null {
  if (!s.shownKey || !s.index) return null;
  return [...s.index.templates, ...s.index.media].find((e) => e.key === s.shownKey) ?? null;
}

/** The Info tab's details line. */
export function itemDetails(entry: LibraryEntry): string {
  if (entry.kind === 'template') {
    const m = entry.manifest;
    return [m.description, `License: ${m.license}`, m.author ? `Author: ${m.author}` : ''].filter(Boolean).join('  ·  ');
  }
  const kind = entry.type ? `${mediaKindLabel(entry.mediaKind)} · ${typeLabel(entry.type)}` : mediaKindLabel(entry.mediaKind);
  return [`${kind} · ${extensionLabel(entry.ext)} · ${sizeLabel(entry.size)}`, describeMeta(entry), entry.path].filter(Boolean).join(' · ');
}



// Derived values.

/** Scope filter text, pressed chips and the typed query joined; what the results are searched with. */
export function effectiveQuery(s: Pick<AppState, 'query' | 'scope' | 'filters'>): string {
  const chipText = FILTER_CHIPS.filter((c) => s.filters.includes(c.id)).map((c) => c.filter);
  return [s.scope?.filter ?? '', ...chipText, s.query].join(' ').trim();
}

/**
 * Every match, however many: the results region renders only the rows and cards
 * in view (src/core/virtual-list.ts), so there is nothing to cap.
 */
export interface ResultsView {
  entries: LibraryEntry[];
  /** True when at least one listed template is online, so a pack export has content. */
  canExportPack: boolean;
}

/** The only parts of the state the results depend on; a change elsewhere (selection, jobs) must not recompute them. */
export type ResultsInput = Pick<AppState, 'index' | 'query' | 'scope' | 'filters' | 'sort'>;

/** What an entry sorts by under each key; missing values go last. */
function sortValue(entry: LibraryEntry, sort: SortKey): string | number | undefined {
  if (sort === 'name') return entryLabel(entry).name.toLowerCase();
  if (sort === 'recent') return entry.lastUsed;
  if (sort === 'duration') return entry.kind === 'template' ? entry.manifest.duration : entry.meta?.duration;
  return undefined;
}

function sortEntries(entries: LibraryEntry[], sort: SortKey): LibraryEntry[] {
  if (sort === 'relevance') return entries;
  const sorted = [...entries].sort((a, b) => {
    const va = sortValue(a, sort);
    const vb = sortValue(b, sort);
    if (va === undefined && vb === undefined) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    if (va === vb) return 0;
    // Name and duration ascending, most recently used first.
    const less = va < vb ? -1 : 1;
    return sort === 'recent' ? -less : less;
  });
  return sorted;
}

export function deriveResults(s: ResultsInput): ResultsView {
  if (!s.index) return { entries: [], canExportPack: false };
  let hits = searchLibrary(s.index, effectiveQuery(s));
  if (s.scope?.root !== undefined) hits = hits.filter((h) => h.entry.root === s.scope?.root);
  return {
    entries: sortEntries(hits.map((h) => h.entry), s.sort),
    canExportPack: hits.some((h) => h.entry.kind === 'template' && !h.entry.offline),
  };
}

/**
 * A results selector that searches only when its inputs changed and otherwise returns
 * the previous view object, so a store can tell "nothing to re-render" by identity.
 */
export function createResultsSelector(): (s: ResultsInput) => ResultsView {
  let last: (ResultsInput & { view: ResultsView }) | null = null;
  return (s) => {
    if (last && last.index === s.index && last.query === s.query && last.scope === s.scope && last.filters === s.filters && last.sort === s.sort) return last.view;
    const view = deriveResults(s);
    last = { index: s.index, query: s.query, scope: s.scope, filters: s.filters, sort: s.sort, view };
    return view;
  };
}

/**
 * The entries the browse tree counts: what the typed query and the chips leave, before
 * the scope narrows it, so selecting a node never zeroes out the others.
 */
export function facetEntries(s: ResultsInput): LibraryEntry[] {
  if (!s.index) return [];
  return searchLibrary(s.index, effectiveQuery({ query: s.query, filters: s.filters, scope: null })).map((h) => h.entry);
}

/** Rebuilds the tree only when the index, the query or the chips changed; the same object otherwise. */
export function createTreeSelector(): (s: ResultsInput) => TreeNode[] {
  let last: { index: LibraryIndex | null; query: string; filters: FilterChipId[]; tree: TreeNode[] } | null = null;
  return (s) => {
    if (last && last.index === s.index && last.query === s.query && last.filters === s.filters) return last.tree;
    const tree = buildBrowseTree(facetEntries(s), s.index?.roots ?? [], s.index?.builtInRoot);
    last = { index: s.index, query: s.query, filters: s.filters, tree };
    return tree;
  };
}

/** The flat list of fixed nodes; the tree (browse-tree.ts) supersedes it for the panel, it stays for the Favorites and Recent scopes. */
export function browseScopes(index: LibraryIndex | null): Scope[] {
  const folders = (index?.roots ?? []).map(
    (root): Scope => ({ label: rootLabel(root, index?.builtInRoot), root, kind: root === index?.builtInRoot ? 'built-in' : 'folder' }),
  );
  return [{ label: 'Favorites', filter: 'favorite:yes', kind: 'favorites' }, { label: 'Recently used', filter: 'recent:yes', kind: 'recent' }, ...folders];
}

/**
 * The entry a step through the results lands on: the one after or before the
 * shown item, clamped at the ends. With nothing shown, a step forward starts at
 * the first and a step back at the last. Null when there is nothing to step to.
 */
export function neighbourEntry(entries: readonly LibraryEntry[], shownKey: string | null, delta: number): LibraryEntry | null {
  if (entries.length === 0) return null;
  const at = entries.findIndex((e) => e.key === shownKey);
  if (at === -1) return entries[delta >= 0 ? 0 : entries.length - 1] ?? null;
  return entries[Math.min(entries.length - 1, Math.max(0, at + delta))] ?? null;
}

/** Two scopes are the same browse node. */
export function sameScope(a: Scope | null, b: Scope | null): boolean {
  return a?.label === b?.label && a?.filter === b?.filter && a?.root === b?.root;
}

export function hasFinishedJobs(s: AppState): boolean {
  return s.jobs.jobs.some(isFinished);
}

/** One line for the collapsed tray: "No renders yet." or "3 renders · 1 running · 2 done". */
/**
 * The one line the collapsed tray shows: what is collected and what is
 * rendering, in that order. Both or either; "Nothing collected yet." when there
 * is neither.
 */
export function traySummary(s: AppState): string {
  const parts: string[] = [];
  if (s.collection.items.length > 0) parts.push(collectionSummary(resolveCollection(s.collection, s.index)));
  const jobs = s.jobs.jobs;
  if (jobs.length > 0) {
    const counts = new Map<RenderJobStatus, number>();
    for (const j of jobs) counts.set(j.status, (counts.get(j.status) ?? 0) + 1);
    const order: RenderJobStatus[] = ['running', 'queued', 'done', 'failed', 'cancelled'];
    const by = order.filter((st) => counts.has(st)).map((st) => `${counts.get(st)} ${st}`);
    parts.push(`${jobs.length} ${jobs.length === 1 ? 'render' : 'renders'} · ${by.join(' · ')}`);
  }
  return parts.length === 0 ? 'Nothing collected yet.' : parts.join('  ·  ');
}

/** Name and meta line for a result row or the stage details. */
export function entryLabel(entry: LibraryEntry): { name: string; meta: string } {
  if (entry.kind === 'template') {
    const m = entry.manifest;
    // The declared type when there is one; the category it was written with otherwise.
    const kind = m.type ? typeLabel(m.type) : categoryLabel(m.category);
    const size = templateDefaultSize(m);
    return { name: m.name, meta: `${kind} · ${durationLabel(m.duration)} · ${dimensionsLabel(size.width, size.height)}${m.alpha ? ' · Alpha' : ''}` };
  }
  return { name: entry.name, meta: [`${mediaKindLabel(entry.mediaKind)} · ${extensionLabel(entry.ext)} · ${sizeLabel(entry.size)}`, describeMeta(entry)].filter(Boolean).join(' · ') };
}

/** "1920 × 1080 · 00:00:06:00 · ProRes · Alpha", from probed metadata; empty until probed. */
export function describeMeta(entry: Extract<LibraryEntry, { kind: 'media' }>): string {
  const m = entry.meta;
  if (!m) return '';
  const parts: string[] = [];
  if (m.width && m.height) parts.push(dimensionsLabel(m.width, m.height));
  if (m.duration) {
    const fps = m.fps ?? 25;
    parts.push(formatTimecode(Math.round(m.duration * fps), fps));
  }
  if (m.fps && entry.mediaKind === 'video') parts.push(frameRateLabel(m.fps));
  if (m.codec) parts.push(codecLabel(m.codec));
  if (m.alpha) parts.push('Alpha');
  if (m.audioCodec && !m.codec) parts.push(audioLabel(m.audioCodec, m.channels, m.sampleRate));
  return parts.join(' · ');
}

/** Kept under its old name for callers; the implementation lives in display.ts. */
export const formatBytes = sizeLabel;
