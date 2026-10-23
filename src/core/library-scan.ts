/**
 * Pieces of the library scan shared by the store and by tests: media kinds,
 * folder tags, and loading one template folder. Uses node:fs only.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { MANIFEST_FILENAME, parseManifest } from './manifest';
import type { LibraryProblem, MediaKind, TemplateEntry } from './library-types';
import { normalizeTag } from './tags';

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

export const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '__MACOSX', '$RECYCLE.BIN']);

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
export async function loadTemplate(dir: string, root: string): Promise<TemplateEntry | LibraryProblem> {
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
