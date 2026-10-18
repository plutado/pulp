import { app } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface Settings {
  /** User-chosen library folders, in the order they were added. */
  libraryFolders: string[];
}

const DEFAULTS: Settings = { libraryFolders: [] };

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<Settings>;
    return {
      libraryFolders: Array.isArray(raw.libraryFolders)
        ? raw.libraryFolders.filter((f): f is string => typeof f === 'string')
        : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}
