/**
 * Previews before full media (milestone 32): a stock collection of hundreds
 * of gigabytes is browsable straight away because it is indexed from the
 * small previews and thumbnails it carries, and its full-quality files are
 * read only when an item is placed or rendered.
 *
 * Where a collection keeps them:
 *
 * - **Beside the file**, named after it: `Fire 01.mov` with `Fire 01.jpg`
 *   (a JPEG beside a clip or a sound is its poster), `Fire 01_preview.mp4`,
 *   `Fire 01 thumb.png`, `Fire 01 (preview).mp3`. A picture beside a picture
 *   is a second picture unless it says it is a preview.
 * - **In a preview folder** — `Previews`, `Thumbnails`, `Thumbs`, `Proxies`,
 *   `Low Res` — at the library's root or beside the media, mirroring the
 *   folders (`Previews/Clips/Fire 01.jpg` for `Clips/Fire 01.mov`) or flat
 *   when every name is unique.
 * - **Named by the library's catalog**, in a `preview` or `thumbnail` column
 *   (src/core/library-catalog.ts).
 *
 * A preview is the item's, not an item of its own; one in a preview folder
 * that no file claims is listed as itself, so nothing disappears. What is read
 * for browsing — the thumbnail, the length, the hover-scrub strip, the stage —
 * comes from the preview; metadata taken from one says so (`fromPreview`), and
 * the full file is probed when the item is first used (`prepareForUse` in
 * src/main/library-service.ts). Pure: the store hands folder listings here.
 */

import type { MediaEntry, MediaKind } from './library-types';
import type { MediaMetadata } from './media-meta';

/** Folder names that hold a collection's previews rather than its media, lowercase. */
export const PREVIEW_FOLDERS: ReadonlySet<string> = new Set(['previews', 'preview', 'thumbnails', 'thumbnail', 'thumbs', 'thumb', 'proxies', 'proxy', 'low res', 'lowres', 'low-res', 'low_res']);

export function isPreviewFolder(name: string): boolean {
  return PREVIEW_FOLDERS.has(name.trim().toLowerCase());
}

/** A picture, a clip or a sound as previews come: the simple formats only, never a layered file or a frame format. */
const PICTURE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const CLIP = /\.(mp4|mov|m4v|webm)$/i;
const SOUND = /\.(mp3|m4a|aac|ogg|wav|flac)$/i;
/** A JPEG beside a clip or a sound is its poster even when its name does not say so; a PNG may be a deliverable. */
const POSTER_WITHOUT_A_WORD = /\.(jpe?g|webp)$/i;

/** The words after a name that make a file its preview: "Fire 01_preview.mp4", "Fire 01 thumb.jpg", "Fire 01 (low res).mov". */
const PREVIEW_WORD = /[\s_\-.]*[([]?(preview|prev|thumbnail|thumbs?|poster|proxy|low[\s_-]?res)[)\]]?$/i;

/** A file's stem in lowercase — and, when a preview word was taken off its end, what it is a preview of. */
export function previewStem(fileName: string): { stem: string; marked: boolean } {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const stripped = base.replace(PREVIEW_WORD, '');
  const marked = stripped !== base && stripped.trim() !== '';
  return { stem: (marked ? stripped : base).trim().toLowerCase(), marked };
}

/**
 * An item's previews (milestone 32): the small files the library carries for it, read for browsing in
 * place of the full one. `still` is a picture, its thumbnail and what the stage shows when there is no
 * `media`; `media` is a small clip or sound of the item's own kind, which the stage plays, the strip
 * and the length come from. Full paths.
 */
export interface MediaPreview {
  still?: string;
  media?: string;
}

/** What kind of preview a file is for an item of `kind`, or null when it is not one. */
function previewSlot(name: string, kind: MediaKind, marked: boolean): keyof MediaPreview | null {
  if (PICTURE.test(name)) {
    if (marked || kind !== 'image') return 'still';
    return null;
  }
  if (!marked) return null;
  if (kind === 'video' && CLIP.test(name)) return 'media';
  if (kind === 'audio' && SOUND.test(name)) return 'media';
  return null;
}

/** A folder's file names by the stem each previews, built once so a folder of thousands of files is matched in linear time. */
export type SiblingIndex = Map<string, { name: string; marked: boolean }[]>;

export function indexSiblings(names: readonly string[]): SiblingIndex {
  const index: SiblingIndex = new Map();
  for (const name of names) {
    const { stem, marked } = previewStem(name);
    index.set(stem, [...(index.get(stem) ?? []), { name, marked }]);
  }
  return index;
}

/**
 * The previews beside an item in its own folder, from the folder's file names: the siblings whose
 * name is the item's — with a preview word after it, or a JPEG for a clip or a sound — and the names
 * they take, so the walk lists none of them as items. `self` is every file that is the item itself (a
 * clip set's parts, say), which can never be its preview.
 */
export function sidecarPreviews(stem: string, kind: MediaKind, self: readonly string[], siblings: SiblingIndex | readonly string[]): { preview: MediaPreview; claimed: string[] } {
  const want = stem.trim().toLowerCase();
  const own = new Set(self);
  const index = Array.isArray(siblings) ? indexSiblings(siblings as readonly string[]) : (siblings as SiblingIndex);
  const candidates = (index.get(want) ?? [])
    .filter((c) => !own.has(c.name))
    .filter((c) => c.marked || (kind !== 'image' && POSTER_WITHOUT_A_WORD.test(c.name)))
    // A file that says it is a preview before one that is only named alike.
    .sort((a, b) => Number(b.marked) - Number(a.marked) || a.name.localeCompare(b.name));
  const preview: MediaPreview = {};
  const claimed: string[] = [];
  for (const c of candidates) {
    const slot = previewSlot(c.name, kind, c.marked);
    if (!slot) continue;
    claimed.push(c.name);
    if (preview[slot] === undefined) preview[slot] = c.name;
  }
  return { preview, claimed };
}

/** A preview the catalog names for an item (milestone 32), in the slot its own format fills; `{}` when it is no preview format. */
export function catalogPreview(file: string, kind: MediaKind): MediaPreview {
  const fileKind = previewFileKind(file.split(/[\\/]/).pop() ?? '');
  if (fileKind === 'picture') return { still: file };
  if ((fileKind === 'clip' && kind === 'video') || (fileKind === 'sound' && kind === 'audio')) return { media: file };
  return {};
}

/** The media kind a preview folder's file previews, from its own extension; a layered or frame format is none. */
function previewFileKind(name: string): 'picture' | 'clip' | 'sound' | null {
  if (PICTURE.test(name)) return 'picture';
  if (CLIP.test(name)) return 'clip';
  if (SOUND.test(name)) return 'sound';
  return null;
}

/**
 * The files of one preview folder, looked up for the media they preview (milestone 32). The folder
 * mirrors the one it sits in — `Previews/Clips/Fire 01.jpg` for `Clips/Fire 01.mov`, when the folder
 * is at the library's root — or sits beside the media it previews (`Clips/Thumbs/Fire 01.jpg`), which is
 * the same thing one level down; a flat folder matches by name alone wherever that name is unique.
 */
export class PreviewFolder {
  private readonly byPath = new Map<string, string[]>();
  private readonly byStem = new Map<string, string[]>();
  /** Every file added, by full path, so the ones no item claims can be listed as themselves. */
  readonly files: string[] = [];

  /** `base`: the folder whose media this one previews (its parent). */
  constructor(readonly base: string) {}

  /** `relative`: the file's path inside the preview folder, `/`-joined; `fullPath`: where it is. */
  add(relative: string, fullPath: string): void {
    const parts = relative.split('/');
    const name = parts.pop()!;
    if (!previewFileKind(name)) return;
    const { stem } = previewStem(name);
    const key = [...parts.map((p) => p.toLowerCase()), stem].join('/');
    this.files.push(fullPath);
    this.byPath.set(key, [...(this.byPath.get(key) ?? []), fullPath]);
    this.byStem.set(stem, [...(this.byStem.get(stem) ?? []), fullPath]);
  }

  /**
   * The previews for an item of `kind` named `stem` in the folder `relDir` under `base` (`/`-joined,
   * '' for `base` itself): the files at the mirrored path, else — when the folder is flat, or the name
   * appears once — the files of that name wherever they lie.
   */
  find(relDir: string, stem: string, kind: MediaKind): { preview: MediaPreview; claimed: string[] } {
    const want = stem.trim().toLowerCase();
    const key = [...relDir.split('/').filter(Boolean).map((p) => p.toLowerCase()), want].join('/');
    const mirrored = this.byPath.get(key);
    const byName = this.byStem.get(want) ?? [];
    const folders = new Set(byName.map((f) => f.split(/[\\/]/).slice(0, -1).join('/')));
    const files = mirrored ?? (folders.size <= 1 ? byName : []);
    const preview: MediaPreview = {};
    const claimed: string[] = [];
    for (const file of [...files].sort()) {
      const name = file.split(/[\\/]/).pop()!;
      const fileKind = previewFileKind(name);
      const slot: keyof MediaPreview | null = fileKind === 'picture' ? 'still' : (fileKind === 'clip' && kind === 'video') || (fileKind === 'sound' && kind === 'audio') ? 'media' : null;
      if (!slot) continue;
      claimed.push(file);
      if (preview[slot] === undefined) preview[slot] = file;
    }
    return { preview, claimed };
  }
}

/** Nothing, or the previews found: `{}` is not a preview. */
export function hasPreview(preview: MediaPreview | undefined): preview is MediaPreview {
  return preview !== undefined && (preview.still !== undefined || preview.media !== undefined);
}

/** Two entries' previews are the same files. */
export function samePreview(a: MediaPreview | undefined, b: MediaPreview | undefined): boolean {
  return (a?.still ?? '') === (b?.still ?? '') && (a?.media ?? '') === (b?.media ?? '');
}

/**
 * What a preview can say for the item: its length, which a preview clip or sound shares with the
 * file. Not its picture size, rate, codec or alpha — a preview is smaller, often slower and never
 * carries the alpha the original does — which wait until the file itself is read on use. With no
 * preview clip (a still only), the length too waits, and this records that nothing was read.
 */
export function metadataFromPreview(probed: MediaMetadata | null): MediaMetadata {
  return { ...(probed?.duration ? { duration: probed.duration } : {}), fromPreview: true };
}

/** The picture a thumbnail is made from: the still, else a frame of the preview clip. */
export function thumbnailPreview(entry: MediaEntry): { file: string; isClip: boolean } | null {
  if (!hasPreview(entry.preview)) return null;
  if (entry.preview.still) return { file: entry.preview.still, isClip: false };
  return entry.preview.media && CLIP.test(entry.preview.media) ? { file: entry.preview.media, isClip: true } : null;
}

/** The small clip the hover-scrub strip and the stage play for a clip, or null when its preview is a still only. */
export function previewClip(entry: MediaEntry): string | null {
  return entry.preview?.media && CLIP.test(entry.preview.media) ? entry.preview.media : null;
}

/** The small sound the waveform and the stage play for a sound, or null when it has none. */
export function previewSound(entry: MediaEntry): string | null {
  return entry.preview?.media && SOUND.test(entry.preview.media) ? entry.preview.media : null;
}

/** Whether a file is a picture, a clip or a sound as the preview handler may serve it. */
export function isPreviewFile(path: string): boolean {
  return previewFileKind(path.split(/[\\/]/).pop() ?? '') !== null;
}
