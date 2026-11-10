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

import type { ScanField, ScanReading } from './interlace';
import { readdir, stat, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MANIFEST_FILENAME } from './manifest';
import type { LibraryEntry, LibraryIndex, LibraryProblem, MediaEntry, TemplateEntry } from './library-types';
import { folderTags, itemId, itemKey, loadLottie, loadTemplate, lottieAnimationKey, mediaKindForPath, SKIP_DIRECTORIES, sniffLottieFile, type PackContext } from './library-scan';
import { isLottieCandidate } from './lottie';
import { groupSequences, sequenceFrameName, sequenceKeyName } from './media-sequence';
import { groupClipSetLayers, groupClipSets, type ClipSetFiles } from './clip-set';
import { CATALOG_FILES, parseCatalog, type CatalogRow } from './library-catalog';
import { catalogPreview, hasPreview, indexSiblings, isPreviewFolder, PreviewFolder, samePreview, sidecarPreviews, type MediaPreview } from './library-preview';
import { embeddedPreview, sidecarPreview, unreadableFormat, type UnreadablePreview } from './unreadable-media';
import { groupMusicVersions, groupStems, pairTransitionSounds } from './music-groups';
import { listZipFile, unpackedPath } from './zip-archive';
import { PACK_FILENAME, parsePackManifest, slug } from './pack';
import { inferMediaType, inferMoods, inferThemes } from './taxonomy';
import { normalizeTag } from './tags';
import type { MediaLookup } from './media-serve';
import type { MediaMetadata } from './media-meta';
import { thumbUrlFor, wantsThumbnail } from './thumbnails';

export interface ScanOptions {
  /** Maximum directory depth below each root. Default 12. */
  maxDepth?: number;
  /**
   * Which root is the bundled library, whose items are keyed by their path
   * inside the app rather than on the disk (`itemKey`). The app sets it on the
   * store itself; a one-off scan — the visual references, a test — says so here.
   */
  builtInRoot?: string;
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
  /** Themes the user added, normalized like tags; built-in or custom. */
  themes: string[];
  favorite: boolean;
  /** ISO time of the last selection or render, if any. */
  lastUsed?: string;
  /**
   * Frames per second for a frame sequence (milestone 30). A folder of frames
   * records no rate, so Pulp states one; this is where a person's own answer
   * is kept, per item, like a tag or a favorite.
   */
  sequenceFps?: number;
  /** Deinterlacing turned off for this clip (milestone 83); absent is the automatic choice. */
  deinterlace?: false;
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
CREATE TABLE IF NOT EXISTS media_meta (
  key TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  meta TEXT
);
CREATE TABLE IF NOT EXISTS thumbs (
  key TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  file TEXT
);
CREATE TABLE IF NOT EXISTS strips (
  key TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  file TEXT
);
CREATE TABLE IF NOT EXISTS waveforms (
  key TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  peaks TEXT
);
CREATE TABLE IF NOT EXISTS embeddings (
  key TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  model TEXT NOT NULL,
  vec BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS user_items (
  key TEXT PRIMARY KEY,
  tags TEXT NOT NULL DEFAULT '[]',
  themes TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used TEXT,
  render_count INTEGER NOT NULL DEFAULT 0
);
`;

// 4: templates re-read so pack defaults apply; 5: re-read so manifests carry aspects;
// 6: the bundled library is keyed by its path inside the app, so every bundled item has a new id.
// 7: a Lottie's limits and Pulp's labels kept as messages, so they are said in the interface's language.
export const SCHEMA_VERSION = 8;

export class LibraryStore {
  private readonly db: DatabaseSync;
  private builtInRoot: string | undefined;
  private archiveFallback: ((zipPath: string, member: string) => string) | undefined;

  /**
   * Where an archive's member is unpacked when its library cannot be written to (milestone 32): a
   * path in Pulp's own data, by archive and member. Set by the app; a one-off scan has none. A file
   * found there is the member unpacked, listed at that path and marked so.
   */
  setArchiveFallback(fallback: ((zipPath: string, member: string) => string) | undefined): void {
    this.archiveFallback = fallback;
  }

  /** Which root is the bundled samples, so the index can label it and its items are keyed by their place in it. */
  setBuiltInRoot(root: string | undefined): void {
    this.builtInRoot = root === undefined ? undefined : resolve(root);
    if (this.builtInRoot !== undefined) this.rekeyBundledUserItems(this.builtInRoot);
  }

  /**
   * Tags, favorites, themes and use counts are kept by item key, and the
   * bundled library's keys became its paths inside the app (`itemKey`), so
   * what someone marked on a bundled item is carried across rather than
   * orphaned by the change. Idempotent: once moved there is nothing left to
   * move, and an item that already has a row under the new key keeps it.
   */
  private rekeyBundledUserItems(root: string): void {
    const rows = this.db.prepare('SELECT key FROM user_items').all() as unknown as { key: string }[];
    const moves: { from: string; to: string }[] = [];
    for (const { key } of rows) {
      // The first colon only: a Windows path carries one of its own ("C:\\…").
      const at = key.indexOf(':');
      const kind = key.slice(0, at);
      const path = key.slice(at + 1);
      if (kind !== 'template' && kind !== 'lottie' && kind !== 'media') continue;
      if (!isAbsolute(path)) continue;
      const moved = itemKey(kind, path, root);
      if (moved !== key) moves.push({ from: key, to: moved });
    }
    if (moves.length === 0) return;
    const taken = new Set(rows.map((r) => r.key));
    this.db.exec('BEGIN');
    try {
      const move = this.db.prepare('UPDATE user_items SET key = ? WHERE key = ?');
      const drop = this.db.prepare('DELETE FROM user_items WHERE key = ?');
      for (const { from, to } of moves) {
        if (taken.has(to)) drop.run(from);
        else move.run(to, from);
      }
      this.db.exec('COMMIT');
    } catch {
      this.db.exec('ROLLBACK');
    }
  }

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
    // user_items predates themes and is never dropped; add the column where it is missing.
    const userColumns = this.db.prepare('PRAGMA table_info(user_items)').all() as unknown as { name: string }[];
    if (!userColumns.some((c) => c.name === 'themes')) this.db.exec("ALTER TABLE user_items ADD COLUMN themes TEXT NOT NULL DEFAULT '[]'");
    // The rate a frame sequence is read at (milestone 30) came later again.
    if (!userColumns.some((c) => c.name === 'sequence_fps')) this.db.exec('ALTER TABLE user_items ADD COLUMN sequence_fps REAL');
    if (!userColumns.some((c) => c.name === 'render_count')) this.db.exec('ALTER TABLE user_items ADD COLUMN render_count INTEGER NOT NULL DEFAULT 0');
    // And a clip's deinterlacing turned off (milestone 83): null is the automatic choice, 0 is off.
    if (!userColumns.some((c) => c.name === 'deinterlace')) this.db.exec('ALTER TABLE user_items ADD COLUMN deinterlace INTEGER');
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
    // A one-off scan may name the bundled root here rather than on the store (ScanOptions).
    if (options.builtInRoot !== undefined) this.builtInRoot = resolve(options.builtInRoot);
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
      /** Files that are an archive's members unpacked (milestone 32): listed once, as the archive's. */
      const archiveTargets = new Set<string>();

      // The library's own catalog (milestone 32), read first: what it says of a file — its name, its
      // keywords, its preview — joins the item as the walk reaches it, and what it lists that is not
      // here is added after the walk as known but missing.
      const catalog = await readCatalog(rootPath, problems);
      /** The catalog's row for each file it names, by full path: its name, category and keywords join the item as the walk reaches it. */
      const catalogByPath = new Map<string, CatalogRow>();
      if (catalog) for (const row of catalog.rows) catalogByPath.set(join(rootPath, ...row.path.split('/')), row);
      /** A preview the catalog names, by the full path of the media it is for; only files that exist. */
      const catalogPreviews = new Map<string, string>();
      /** Every file a catalog names as a preview: an item's, not an item. */
      const catalogClaimed = new Set<string>();
      if (catalog) {
        for (const row of catalog.rows) {
          if (!row.preview) continue;
          const file = join(rootPath, ...row.preview.split('/'));
          try {
            if (!(await stat(file)).isFile()) continue;
          } catch {
            continue;
          }
          catalogPreviews.set(join(rootPath, ...row.path.split('/')), file);
          catalogClaimed.add(file);
        }
      }
      /**
       * The preview folders found so far (milestone 32) — `Previews`, `Thumbnails`, `Thumbs` — each
       * standing for the folder it sits in. A file in one is an item's preview, not an item, unless
       * nothing claims it by the end of the walk.
       */
      const previewFolders: PreviewFolder[] = [];
      const folderClaimed = new Set<string>();
      /** Read a preview folder's files into `folder` rather than walking it as media. */
      const collectPreviews = async (path: string, rel: string, folder: PreviewFolder, depth: number): Promise<void> => {
        let inside;
        try {
          inside = await readdir(path, { withFileTypes: true });
        } catch (err) {
          problems.push({ path, message: `could not read folder: ${(err as Error).message}` });
          return;
        }
        for (const e of inside) {
          if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
          if (e.isDirectory()) {
            if (!SKIP_DIRECTORIES.has(e.name) && depth < maxDepth) await collectPreviews(join(path, e.name), `${rel}${e.name}/`, folder, depth + 1);
            continue;
          }
          if (!e.isFile() || fileCount >= maxFiles) continue;
          fileCount += 1;
          folder.add(`${rel}${e.name}`, join(path, e.name));
        }
      };
      /**
       * An item's previews: beside it (`sidecar`, from its own folder's names), else in a preview folder
       * standing for one of its ancestors — the nearest first — else what the catalog names for it.
       */
      /** The preview folders standing for a folder or one of its ancestors, nearest first; worked out once per folder. */
      const foldersAbove = new Map<string, { folder: PreviewFolder; rel: string }[]>();
      const previewFoldersFor = (dir: string) => {
        let above = foldersAbove.get(dir);
        if (!above) {
          above = previewFolders
            .filter((f) => dir === f.base || dir.startsWith(f.base + sep))
            .map((folder) => ({ folder, rel: relative(folder.base, dir).split(sep).join('/') }))
            .reverse();
          foldersAbove.set(dir, above);
        }
        return above;
      };
      const previewsFor = (dir: string, file: string, stem: string, kind: 'video' | 'image' | 'audio', sidecar: MediaPreview | undefined): MediaPreview | undefined => {
        const preview: MediaPreview = { ...(sidecar ?? {}) };
        for (const { folder, rel } of previewFoldersFor(dir)) {
          if (hasPreview(preview) && preview.still && (kind === 'image' || preview.media)) break;
          const found = folder.find(rel, stem, kind);
          for (const c of found.claimed) folderClaimed.add(c);
          if (preview.still === undefined && found.preview.still) preview.still = found.preview.still;
          if (preview.media === undefined && found.preview.media) preview.media = found.preview.media;
        }
        if (!hasPreview(preview)) {
          const named = catalogPreviews.get(join(dir, file));
          if (named) Object.assign(preview, catalogPreview(named, kind));
        }
        return hasPreview(preview) ? preview : undefined;
      };

      const walk = async (dir: string, depth: number, pack?: PackContext): Promise<void> => {
        if (fileCount >= maxFiles) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (err) {
          problems.push({ path: dir, message: `could not read folder: ${(err as Error).message}` });
          return;
        }

        if (entries.some((e) => e.isFile() && e.name === PACK_FILENAME)) {
          // A pack folder: its pack.json names it and gives its templates their defaults.
          try {
            const parsed = parsePackManifest(await readFile(join(dir, PACK_FILENAME), 'utf8'));
            if (parsed.ok) {
              const m = parsed.manifest;
              pack = { name: m.name, slug: slug(m.name, 'pack'), ...(m.type ? { type: m.type } : {}), ...(m.themes ? { themes: m.themes } : {}), ...(m.styles ? { styles: m.styles } : {}), ...(m.sound ? { sound: m.sound } : {}) };
            } else {
              problems.push({ path: join(dir, PACK_FILENAME), message: `invalid pack.json: ${parsed.problems.join('; ')}` });
            }
          } catch (err) {
            problems.push({ path: join(dir, PACK_FILENAME), message: `could not read pack.json: ${(err as Error).message}` });
          }
        }

        if (entries.some((e) => e.isFile() && e.name === MANIFEST_FILENAME)) {
          // A template folder is one item, keyed by its folder; its assets are not library media.
          stats.visited += 1;
          const key = itemKey('template', dir, this.builtInRoot);
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
          const loaded = await loadTemplate(dir, rootPath, pack, this.builtInRoot);
          if ('kind' in loaded) upserts.push({ key, kind: 'template', size: info.size, mtimeMs: info.mtimeMs, entry: loaded });
          else {
            problems.push(loaded);
            seen.delete(key); // a broken template is not an item; drop any stale row
          }
          return;
        }

        entries.sort((a, b) => a.name.localeCompare(b.name));

        // A preview folder beside the media (milestone 32) is read for what it previews, not walked for items.
        for (const e of entries) {
          if (e.isDirectory() && !e.isSymbolicLink() && isPreviewFolder(e.name) && depth < maxDepth) {
            const folder = new PreviewFolder(dir);
            await collectPreviews(join(dir, e.name), '', folder, depth + 1);
            previewFolders.push(folder);
          }
        }

        // Numbered frame runs in this folder are one clip each, not a card per frame
        // (milestone 26). Their member files are skipped by the loop below.
        const { sequences } = groupSequences(
          dir,
          entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name),
        );
        const sequenceFrames = new Set<string>();
        for (const seq of sequences) {
          for (let i = 0; i < seq.count; i++) sequenceFrames.add(sequenceFrameName(seq, i));
        }
        for (const seq of sequences) {
          if (fileCount >= maxFiles) {
            if (!truncated) problems.push({ path: rootPath, message: `stopped after ${maxFiles} files` });
            truncated = true;
            return;
          }
          // A sequence counts as the files it holds, so a folder of them cannot slip past the cap.
          fileCount += seq.count;
          stats.visited += 1;
          const key = itemKey('media', join(dir, sequenceKeyName(seq)), this.builtInRoot);
          seen.add(key);
          const first = join(dir, sequenceFrameName(seq, 0));
          const last = join(dir, sequenceFrameName(seq, seq.count - 1));
          let firstInfo;
          let lastInfo;
          try {
            [firstInfo, lastInfo] = await Promise.all([stat(first), stat(last)]);
          } catch (err) {
            problems.push({ path: first, message: `could not stat frame: ${(err as Error).message}` });
            seen.delete(key);
            continue;
          }
          // The signature is the two ends: re-rendering frames changes their times, and adding
          // or removing frames moves the last one, so the run is read again when it should be.
          const size = firstInfo.size + lastInfo.size;
          const mtimeMs = Math.max(firstInfo.mtimeMs, lastInfo.mtimeMs);
          const storedSeq = existing.get(key);
          if (storedSeq && storedSeq.size === size && storedSeq.mtime_ms === mtimeMs) {
            stats.kept += 1;
            continue;
          }
          stats.loaded += 1;
          const segments = folderTags(rootPath, dir);
          // A run of frames is a clip, so it is typed and filtered as video however its frames are stored.
          const inferredType = inferMediaType('video', segments);
          const inferredThemes = inferThemes(segments);
          const inferredMoods = inferMoods(segments);
          const media: MediaEntry = {
            kind: 'media',
            key,
            id: itemId(key),
            path: first,
            root: rootPath,
            name: seq.stem.replace(/[-_. ]+$/, '') || seq.stem,
            mediaKind: 'video',
            ext: seq.ext,
            size,
            mtimeMs,
            tags: segments,
            sequence: seq,
            ...(inferredType ? { type: inferredType } : {}),
            ...(inferredThemes.length > 0 ? { themes: inferredThemes } : {}),
            ...(inferredMoods.length > 0 ? { moods: inferredMoods } : {}),
          };
          upserts.push({ key, kind: 'media', size, mtimeMs, entry: media });
        }

        // The previews beside the media in this folder (milestone 32): a clip's poster, a still's
        // thumbnail, a small preview clip or sound, named after the item. Theirs, so not items.
        const fileNames = entries.filter((e) => e.isFile() && !e.name.startsWith('.') && !sequenceFrames.has(e.name)).map((e) => e.name);
        const siblings = indexSiblings(fileNames);
        const sidecarOf = new Map<string, MediaPreview>();
        const sidecarClaimed = new Set<string>();
        for (const name of fileNames) {
          const kind = mediaKindForPath(name);
          if (!kind) continue;
          const { preview, claimed } = sidecarPreviews(basename(name, extname(name)), kind, [name], siblings);
          for (const c of claimed) sidecarClaimed.add(c);
          if (hasPreview(preview)) sidecarOf.set(name, { ...(preview.still ? { still: join(dir, preview.still) } : {}), ...(preview.media ? { media: join(dir, preview.media) } : {}) });
        }
        const isPreviewFile = (name: string) => sidecarClaimed.has(name) || catalogClaimed.has(join(dir, name));

        // A zip in the library (milestone 32) is browsed without unpacking it: each media file in its
        // central directory is an item of its own, whose path is where it unpacks to — beside the
        // archive, in a folder named after it. Files already unpacked there are those same items,
        // so the walk below skips them rather than listing them twice.
        for (const zip of entries.filter((e) => e.isFile() && !e.name.startsWith('.') && /\.zip$/i.test(e.name))) {
          const zipPath = join(dir, zip.name);
          let zipInfo;
          let members;
          try {
            zipInfo = await stat(zipPath);
            members = await listZipFile(zipPath);
          } catch (err) {
            problems.push({ path: zipPath, message: `could not read archive: ${(err as Error).message}` });
            continue;
          }
          const zipTags = [...folderTags(rootPath, dir), ...folderTags(dir, join(dir, zip.name.replace(/\.zip$/i, '')))];
          for (const member of members) {
            const kind = mediaKindForPath(member.name);
            if (!kind) continue;
            if (fileCount >= maxFiles) {
              if (!truncated) problems.push({ path: rootPath, message: `stopped after ${maxFiles} files` });
              truncated = true;
              return;
            }
            fileCount += 1;
            stats.visited += 1;
            const target = unpackedPath(zipPath, member.name);
            archiveTargets.add(target);
            const key = itemKey('media', `${zipPath}!/${member.name}`, this.builtInRoot);
            seen.add(key);
            // Its signature is the member's own size and the archive's time: a new download reads again.
            // Unpacked beside the archive, or — when the library could not be written to — into Pulp's
            // own data, where the item then lives.
            let unpacked = false;
            let path = target;
            let elsewhere = false;
            try {
              unpacked = (await stat(target)).size === member.size;
            } catch {
              // Not unpacked beside the archive.
            }
            if (!unpacked && this.archiveFallback) {
              const alt = this.archiveFallback(zipPath, member.name);
              try {
                if ((await stat(alt)).size === member.size) {
                  unpacked = true;
                  elsewhere = true;
                  path = alt;
                }
              } catch {
                // Not unpacked there either.
              }
            }
            const storedMember = existing.get(key);
            const wasMember = storedMember ? (JSON.parse(storedMember.entry) as MediaEntry) : undefined;
            if (storedMember && storedMember.size === member.size && storedMember.mtime_ms === zipInfo.mtimeMs && wasMember?.archive?.unpacked === unpacked && wasMember.path === path) {
              stats.kept += 1;
              continue;
            }
            stats.loaded += 1;
            const inside = member.name.split('/');
            const segments = [...new Set([...zipTags, ...folderTags(dir, join(dir, ...inside.slice(0, -1)))])];
            const fileName = inside.at(-1)!;
            const inferredType = inferMediaType(kind, segments);
            const inferredThemes = inferThemes(segments);
            const inferredMoods = inferMoods(segments);
            const media: MediaEntry = {
              kind: 'media',
              key,
              id: itemId(key),
              path,
              root: rootPath,
              name: basename(fileName, extname(fileName)),
              mediaKind: kind,
              ext: extname(fileName).toLowerCase(),
              size: member.size,
              mtimeMs: zipInfo.mtimeMs,
              tags: segments,
              archive: { zip: zipPath, member: member.name, unpacked, ...(elsewhere ? { elsewhere: true as const } : {}) },
              // A password-protected member is listed, never read: an item Pulp cannot open, with the note.
              ...(member.encrypted ? { unreadable: { ext: extname(fileName).toLowerCase(), encrypted: true as const } } : {}),
              ...(inferredType ? { type: inferredType } : {}),
              ...(inferredThemes.length > 0 ? { themes: inferredThemes } : {}),
              ...(inferredMoods.length > 0 ? { moods: inferredMoods } : {}),
            };
            upserts.push({ key, kind: 'media', size: member.size, mtimeMs: zipInfo.mtimeMs, entry: media });
          }
        }

        // An intro, a loop and an outro that belong together are one item that stretches
        // (milestone 32). Their files are skipped by the loop below, as a sequence's frames are.
        const setMembers = new Set<string>();
        const videoNames = fileNames.filter((n) => !isPreviewFile(n) && mediaKindForPath(n) === 'video');
        // Several sets that are the layers of one (a main graphic and a flare) are one item too.
        for (const found of groupClipSetLayers(groupClipSets(videoNames, basename(dir)), basename(dir))) {
          if (fileCount >= maxFiles) {
            if (!truncated) problems.push({ path: rootPath, message: `stopped after ${maxFiles} files` });
            truncated = true;
            return;
          }
          const partNames = (f: ClipSetFiles) => [f.intro, f.loop, f.outro].filter((n): n is string => n !== undefined);
          const names = found.layers.flatMap((l) => partNames(l.files));
          fileCount += names.length;
          stats.visited += 1;
          for (const n of names) setMembers.add(n);
          const fullFiles = (f: ClipSetFiles): ClipSetFiles => ({
            ...(f.intro ? { intro: join(dir, f.intro) } : {}),
            loop: join(dir, f.loop),
            ...(f.outro ? { outro: join(dir, f.outro) } : {}),
          });
          const base = found.layers[0]!.files;
          const files = fullFiles(base);
          const layers = found.layers.map((l) => ({ name: l.name, files: fullFiles(l.files) }));
          // Keyed by the loop and the set's name, so a set is the same item across scans.
          const key = itemKey('media', join(dir, `${found.name} [set]`), this.builtInRoot);
          seen.add(key);
          let infos;
          try {
            infos = await Promise.all(names.map((n) => stat(join(dir, n))));
          } catch (err) {
            problems.push({ path: join(dir, base.loop), message: `could not stat clip set: ${(err as Error).message}` });
            seen.delete(key);
            continue;
          }
          // Its signature is every part's: replacing any of them reads the set again.
          const size = infos.reduce((n, i) => n + i.size, 0);
          const mtimeMs = Math.max(...infos.map((i) => i.mtimeMs));
          // A set's preview is named after the set ("Swoosh.jpg", "Swoosh_preview.mp4"), beside its parts.
          const setSidecar = sidecarPreviews(found.name, 'video', names, siblings);
          for (const c of setSidecar.claimed) sidecarClaimed.add(c);
          const setPreview = previewsFor(dir, base.loop, found.name, 'video', hasPreview(setSidecar.preview) ? { ...(setSidecar.preview.still ? { still: join(dir, setSidecar.preview.still) } : {}), ...(setSidecar.preview.media ? { media: join(dir, setSidecar.preview.media) } : {}) } : undefined);
          const storedSet = existing.get(key);
          if (storedSet && storedSet.size === size && storedSet.mtime_ms === mtimeMs && samePreview((JSON.parse(storedSet.entry) as MediaEntry).preview, setPreview)) {
            stats.kept += 1;
            continue;
          }
          stats.loaded += 1;
          const segments = folderTags(rootPath, dir);
          const inferredType = inferMediaType('video', segments);
          const inferredThemes = inferThemes(segments);
          const inferredMoods = inferMoods(segments);
          const media: MediaEntry = {
            kind: 'media',
            key,
            id: itemId(key),
            path: files.loop,
            root: rootPath,
            name: found.name,
            mediaKind: 'video',
            ext: extname(base.loop).toLowerCase(),
            size,
            mtimeMs,
            tags: segments,
            clipSet: files,
            ...(layers.length > 1 ? { clipSetLayers: layers } : {}),
            ...(setPreview ? { preview: setPreview } : {}),
            ...(inferredType ? { type: inferredType } : {}),
            ...(inferredThemes.length > 0 ? { themes: inferredThemes } : {}),
            ...(inferredMoods.length > 0 ? { moods: inferredMoods } : {}),
          };
          upserts.push({ key, kind: 'media', size, mtimeMs, entry: media });
        }

        // Music and sound effects (milestone 32): a track's cuts and a song's stems are one item
        // each, their files kept as items marked part of it; a sound made for a clip is paired.
        const plainFiles = fileNames.filter((n) => !setMembers.has(n) && !isPreviewFile(n));
        const fileExtras = new Map<string, Pick<MediaEntry, 'partOf' | 'pairedSound'>>();
        const groupOf = (name: string, label: string) => itemKey('media', join(dir, `${name} [${label}]`), this.builtInRoot);
        const memberId = (file: string) => itemId(itemKey('media', join(dir, file), this.builtInRoot));
        const groups: { key: string; name: string; files: string[]; entry: Partial<MediaEntry> }[] = [];
        for (const found of groupStems(basename(dir), basename(dirname(dir)), plainFiles)) {
          const key = groupOf(found.name, 'stems');
          groups.push({ key, name: found.name, files: found.stems.map((s) => s.file), entry: { stemParts: found.stems.map((s) => ({ id: memberId(s.file), label: s.label })) } });
        }
        const inStems = new Set(groups.flatMap((g) => g.files));
        for (const found of groupMusicVersions(plainFiles.filter((f) => !inStems.has(f)))) {
          const key = groupOf(found.name, 'versions');
          groups.push({ key, name: found.name, files: found.versions.map((v) => v.file), entry: { versions: found.versions.map((v) => ({ id: memberId(v.file), label: v.label, ...(v.seconds !== undefined ? { seconds: v.seconds } : {}) })) } });
        }
        for (const g of groups) for (const f of g.files) fileExtras.set(f, { partOf: g.key });
        const kindOf = (f: string) => mediaKindForPath(f);
        for (const [clip, sound] of pairTransitionSounds(plainFiles.filter((f) => kindOf(f) === 'video'), plainFiles.filter((f) => kindOf(f) === 'audio' && !fileExtras.has(f)))) {
          fileExtras.set(clip, { pairedSound: memberId(sound) });
        }
        for (const g of groups) {
          if (fileCount >= maxFiles) break;
          stats.visited += 1;
          seen.add(g.key);
          const infos = await Promise.all(g.files.map((f) => stat(join(dir, f)).catch(() => null)));
          if (infos.some((i) => i === null)) { seen.delete(g.key); continue; }
          const size = infos.reduce((n, i) => n + i!.size, 0);
          const mtimeMs = Math.max(...infos.map((i) => i!.mtimeMs));
          // The group shows the first member's preview that has one (milestone 32): a track's cover, say.
          const groupPreview = g.files.map((f) => previewsFor(dir, f, basename(f, extname(f)), 'audio', sidecarOf.get(f))).find((p) => p !== undefined);
          const stored = existing.get(g.key);
          if (stored && stored.size === size && stored.mtime_ms === mtimeMs && samePreview((JSON.parse(stored.entry) as MediaEntry).preview, groupPreview)) { stats.kept += 1; continue; }
          stats.loaded += 1;
          const segments = folderTags(rootPath, dir);
          const inferredThemes = inferThemes(segments);
          const inferredMoods = inferMoods(segments);
          const inferredType = inferMediaType('audio', segments);
          const first = join(dir, g.files[0]!);
          const media: MediaEntry = {
            kind: 'media', key: g.key, id: itemId(g.key), path: first, root: rootPath, name: g.name, mediaKind: 'audio',
            ext: extname(first).toLowerCase(), size, mtimeMs, tags: segments, ...g.entry,
            ...(groupPreview ? { preview: groupPreview } : {}),
            ...(inferredType ? { type: inferredType } : {}),
            ...(inferredThemes.length > 0 ? { themes: inferredThemes } : {}),
            ...(inferredMoods.length > 0 ? { moods: inferredMoods } : {}),
          };
          upserts.push({ key: g.key, kind: 'media', size, mtimeMs, entry: media });
        }

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (sequenceFrames.has(entry.name)) continue;
          if (setMembers.has(entry.name)) continue;
          // An item's preview is the item's, not an item (milestone 32).
          if (entry.isFile() && isPreviewFile(entry.name)) continue;
          // An archive's unpacked file is the archive's item, not a second one; a part being written is nothing yet.
          if (archiveTargets.has(join(dir, entry.name)) || entry.name.endsWith('.pulp-part')) continue;
          const full = join(dir, entry.name);
          // Symlinks are skipped to avoid cycles and surprising scans outside the chosen roots.
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            if (SKIP_DIRECTORIES.has(entry.name) || isPreviewFolder(entry.name)) continue;
            if (depth < maxDepth) await walk(full, depth + 1, pack);
            continue;
          }
          if (!entry.isFile()) continue;
          const kind = mediaKindForPath(entry.name);
          if (!kind) {
            // A Lottie animation is a template read from one file (milestone 35): a `.lottie` by its
            // extension, a `.json` by its shape. An unchanged one is kept without being read; a `.json`
            // not seen before is sniffed first, so a settings file is never parsed whole.
            if (isLottieCandidate(entry.name)) {
              let info;
              try {
                info = await stat(full);
              } catch (err) {
                problems.push({ path: full, message: `could not stat file: ${(err as Error).message}` });
                continue;
              }
              const key = itemKey('lottie', full, this.builtInRoot);
              const stored = existing.get(key);
              if (stored && stored.size === info.size && stored.mtime_ms === info.mtimeMs) {
                seen.add(key);
                // An archive of several animations is several entries (milestone 35): the
                // siblings' keys are the file's key plus each animation's id, kept with it.
                try {
                  const was = JSON.parse(stored.entry) as TemplateEntry;
                  for (const id of was.lottie?.animations?.slice(1) ?? []) seen.add(lottieAnimationKey(key, id));
                } catch {
                  // An unreadable stored row is read again next scan; nothing to keep seen.
                }
                fileCount += 1;
                stats.visited += 1;
                stats.kept += 1;
                continue;
              }
              if (extname(entry.name).toLowerCase() === '.json' && !(await sniffLottieFile(full))) continue;
              if (fileCount >= maxFiles) {
                if (!truncated) problems.push({ path: rootPath, message: `stopped after ${maxFiles} files` });
                truncated = true;
                return;
              }
              fileCount += 1;
              stats.visited += 1;
              stats.loaded += 1;
              const loaded = await loadLottie(full, rootPath, folderTags(rootPath, dir), this.builtInRoot);
              if (Array.isArray(loaded)) {
                for (const one of loaded) {
                  seen.add(one.key);
                  upserts.push({ key: one.key, kind: 'template', size: info.size, mtimeMs: info.mtimeMs, entry: one });
                }
              } else problems.push(loaded);
              continue;
            }
            // A file Pulp cannot read is listed, not skipped (milestones 33 and 32): an item with a plain
            // note of what it needs, and its preview where one exists — beside it, or inside it.
            const format = unreadableFormat(entry.name);
            if (!format) continue;
            if (fileCount >= maxFiles) {
              if (!truncated) problems.push({ path: rootPath, message: `stopped after ${maxFiles} files` });
              truncated = true;
              return;
            }
            fileCount += 1;
            stats.visited += 1;
            const ukey = itemKey('media', full, this.builtInRoot);
            seen.add(ukey);
            let uinfo;
            try {
              uinfo = await stat(full);
            } catch (err) {
              problems.push({ path: full, message: `could not stat file: ${(err as Error).message}` });
              seen.delete(ukey);
              continue;
            }
            const beside = sidecarPreview(entry.name, entries.filter((e) => e.isFile()).map((e) => e.name));
            const ustored = existing.get(ukey);
            const wasPreview = ustored ? (JSON.parse(ustored.entry) as MediaEntry).unreadable?.preview : undefined;
            const sameBeside = beside ? wasPreview && 'file' in wasPreview && wasPreview.file === join(dir, beside) : !wasPreview || 'zip' in wasPreview;
            if (ustored && ustored.size === uinfo.size && ustored.mtime_ms === uinfo.mtimeMs && sameBeside) {
              stats.kept += 1;
              continue;
            }
            stats.loaded += 1;
            let preview: UnreadablePreview | undefined = beside ? { file: join(dir, beside) } : undefined;
            if (!preview) {
              // A zip-based format (a Motion Graphics template, a Sketch file) may carry its own thumbnail.
              const inside = await listZipFile(full).then((ms) => embeddedPreview(ms.map((m) => m.name)), () => null);
              if (inside) preview = { zip: full, member: inside };
            }
            const usegments = folderTags(rootPath, dir);
            const uType = inferMediaType(format.kind, usegments);
            const uThemes = inferThemes(usegments);
            const umedia: MediaEntry = {
              kind: 'media', key: ukey, id: itemId(ukey), path: full, root: rootPath,
              name: basename(entry.name, extname(entry.name)), mediaKind: format.kind, ext: format.ext,
              size: uinfo.size, mtimeMs: uinfo.mtimeMs, tags: usegments,
              unreadable: { ext: format.ext, ...(preview ? { preview } : {}) },
              ...(uType ? { type: uType } : {}),
              ...(uThemes.length > 0 ? { themes: uThemes } : {}),
            };
            upserts.push({ key: ukey, kind: 'media', size: uinfo.size, mtimeMs: uinfo.mtimeMs, entry: umedia });
            continue;
          }
          if (fileCount >= maxFiles) {
            if (!truncated) problems.push({ path: rootPath, message: `stopped after ${maxFiles} files` });
            truncated = true;
            return;
          }
          fileCount += 1;
          stats.visited += 1;
          const key = itemKey('media', full, this.builtInRoot);
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
          const extras = fileExtras.get(entry.name) ?? {};
          const preview = previewsFor(dir, entry.name, basename(entry.name, extname(entry.name)), kind, sidecarOf.get(entry.name));
          // The library's own organization (milestone 32): the catalog's name, category and keywords
          // join the item here, so it browses and searches as the collection was organized. The
          // category's words come after the folders', so where both name a type the catalog's wins.
          const catalogRow = catalogByPath.get(full);
          const name = catalogRow?.name ?? basename(entry.name, extname(entry.name));
          const segments = [...new Set([...folderTags(rootPath, dir), ...(catalogRow ? [...catalogRow.keywords, ...catalogRow.category].map(normalizeTag).filter(Boolean) : [])])];
          // Unchanged, still in the same group or pairing, with the same previews and the same catalog row: kept as it is.
          const sameExtras = (row: ItemRow) => {
            const was = JSON.parse(row.entry) as MediaEntry;
            return was.partOf === extras.partOf && was.pairedSound === extras.pairedSound && samePreview(was.preview, preview) &&
              was.name === name && JSON.stringify(was.tags) === JSON.stringify(segments) && JSON.stringify(was.category ?? []) === JSON.stringify(catalogRow?.category ?? []);
          };
          if (stored && stored.size === info.size && stored.mtime_ms === info.mtimeMs && sameExtras(stored)) {
            stats.kept += 1;
            continue;
          }
          stats.loaded += 1;
          const inferredType = inferMediaType(kind, segments);
          const inferredThemes = inferThemes(segments);
          const inferredMoods = inferMoods(segments);
          const media: MediaEntry = {
            kind: 'media',
            key,
            id: itemId(key),
            path: full,
            root: rootPath,
            name,
            mediaKind: kind,
            ext: extname(entry.name).toLowerCase(),
            size: info.size,
            mtimeMs: info.mtimeMs,
            tags: segments,
            ...extras,
            ...(catalogRow?.category.length ? { category: catalogRow.category } : {}),
            ...(preview ? { preview } : {}),
            ...(inferredType ? { type: inferredType } : {}),
            ...(inferredThemes.length > 0 ? { themes: inferredThemes } : {}),
            ...(inferredMoods.length > 0 ? { moods: inferredMoods } : {}),
          };
          upserts.push({ key, kind: 'media', size: info.size, mtimeMs: info.mtimeMs, entry: media });
        }
      };

      await walk(rootPath, 0);

      // Everything the catalog lists whose file is not here is a known but missing item (milestone 32),
      // so the whole collection is seen, and what is missing from it — pictured by its preview where
      // the catalog or a preview folder has one.
      if (catalog) {
        for (const row of catalog.rows) {
          const full = join(rootPath, ...row.path.split('/'));
          const kind = mediaKindForPath(full);
          if (!kind) continue;
          // A file inside an archive's unpack folder is the archive's item, present or not — never a missing one.
          if (archiveTargets.has(full)) continue;
          const key = itemKey('media', full, this.builtInRoot);
          if (seen.has(key)) continue;
          seen.add(key);
          stats.visited += 1;
          const preview = previewsFor(dirname(full), basename(full), basename(full, extname(full)), kind, undefined);
          const stored = existing.get(key);
          const was = stored ? (JSON.parse(stored.entry) as MediaEntry) : undefined;
          if (stored && stored.mtime_ms === catalog.mtimeMs && was?.missing && samePreview(was.preview, preview)) {
            stats.kept += 1;
            continue;
          }
          stats.loaded += 1;
          const segments = [...new Set([...folderTags(rootPath, dirname(full)), ...[...row.keywords, ...row.category].map(normalizeTag).filter(Boolean)])];
          const inferredType = inferMediaType(kind, segments);
          const inferredThemes = inferThemes(segments);
          const inferredMoods = inferMoods(segments);
          const media: MediaEntry = {
            kind: 'media', key, id: itemId(key), path: full, root: rootPath,
            name: row.name ?? basename(full, extname(full)), mediaKind: kind, ext: extname(full).toLowerCase(),
            size: 0, mtimeMs: catalog.mtimeMs, tags: segments, missing: true,
            ...(row.category.length ? { category: row.category } : {}),
            ...(preview ? { preview } : {}),
            ...(inferredType ? { type: inferredType } : {}),
            ...(inferredThemes.length > 0 ? { themes: inferredThemes } : {}),
            ...(inferredMoods.length > 0 ? { moods: inferredMoods } : {}),
          };
          upserts.push({ key, kind: 'media', size: 0, mtimeMs: catalog.mtimeMs, entry: media });
        }
      }

      // A file in a preview folder that nothing claims — no item of its name, no catalog row — is
      // listed as itself (milestone 32), so nothing in the library disappears.
      for (const folder of previewFolders) {
        for (const full of folder.files) {
          if (folderClaimed.has(full) || catalogClaimed.has(full)) continue;
          const kind = mediaKindForPath(full);
          if (!kind) continue;
          const key = itemKey('media', full, this.builtInRoot);
          if (seen.has(key)) continue;
          seen.add(key);
          stats.visited += 1;
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
          const dir = dirname(full);
          const segments = folderTags(rootPath, dir);
          const inferredType = inferMediaType(kind, segments);
          const inferredThemes = inferThemes(segments);
          const inferredMoods = inferMoods(segments);
          const media: MediaEntry = {
            kind: 'media', key, id: itemId(key), path: full, root: rootPath,
            name: basename(full, extname(full)), mediaKind: kind, ext: extname(full).toLowerCase(),
            size: info.size, mtimeMs: info.mtimeMs, tags: segments,
            ...(inferredType ? { type: inferredType } : {}),
            ...(inferredThemes.length > 0 ? { themes: inferredThemes } : {}),
            ...(inferredMoods.length > 0 ? { moods: inferredMoods } : {}),
          };
          upserts.push({ key, kind: 'media', size: info.size, mtimeMs: info.mtimeMs, entry: media });
        }
      }

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
    if (this.builtInRoot !== undefined) index.builtInRoot = this.builtInRoot;

    const rows = this.db.prepare('SELECT key, id, root, kind, size, mtime_ms, entry FROM items').all() as unknown as ItemRow[];
    rows.sort((a, b) => (order.get(a.root) ?? 0) - (order.get(b.root) ?? 0) || a.key.localeCompare(b.key));
    // Metadata is merged only while its stat signature matches the item; a changed file is probed again.
    const metaRows = this.db.prepare('SELECT key, size, mtime_ms, meta FROM media_meta WHERE meta IS NOT NULL').all() as unknown as {
      key: string;
      size: number;
      mtime_ms: number;
      meta: string;
    }[];
    const metaByKey = new Map(metaRows.map((m) => [m.key, m]));
    const thumbRows = this.db.prepare('SELECT key, size, mtime_ms FROM thumbs WHERE file IS NOT NULL').all() as unknown as { key: string; size: number; mtime_ms: number }[];
    const thumbByKey = new Map(thumbRows.map((t) => [t.key, t]));
    const userRows = this.db.prepare('SELECT key, tags, themes, favorite, last_used, render_count, sequence_fps, deinterlace FROM user_items').all() as unknown as {
      key: string;
      tags: string;
      themes: string;
      favorite: number;
      last_used: string | null;
      render_count: number;
      sequence_fps: number | null;
      deinterlace: number | null;
    }[];
    const userByKey = new Map(userRows.map((u) => [u.key, u]));
    const seenIds = new Map<string, string>();
    const duplicates: LibraryProblem[] = [];
    for (const row of rows) {
      const entry = JSON.parse(row.entry) as LibraryEntry;
      // A missing item is refused everywhere an offline one is (milestone 32).
      if (offline.has(row.root) || (entry.kind === 'media' && (entry.missing || entry.unreadable))) entry.offline = true;
      const t = thumbByKey.get(row.key);
      if (t && t.size === row.size && t.mtime_ms === row.mtime_ms) entry.thumbnail = thumbUrlFor(row.id);
      // The base themes come with the entry: the manifest's for templates, the folders' for media.
      if (entry.kind === 'template' && entry.manifest.themes?.length) entry.themes = [...entry.manifest.themes];
      const u = userByKey.get(row.key);
      if (u) {
        const userTags = JSON.parse(u.tags) as string[];
        if (userTags.length > 0) {
          entry.userTags = userTags;
          entry.tags = [...new Set([...entry.tags, ...userTags])];
        }
        const userThemes = JSON.parse(u.themes ?? '[]') as string[];
        if (userThemes.length > 0) {
          entry.userThemes = userThemes;
          entry.themes = [...new Set([...(entry.themes ?? []), ...userThemes])];
        }
        if (u.favorite === 1) entry.favorite = true;
        if (u.last_used) entry.lastUsed = u.last_used;
        if (u.render_count > 0) entry.renderCount = u.render_count;
      }
      if (entry.kind === 'template') {
        const previous = seenIds.get(entry.manifest.id);
        if (previous) {
          duplicates.push({ path: entry.dir, message: `duplicate template id "${entry.manifest.id}" (already loaded from ${previous}); skipped` });
          continue;
        }
        seenIds.set(entry.manifest.id, entry.dir);
        index.templates.push(entry);
      } else {
        const m = metaByKey.get(row.key);
        if (m && m.size === row.size && m.mtime_ms === row.mtime_ms) entry.meta = JSON.parse(m.meta) as MediaMetadata;
        // A rate of the person's own for a frame sequence (milestone 30), over the one the probe
        // recorded from Pulp's stated default. After the metadata, or it would be overwritten.
        const rate = userByKey.get(row.key)?.sequence_fps;
        if (rate && entry.sequence) {
          entry.meta = { ...entry.meta, fps: rate, duration: Math.round((entry.sequence.count / rate) * 1000) / 1000 };
        }
        // Deinterlacing turned off for this clip (milestone 83).
        if (userByKey.get(row.key)?.deinterlace === 0) entry.deinterlace = false;
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
      .prepare("SELECT items.key AS key, items.size AS size, items.mtime_ms AS mtime_ms, items.entry AS entry, items.root AS root, roots.online AS online FROM items JOIN roots ON roots.path = items.root WHERE items.id = ? AND items.kind = 'media'")
      .get(id) as { key: string; size: number; mtime_ms: number; entry: string; root: string; online: number } | undefined;
    if (!row) return undefined;
    const entry = JSON.parse(row.entry) as MediaEntry;
    // Probed metadata rides along while its signature matches, as it does for the index: what
    // decodes a clip needs its codec and alpha (milestone 32) and its size.
    const m = this.db.prepare('SELECT size, mtime_ms, meta FROM media_meta WHERE key = ? AND meta IS NOT NULL').get(row.key) as { size: number; mtime_ms: number; meta: string } | undefined;
    if (m && m.size === row.size && m.mtime_ms === row.mtime_ms) entry.meta = JSON.parse(m.meta) as MediaMetadata;
    // Deinterlacing turned off for this clip (milestone 83): what reads its pixels must know.
    if (this.deinterlaceOff(row.key)) entry.deinterlace = false;
    return { entry, root: row.root, online: row.online === 1 };
  }

  /** Media items in online roots that have no metadata for their current size and mtime, oldest first. */
  pendingMetadata(limit = 50): MediaEntry[] {
    const rows = this.db
      .prepare(
        'SELECT items.entry AS entry FROM items JOIN roots ON roots.path = items.root ' +
          'LEFT JOIN media_meta ON media_meta.key = items.key AND media_meta.size = items.size AND media_meta.mtime_ms = items.mtime_ms ' +
          "WHERE items.kind = 'media' AND roots.online = 1 AND media_meta.key IS NULL AND json_extract(items.entry, '$.missing') IS NULL AND json_extract(items.entry, '$.unreadable') IS NULL ORDER BY items.rowid LIMIT ?",
      )
      .all(limit) as unknown as { entry: string }[];
    return rows.map((r) => JSON.parse(r.entry) as MediaEntry);
  }

  /**
   * Clips whose frames have not been read for their scan yet (milestone 83): video files in online
   * roots, measured from the file itself (not a preview), with no `scan` in their metadata. A
   * sequence, a clip set, a file known only from a catalog or a preview, and a file Pulp cannot
   * read are left out; the caller decides from the metadata whether frames need reading at all.
   */
  pendingScans(limit = 20): MediaEntry[] {
    const rows = this.db
      .prepare(
        'SELECT items.entry AS entry, media_meta.meta AS meta FROM items JOIN roots ON roots.path = items.root ' +
          'JOIN media_meta ON media_meta.key = items.key AND media_meta.size = items.size AND media_meta.mtime_ms = items.mtime_ms ' +
          "WHERE items.kind = 'media' AND roots.online = 1 AND media_meta.meta IS NOT NULL AND json_extract(media_meta.meta, '$.scan') IS NULL " +
          "AND json_extract(media_meta.meta, '$.fromPreview') IS NULL AND json_extract(items.entry, '$.mediaKind') = 'video' " +
          "AND json_extract(items.entry, '$.sequence') IS NULL AND json_extract(items.entry, '$.clipSet') IS NULL " +
          "AND json_extract(items.entry, '$.missing') IS NULL AND json_extract(items.entry, '$.unreadable') IS NULL ORDER BY items.rowid LIMIT ?",
      )
      .all(limit) as unknown as { entry: string; meta: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.entry) as MediaEntry), meta: JSON.parse(r.meta) as MediaMetadata }));
  }

  /**
   * Keep what a clip's frames showed of its scan (milestone 83) with its metadata, and what its tag
   * claims, where the metadata is still of the file as it is: false when there is none to keep it
   * with — the file changed, or has not been probed — which the next pass puts right.
   */
  recordScan(key: string, size: number, mtimeMs: number, scan: ScanReading, fieldOrder?: ScanField): boolean {
    const m = this.db.prepare('SELECT size, mtime_ms, meta FROM media_meta WHERE key = ? AND meta IS NOT NULL').get(key) as { size: number; mtime_ms: number; meta: string } | undefined;
    if (!m || m.size !== size || m.mtime_ms !== mtimeMs) return false;
    const meta = JSON.parse(m.meta) as MediaMetadata;
    if (meta.fromPreview) return false;
    const next: MediaMetadata = { ...meta, scan, ...(fieldOrder ? { fieldOrder } : {}) };
    this.db.prepare('UPDATE media_meta SET meta = ? WHERE key = ?').run(JSON.stringify(next), key);
    return true;
  }

  /** Store a probe result for the item as it is now; null records that ffprobe could not read it, so it is not retried until the file changes. */
  setMetadata(entry: MediaEntry, meta: MediaMetadata | null): void {
    this.db
      .prepare(
        'INSERT INTO media_meta (key, size, mtime_ms, meta) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, meta = excluded.meta',
      )
      .run(entry.key, entry.size, entry.mtimeMs, meta ? JSON.stringify(meta) : null);
  }

  /** Items in online roots that want a thumbnail and have none for their current size and mtime. */
  pendingThumbnails(limit = 20): LibraryEntry[] {
    const rows = this.db
      .prepare(
        'SELECT items.entry AS entry FROM items JOIN roots ON roots.path = items.root ' +
          'LEFT JOIN thumbs ON thumbs.key = items.key AND thumbs.size = items.size AND thumbs.mtime_ms = items.mtime_ms ' +
          "WHERE roots.online = 1 AND thumbs.key IS NULL AND (json_extract(items.entry, '$.missing') IS NULL OR json_extract(items.entry, '$.preview') IS NOT NULL) AND (json_extract(items.entry, '$.unreadable') IS NULL OR json_extract(items.entry, '$.unreadable.preview') IS NOT NULL) ORDER BY items.rowid LIMIT ?",
      )
      .all(limit * 2) as unknown as { entry: string }[];
    return rows.map((r) => JSON.parse(r.entry) as LibraryEntry).filter(wantsThumbnail).slice(0, limit);
  }

  /** Record a thumbnail for the item as it is now; null means generation failed and is not retried until the item changes. */
  setThumbnail(entry: LibraryEntry, file: string | null): void {
    const row = this.db.prepare('SELECT size, mtime_ms FROM items WHERE key = ?').get(entry.key) as { size: number; mtime_ms: number } | undefined;
    if (!row) return;
    this.db
      .prepare('INSERT INTO thumbs (key, size, mtime_ms, file) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, file = excluded.file')
      .run(entry.key, row.size, row.mtime_ms, file);
  }

  /** The cache file of an item's current thumbnail by id, or undefined. Audio and never-generated items have none. */
  findThumbnailById(id: string): string | undefined {
    const row = this.db
      .prepare('SELECT thumbs.file AS file FROM items JOIN thumbs ON thumbs.key = items.key AND thumbs.size = items.size AND thumbs.mtime_ms = items.mtime_ms WHERE items.id = ? AND thumbs.file IS NOT NULL')
      .get(id) as { file: string } | undefined;
    return row?.file;
  }

  /**
   * The hover-scrub strip of an item by id. Strips are made on demand, so there
   * are three answers: a file, "tried and failed" (a row with no file, which is
   * not retried until the item changes), and "not made yet".
   */
  findStripById(id: string): { file: string | null } | undefined {
    return this.db
      .prepare('SELECT strips.file AS file FROM items JOIN strips ON strips.key = items.key AND strips.size = items.size AND strips.mtime_ms = items.mtime_ms WHERE items.id = ?')
      .get(id) as { file: string | null } | undefined;
  }

  /** An item's waveform peaks, base64, or undefined when none has been taken for the file as it is now. */
  findWaveformById(id: string): { peaks: string | null } | undefined {
    return this.db
      .prepare('SELECT waveforms.peaks AS peaks FROM items JOIN waveforms ON waveforms.key = items.key AND waveforms.size = items.size AND waveforms.mtime_ms = items.mtime_ms WHERE items.id = ?')
      .get(id) as { peaks: string | null } | undefined;
  }

  /** Record peaks for the item as it is now; null records that ffmpeg could not read its audio. */
  setWaveform(key: string, peaks: string | null): void {
    const row = this.db.prepare('SELECT size, mtime_ms FROM items WHERE key = ?').get(key) as { size: number; mtime_ms: number } | undefined;
    if (!row) return;
    this.db
      .prepare('INSERT INTO waveforms (key, size, mtime_ms, peaks) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, peaks = excluded.peaks')
      .run(key, row.size, row.mtime_ms, peaks);
  }

  /**
   * The items the semantic pass still has to embed (milestone 9): online, with
   * no vector for the file as it is now under this model. Keys and ids only;
   * the text is built from the entry when the pass reaches it.
   */
  embeddingsMissing(model: string): { key: string; id: string }[] {
    return this.db
      .prepare(
        'SELECT items.key AS key, items.id AS id FROM items ' +
        'JOIN roots ON roots.path = items.root ' +
        'LEFT JOIN embeddings ON embeddings.key = items.key AND embeddings.size = items.size AND embeddings.mtime_ms = items.mtime_ms AND embeddings.model = ? ' +
        'WHERE roots.online = 1 AND embeddings.key IS NULL',
      )
      .all(model) as unknown as { key: string; id: string }[];
  }

  /** Every vector held for files as they are now under this model, by library id. */
  embeddingsAll(model: string): { id: string; vec: Uint8Array }[] {
    return this.db
      .prepare(
        'SELECT items.id AS id, embeddings.vec AS vec FROM items ' +
        'JOIN embeddings ON embeddings.key = items.key AND embeddings.size = items.size AND embeddings.mtime_ms = items.mtime_ms ' +
        'WHERE embeddings.model = ?',
      )
      .all(model) as unknown as { id: string; vec: Uint8Array }[];
  }

  /** Record an item's vector for the file as it is now. */
  setEmbedding(key: string, model: string, vec: Uint8Array): void {
    const row = this.db.prepare('SELECT size, mtime_ms FROM items WHERE key = ?').get(key) as { size: number; mtime_ms: number } | undefined;
    if (!row) return;
    this.db
      .prepare('INSERT INTO embeddings (key, size, mtime_ms, model, vec) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, model = excluded.model, vec = excluded.vec')
      .run(key, row.size, row.mtime_ms, model, vec);
  }

  /** Record a strip for the item as it is now; null records a failure, so it is not attempted again until the item changes. */
  setStrip(key: string, file: string | null): void {
    const row = this.db.prepare('SELECT size, mtime_ms FROM items WHERE key = ?').get(key) as { size: number; mtime_ms: number } | undefined;
    if (!row) return;
    this.db
      .prepare('INSERT INTO strips (key, size, mtime_ms, file) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, file = excluded.file')
      .run(key, row.size, row.mtime_ms, file);
  }

  /**
   * The entry behind a library id, for work that needs the item itself rather
   * than the whole index. Probed metadata is merged in, as the index does and
   * for the same reason: only while its stat signature still matches.
   */
  /**
   * A template by library id, with whether its root is reachable — the answer
   * `findEntryById` cannot give, because the offline flag belongs to the root
   * and is put on the index as it is built rather than stored on the row.
   * What a Lottie placed as a layer is looked up through (milestone 35).
   */
  findTemplateById(id: string): { entry: TemplateEntry; online: boolean } | undefined {
    const row = this.db
      .prepare("SELECT items.entry AS entry, roots.online AS online FROM items JOIN roots ON roots.path = items.root WHERE items.id = ? AND items.kind = 'template'")
      .get(id) as { entry: string; online: number } | undefined;
    if (!row) return undefined;
    return { entry: JSON.parse(row.entry) as TemplateEntry, online: row.online === 1 };
  }

  findEntryById(id: string): LibraryEntry | undefined {
    const row = this.db.prepare('SELECT key, size, mtime_ms, entry FROM items WHERE id = ?').get(id) as
      | { key: string; size: number; mtime_ms: number; entry: string }
      | undefined;
    if (!row) return undefined;
    const entry = JSON.parse(row.entry) as LibraryEntry;
    if (entry.kind === 'media') {
      const m = this.db.prepare('SELECT size, mtime_ms, meta FROM media_meta WHERE key = ? AND meta IS NOT NULL').get(row.key) as
        | { size: number; mtime_ms: number; meta: string }
        | undefined;
      if (m && m.size === row.size && m.mtime_ms === row.mtime_ms) entry.meta = JSON.parse(m.meta) as MediaMetadata;
      if (this.deinterlaceOff(row.key)) entry.deinterlace = false;
    }
    return entry;
  }

  /** Whether a person turned deinterlacing off for the item behind this key (milestone 83). */
  private deinterlaceOff(key: string): boolean {
    return (this.db.prepare('SELECT deinterlace FROM user_items WHERE key = ?').get(key) as { deinterlace: number | null } | undefined)?.deinterlace === 0;
  }

  itemCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n;
  }

  /**
   * An archive's member unpacked just now (milestone 32): its row takes the file's path and says it
   * is unpacked — and where, when the library could not be written to — so whatever uses it next
   * reads the file at once, ahead of the scan that will agree.
   */
  markArchiveUnpacked(key: string, path: string, elsewhere: boolean): void {
    const row = this.db.prepare('SELECT entry FROM items WHERE key = ?').get(key) as { entry: string } | undefined;
    if (!row) return;
    const entry = JSON.parse(row.entry) as MediaEntry;
    if (entry.kind !== 'media' || !entry.archive) return;
    const archive = { zip: entry.archive.zip, member: entry.archive.member, unpacked: true, ...(elsewhere ? { elsewhere: true as const } : {}) };
    this.db.prepare('UPDATE items SET entry = ? WHERE key = ?').run(JSON.stringify({ ...entry, path, archive }), key);
  }

  /** The item key behind a library id, for any kind; undefined for unknown ids. */
  keyForId(id: string): string | undefined {
    return (this.db.prepare('SELECT key FROM items WHERE id = ?').get(id) as { key: string } | undefined)?.key;
  }

  getUserData(key: string): UserItemData {
    const row = this.db.prepare('SELECT tags, themes, favorite, last_used, sequence_fps, deinterlace FROM user_items WHERE key = ?').get(key) as
      | { tags: string; themes: string; favorite: number; last_used: string | null; sequence_fps: number | null; deinterlace: number | null }
      | undefined;
    if (!row) return { tags: [], themes: [], favorite: false };
    return {
      tags: JSON.parse(row.tags) as string[],
      themes: JSON.parse(row.themes ?? '[]') as string[],
      favorite: row.favorite === 1,
      ...(row.last_used ? { lastUsed: row.last_used } : {}),
      ...(row.sequence_fps ? { sequenceFps: row.sequence_fps } : {}),
      ...(row.deinterlace === 0 ? { deinterlace: false as const } : {}),
    };
  }

  /** One more finished render of this item, for the Info tab's Usage section. */
  countRender(key: string): void {
    this.db
      .prepare('INSERT INTO user_items (key, render_count) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET render_count = render_count + 1')
      .run(key);
  }

  setUserData(key: string, patch: Partial<UserItemData>): UserItemData {
    const next = { ...this.getUserData(key), ...patch };
    this.db
      .prepare(
        'INSERT INTO user_items (key, tags, themes, favorite, last_used, sequence_fps, deinterlace) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET tags = excluded.tags, themes = excluded.themes, favorite = excluded.favorite, ' +
          'last_used = excluded.last_used, sequence_fps = excluded.sequence_fps, deinterlace = excluded.deinterlace',
      )
      .run(key, JSON.stringify(next.tags), JSON.stringify(next.themes), next.favorite ? 1 : 0, next.lastUsed ?? null, next.sequenceFps ?? null, next.deinterlace === false ? 0 : null);
    return next;
  }
}

/**
 * The library's own catalog at its root (milestone 32), if it has one: its rows and the file's time,
 * which is the signature of every item known only from it. A catalog that cannot be read is a problem
 * of the root; none at all is nothing.
 */
async function readCatalog(rootPath: string, problems: LibraryProblem[]): Promise<{ rows: CatalogRow[]; mtimeMs: number } | null> {
  for (const catalogName of CATALOG_FILES) {
    const catalogPath = join(rootPath, catalogName);
    try {
      const info = await stat(catalogPath);
      return { rows: parseCatalog(await readFile(catalogPath, 'utf8'), catalogName), mtimeMs: info.mtimeMs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') problems.push({ path: catalogPath, message: `could not read the library's catalog: ${(err as Error).message}` });
    }
  }
  return null;
}

async function entryStillExists(stored: ItemRow): Promise<boolean> {
  try {
    const entry = JSON.parse(stored.entry) as TemplateEntry;
    return (await stat(join(entry.dir, entry.manifest.entry))).isFile();
  } catch {
    return false;
  }
}
