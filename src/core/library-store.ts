/**
 * Persistent library index in one SQLite database (node:sqlite, built into
 * Node 22.13+ and Electron 44), kept in the app's user data folder; ADR 0007.
 *
 * Scans are incremental: a media file whose size and mtime match the stored
 * row is kept without being re-read, a template folder whose template.json
 * is unchanged keeps its parsed entry, and only files that are new or changed
 * are loaded. A root that has gone missing marks its items offline instead
 * of deleting them, so user data (tags, favorites) attached to them survives
 * until the folder comes back. Nothing is ever written into library folders.
 *
 * Uses node:fs and node:sqlite only; no Electron dependency. `:memory:` gives
 * a throwaway store, which is what `scanLibrary` uses.
 */

import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MANIFEST_FILENAME } from './manifest';
import type { LibraryEntry, LibraryIndex, LibraryProblem, MediaEntry, TemplateEntry } from './library-types';
import { folderTags, itemId, loadTemplate, mediaKindForPath, SKIP_DIRECTORIES } from './library-scan';
import type { MediaLookup } from './media-serve';

export interface ScanOptions {
  /** Maximum directory depth below each root. Default 12. */
  maxDepth?: number;
  /** Stop after this many files across all roots, to keep a mis-chosen root (e.g. a whole disk) bounded. Default 100000. */
  maxFiles?: number;
}

/** What one scan did, for logs and tests. */
export interface ScanStats {
  roots: number;
  /** Files and template folders visited. */
  visited: number;
  /** Items whose stored row was reused unchanged. */
  kept: number;
  /** Items read or parsed because they were new or changed. */
  loaded: number;
  /** Stored items no longer present in a root that is online. */
  removed: number;
  ms: number;
}

/** Per-item user data, kept apart from scan results so it survives rescans and offline periods. */
export interface UserItemData {
  tags: string[];
  favorite: boolean;
  /** ISO time of the last selection or render, if any. */
  lastUsed?: string;
}

interface RootRow {
  path: string;
  position: number;
  online: number;
  missing_reason: string | null;
}

interface ItemRow {
  key: string;
  id: string;
  root: string;
  kind: string;
  size: number;
  mtime_ms: number;
  entry: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roots (
  path TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  online INTEGER NOT NULL DEFAULT 1,
  missing_reason TEXT,
  scanned_at TEXT
);
CREATE TABLE IF NOT EXISTS items (
  key TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  root TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  entry TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_root ON items(root);
CREATE UNIQUE INDEX IF NOT EXISTS items_id ON items(id);
CREATE TABLE IF NOT EXISTS problems (
  root TEXT NOT NULL,
  path TEXT NOT NULL,
  message TEXT NOT NULL,
  issues TEXT
);
CREATE INDEX IF NOT EXISTS problems_root ON problems(root);
CREATE TABLE IF NOT EXISTS user_items (
  key TEXT PRIMARY KEY,
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used TEXT
);
`;

export const SCHEMA_VERSION = 2;

export class LibraryStore {
  private readonly db: DatabaseSync;

  constructor(readonly file: string = ':memory:') {
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const stored = (this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined)?.value;
    if (stored !== undefined && Number(stored) !== SCHEMA_VERSION) {
      // Scan results are rebuilt by the next scan; user data has its own table and is kept.
      this.db.exec('DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS problems;');
    }
    this.db.exec(SCHEMA);
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema', String(SCHEMA_VERSION));
  }

  close(): void {
    this.db.close();
  }

  /** Configured roots, in order. Roots no longer configured are dropped with their items; user data stays. */
  setRoots(paths: string[]): void {
    const roots = [...new Set(paths.map((p) => resolve(p)))];
    const tx = this.db;
    tx.exec('BEGIN');
    try {
      const keep = roots.length ? roots.map(() => '?').join(',') : "''";
      tx.prepare(`DELETE FROM items WHERE root NOT IN (${keep})`).run(...roots);
      tx.prepare(`DELETE FROM problems WHERE root NOT IN (${keep})`).run(...roots);
      tx.prepare(`DELETE FROM roots WHERE path NOT IN (${keep})`).run(...roots);
      const upsert = tx.prepare(
        'INSERT INTO roots (path, position) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET position = excluded.position',
      );
      roots.forEach((r, i) => upsert.run(r, i));
      tx.exec('COMMIT');
    } catch (err) {
      tx.exec('ROLLBACK');
      throw err;
    }
  }

  roots(): { path: string; online: boolean; missingReason?: string }[] {
    return (this.db.prepare('SELECT path, position, online, missing_reason FROM roots ORDER BY position').all() as unknown as RootRow[]).map(
      (r) => ({ path: r.path, online: r.online === 1, ...(r.missing_reason ? { missingReason: r.missing_reason } : {}) }),
    );
  }

  /** Mark a root as not reachable. Its items stay, flagged offline in the index. */
  markOffline(root: string, reason = 'library root does not exist'): void {
    this.db.prepare('UPDATE roots SET online = 0, missing_reason = ? WHERE path = ?').run(reason, resolve(root));
  }

  /** Scan the given roots incrementally. Roots must have been registered with setRoots. */
  async scanRoots(roots: string[], options: ScanOptions = {}): Promise<ScanStats> {
    const started = Date.now();
    const maxDepth = options.maxDepth ?? 12;
    const maxFiles = options.maxFiles ?? 100_000;
    const stats: ScanStats = { roots: 0, visited: 0, kept: 0, loaded: 0, removed: 0, ms: 0 };
    let fileCount = 0;

    for (const rootPath of [...new Set(roots.map((r) => resolve(r)))]) {
      stats.roots += 1;
      try {
        if (!(await stat(rootPath)).isDirectory()) {
          this.markOffline(rootPath, 'library root is not a folder');
          continue;
        }
      } catch {
        this.markOffline(rootPath);
        continue;
      }

      const existing = new Map<string, ItemRow>();
      for (const row of this.db.prepare('SELECT key, id, root, kind, size, mtime_ms, entry FROM items WHERE root = ?').all(rootPath) as unknown as ItemRow[]) {
        existing.set(row.key, row);
      }
      const seen = new Set<string>();
      const problems: LibraryProblem[] = [];
      const upserts: { key: string; kind: string; size: number; mtimeMs: number; entry: LibraryEntry }[] = [];
      let truncated = false;

      const walk = async (dir: string, depth: number): Promise<void> => {
        if (fileCount >= maxFiles) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (err) {
          problems.push({ path: dir, message: `could not read folder: ${(err as Error).message}` });
          return;
        }

        if (entries.some((e) => e.isFile() && e.name === MANIFEST_FILENAME)) {
          // A template folder is one item, keyed by its folder; its assets are not library media.
          stats.visited += 1;
          const key = `template:${dir}`;
          seen.add(key);
          let info;
          try {
            info = await stat(join(dir, MANIFEST_FILENAME));
          } catch (err) {
            problems.push({ path: join(dir, MANIFEST_FILENAME), message: `could not read manifest: ${(err as Error).message}` });
            return;
          }
          const stored = existing.get(key);
          if (stored && stored.size === info.size && stored.mtime_ms === info.mtimeMs && (await entryStillExists(stored))) {
            stats.kept += 1;
            return;
          }
          stats.loaded += 1;
          const loaded = await loadTemplate(dir, rootPath);
          if ('kind' in loaded) upserts.push({ key, kind: 'template', size: info.size, mtimeMs: info.mtimeMs, entry: loaded });
          else {
            problems.push(loaded);
            seen.delete(key); // a broken template is not an item; drop any stale row
          }
          return;
        }

        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const full = join(dir, entry.name);
          // Symlinks are skipped to avoid cycles and surprising scans outside the chosen roots.
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            if (SKIP_DIRECTORIES.has(entry.name)) continue;
            if (depth < maxDepth) await walk(full, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          const kind = mediaKindForPath(entry.name);
          if (!kind) continue;
          if (fileCount >= maxFiles) {
            if (!truncated) problems.push({ path: rootPath, message: `stopped after ${maxFiles} files` });
            truncated = true;
            return;
          }
          fileCount += 1;
          stats.visited += 1;
          const key = `media:${full}`;
          seen.add(key);
          let info;
          try {
            info = await stat(full);
          } catch (err) {
            problems.push({ path: full, message: `could not stat file: ${(err as Error).message}` });
            seen.delete(key);
            continue;
          }
          const stored = existing.get(key);
          if (stored && stored.size === info.size && stored.mtime_ms === info.mtimeMs) {
            stats.kept += 1;
            continue;
          }
          stats.loaded += 1;
          const media: MediaEntry = {
            kind: 'media',
            key,
            id: itemId(key),
            path: full,
            root: rootPath,
            name: basename(entry.name, extname(entry.name)),
            mediaKind: kind,
            ext: extname(entry.name).toLowerCase(),
            size: info.size,
            mtimeMs: info.mtimeMs,
            tags: folderTags(rootPath, dir),
          };
          upserts.push({ key, kind: 'media', size: info.size, mtimeMs: info.mtimeMs, entry: media });
        }
      };

      await walk(rootPath, 0);

      this.db.exec('BEGIN');
      try {
        const upsert = this.db.prepare(
          'INSERT INTO items (key, id, root, kind, size, mtime_ms, entry) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, size = excluded.size, mtime_ms = excluded.mtime_ms, entry = excluded.entry',
        );
        for (const u of upserts) upsert.run(u.key, itemId(u.key), rootPath, u.kind, u.size, u.mtimeMs, JSON.stringify(u.entry));
        if (!truncated) {
          const remove = this.db.prepare('DELETE FROM items WHERE key = ?');
          for (const key of existing.keys()) {
            if (!seen.has(key)) {
              remove.run(key);
              stats.removed += 1;
            }
          }
        }
        this.db.prepare('DELETE FROM problems WHERE root = ?').run(rootPath);
        const addProblem = this.db.prepare('INSERT INTO problems (root, path, message, issues) VALUES (?, ?, ?, ?)');
        for (const p of problems) addProblem.run(rootPath, p.path, p.message, p.issues ? JSON.stringify(p.issues) : null);
        this.db
          .prepare('UPDATE roots SET online = 1, missing_reason = NULL, scanned_at = ? WHERE path = ?')
          .run(new Date().toISOString(), rootPath);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }

    stats.ms = Date.now() - started;
    return stats;
  }

  /** The index as the UI sees it: all stored items, offline roots flagged, duplicate template ids resolved in root order. */
  toIndex(): LibraryIndex {
    const roots = this.db.prepare('SELECT path, position, online, missing_reason FROM roots ORDER BY position').all() as unknown as RootRow[];
    const order = new Map(roots.map((r, i) => [r.path, i]));
    const offline = new Set(roots.filter((r) => r.online === 0).map((r) => r.path));
    const index: LibraryIndex = {
      roots: roots.map((r) => r.path),
      templates: [],
      media: [],
      problems: [],
      builtAt: new Date().toISOString(),
    };

    const rows = this.db.prepare('SELECT key, id, root, kind, size, mtime_ms, entry FROM items').all() as unknown as ItemRow[];
    rows.sort((a, b) => (order.get(a.root) ?? 0) - (order.get(b.root) ?? 0) || a.key.localeCompare(b.key));
    const seenIds = new Map<string, string>();
    const duplicates: LibraryProblem[] = [];
    for (const row of rows) {
      const entry = JSON.parse(row.entry) as LibraryEntry;
      if (offline.has(row.root)) entry.offline = true;
      if (entry.kind === 'template') {
        const previous = seenIds.get(entry.manifest.id);
        if (previous) {
          duplicates.push({ path: entry.dir, message: `duplicate template id "${entry.manifest.id}" (already loaded from ${previous}); skipped` });
          continue;
        }
        seenIds.set(entry.manifest.id, entry.dir);
        index.templates.push(entry);
      } else {
        index.media.push(entry);
      }
    }

    for (const r of roots) {
      if (r.online === 0) index.problems.push({ path: r.path, message: r.missing_reason ?? 'library root does not exist' });
      const stored = this.db.prepare('SELECT path, message, issues FROM problems WHERE root = ? ORDER BY rowid').all(r.path) as unknown as {
        path: string;
        message: string;
        issues: string | null;
      }[];
      for (const p of stored) index.problems.push({ path: p.path, message: p.message, ...(p.issues ? { issues: JSON.parse(p.issues) } : {}) });
    }
    index.problems.push(...duplicates);
    index.templates.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
    return index;
  }

  /** A media item by library id, with whether its root is reachable; undefined for unknown ids and templates. */
  findMediaById(id: string): MediaLookup | undefined {
    const row = this.db
      .prepare("SELECT items.entry AS entry, items.root AS root, roots.online AS online FROM items JOIN roots ON roots.path = items.root WHERE items.id = ? AND items.kind = 'media'")
      .get(id) as { entry: string; root: string; online: number } | undefined;
    if (!row) return undefined;
    return { entry: JSON.parse(row.entry) as MediaEntry, root: row.root, online: row.online === 1 };
  }

  itemCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n;
  }

  getUserData(key: string): UserItemData {
    const row = this.db.prepare('SELECT tags, favorite, last_used FROM user_items WHERE key = ?').get(key) as
      | { tags: string; favorite: number; last_used: string | null }
      | undefined;
    if (!row) return { tags: [], favorite: false };
    return { tags: JSON.parse(row.tags) as string[], favorite: row.favorite === 1, ...(row.last_used ? { lastUsed: row.last_used } : {}) };
  }

  setUserData(key: string, patch: Partial<UserItemData>): UserItemData {
    const next = { ...this.getUserData(key), ...patch };
    this.db
      .prepare(
        'INSERT INTO user_items (key, tags, favorite, last_used) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET tags = excluded.tags, favorite = excluded.favorite, last_used = excluded.last_used',
      )
      .run(key, JSON.stringify(next.tags), next.favorite ? 1 : 0, next.lastUsed ?? null);
    return next;
  }
}

async function entryStillExists(stored: ItemRow): Promise<boolean> {
  try {
    const entry = JSON.parse(stored.entry) as TemplateEntry;
    return (await stat(join(entry.dir, entry.manifest.entry))).isFile();
  } catch {
    return false;
  }
}
