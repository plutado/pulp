/**
 * Shared UI state: one plain object, pure actions and derived values (ADR 0009).
 * No DOM and no Electron; the renderer wraps this in signals (`src/renderer/store.ts`),
 * regions render from it and change it only through the actions here.
 */

import type { LibraryEntry, LibraryIndex } from './library-types';
import { formatTimecode } from './timecode';
import { isFinished, type RenderQueueSnapshot } from './render-queue';
import { searchLibrary } from './search';

/** A browse-tree node narrowing the results: its label for the scope chip, its search filter text. */
export interface Scope {
  label: string;
  filter: string;
}

export interface AppState {
  index: LibraryIndex | null;
  /** The search field's text. */
  query: string;
  /** The selected browse node, or null for the whole library. */
  scope: Scope | null;
  /** Key of the entry shown as selected in the results, or null. */
  selectedKey: string | null;
  jobs: RenderQueueSnapshot;
}

export const initialAppState: AppState = {
  index: null,
  query: '',
  scope: null,
  selectedKey: null,
  jobs: { jobs: [] },
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

export function setSelection(s: AppState, selectedKey: string | null): AppState {
  return s.selectedKey === selectedKey ? s : { ...s, selectedKey };
}

export function setJobs(s: AppState, jobs: RenderQueueSnapshot): AppState {
  return s.jobs === jobs ? s : { ...s, jobs };
}

// Derived values.

/** The scope's filter text joined with the typed query; what the results are searched with. */
export function effectiveQuery(s: AppState): string {
  return s.scope ? `${s.scope.filter} ${s.query}`.trim() : s.query;
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

export function deriveResults(s: AppState): ResultsView {
  if (!s.index) return { entries: [], total: 0, capped: false, canExportPack: false };
  const hits = searchLibrary(s.index, effectiveQuery(s));
  return {
    entries: hits.slice(0, RESULT_CAP).map((h) => h.entry),
    total: hits.length,
    capped: hits.length > RESULT_CAP,
    canExportPack: hits.some((h) => h.entry.kind === 'template' && !h.entry.offline),
  };
}

export function hasFinishedJobs(s: AppState): boolean {
  return s.jobs.jobs.some(isFinished);
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
