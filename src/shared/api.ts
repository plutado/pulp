/**
 * Contract between the preload script (window.pulp) and the renderer.
 * Types only; both sides import it.
 */

import type { LayoutState } from '../core/layout';
import type { LibraryIndex } from '../core/library-types';
import type { PresetId, RenderOptions } from '../core/render-plan';
import type { RenderQueueSnapshot } from '../core/render-queue';
import type { PlayerState } from '../core/player';
import type { ResultsViewState } from '../core/results-view';
import type { Collection, CollectionItem } from '../core/collection';
import type { CollisionChoice, PackManifest, PackPreview } from '../core/pack';

export type { RenderJobStatus, RenderQueueJob, RenderQueueSnapshot } from '../core/render-queue';
export type { LibraryIndex } from '../core/library-types';
export type { CollisionChoice, PackManifest, PackPreview, PackTemplatePreview } from '../core/pack';
export type { RenderOptions } from '../core/render-plan';
export type { Collection, CollectionItem } from '../core/collection';

export interface FfmpegInfo {
  ok: boolean;
  /** Path and version when found; a human-readable error when not. */
  path?: string;
  version?: string;
  message?: string;
  /** Encoder names from `ffmpeg -encoders`, so the UI can mark presets this build cannot write. */
  encoders?: string[];
}

export interface RenderRequest {
  /** Manifest id of the template to render. */
  templateId: string;
  params: Record<string, unknown>;
  presetId: PresetId;
  /** Frame rate override, background for flattening, start/end trim. */
  options?: RenderOptions;
}

export type RenderResult =
  | {
      ok: true;
      output: string;
      frames: number;
      warnings: string[];
      /** How frames reached ffmpeg, for example "raw (bgra, premultiplied alpha)" or "png". */
      transport: string;
    }
  | { ok: false; cancelled?: boolean; message: string };

/**
 * What came of asking for a hover-scrub strip. `url` null with no reason means
 * the item simply has nothing to scrub (a still, an unprobed clip); a reason
 * says what went wrong, and `transient` marks the kind worth asking about
 * again — a busy machine rather than an item that cannot produce one.
 */
export interface HoverStripResult {
  url: string | null;
  reason?: string;
  transient?: boolean;
}

/** An audio file's waveform peaks, base64 (src/core/waveform.ts), or why there are none. */
export interface WaveformResult {
  peaks: string | null;
  reason?: string;
  transient?: boolean;
}

/** Saving or opening a collection file. */
export type CollectionFileResult =
  | { ok: true; path: string; name: string; collection?: Collection }
  | { ok: false; cancelled?: boolean; message: string };

/** Render all: the jobs queued, and anything that could not be. */
export type RenderCollectionResult =
  | { ok: true; jobIds: number[]; folder: string; skipped: string[] }
  | { ok: false; cancelled?: boolean; message: string };

export interface RenderProgress {
  frame: number;
  totalFrames: number;
}

/** One render of a batch: the row's parameters, and its name for the queue and the output file. */
export interface BatchRequestRow {
  label: string;
  /** File name without extension; the preset's extension is added. */
  fileName: string;
  params: Record<string, unknown>;
}

export interface BatchRequest {
  templateId: string;
  presetId: PresetId;
  options?: RenderOptions;
  rows: BatchRequestRow[];
}

export type EnqueueBatchResult = { ok: true; jobIds: number[]; folder: string } | { ok: false; cancelled?: boolean; message: string };

export interface PackInstallResult {
  installed: string[];
  replaced: string[];
  skipped: { folder: string; reason: string }[];
  packDir: string;
}

/** Preparing a render for drag: an existing cached file, or a queued job to wait for. */
export type PrepareDragResult =
  | { ok: true; cached: true; file: string; jobId: number }
  | { ok: true; cached: false; jobId: number }
  | { ok: false; message: string };

export interface RenderCacheStats {
  dir: string;
  files: number;
  bytes: number;
  maxMB: number;
  summary: string;
}

/** Outcome of adding a render to the queue; the render itself reports through the queue snapshot. */
export type EnqueueResult = { ok: true; jobId: number } | { ok: false; cancelled?: boolean; message: string };

export interface PulpApi {
  /** The stored index at once; a fresh scan follows through onLibraryChanged. */
  getLibrary(): Promise<LibraryIndex>;
  rescanLibrary(): Promise<LibraryIndex>;
  /** Called with the whole index after every scan: on demand, on folder changes, on focus, when a root returns. */
  onLibraryChanged(listener: (index: LibraryIndex) => void): () => void;
  /** Replace an item's user tags. Resolves to the updated index. */
  setItemTags(id: string, tags: string[]): Promise<LibraryIndex>;
  setItemFavorite(id: string, favorite: boolean): Promise<LibraryIndex>;
  /** Replace an item's user themes (built-in ids or custom words, normalized like tags). */
  setItemThemes(id: string, themes: string[]): Promise<LibraryIndex>;
  /**
   * The hover-scrub strip of an item, made on first ask and cached. Either the
   * URL to load it from, or why there is none.
   */
  hoverStrip(id: string): Promise<HoverStripResult>;
  /** An audio file's waveform peaks, computed on first ask and cached. */
  waveform(id: string): Promise<WaveformResult>;
  /** Record that an item was selected or rendered now. */
  markItemUsed(id: string): Promise<void>;
  /** Opens a folder picker; resolves to the updated index, or null if cancelled. */
  addLibraryFolder(): Promise<LibraryIndex | null>;
  ffmpegStatus(): Promise<FfmpegInfo>;
  /** Opens a save dialog, then adds the render to the queue. Jobs run one after another. */
  render(request: RenderRequest): Promise<EnqueueResult>;
  /** Opens a folder picker, then queues one render per row. */
  renderBatch(request: BatchRequest): Promise<EnqueueBatchResult>;
  /** Render into the cache for dragging, or find the same render already cached. */
  prepareDrag(request: RenderRequest): Promise<PrepareDragResult>;
  /** Start a native drag of a rendered file (cache file or finished job output). False if refused. */
  startDrag(path: string, templateId?: string): Promise<boolean>;
  /** The file a finished job's output would be dragged as (a sequence drags its first frame). */
  renderCacheStats(): Promise<RenderCacheStats>;
  clearRenderCache(): Promise<RenderCacheStats>;
  /** Folder picker for the cache; null when cancelled. */
  chooseRenderCacheDir(): Promise<RenderCacheStats | null>;
  setRenderCacheLimit(maxMB: number): Promise<RenderCacheStats>;
  /** Cancel a queued or running job. */
  cancelRender(jobId: number): Promise<void>;
  /** Saved parameter presets of a template: name to the values that differ from the defaults. */
  listPresets(templateId: string): Promise<Record<string, Record<string, unknown>>>;
  savePreset(templateId: string, name: string, values: Record<string, unknown>): Promise<Record<string, Record<string, unknown>>>;
  deletePreset(templateId: string, name: string): Promise<Record<string, Record<string, unknown>>>;
  /** Remove done, failed and cancelled jobs from the queue. */
  clearFinishedRenders(): Promise<void>;
  /** Save dialog, then write the collection to a file. */
  saveCollection(collection: Collection, suggestedName: string): Promise<CollectionFileResult>;
  /** Open dialog, then read a collection back. */
  openCollection(): Promise<CollectionFileResult>;
  /** Ask for one folder, then queue a render for every item. */
  renderCollection(items: CollectionItem[], name: string): Promise<RenderCollectionResult>;
  /** Take one finished card off the tray. */
  removeRender(id: number): Promise<void>;
  /** Show a rendered file in the file manager. False when the path is not one this app made. */
  revealFile(path: string): Promise<boolean>;
  /** Put a rendered file's path on the clipboard, under the same rule. */
  copyFilePath(path: string): Promise<boolean>;
  /** What this machine is, so the Reveal action can use the file manager's own name. */
  platform: string;
  getRenderQueue(): Promise<RenderQueueSnapshot>;
  /** The last committed searches, most recent first. */
  getRecentSearches(): Promise<string[]>;
  /** Record a committed search; resolves to the updated list. */
  addRecentSearch(query: string): Promise<string[]>;
  /** Shell pane sizes and collapsed state, from settings.json. */
  getLayout(): Promise<LayoutState>;
  /** Persist the shell layout; sanitized and written through the settings queue. */
  saveLayout(layout: LayoutState): Promise<void>;
  /** Whether the "your editor links to this file" notice has already been shown. */
  getDragNoticeSeen(): Promise<boolean>;
  setDragNoticeSeen(): Promise<void>;
  /** Stage player preferences: loop, background, safe areas, volume. */
  getPlayer(): Promise<PlayerState>;
  savePlayer(player: PlayerState): Promise<void>;
  /** Grid or list per kind and the thumbnail size, from settings.json. */
  getResultsView(): Promise<ResultsViewState>;
  saveResultsView(view: ResultsViewState): Promise<void>;
  /** Recently used parameter colors, shared across templates, most recent first. */
  getRecentColors(): Promise<string[]>;
  /** Record a color as recently used; resolves to the updated list. */
  addRecentColor(hex: string): Promise<string[]>;
  /** Called with the whole queue whenever a job is added, progresses, finishes or is removed. */
  onRenderQueue(listener: (snapshot: RenderQueueSnapshot) => void): () => void;
  /** Open dialog for a .zip pack; null when cancelled. */
  choosePackFile(): Promise<string | null>;
  /** What a pack (zip or folder) contains and what installing it would do. */
  previewPack(path: string): Promise<{ path: string; preview: PackPreview } | { error: string }>;
  /** Install into the packs folder of user data, then rescan. */
  installPack(path: string, choices: Record<string, CollisionChoice>): Promise<PackInstallResult | { error: string }>;
  listInstalledPacks(): Promise<{ dir: string; manifest: PackManifest }[]>;
  /** Save dialog, then zip the given templates with a pack.json. */
  exportPack(templateIds: string[], meta: { name: string; author?: string; license: string; description?: string }): Promise<{ ok: true; path: string; bytes: number } | { ok: false; cancelled?: boolean; message: string }>;
}

export const TEMPLATE_SCHEME = 'pulp-template';
export { MEDIA_SCHEME, mediaUrlFor } from '../core/media-url';

/** Template ids are lowercase and dot/dash separated, so they are valid URL hosts as-is. */
export function templateUrlFor(templateId: string, entry = 'index.html'): string {
  return `${TEMPLATE_SCHEME}://${templateId}/${entry.split('/').map(encodeURIComponent).join('/')}`;
}
