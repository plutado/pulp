/**
 * Contract between the preload script (window.pulp) and the renderer.
 * Types only; both sides import it.
 */

import type { LayoutState } from '../core/layout';
import type { MainPerformance } from '../core/perf';
import type { LibraryIndex } from '../core/library-types';
import type { PresetId, RenderOptions } from '../core/render-plan';
import type { TypeOutputDefault } from '../core/output-defaults';
import type { SemanticStatus } from '../main/semantic-service';
import type { PanelStatus } from '../main/panel-service';
import type { RenderQueueSnapshot } from '../core/render-queue';
import type { PlayerState } from '../core/player';
import type { Appearance, Palette } from '../core/appearance';
import type { ResultsViewState } from '../core/results-view';
import type { Collection, CollectionItem } from '../core/collection';
import type { ExposedParam } from '../core/expose';
import type { LayerValues } from '../core/layers';
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
export type { PanelStatus } from '../main/panel-service';

/** Saving the canvas as a template folder: where it went and what it is called in the library. */
export type SaveCanvasResult =
  | { ok: true; path: string; templateId: string; notes: string[] }
  | { ok: false; cancelled?: boolean; message: string };
import type { ImageGrantRequest } from '../core/image-slot';
import type { PsdOutline } from '../core/psd';
export type { PsdOutline } from '../core/psd';
export type PsdOutlineResult = { ok: true; outline: PsdOutline } | { ok: false; message: string };
import type { RecentProjectRow } from '../core/start-screen';

/** The two devices Pulp records from: the microphone (milestone 63) and the camera (milestone 64). */
export type MediaDevice = 'microphone' | 'camera';

/** Whether a device may be used: yes, or which one was refused, why, and whether its settings can open. */
export type DeviceAccess = { ok: true } | { ok: false; device: MediaDevice; message: string; canOpenSettings: boolean };

/** A saved take: where it landed, and the library's id for it once the rescan found it. */
export interface SavedRecording {
  path: string;
  id: string | null;
}

/** The microphone chosen for recording; null follows the system's default. */
export type RecordingInput = { id: string; label: string } | null;

/** What the camera's preview remembers (milestone 64); src/core/video-take.ts. */
export type { VideoInputs } from '../core/video-take';
import type { VideoInputs } from '../core/video-take';

/** What the window knows of a take that the file alone does not say: the camera's size and rate, and whether sound was on. */
export interface VideoTakeFacts {
  width: number;
  height: number;
  /** The rate the camera reports it was opened at; the file is written at the steady rate nearest it. */
  frameRate: number | undefined;
  sound: boolean;
}

/** A camera's take in the library: an MP4 when it could be converted, the recorder's WebM — and why — when not. */
export interface SavedVideoTake extends SavedRecording {
  converted: boolean;
  note: string | null;
}

/** The appearance chosen in Settings or the View menu, and the palette it comes to (milestone 62). */
export interface AppearanceState {
  choice: Appearance;
  palette: Palette;
}

/**
 * The interface's language (milestone 59): what Settings → Language holds, the locale it comes to,
 * and the system's own preferred languages, which "Same as the system" follows.
 */
export interface LanguageState {
  choice: LanguageChoice;
  locale: LocaleId;
  system: string[];
}
import type { LanguageChoice, LocaleId } from '../core/i18n';

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

/**
 * What the download helper would fetch for this machine (milestone 17, ADR
 * 0022): said in full before anything is fetched, since what arrives is GPL
 * software from someone else's server.
 */
export interface FfmpegDownloadInfo {
  /** None where Pulp has no build pinned for this platform and architecture. */
  build: {
    id: string;
    label: string;
    version: string;
    publisher: string;
    publisherUrl: string;
    license: string;
    bytes: number;
    /** The sentence Settings shows beside the button. */
    note: string;
  } | null;
  /** True when a build Pulp fetched is on this machine; an ffmpeg of your own is `ffmpegStatus`. */
  installed: boolean;
  path?: string;
}

export interface RenderRequest {
  /** Manifest id of the template to render; or none, with `mediaId`, for a library item rendered itself (milestone 15). */
  templateId?: string;
  /** Library id of the clip, still, layered file or sound to render. */
  mediaId?: string;
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
      /** The cover image written beside the render, when one was asked for (milestone 20). */
      cover?: string;
      /** The project's captions as SRT and WebVTT beside the render (milestone 50), when it has any. */
      subtitles?: { srt: string; vtt: string };
      /** The captions rendered on their own as an alpha track beside the render, when asked for (milestone 50). */
      captionTrack?: string;
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

/**
 * What transcription needs and what is already here (milestone 50): the
 * program that runs the model, the model with its size and license so the
 * dialog can say what it would fetch, and whether ffmpeg is there to read the
 * sound.
 */
export interface SpeechStatus {
  runner: { ok: boolean; path?: string; message?: string };
  model: { id: string; label: string; bytes: number; license: string; note: string; installed: boolean };
  ffmpeg: boolean;
}

/** What View → Stage on Display did (milestone 43). */
export interface StageOnDisplayResult {
  moved: boolean;
  fullScreen: boolean;
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
  /** One frame of a clip, plain and keyed with the settings as they stand (milestone 52): the key dialog's before and after. */
  chromaKeyPreview(id: string, settings: unknown, atSeconds: number): Promise<{ ok: true; plain: string; keyed: string } | { ok: false; message: string }>;
  /** Key the whole clip to an alpha clip beside the original, and rescan so it joins the library. */
  chromaKeyClip(id: string, settings: unknown): Promise<{ ok: true; path: string } | { ok: false; message: string }>;
  /** Split footage at its cuts into clips in a folder beside it, by stream copy, and rescan. */
  splitScenes(id: string): Promise<{ ok: true; clips: number; folder: string } | { ok: false; message: string }>;
  /** Ask for a `.cube` file; null when the dialog is closed without one. */
  chooseLutFile(): Promise<string | null>;
  /**
   * What the project's mix measures (milestone 52): integrated loudness and
   * true peak by EBU R128, for the transport row's meter — the same
   * measurement a leveled render's first pass runs. Layers travel as ids and
   * settings; the main process resolves the files (ADR 0013). Null when there
   * is nothing to measure.
   */
  mixLoudness(request: { layers: { kind: 'clip' | 'sound' | 'template'; value: unknown; span?: { start: number; end: number | null }; speed?: number; templateId?: string }[]; fps: number; length: number }): Promise<{ lufs: number | null; truePeakDb: number | null }>;
  /**
   * A treated voice preview (milestone 53): the layer's sound rendered once
   * through its treatment's own recipe, answered as a pulp-media URL for the
   * preview's element — or null when there is nothing to treat or no ffmpeg.
   * The item travels as an id; the main process resolves the file (ADR 0013).
   */
  voicePreview(request: { kind: 'clip' | 'sound'; id: string; voice: unknown }): Promise<{ url: string | null }>;
  /**
   * The cut track's frames for the preview (milestone 49): each cut's window
   * decoded at a proxy height, as PNG data URLs with what maps a moment to a
   * frame. A cut that cannot be read is null; ids only, never paths (ADR 0013).
   */
  trackFrames(request: { cuts: { id: string; from: number; to: number }[]; height: number }): Promise<{ cuts: ({ srcs: string[]; fps: number; first: number } | null)[] }>;
  /**
   * The cut track's quiet stretches (milestone 49): ffmpeg's silence detection
   * over each cut's sound at a threshold and a minimum length, mapped onto
   * the timeline — shown on the lane before anything is cut.
   */
  trackSilences(request: { cuts: { id: string; from: number; to: number }[]; thresholdDb: number; minSeconds: number }): Promise<{ ranges: { start: number; end: number }[] }>;
  /**
   * Export the edit for an editing app (milestone 49): the cut track written
   * as FCPXML and an EDL, with the clips referenced in place and the graphics
   * above them rendered with alpha beside the files. The save dialog asks
   * where; the result names what was written.
   */
  exportEdit(request: { templateId: string; name: string; params: Record<string, unknown> }): Promise<{ ok: true; fcpxml: string; edl: string; graphics: string } | { ok: false; cancelled?: boolean; message: string }>;
  /**
   * Transcription on this machine (milestone 50). `speechStatus` says what is
   * there — the program that runs the model, the model itself with its size
   * and license, and ffmpeg — so the dialog can **ask before anything is
   * fetched**; `fetchSpeechModel` is the yes, and the only request Pulp
   * makes. `transcribe` listens to the stretches of project sound named by
   * library id (ADR 0013) and answers with the words and their timings, on
   * the project's own clock. Nothing of the project leaves the machine.
   */
  /**
   * Semantic search on this machine (milestone 9, ADR 0024). Off by default.
   * `semanticStatus` says what is there and what Pulp would fetch — which
   * model, how big, under what license — so Settings can **ask before anything
   * is fetched**; `fetchSemanticModel` is the yes, and the only request Pulp
   * makes. `semanticSearch` embeds the free text locally and answers library
   * ids with how close each item's meaning came; nothing else ever leaves the
   * machine.
   */
  semanticStatus(): Promise<SemanticStatus>;
  setSemanticSearch(enabled: boolean): Promise<SemanticStatus>;
  fetchSemanticModel(): Promise<{ ok: true; path: string } | { ok: false; message: string }>;
  semanticSearch(text: string): Promise<{ hits: { id: string; score: number }[] }>;
  onSemanticProgress(listener: (progress: { note: string; fraction: number | null }) => void): () => void;
  /**
   * The editor panel's bridge (milestone 54, ADR 0025). Off by default.
   * `panelStatus` says whether it is on and where it listens; `setEditorPanel`
   * is the toggle, starting or stopping the listener there and then. The
   * bridge binds to 127.0.0.1 only and asks a token of every request, so
   * nothing leaves the machine and nothing on it answers without the word.
   * `panelCollectionChanged` is the window reporting its collection whenever
   * it changes, so the panel inside the editing app can list it.
   */
  panelStatus(): Promise<PanelStatus>;
  setEditorPanel(enabled: boolean): Promise<PanelStatus>;
  /**
   * Light and dark appearance (milestone 62): the saved choice and the palette it comes to on this
   * system now. Setting it redraws every window at once; the pages read it as `prefers-color-scheme`.
   */
  getAppearance(): Promise<AppearanceState>;
  /** The interface's language (milestone 59): read it, choose it, and hear when it changes in any window. */
  getLanguage(): Promise<LanguageState>;
  setLanguage(choice: LanguageChoice): Promise<LanguageState>;
  onLanguageChanged(listener: (state: LanguageState) => void): () => void;
  setAppearance(choice: Appearance): Promise<AppearanceState>;
  /**
   * Recording a voice (milestone 63): may the microphone be used, save a finished take's WAV bytes
   * into the managed Recordings folder, open the system's microphone page after a refusal, and the
   * remembered input.
   */
  microphoneAccess(): Promise<DeviceAccess>;
  saveRecording(wav: ArrayBuffer): Promise<SavedRecording>;
  openPrivacySettings(device: MediaDevice): Promise<void>;
  getRecordingInput(): Promise<RecordingInput>;
  setRecordingInput(input: RecordingInput): Promise<void>;
  /**
   * Recording from a camera (milestone 64): may the camera — and, with sound, the microphone — be
   * used; a take begun, sent a piece at a time, then finished (converted and into the library) or
   * abandoned; and the preview's remembered camera, microphone and sound.
   */
  cameraAccess(sound: boolean): Promise<DeviceAccess>;
  beginVideoTake(): Promise<string>;
  appendVideoTake(id: string, piece: ArrayBuffer): Promise<void>;
  finishVideoTake(id: string, facts: VideoTakeFacts): Promise<SavedVideoTake>;
  abandonVideoTake(id: string): Promise<void>;
  getVideoInputs(): Promise<VideoInputs>;
  setVideoInputs(inputs: VideoInputs): Promise<void>;
  panelCollectionChanged(collection: Collection, name: string): Promise<void>;
  /**
   * Save the canvas as a template folder (milestone 55): the window sends what
   * was composed, the main process asks where (tests name `dir` outright),
   * writes template.json and index.html, and adds the folder to the library.
   * The notes say what could not travel: a template never ships a library id.
   */
  saveCanvasTemplate(request: { layers: LayerValues; expose: ExposedParam[]; length: number; dir?: string }): Promise<SaveCanvasResult>;
  /** The panel asked for an item to be shown, or a collection card opened for editing (milestone 54's third item). */
  onPanelOpen(listener: (target: { kind: 'item'; id: string } | { kind: 'collection'; uid: string }) => void): () => void;
  speechStatus(request?: { model?: string }): Promise<SpeechStatus>;
  fetchSpeechModel(request: { model: string }): Promise<{ ok: true; path: string } | { ok: false; message: string }>;
  transcribe(request: { segments: { kind: 'clip' | 'sound'; id: string; from: number; to: number; at: number; speed?: number }[]; model?: string; language?: string }):
    Promise<{ ok: true; words: { text: string; start: number; end: number }[]; language: string } | { ok: false; message: string }>;
  /** How a fetch or a transcription is going, for the dialog's line of status. */
  onSpeechProgress(listener: (progress: { note: string; fraction: number | null }) => void): () => void;
  /** Record that an item was selected or rendered now. */
  markItemUsed(id: string): Promise<void>;
  /** Opens a folder picker; resolves to the updated index, or null if canceled. */
  addLibraryFolder(): Promise<LibraryIndex | null>;
  /**
   * Add a stock library from a folder or a drive (milestone 32), read in place and never copied.
   * Null when the picker is dismissed; a refusal says why (already added, inside one, Pulp's own).
   */
  addStockLibrary(): Promise<{ ok: true; index: LibraryIndex } | { ok: false; why: 'already' | 'inside' | 'contains' | 'own' | 'missing' } | null>;
  /** A clip set stitched to `length` seconds (its own when undefined) for the stage to play (milestone 32). */
  clipSetPreview(id: string, length?: number): Promise<{ ok: true; url: string; seconds: number } | { ok: false; message: string }>;
  /** A song's stems mixed for the stage to play (milestone 32). */
  stemsPreview(id: string): Promise<{ ok: true; url: string; seconds: number } | { ok: false; message: string }>;
  /** Forget a stock library. Its files are not touched. */
  removeStockLibrary(path: string): Promise<LibraryIndex>;
  /** Make the sample-media folder inside a chosen folder, add it to the library, and say what was written. Null when canceled. */
  addSampleMedia(): Promise<SampleMediaOutcome | null>;
  /**
   * The popped-out stage (milestone 43). The renderer moves the stage's own elements into a child
   * window it opens itself; the main process places that window, remembers where it goes, and
   * holds its close until the stage has been put back.
   */
  /** Whether the stage should start out, as it was left — unless its display has gone. */
  stageWindowState(): Promise<{ open: boolean }>;
  /** The stage is back in the main window: close its window and remember it as closed. */
  closeStageWindow(): Promise<void>;
  /** Fill the stage window's display with it, or come back from that. */
  setStageWindowFullScreen(on: boolean): Promise<void>;
  /**
   * Move the stage's window to this display and fill it (View → Stage on Display). `moved` is false
   * when there is no such display or no window; `fullScreen` says whether the platform granted it,
   * which a session with no window manager to ask does not.
   */
  stageWindowOnDisplay(id: number): Promise<StageOnDisplayResult>;
  /** The stage window is being closed by its own button: put the stage back, then closeStageWindow. */
  onStageWindowCloseRequested(listener: () => void): () => void;
  /** The stage window went full screen or came back, by any means, so the theater button can follow. */
  onStageWindowFullScreen(listener: (on: boolean) => void): () => void;
  /** How many catalog files each taxonomy type still lacks (milestone 34); a type with none left is absent. */
  sampleMediaStatus(): Promise<{ unmade: Record<string, number> }>;
  /** Make just these types' sample media, into the folder the rest is in or one chosen now. Null when canceled. */
  makeSampleMedia(types: readonly string[]): Promise<SampleMediaOutcome | null>;
  /**
   * Image slots (ADR 0013): the bytes of exactly these library stills, as data URLs for the preview
   * to hand to the template page; ids that are not online stills come back as missing.
   */
  loadSlotImages(requests: ImageGrantRequest[]): Promise<{ images: { id: string; key: string; src: string }[]; missing: string[] }>;
  /** A layered Photoshop file's structure (milestone 33): its layers without pixels, and what is not reproduced. */
  psdOutline(id: string): Promise<PsdOutlineResult>;
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
  /** A file dialog for a font; the family is read from the file so the license note can name it. Null when canceled. */
  chooseFont(): Promise<{ path: string; family: string; file: string } | { error: string } | null>;
  /** Copy a chosen font into the managed folder with the person's license note. */
  importFont(path: string, note: string): Promise<ImportedFont | { error: string }>;
  /** The imported fonts changed: the family list and the pages' faces follow. */
  onFontsChanged(listener: (fonts: ImportedFont[]) => void): () => void;
  /** What the background queue is doing: thumbnails, probes, the heavy-work chain. For diagnostics. */
  libraryDiagnostics(): Promise<LibraryDiagnostics>;
  ffmpegStatus(): Promise<FfmpegInfo>;
  /**
   * The FFmpeg download helper (milestone 17, ADR 0022), for the machine with
   * no FFmpeg on it. `ffmpegDownloadStatus` says what Pulp would fetch for
   * this machine — which build, from whom, how big and under what license —
   * so Settings can **ask before anything is fetched**; `fetchFfmpeg` is the
   * yes. What arrives is checked against a pinned checksum and kept beside
   * the settings, and an ffmpeg of your own still comes first.
   */
  ffmpegDownloadStatus(): Promise<FfmpegDownloadInfo>;
  fetchFfmpeg(): Promise<{ ok: true; path: string; version: string } | { ok: false; message: string }>;
  /** How the fetch is going, for the Settings line of status. */
  onFfmpegProgress(listener: (progress: { note: string; fraction: number | null }) => void): () => void;
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
  /** Folder picker for the cache; null when canceled. */
  chooseRenderCacheDir(): Promise<RenderCacheStats | null>;
  setRenderCacheLimit(maxMB: number): Promise<RenderCacheStats>;
  /** Cancel a queued or running job. */
  cancelRender(jobId: number): Promise<void>;
  /** Saved parameter presets of a template: name to the values that differ from the defaults. */
  listPresets(templateId: string): Promise<Record<string, Record<string, unknown>>>;
  savePreset(templateId: string, name: string, values: Record<string, unknown>): Promise<Record<string, Record<string, unknown>>>;
  deletePreset(templateId: string, name: string): Promise<Record<string, Record<string, unknown>>>;
  /** Remove done, failed and canceled jobs from the queue. */
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
  /**
   * A project file the system handed over (milestone 17) — double-clicked, dropped on the Dock
   * icon, or given on the command line. `takePendingOpen` is asked once the window can open
   * one, and answers with the file the app was started with, if any; after that `onOpenFile`
   * hears each new one as it arrives, from the running app's second copy or the Dock.
   */
  takePendingOpen(): Promise<string | null>;
  onOpenFile(listener: (path: string) => void): () => void;
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
  /**
   * Renders the last session was in the middle of when it ended without finishing (milestone 58):
   * their partial files are already gone, and `renderAgain` queues them to the same outputs.
   */
  interruptedRenders(): Promise<{ label: string; outputPath: string }[]>;
  renderAgain(): Promise<number>;
  /** Ask where a missing item is now, bring its folder in, and rebind it and everything that moved with it. */
  relinkItem(target: { uid: string; path: string; kind: 'template' | 'media'; name: string }, others: { uid: string; path: string }[], answer?: string): Promise<RelinkResult>;
  /** Which of a project's library folders this computer does not have. */
  missingLibraryFolders(folders: string[]): Promise<string[]>;
  /** The window is closing and there are unsaved changes: the renderer asks, then allows or does not. */
  onCloseRequested(listener: () => void): () => void;
  /** Let the close that was held go ahead; the recovery copy is cleared with it. */
  allowClose(): Promise<void>;
  /** The close was canceled: the next one asks again. */
  cancelClose(): Promise<void>;
  /** The project's name and whether it has unsaved changes, for the window title. */
  setProjectTitle(name: string, dirty: boolean): Promise<void>;
  /** What the window can do now, so the application menu offers only what can act (milestone 27). */
  setMenuState(state: MenuState): Promise<void>;
  /** The menu as it stands, for the keyboard-shortcut list. */
  menuSections(): Promise<MenuSection[]>;
  /** A menu item was chosen: the id, and what it is about (a recent project's path). */
  onMenuCommand(listener: (command: MenuCommand, arg: string | null) => void): () => void;
  /** Record what the window caught in the local log (milestone 8); nothing leaves the machine. */
  recordLog(level: 'crash' | 'error' | 'warn' | 'info', source: string, message: string, detail?: string): Promise<void>;
  /** The log file's place and its last lines, for the diagnostics text. */
  logTail(lines?: number): Promise<{ path: string; lines: string[] }>;
  /** Show the log file in the file manager. */
  revealLog(): Promise<boolean>;
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
  /** Open the system share sheet on a finished render (milestone 20). macOS only; false elsewhere, and under the same path rule. */
  shareFile(path: string): Promise<boolean>;
  /**
   * Hand a finished render to its platform (milestone 20): the platform's own
   * upload page in the browser and the file shown in the file manager, ready
   * to drop. The platform is a preset id; the main process holds the only list
   * of pages it will open, so no URL ever travels over this call.
   */
  openUploadPage(path: string, platform: string): Promise<boolean>;
  /** Show a library item in the file manager. The main process looks its path up from the id. */
  revealItem(id: string): Promise<boolean>;
  /** Put a library item's path on the clipboard, looked up the same way. */
  copyItemPath(id: string): Promise<boolean>;
  /** What this machine is, so the Reveal action can use the file manager's own name. */
  platform: string;
  /** Pulp's version, which only the main process can answer for. */
  appVersion(): Promise<string>;
  /** What the main process knows about speed and weight (milestone 58), for the diagnostics' Performance section. */
  appPerformance(): Promise<MainPerformance>;
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
  /** The Output tab's remembered settings per template type (milestone 14), from settings.json. */
  getTypeOutputDefaults(): Promise<Record<string, TypeOutputDefault>>;
  /** Save one type's default (or clear it with null); answers the updated map. */
  setTypeOutputDefault(type: string, value: TypeOutputDefault | null): Promise<Record<string, TypeOutputDefault>>;
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
  /** Open dialog for a .zip pack; null when canceled. */
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
