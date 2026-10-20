import { app } from 'electron';
import { join } from 'node:path';
import { scanLibrary, type LibraryIndex, type TemplateEntry } from '../core/library';
import { loadSettings, saveSettings } from './settings';

/** Folder of sample templates shipped with the app. */
export function bundledTemplatesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'templates') : join(app.getAppPath(), 'templates');
}

let current: LibraryIndex | null = null;

/** Rescan all roots. `extraFolders` are scanned too but not saved (headless `--library`). */
export async function rescan(extraFolders: string[] = []): Promise<LibraryIndex> {
  const settings = await loadSettings();
  current = await scanLibrary([bundledTemplatesDir(), ...settings.libraryFolders, ...extraFolders]);
  return current;
}

export async function getLibrary(): Promise<LibraryIndex> {
  return current ?? rescan();
}

export async function addLibraryFolder(folder: string): Promise<LibraryIndex> {
  const settings = await loadSettings();
  if (!settings.libraryFolders.includes(folder)) {
    settings.libraryFolders.push(folder);
    await saveSettings(settings);
  }
  return rescan();
}

export async function findTemplate(id: string): Promise<TemplateEntry | undefined> {
  const index = await getLibrary();
  return index.templates.find((t) => t.manifest.id === id);
}
