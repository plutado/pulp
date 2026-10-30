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
import type { Project } from '../core/project';
import type { MenuCommand, MenuSection, MenuState } from '../core/menu';
import type { ImportedFont } from '../core/fonts';
import type { CollisionChoice, PackManifest, PackPreview } from '../core/pack';

export type { RenderJobStatus, RenderQueueJob, RenderQueueSnapshot } from '../core/render-queue';
export type { LibraryIndex } from '../core/library-types';
export type { CollisionChoice, PackManifest, PackPreview, PackTemplatePreview } from '../core/pack';
export type { RenderOptions } from '../core/render-plan';
export type { Collection, CollectionItem } from '../core/collection';
export type { Project } from '../core/project';
export type { MenuCommand, MenuSection, MenuState } from '../core/menu';
export type { RecentProjectRow } from '../core/start-screen';
import type { RecentProjectRow } from '../core/start-screen';

/** The start screen's remembered switches (milestone 31). */
export interface StartScreenPrefs {
  /** The screen is shown at launch; File → Home shows it either way. */
  showAtStartup: boolean;
  /** The guided tour has been taken or skipped, so it is offered only before then. */
  tourSeen: boolean;
}

/** A bundled example project: a ready-made `.pulp` that opens as a copy. */
export interface ExampleProject {
  path: string;
  name: string;
  description: string;
  /** Manifest id of its first template, whose thumbnail stands for it. */
  thumbTemplateId?: string;
}

/** Reading an example back: its contents, never a path, so it opens as a copy. */
export type ExampleReadResult = { ok: true; name: string; project: Project } | { ok: false; message: string };

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

/**
 * Saving or opening a project (milestone 27). `project` comes back from
 * opening one, as a collection's does; saving answers with where it went.
 * `fromCollection` marks a
 * `.pulpcollection` read as a project, so the window can offer to save it on
 * as one; `missing` marks a file that is not there any more, which is what a
 * recent entry deserves to be told about.
 */
export type ProjectFileResult =
  | { ok: true; path: string; name: string; recent: string[]; project?: Project; fromCollection?: true }
  | { ok: false; cancelled?: boolean; missing?: true; message: string };

/** A project left behind by a session that did not end cleanly. */
export interface ProjectRecovery {
  project: Project;
  /** The file the unsaved changes belong to, or null for a project never saved anywhere. */
  path: string | null;
  name: string;
  savedAt: string;
}

/** Relinking media that moved: the items rebound, and the library as it is now. */
export type RelinkResult =
  | { ok: true; relinked: { uid: string; id: string; path: string }[]; index: LibraryIndex }
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

export type EnqueueBatchResult = { ok: true; jobIds: number[]; folder: string; skipped?: string[] } | { ok: false; cancelled?: boolean; message: string };

/** What the background queue is doing (src/main/library-service.ts). */
export interface LibraryDiagnostics {
  thumbnailing: boolean;
  probing: boolean;
  pendingThumbnails: number;
  pendingMetadata: number;
  heavyWaiting: number;
  heavyCurrent: { label: string; forMs: number } | null;
  roots: { path: string; online: boolean }[];
}

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

/** What came of making the sample-media folder: the index with it added, and the counts. */
export interface SampleMediaOutcome {
  index: LibraryIndex | null;
  written: number;
  skipped: number;
  /** Reasons for files that could not be made; empty when all went well. */
  failed: string[];
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
  /** The rate a frame sequence is read at; `undefined` goes back to Pulp's stated default (milestone 30). */
  setItemSequenceFps(id: string, fps: number | undefined): Promise<LibraryIndex>;
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
  /** Make the sample-media folder inside a chosen folder, add it to the library, and say what was written. Null when cancelled. */
  addSampleMedia(): Promise<SampleMediaOutcome | null>;
  /**
   * Image slots (ADR 0013): the bytes of exactly these library stills, as data URLs for the preview
   * to hand to the template page; ids that are not online stills come back as missing.
   */
  loadSlotImages(ids: string[]): Promise<{ images: { id: string; src: string }[]; missing: string[] }>;
  /** The clips chosen for video layers: their frames, and what was measured about each (milestone 26). */
  loadLayerClips(requests: { id: string; value: ClipValue; drawnHeight: number }[]): Promise<{
    clips: { id: string; kind: 'clip'; srcs: string[] }[];
    sources: Record<string, ClipSource>;
    missing: string[];
  }>;
  /** Copy a file from outside the library into the managed Imported folder and index it; resolves to its library id. */
  importImage(file: File): Promise<{ id: string } | { error: string }>;
  /** The person's own fonts, as the managed folder's index records them (milestone 23). */
  listFonts(): Promise<ImportedFont[]>;
  /** A file dialog for a font; the family is read from the file so the licence note can name it. Null when cancelled. */
  chooseFont(): Promise<{ path: string; family: string; file: string } | { error: string } | null>;
  /** Copy a chosen font into the managed folder with the person's licence note. */
  importFont(path: string, note: string): Promise<ImportedFont | { error: string }>;
  /** The imported fonts changed: the family list and the pages' faces follow. */
  onFontsChanged(listener: (fonts: ImportedFont[]) => void): () => void;
  /** What the background queue is doing: thumbnails, probes, the heavy-work chain. For diagnostics. */
  libraryDiagnostics(): Promise<LibraryDiagnostics>;
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
  /**
   * Write the project (milestone 27). With a path it saves in place; without
   * one it asks, which is Save As and the first Save of a new project. A path
   * ending `.pulpcollection` writes a collection instead, for an older build.
   */
  saveProject(project: Project, path: string | null, suggestedName: string): Promise<ProjectFileResult>;
  /** Open dialog, then read a project or a collection back as a project. */
  openProject(): Promise<ProjectFileResult>;
  /** The same by path, for Open Recent and for scripting. */
  openProjectPath(path: string): Promise<ProjectFileResult>;
  /** Recently opened projects, newest first; `forgetProject` takes one off. */
  recentProjects(): Promise<string[]>;
  forgetProject(path: string): Promise<string[]>;
  /** The recent projects with pins, last-opened times and whether each file is still there (milestone 31). */
  recentProjectsDetailed(): Promise<RecentProjectRow[]>;
  /** Pin or unpin a recent project on the start screen; resolves to the pinned paths. */
  setProjectPinned(path: string, pinned: boolean): Promise<string[]>;
  /** A recent project whose file moved: ask where it is now and point the entry there. */
  relinkRecentProject(path: string, answer?: string): Promise<{ ok: boolean; path?: string }>;
  /** The bundled example projects, and one of them read back as a copy. */
  listExamples(): Promise<ExampleProject[]>;
  readExample(path: string): Promise<ExampleReadResult>;
  /** The start screen's switches: shown at startup, and whether the tour was taken. */
  getStartScreenPrefs(): Promise<StartScreenPrefs>;
  setShowStartScreen(on: boolean): Promise<void>;
  setTourSeen(): Promise<void>;
  /** Write the recovery copy while there are unsaved changes, and clear it when there are none. */
  autosaveProject(project: Project, path: string | null): Promise<void>;
  clearRecovery(): Promise<void>;
  /** A recovery copy left by a session that did not end cleanly, offered once at launch. */
  pendingRecovery(): Promise<ProjectRecovery | null>;
  /** Ask where a missing item is now, bring its folder in, and rebind it and everything that moved with it. */
  relinkItem(target: { uid: string; path: string; kind: 'template' | 'media'; name: string }, others: { uid: string; path: string }[], answer?: string): Promise<RelinkResult>;
  /** Which of a project's library folders this computer does not have. */
  missingLibraryFolders(folders: string[]): Promise<string[]>;
  /** The window is closing and there are unsaved changes: the renderer asks, then allows or does not. */
  onCloseRequested(listener: () => void): () => void;
  /** Let the close that was held go ahead; the recovery copy is cleared with it. */
  allowClose(): Promise<void>;
  /** The close was cancelled: the next one asks again. */
  cancelClose(): Promise<void>;
  /** The project's name and whether it has unsaved changes, for the window title. */
  setProjectTitle(name: string, dirty: boolean): Promise<void>;
  /** What the window can do now, so the application menu offers only what can act (milestone 27). */
  setMenuState(state: MenuState): Promise<void>;
  /** The menu as it stands, for the keyboard-shortcut list. */
  menuSections(): Promise<MenuSection[]>;
  /** A menu item was chosen: the id, and what it is about (a recent project's path). */
  onMenuCommand(listener: (command: MenuCommand, arg: string | null) => void): () => void;
  /** Put the diagnostics text on the clipboard; bounded, and only ever this text. */
  copyDiagnostics(text: string): Promise<boolean>;
  /** Ask for one folder, then queue a render for every item. */
  renderCollection(items: CollectionItem[], name: string): Promise<RenderCollectionResult>;
  /** Take one finished card off the tray. */
  removeRender(id: number): Promise<void>;
  /** Show a rendered file in the file manager. False when the path is not one this app made. */
  revealFile(path: string): Promise<boolean>;
  /** Put a rendered file's path on the clipboard, under the same rule. */
  copyFilePath(path: string): Promise<boolean>;
  /** Show a library item in the file manager. The main process looks its path up from the id. */
  revealItem(id: string): Promise<boolean>;
  /** Put a library item's path on the clipboard, looked up the same way. */
  copyItemPath(id: string): Promise<boolean>;
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
  /** Which Info tab sections are open, remembered between sessions. */
  getInfoSections(): Promise<Record<string, boolean>>;
  saveInfoSections(sections: Record<string, boolean>): Promise<void>;
  /** Stage player preferences: loop, background, safe areas, volume. */
  getPlayer(): Promise<PlayerState>;
  savePlayer(player: PlayerState): Promise<void>;
  /** Whether the browse tree keeps one section open at a time, from settings.json; on by default. */
  getBrowseAccordion(): Promise<boolean>;
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
  exportPack(templateIds: string[], meta: { name: string; author?: string; license: string; description?: string }): Promise<{ ok: true; path: string; bytes: number; warnings: string[] } | { ok: false; cancelled?: boolean; message: string }>;
}

export const TEMPLATE_SCHEME = 'pulp-template';
export { MEDIA_SCHEME, mediaFrameUrlFor, mediaUrlFor } from '../core/media-url';
export type { ClipSource, ClipValue } from '../core/video-layer';
import type { ClipSource, ClipValue } from '../core/video-layer';

/** Template ids are lowercase and dot/dash separated, so they are valid URL hosts as-is. */
export function templateUrlFor(templateId: string, entry = 'index.html'): string {
  return `${TEMPLATE_SCHEME}://${templateId}/${entry.split('/').map(encodeURIComponent).join('/')}`;
}
