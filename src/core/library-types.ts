/** Library index data types. Pure; shared with the renderer over IPC. */

import type { TemplateManifest, ValidationIssue } from './manifest';

export type MediaKind = 'video' | 'image' | 'audio';

export interface TemplateEntry {
  kind: 'template';
  /** Unique key within the index. */
  key: string;
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
}

