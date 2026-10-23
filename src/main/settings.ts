import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../core/atomic-file';
import { DEFAULT_LAYOUT, sanitizeLayout, type LayoutState } from '../core/layout';
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
}

const DEFAULTS: Settings = { libraryFolders: [], recentColors: [], recentSearches: [], renderCacheMaxMB: DEFAULT_CACHE_MAX_MB, layout: DEFAULT_LAYOUT };

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
