/** Library index data types. Pure; shared with the renderer over IPC. */

import type { TemplateManifest, ValidationIssue } from './manifest';
import type { MediaMetadata } from './media-meta';
import type { MediaSequence } from './media-sequence';
import type { LottieInfo } from './lottie-types';

export type { MediaMetadata } from './media-meta';

export type MediaKind = 'video' | 'image' | 'audio';

export interface TemplateEntry {
  kind: 'template';
  /** Unique key within the index (derived from the path). */
  key: string;
  /** Opaque library id, stable for the item while it exists; used to address it without exposing its path. */
  id: string;
  /** pulp-thumb://<id>/ once a thumbnail exists for the item as it is now. */
  thumbnail?: string;
  /** Tags the user added; also merged into `tags`. */
  userTags?: string[];
  favorite?: boolean;
  /** ISO time the item was last selected or rendered. */
  lastUsed?: string;
  /** How many times a render of this item has finished. */
  renderCount?: number;
  /** True when the item's library root is not reachable right now; the item is kept so user data survives. */
  offline?: boolean;
  /** Manifest themes plus the user's; themes the user added; both like tags. */
  themes?: string[];
  userThemes?: string[];
  dir: string;
  root: string;
  /** Bytes the template folder holds, and the newest file in it; for the Info tab's File section. */
  size?: number;
  mtimeMs?: number;
  /** The pack this template was found under (a folder with a pack.json), if any. */
  pack?: { name: string; slug: string };
  manifest: TemplateManifest;
  /** Manifest tags plus folder-derived tags. */
  tags: string[];
  warnings: ValidationIssue[];
  /**
   * Set when the item is a Lottie animation read as a template (milestone 35):
   * a single `.json` or `.lottie` file, with no folder of its own. `dir` is then
   * the folder it sits in and `manifest.entry` is answered by a generated page.
   */
  lottie?: LottieInfo;
}

export interface MediaEntry {
  kind: 'media';
  key: string;
  id: string;
  thumbnail?: string;
  userTags?: string[];
  favorite?: boolean;
  lastUsed?: string;
  /** How many times a render of this item has finished. */
  renderCount?: number;
  offline?: boolean;
  /** From the built-in taxonomy, named by a folder on the item's path; absent when no folder says. */
  type?: string;
  /** Folder-inferred themes plus the user's; themes the user added. */
  themes?: string[];
  userThemes?: string[];
  path: string;
  root: string;
  name: string;
  mediaKind: MediaKind;
  ext: string;
  size: number;
  mtimeMs: number;
  /** Folder-derived tags. */
  tags: string[];
  /** From ffprobe, once probed; absent until then or when ffprobe could not read the file. */
  meta?: MediaMetadata;
  /**
   * Set when this entry is a run of numbered frames read as one clip rather
   * than a single file (milestone 26). `path` is then its first frame, and
   * `mediaKind` is `video` however the frames are stored.
   */
  sequence?: MediaSequence;
}

export type LibraryEntry = TemplateEntry | MediaEntry;

export interface LibraryProblem {
  path: string;
  message: string;
  issues?: ValidationIssue[];
}

export interface LibraryIndex {
  roots: string[];
  templates: TemplateEntry[];
  media: MediaEntry[];
  problems: LibraryProblem[];
  builtAt: string;
  /** The root holding the bundled sample templates, shown as "Built-in templates". */
  builtInRoot?: string;
}

