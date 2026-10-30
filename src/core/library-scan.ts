/**
 * Pieces of the library scan shared by the store and by tests: media kinds,
 * folder tags, and loading one template folder. Uses node:fs only.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { type TemplateManifest, MANIFEST_FILENAME, parseManifest } from './manifest';
import type { LibraryProblem, MediaKind, TemplateEntry } from './library-types';
import { normalizeTag } from './tags';

export const MEDIA_EXTENSIONS: Record<MediaKind, readonly string[]> = {
  video: ['.mov', '.mp4', '.m4v', '.mkv', '.webm', '.mxf', '.avi'],
  // A layered still is a still too (milestone 33): Photoshop, OpenRaster, Krita, SVG, and the PDF
  // an .ai carries — browsed as its composite, placed whole or as layers.
  image: ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.exr', '.webp', '.gif', '.bmp', '.dpx', '.svg', '.psd', '.ora', '.kra', '.ai', '.pdf'],
  audio: ['.wav', '.aif', '.aiff', '.mp3', '.m4a', '.aac', '.flac', '.ogg'],
};

const EXTENSION_KIND = new Map<string, MediaKind>(
  (Object.entries(MEDIA_EXTENSIONS) as [MediaKind, readonly string[]][]).flatMap(([kind, exts]) =>
    exts.map((ext) => [ext, kind] as const),
  ),
);

export const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '__MACOSX', '$RECYCLE.BIN']);

/** Library id for an item key: stable, opaque (a hash, not the path), 24 hex characters. */
export function itemId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
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

/** Read and validate one template folder; problems are returned, not thrown. */
/** The pack a template is found under: its name, install slug and the defaults its pack.json declares. */
export interface PackContext {
  name: string;
  slug: string;
  type?: string;
  themes?: string[];
  styles?: string[];
}

/** A template's manifest with its pack's defaults filled in: its own type wins; themes and styles are joined. */
export function applyPackDefaults(manifest: TemplateManifest, pack: PackContext | undefined): TemplateManifest {
  if (!pack) return manifest;
  const out = { ...manifest };
  if (out.type === undefined && pack.type) out.type = pack.type;
  if (pack.themes?.length) out.themes = [...new Set([...(out.themes ?? []), ...pack.themes])];
  if (pack.styles?.length) out.styles = [...new Set([...(out.styles ?? []), ...pack.styles])];
  return out;
}

/**
 * What a template folder weighs and when it last changed. Walked only when a
 * template is (re)loaded, not on every scan, and bounded by the same skip list
 * as the library walk, so a stray node_modules inside a template cannot run away
 * with it.
 */
async function folderBytes(dir: string, depth = 0): Promise<{ size: number; mtimeMs: number }> {
  let size = 0;
  let mtimeMs = 0;
  if (depth > 4) return { size, mtimeMs };
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { size, mtimeMs };
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRECTORIES.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const inner = await folderBytes(full, depth + 1);
      size += inner.size;
      mtimeMs = Math.max(mtimeMs, inner.mtimeMs);
    } else if (e.isFile()) {
      try {
        const info = await stat(full);
        size += info.size;
        mtimeMs = Math.max(mtimeMs, info.mtimeMs);
      } catch {
        // A file that vanished mid-walk simply does not count.
      }
    }
  }
  return { size, mtimeMs };
}

export async function loadTemplate(dir: string, root: string, pack?: PackContext): Promise<TemplateEntry | LibraryProblem> {
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

  const onDisk = await folderBytes(dir);
  // A template folder's own name is not a useful tag; only its parents are.
  const tags = unique([...result.manifest.tags, ...folderTags(root, join(dir, '..'))]);
  const key = `template:${dir}`;
  return {
    kind: 'template',
    key,
    id: itemId(key),
    dir,
    size: onDisk.size,
    mtimeMs: onDisk.mtimeMs,
    root,
    ...(pack ? { pack: { name: pack.name, slug: pack.slug } } : {}),
    manifest: applyPackDefaults(result.manifest, pack),
    tags,
    warnings: result.warnings,
  };
}
