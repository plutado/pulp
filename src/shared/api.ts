/**
 * Contract between the preload script (window.pulp) and the renderer.
 * Types only; both sides import it.
 */

import type { LibraryIndex } from '../core/library-types';
import type { PresetId, RenderOptions } from '../core/render-plan';
import type { RenderQueueSnapshot } from '../core/render-queue';

export type { RenderJobStatus, RenderQueueJob, RenderQueueSnapshot } from '../core/render-queue';
export type { LibraryIndex } from '../core/library-types';
export type { RenderOptions } from '../core/render-plan';

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

export interface RenderProgress {
  frame: number;
  totalFrames: number;
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
  /** Record that an item was selected or rendered now. */
  markItemUsed(id: string): Promise<void>;
  /** Opens a folder picker; resolves to the updated index, or null if cancelled. */
  addLibraryFolder(): Promise<LibraryIndex | null>;
  ffmpegStatus(): Promise<FfmpegInfo>;
  /** Opens a save dialog, then adds the render to the queue. Jobs run one after another. */
  render(request: RenderRequest): Promise<EnqueueResult>;
  /** Cancel a queued or running job. */
  cancelRender(jobId: number): Promise<void>;
  /** Remove done, failed and cancelled jobs from the queue. */
  clearFinishedRenders(): Promise<void>;
  getRenderQueue(): Promise<RenderQueueSnapshot>;
  /** Recently used parameter colors, shared across templates, most recent first. */
  getRecentColors(): Promise<string[]>;
  /** Record a color as recently used; resolves to the updated list. */
  addRecentColor(hex: string): Promise<string[]>;
  /** Called with the whole queue whenever a job is added, progresses, finishes or is removed. */
  onRenderQueue(listener: (snapshot: RenderQueueSnapshot) => void): () => void;
}

export const TEMPLATE_SCHEME = 'pulp-template';
export { MEDIA_SCHEME, mediaUrlFor } from '../core/media-url';

/** Template ids are lowercase and dot/dash separated, so they are valid URL hosts as-is. */
export function templateUrlFor(templateId: string, entry = 'index.html'): string {
  return `${TEMPLATE_SCHEME}://${templateId}/${entry.split('/').map(encodeURIComponent).join('/')}`;
}
