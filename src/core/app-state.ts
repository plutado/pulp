/**
 * Shared UI state: one plain object, pure actions and derived values (ADR 0009).
 * No DOM and no Electron; the renderer wraps this in signals (`src/renderer/store.ts`),
 * regions render from it and change it only through the actions here.
 */

import type { LibraryEntry, LibraryIndex } from './library-types';
import { formatTimecode } from './timecode';
import { isFinished, type RenderJobStatus, type RenderQueueJob, type RenderQueueSnapshot } from './render-queue';
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

/** What the drag handle carries: a cached file ready to drag, or the job rendering one. */
export type DragTarget = { file: string; templateId: string } | { jobId: number } | null;

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
  drag: DragTarget;
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
  drag: null,
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

export function setJobs(s: AppState, jobs: RenderQueueSnapshot): AppState {
  return s.jobs === jobs ? s : { ...s, jobs };
}

export function setDrag(s: AppState, drag: DragTarget): AppState {
  return s.drag === drag ? s : { ...s, drag };
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
  return [`${entry.mediaKind} · ${entry.ext.slice(1)} · ${formatBytes(entry.size)}`, describeMeta(entry), entry.path].filter(Boolean).join(' · ');
}

/** A sequence output pattern drags as its first frame file. */
export function dragFileFor(job: RenderQueueJob): string {
  const output = job.output ?? job.outputPath;
  const m = /%(0?)(\d*)d/.exec(output);
  if (!m) return output;
  const width = m[2] ? Number(m[2]) : 0;
  return output.slice(0, m.index) + String(job.firstFrame ?? 0).padStart(width, m[1] === '0' ? '0' : ' ') + output.slice(m.index + m[0].length);
}

/**
 * What a queue change means for a drag in progress: the handle arms when the job it
 * waits for finishes, and reports the failure otherwise. Null when nothing changes.
 */
export function resolveDragJob(
  s: Pick<AppState, 'drag' | 'jobs'>,
): { drag: DragTarget; status: string; error: boolean; cacheChanged: boolean } | null {
  if (!s.drag || !('jobId' in s.drag)) return null;
  const job = s.jobs.jobs.find((j) => j.id === (s.drag as { jobId: number }).jobId);
  if (!job || job.status === 'queued' || job.status === 'running') return null;
  if (job.status === 'done' && job.output) {
    return { drag: { file: dragFileFor(job), templateId: job.templateId }, status: 'Ready to drag.', error: false, cacheChanged: true };
  }
  return { drag: null, status: job.message ?? 'The render did not finish.', error: true, cacheChanged: false };
}

// Derived values.

/** Scope filter text, pressed chips and the typed query joined; what the results are searched with. */
export function effectiveQuery(s: Pick<AppState, 'query' | 'scope' | 'filters'>): string {
  const chipText = FILTER_CHIPS.filter((c) => s.filters.includes(c.id)).map((c) => c.filter);
  return [s.scope?.filter ?? '', ...chipText, s.query].join(' ').trim();
}

/** Results beyond the cap are not rendered; milestone 12's virtualized list removes the cap. */
export const RESULT_CAP = 500;

export interface ResultsView {
  entries: LibraryEntry[];
  /** How many matched before the cap. */
  total: number;
  capped: boolean;
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
  if (!s.index) return { entries: [], total: 0, capped: false, canExportPack: false };
  let hits = searchLibrary(s.index, effectiveQuery(s));
  if (s.scope?.root !== undefined) hits = hits.filter((h) => h.entry.root === s.scope?.root);
  const entries = sortEntries(hits.map((h) => h.entry), s.sort);
  return {
    entries: entries.slice(0, RESULT_CAP),
    total: hits.length,
    capped: hits.length > RESULT_CAP,
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

/** The browse panel's nodes until milestone 10 adds the tree: Favorites, Recently used, one per folder. */
export function browseScopes(index: LibraryIndex | null): Scope[] {
  const folders = (index?.roots ?? []).map((root) => ({
    label: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
    root,
  }));
  return [{ label: 'Favorites', filter: 'favorite:yes' }, { label: 'Recently used', filter: 'recent:yes' }, ...folders];
}

/** Two scopes are the same browse node. */
export function sameScope(a: Scope | null, b: Scope | null): boolean {
  return a?.label === b?.label && a?.filter === b?.filter && a?.root === b?.root;
}

export function hasFinishedJobs(s: AppState): boolean {
  return s.jobs.jobs.some(isFinished);
}

/** One line for the collapsed tray: "No renders yet." or "3 renders · 1 running · 2 done". */
export function traySummary(s: AppState): string {
  const jobs = s.jobs.jobs;
  if (jobs.length === 0) return 'No renders yet.';
  const counts = new Map<RenderJobStatus, number>();
  for (const j of jobs) counts.set(j.status, (counts.get(j.status) ?? 0) + 1);
  const order: RenderJobStatus[] = ['running', 'queued', 'done', 'failed', 'cancelled'];
  const parts = order.filter((st) => counts.has(st)).map((st) => `${counts.get(st)} ${st}`);
  return `${jobs.length} ${jobs.length === 1 ? 'render' : 'renders'} · ${parts.join(' · ')}`;
}

/** Name and meta line for a result row or the stage details. */
export function entryLabel(entry: LibraryEntry): { name: string; meta: string } {
  if (entry.kind === 'template') {
    const m = entry.manifest;
    return { name: m.name, meta: `${m.category} · ${m.duration}s · ${m.width}x${m.height}${m.alpha ? ' · alpha' : ''}` };
  }
  return { name: entry.name, meta: [`${entry.mediaKind} · ${entry.ext.slice(1)} · ${formatBytes(entry.size)}`, describeMeta(entry)].filter(Boolean).join(' · ') };
}

/** "1920x1080 · 00:00:06:00 · prores · alpha", from probed metadata; empty until probed. */
export function describeMeta(entry: Extract<LibraryEntry, { kind: 'media' }>): string {
  const m = entry.meta;
  if (!m) return '';
  const parts: string[] = [];
  if (m.width && m.height) parts.push(`${m.width}x${m.height}`);
  if (m.duration) {
    const fps = m.fps ?? 25;
    parts.push(formatTimecode(Math.round(m.duration * fps), fps));
  }
  if (m.fps && entry.mediaKind === 'video') parts.push(`${m.fps} fps`);
  if (m.codec) parts.push(m.codec);
  if (m.alpha) parts.push('alpha');
  if (m.audioCodec && !m.codec) parts.push(`${m.audioCodec}${m.channels ? ` · ${m.channels}ch` : ''}${m.sampleRate ? ` · ${m.sampleRate / 1000} kHz` : ''}`);
  return parts.join(' · ');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
