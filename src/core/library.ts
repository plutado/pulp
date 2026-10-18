/**
 * Library indexer: walks user-chosen folders and builds an in-memory index of
 * templates (folders containing a template.json) and media files.
 *
 * Uses node:fs only; no Electron dependency. The index is plain data so it can
 * be sent over IPC and searched with ./search.ts.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { MANIFEST_FILENAME, parseManifest } from './manifest';
import type { LibraryIndex, LibraryProblem, MediaKind, TemplateEntry } from './library-types';
import { normalizeTag } from './tags';

export { normalizeTag };
export type * from './library-types';

export const MEDIA_EXTENSIONS: Record<MediaKind, readonly string[]> = {
  video: ['.mov', '.mp4', '.m4v', '.mkv', '.webm', '.mxf', '.avi'],
  image: ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.exr', '.webp', '.gif', '.bmp', '.dpx'],
  audio: ['.wav', '.aif', '.aiff', '.mp3', '.m4a', '.aac', '.flac', '.ogg'],
};

const EXTENSION_KIND = new Map<string, MediaKind>(
  (Object.entries(MEDIA_EXTENSIONS) as [MediaKind, readonly string[]][]).flatMap(([kind, exts]) =>
    exts.map((ext) => [ext, kind] as const),
  ),
);

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '__MACOSX', '$RECYCLE.BIN']);

export interface ScanOptions {
  /** Maximum directory depth below each root. Default 12. */
  maxDepth?: number;
  /** Stop after this many files across all roots, to keep a mis-chosen root (e.g. a whole disk) bounded. Default 100000. */
  maxFiles?: number;
}

export function mediaKindForPath(path: string): MediaKind | null {
  return EXTENSION_KIND.get(extname(path).toLowerCase()) ?? null;
}

/** Tags derived from the directories between the library root and the item. */
export function folderTags(root: string, itemDir: string): string[] {
  const rel = relative(root, itemDir);
  if (!rel || rel.startsWith('..')) return [];
  return rel
    .split(sep)
    .map(normalizeTag)
    .filter((t) => t.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function loadTemplate(dir: string, root: string): Promise<TemplateEntry | LibraryProblem> {
  const manifestPath = join(dir, MANIFEST_FILENAME);
  let text: string;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (err) {
    return { path: manifestPath, message: `could not read manifest: ${(err as Error).message}` };
  }
  const result = parseManifest(text);
  if (!result.ok) return { path: manifestPath, message: 'invalid template manifest', issues: result.errors };

  const entryPath = join(dir, result.manifest.entry);
  try {
    if (!(await stat(entryPath)).isFile()) throw new Error('not a file');
  } catch {
    return { path: manifestPath, message: `entry file "${result.manifest.entry}" does not exist` };
  }

  // A template folder's own name is not a useful tag; only its parents are.
  const tags = unique([...result.manifest.tags, ...folderTags(root, join(dir, '..'))]);
  return {
    kind: 'template',
    key: `template:${dir}`,
    dir,
    root,
    manifest: result.manifest,
    tags,
    warnings: result.warnings,
  };
}

/** Scan the given roots and build a library index. Missing roots are reported as problems, not thrown. */
export async function scanLibrary(roots: string[], options: ScanOptions = {}): Promise<LibraryIndex> {
  const maxDepth = options.maxDepth ?? 12;
  const maxFiles = options.maxFiles ?? 100_000;
  const index: LibraryIndex = {
    roots: unique(roots.map((r) => resolve(r))),
    templates: [],
    media: [],
    problems: [],
    builtAt: new Date().toISOString(),
  };
  const seenTemplateIds = new Map<string, string>();
  let fileCount = 0;
  let truncated = false;

  async function walk(dir: string, root: string, depth: number): Promise<void> {
    if (fileCount >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      index.problems.push({ path: dir, message: `could not read folder: ${(err as Error).message}` });
      return;
    }

    if (entries.some((e) => e.isFile() && e.name === MANIFEST_FILENAME)) {
      const loaded = await loadTemplate(dir, root);
      if ('kind' in loaded) {
        const previous = seenTemplateIds.get(loaded.manifest.id);
        if (previous) {
          index.problems.push({
            path: dir,
            message: `duplicate template id "${loaded.manifest.id}" (already loaded from ${previous}); skipped`,
          });
        } else {
          seenTemplateIds.set(loaded.manifest.id, dir);
          index.templates.push(loaded);
        }
      } else {
        index.problems.push(loaded);
      }
      // A template folder is a unit; its assets are not library media.
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
        if (depth < maxDepth) await walk(full, root, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const kind = mediaKindForPath(entry.name);
      if (!kind) continue;
      if (fileCount >= maxFiles) {
        if (!truncated) index.problems.push({ path: root, message: `stopped after ${maxFiles} files` });
        truncated = true;
        return;
      }
      fileCount += 1;
      let info;
      try {
        info = await stat(full);
      } catch (err) {
        index.problems.push({ path: full, message: `could not stat file: ${(err as Error).message}` });
        continue;
      }
      index.media.push({
        kind: 'media',
        key: `media:${full}`,
        path: full,
        root,
        name: basename(entry.name, extname(entry.name)),
        mediaKind: kind,
        ext: extname(entry.name).toLowerCase(),
        size: info.size,
        mtimeMs: info.mtimeMs,
        tags: folderTags(root, dir),
      });
    }
  }

  for (const root of index.roots) {
    try {
      if (!(await stat(root)).isDirectory()) {
        index.problems.push({ path: root, message: 'library root is not a folder' });
        continue;
      }
    } catch {
      index.problems.push({ path: root, message: 'library root does not exist' });
      continue;
    }
    await walk(root, root, 0);
  }

  index.templates.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return index;
}
