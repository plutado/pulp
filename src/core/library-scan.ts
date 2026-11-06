/**
 * Pieces of the library scan shared by the store and by tests: media kinds,
 * folder tags, and loading one template folder. Uses node:fs only.
 */

import { createHash } from 'node:crypto';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { tr } from './i18n';
import { type TemplateManifest, MANIFEST_FILENAME, parseManifest } from './manifest';
import type { TemplateSound } from './template-sound';
import type { LibraryProblem, MediaKind, TemplateEntry } from './library-types';
import { normalizeTag } from './tags';
import type { LottieNote } from './lottie-types';
import { humanizeFileName, lottieEditables, lottieExtras, lottieInfo, lottieLimits, lottieManifest, parseLottie, readDotLottie, sniffLottieJson, type LottieDocument } from './lottie';
import type { LottieFormat } from './lottie-types';
import { inferTemplateType, inferThemes } from './taxonomy';

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

/**
 * What stands for the bundled library in an item's key, in place of wherever
 * the app happens to be installed or checked out.
 */
export const BUNDLED_KEY_ROOT = '@bundled';

/**
 * The key an item is known by, which its library id is the hash of.
 *
 * For anything in a person's own folders that is the absolute path: the file
 * is where they put it, and a project that outlives a move is relinked by
 * path (`src/main/project-service.ts`). For the **bundled library** it is the
 * path *inside the app* — `@bundled/lottie/tick-draw.json` — because that
 * folder sits at a different absolute path in every checkout and every
 * install, while the item in it is the same item. Keyed by the absolute path,
 * a bundled item took a new id on every machine, which the visual references
 * felt first: a Lottie has no manifest id of its own, so its manifest id is
 * made from its library id (`lottieManifestId`), and the references written
 * in one checkout matched nothing in another. Collections and saved projects
 * carry the same ids and would have missed the same way.
 *
 * The separators are `/` on every platform, so the id a Windows runner makes
 * is the id a macOS one makes (docs/platform-notes.md).
 */
export function itemKey(kind: 'template' | 'lottie' | 'media', path: string, builtInRoot?: string): string {
  if (builtInRoot !== undefined) {
    const rel = relative(builtInRoot, path);
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
      return `${kind}:${BUNDLED_KEY_ROOT}/${rel.split(sep).join('/')}`;
    }
  }
  return `${kind}:${path}`;
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
  /** Sound variations for the pack's templates (milestone 16): applied where a template declares none and carries the files. */
  sound?: TemplateSound;
}

/** A template's manifest with its pack's defaults filled in: its own type wins; themes and styles are joined. */
export function applyPackDefaults(manifest: TemplateManifest, pack: PackContext | undefined): TemplateManifest {
  if (!pack) return manifest;
  const out = { ...manifest };
  if (out.type === undefined && pack.type) out.type = pack.type;
  if (pack.themes?.length) out.themes = [...new Set([...(out.themes ?? []), ...pack.themes])];
  if (pack.styles?.length) out.styles = [...new Set([...(out.styles ?? []), ...pack.styles])];
  if (out.sound === undefined && pack.sound) out.sound = pack.sound;
  return out;
}

/**
 * The pack's sound as it applies to one template folder (milestone 16): only
 * the variants whose files are really inside the folder, with a default that
 * still names one of them; null when none are there, so a template without the
 * files is simply a template without a sound rather than a broken promise.
 */
export async function packSoundFor(sound: TemplateSound, dir: string): Promise<TemplateSound | null> {
  const variants = [];
  for (const variant of sound.variants) {
    try {
      if ((await stat(join(dir, variant.file))).isFile()) variants.push(variant);
    } catch {
      // Not there: this variant does not apply to this template.
    }
  }
  if (variants.length === 0) return null;
  const defaultKept = sound.default === undefined || sound.default === 'none' || variants.some((v) => v.value === sound.default);
  return { variants, ...(defaultKept && sound.default !== undefined ? { default: sound.default } : {}), ...(sound.at !== undefined ? { at: sound.at } : {}) };
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

export async function loadTemplate(dir: string, root: string, pack?: PackContext, builtInRoot?: string): Promise<TemplateEntry | LibraryProblem> {
  const manifestPath = join(dir, MANIFEST_FILENAME);
  let text: string;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (err) {
    return { path: manifestPath, message: tr('library.problem.manifest-unreadable', { reason: (err as Error).message }) };
  }
  const result = parseManifest(text);
  if (!result.ok) return { path: manifestPath, message: tr('library.problem.manifest-invalid'), issues: result.errors };

  const entryPath = join(dir, result.manifest.entry);
  try {
    if (!(await stat(entryPath)).isFile()) throw new Error('not a file');
  } catch {
    return { path: manifestPath, message: tr('library.problem.entry-missing', { entry: result.manifest.entry }) };
  }

  const onDisk = await folderBytes(dir);
  // A template folder's own name is not a useful tag; only its parents are.
  const tags = unique([...result.manifest.tags, ...folderTags(root, join(dir, '..'))]);
  // A pack's sound (milestone 16) applies only where this folder really holds the files, and
  // never over a sound the template declares itself.
  let packHere = pack;
  if (pack?.sound && result.manifest.sound === undefined) {
    const sound = await packSoundFor(pack.sound, dir);
    packHere = sound ? { ...pack, sound } : (({ sound: _sound, ...rest }) => rest)(pack);
  }
  const key = itemKey('template', dir, builtInRoot);
  return {
    kind: 'template',
    key,
    id: itemId(key),
    dir,
    size: onDisk.size,
    mtimeMs: onDisk.mtimeMs,
    root,
    ...(pack ? { pack: { name: pack.name, slug: pack.slug } } : {}),
    manifest: applyPackDefaults(result.manifest, packHere),
    tags,
    warnings: result.warnings,
  };
}

// ---------------------------------------------------------------- Lottie animations (milestone 35)

/** How much of a `.json` is read to tell a Lottie from any other JSON: Bodymovin's header keys come first. */
const LOTTIE_SNIFF_BYTES = 4096;

/** Does this `.json` look like a Lottie? Reads only its head; the whole file is parsed when it is loaded. */
export async function sniffLottieFile(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return false;
  }
  try {
    const buffer = Buffer.alloc(LOTTIE_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, LOTTIE_SNIFF_BYTES, 0);
    return sniffLottieJson(buffer.toString('utf8', 0, bytesRead));
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

/**
 * Read a Lottie file — a `.json` or a `.lottie` archive — as a template entry:
 * the manifest made from the file, its editable text and colors as
 * parameters, its type and themes from its folders as a clip's would be.
 * Problems are returned, not thrown, as `loadTemplate` returns them.
 */
export async function loadLottie(path: string, root: string, folderSegments: readonly string[], builtInRoot?: string): Promise<TemplateEntry | LibraryProblem> {
  let info;
  try {
    info = await stat(path);
  } catch (err) {
    return { path, message: tr('library.problem.file-unreadable', { reason: (err as Error).message }) };
  }
  const format: LottieFormat = extname(path).toLowerCase() === '.lottie' ? 'lottie' : 'json';
  let document: LottieDocument;
  let animations: string[] | undefined;
  let author: string | undefined;
  const limits: LottieNote[] = [];
  try {
    if (format === 'lottie') {
      const archive = readDotLottie(await readFile(path));
      document = archive.document;
      animations = archive.animations;
      author = archive.author;
      limits.push(...archive.limits);
    } else {
      document = parseLottie(await readFile(path, 'utf8'));
    }
  } catch (err) {
    return { path, message: tr('library.problem.lottie-unreadable', { reason: (err as Error).message }) };
  }
  const extras = lottieExtras(document.data);
  const editables = lottieEditables(document.data);
  limits.push(...lottieLimits(document.data), ...editables.limits);
  const key = itemKey('lottie', path, builtInRoot);
  const id = itemId(key);
  const type = inferTemplateType(folderSegments);
  const themes = inferThemes(folderSegments);
  const result = lottieManifest(document, {
    id,
    name: humanizeFileName(basename(path)),
    format,
    ...(type ? { type } : {}),
    themes,
    tags: [...folderSegments],
    ...(author ? { author } : {}),
    extras,
    editables,
    limits,
  });
  if (!result.ok) return { path, message: tr('library.problem.lottie-invalid'), issues: result.errors };
  return {
    kind: 'template',
    key,
    id,
    dir: dirname(path),
    root,
    size: info.size,
    mtimeMs: info.mtimeMs,
    manifest: result.manifest,
    tags: unique([...result.manifest.tags, ...folderSegments]),
    warnings: result.warnings,
    lottie: lottieInfo(document, path, format, editables.bindings, limits, animations),
  };
}
