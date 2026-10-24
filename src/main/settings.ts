import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../core/atomic-file';
import { DEFAULT_LAYOUT, sanitizeLayout, type LayoutState } from '../core/layout';
import { INFO_SECTIONS } from '../core/item-info';
import { DEFAULT_PLAYER, sanitizePlayer, type PlayerState } from '../core/player';
import { DEFAULT_RESULTS_VIEW, sanitizeResultsView, type ResultsViewState } from '../core/results-view';
import { sanitizeRecentColors } from '../core/recent-colors';
import { sanitizeRecentSearches } from '../core/recent-searches';
import { DEFAULT_CACHE_MAX_MB, sanitizeCacheMaxMB } from '../core/render-cache';

export interface Settings {
  /** User-chosen library folders, in the order they were added. */
  libraryFolders: string[];
  /** Recently used parameter colors, shared across templates, most recent first. */
  recentColors: string[];
  /** The last committed searches, most recent first. */
  recentSearches: string[];
  /** Folder for renders made for dragging; default render-cache in user data. */
  renderCacheDir?: string;
  /** Size limit of that folder in MiB; the oldest files are removed first. */
  renderCacheMaxMB: number;
  /** Shell pane sizes and collapsed state (src/core/layout.ts). */
  layout: LayoutState;
  /** Grid or list per kind and the thumbnail size (src/core/results-view.ts). */
  resultsView: ResultsViewState;
  /** Stage player preferences: loop, background, safe areas, volume (src/core/player.ts). */
  player: PlayerState;
  /** True once the "your editor links to this file" notice has been shown and dismissed. */
  dragNoticeSeen: boolean;
  /** Which Info tab sections are open, by section id (src/core/item-info.ts). */
  infoSections: Record<string, boolean>;
}

const DEFAULTS: Settings = {
  libraryFolders: [],
  recentColors: [],
  recentSearches: [],
  renderCacheMaxMB: DEFAULT_CACHE_MAX_MB,
  layout: DEFAULT_LAYOUT,
  resultsView: DEFAULT_RESULTS_VIEW,
  player: DEFAULT_PLAYER,
  dragNoticeSeen: false,
  infoSections: {},
};

/** Only the known section ids, only booleans; anything else in the file is ignored. */
function sanitizeInfoSections(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== 'object') return out;
  const known = new Set(INFO_SECTIONS.map((s) => s.id as string));
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (known.has(key) && typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function sanitize(raw: Partial<Settings>): Settings {
  return {
    libraryFolders: Array.isArray(raw.libraryFolders) ? raw.libraryFolders.filter((f): f is string => typeof f === 'string') : [],
    recentColors: sanitizeRecentColors(raw.recentColors),
    recentSearches: sanitizeRecentSearches(raw.recentSearches),
    renderCacheMaxMB: sanitizeCacheMaxMB(raw.renderCacheMaxMB),
    layout: sanitizeLayout(raw.layout),
    resultsView: sanitizeResultsView(raw.resultsView),
    player: sanitizePlayer(raw.player),
    dragNoticeSeen: raw.dragNoticeSeen === true,
    infoSections: sanitizeInfoSections(raw.infoSections),
    ...(typeof raw.renderCacheDir === 'string' && raw.renderCacheDir.trim() ? { renderCacheDir: raw.renderCacheDir } : {}),
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    return sanitize(JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<Settings>);
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Write the whole settings file atomically: a temporary file in the same
 * folder, renamed over settings.json, so a crash or a concurrent reader sees
 * the old file or the new one and never a half-written one.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await writeFileAtomic(settingsPath(), JSON.stringify(settings, null, 2) + '\n');
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Load, change and save under a queue, so two changes arriving close together
 * (two recent colors, a folder and a color) cannot overwrite each other's work.
 * Resolves to the saved settings.
 */
export function updateSettings(change: (current: Settings) => Settings | void): Promise<Settings> {
  const next = chain.then(async () => {
    const current = await loadSettings();
    const updated = change(current) ?? current;
    await saveSettings(updated);
    return updated;
  });
  chain = next.catch(() => undefined);
  return next;
}
