import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../core/atomic-file';
import { sanitizeRecentColors } from '../core/recent-colors';

export interface Settings {
  /** User-chosen library folders, in the order they were added. */
  libraryFolders: string[];
  /** Recently used parameter colors, shared across templates, most recent first. */
  recentColors: string[];
}

const DEFAULTS: Settings = { libraryFolders: [], recentColors: [] };

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function sanitize(raw: Partial<Settings>): Settings {
  return {
    libraryFolders: Array.isArray(raw.libraryFolders) ? raw.libraryFolders.filter((f): f is string => typeof f === 'string') : [],
    recentColors: sanitizeRecentColors(raw.recentColors),
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
