/** Library index data types. Pure; shared with the renderer over IPC. */

import type { TemplateManifest, ValidationIssue } from './manifest';
import type { MediaMetadata } from './media-meta';

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
  /** True when the item's library root is not reachable right now; the item is kept so user data survives. */
  offline?: boolean;
  dir: string;
  root: string;
  manifest: TemplateManifest;
  /** Manifest tags plus folder-derived tags. */
  tags: string[];
  warnings: ValidationIssue[];
}

export interface MediaEntry {
  kind: 'media';
  key: string;
  id: string;
  thumbnail?: string;
  userTags?: string[];
  favorite?: boolean;
  lastUsed?: string;
  offline?: boolean;
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

