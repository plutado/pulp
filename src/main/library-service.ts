/**
 * The app's library: a persistent SQLite index in user data (ADR 0007), kept
 * current by incremental rescans. Rescans run on demand, when a watched root
 * changes, when the app window gains focus (if the last scan is older than a
 * few seconds), and when a root that had gone missing is back. Every scan
 * result is pushed to the UI as `library:changed`.
 *
 * Headless mode uses an in-memory store so `--library` folders are indexed
 * for that run only and nothing in user data is touched.
 */

import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LibraryStore, type ScanStats } from '../core/library-store';
import type { LibraryIndex, TemplateEntry } from '../core/library-types';
import { watchRoot, type RootWatcher } from '../core/library-watch';
import { loadSettings, saveSettings } from './settings';

/** Folder of sample templates shipped with the app. */
export function bundledTemplatesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'templates') : join(app.getAppPath(), 'templates');
}

/** How long a scan result counts as fresh when the window regains focus. */
export const FOCUS_RESCAN_AGE_MS = 5_000;
/** How often missing roots are checked for having come back. */
export const OFFLINE_ROOT_POLL_MS = 15_000;

let store: LibraryStore | null = null;
let persistent = true;
let extraRoots: string[] = [];
let firstScan: Promise<LibraryIndex> | null = null;
let lastScanAt = 0;
let lastStats: ScanStats | null = null;
const watchers = new Map<string, RootWatcher>();
let monitor: ReturnType<typeof setInterval> | null = null;
/** Scans run one at a time, in order. */
let chain: Promise<unknown> = Promise.resolve();

/** Headless mode: no database on disk; `--library` folders are indexed for the run only. */
export function useInMemoryLibrary(): void {
  persistent = false;
}

function getStore(): LibraryStore {
  store ??= new LibraryStore(persistent ? join(app.getPath('userData'), 'library.sqlite') : ':memory:');
  return store;
}

async function configuredRoots(): Promise<string[]> {
  const settings = await loadSettings();
  return [...new Set([bundledTemplatesDir(), ...settings.libraryFolders, ...extraRoots])];
}

function broadcast(index: LibraryIndex): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('library:changed', index);
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task);
  chain = next.catch(() => undefined);
  return next;
}

/** Keep one watcher per online root; drop watchers for roots that are gone or no longer configured. */
function syncWatchers(): void {
  const st = getStore();
  const wanted = new Set(st.roots().filter((r) => r.online).map((r) => r.path));
  for (const [root, watcher] of watchers) {
    if (!wanted.has(root)) {
      watcher.close();
      watchers.delete(root);
    }
  }
  for (const root of wanted) {
    if (watchers.has(root)) continue;
    const watcher = watchRoot(root, () => void rescanRoot(root));
    if (watcher) watchers.set(root, watcher);
  }
}

/** Rescan every configured root (plus `extraFolders` for this run) incrementally and tell the UI. */
export function rescan(extraFolders: string[] = []): Promise<LibraryIndex> {
  if (extraFolders.length > 0) extraRoots = [...new Set([...extraRoots, ...extraFolders])];
  const scan = enqueue(async () => {
    const st = getStore();
    const roots = await configuredRoots();
    st.setRoots(roots);
    lastStats = await st.scanRoots(roots);
    lastScanAt = Date.now();
    syncWatchers();
    const index = st.toIndex();
    broadcast(index);
    return index;
  });
  firstScan ??= scan;
  return scan;
}

/** Rescan one root after its watcher fired. */
function rescanRoot(root: string): Promise<void> {
  return enqueue(async () => {
    const st = getStore();
    await st.scanRoots([root]);
    lastScanAt = Date.now();
    syncWatchers();
    broadcast(st.toIndex());
  });
}

/** Rescan if the last scan is older than `maxAgeMs` (window focus). */
export async function rescanIfStale(maxAgeMs = FOCUS_RESCAN_AGE_MS): Promise<void> {
  if (Date.now() - lastScanAt < maxAgeMs) return;
  await rescan();
}

/** Rescan when a root that was offline exists again. */
export async function rescanIfRootReturned(): Promise<void> {
  const returned = getStore()
    .roots()
    .filter((r) => !r.online && existsSync(r.path));
  if (returned.length > 0) await rescan();
}

/**
 * The index. Stored items are returned at once; the first scan of the session
 * starts in the background and arrives as `library:changed`. With nothing
 * stored yet (first run, headless), the first scan is awaited instead.
 */
export async function getLibrary(): Promise<LibraryIndex> {
  const st = getStore();
  st.setRoots(await configuredRoots());
  const scan = firstScan ?? rescan();
  if (st.itemCount() > 0) return st.toIndex();
  return scan;
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
  await (firstScan ?? rescan());
  return getStore()
    .toIndex()
    .templates.find((t) => t.manifest.id === id);
}

/** Watch for returning roots. Idempotent. */
export function startLibraryMonitor(): void {
  monitor ??= setInterval(() => void rescanIfRootReturned(), OFFLINE_ROOT_POLL_MS);
}

export function lastScanStats(): ScanStats | null {
  return lastStats;
}

/** Stop watching and close the database (app quit). */
export function closeLibrary(): void {
  if (monitor) clearInterval(monitor);
  monitor = null;
  for (const watcher of watchers.values()) watcher.close();
  watchers.clear();
  store?.close();
  store = null;
}
