/**
 * Contract between the preload script (window.pulp) and the renderer.
 * Types only; both sides import it.
 */

import type { LibraryIndex } from '../core/library-types';
import type { PresetId } from '../core/render-plan';

export interface FfmpegInfo {
  ok: boolean;
  /** Path and version when found; a human-readable error when not. */
  path?: string;
  version?: string;
  message?: string;
}

export interface RenderRequest {
  /** Manifest id of the template to render. */
  templateId: string;
  params: Record<string, unknown>;
  presetId: PresetId;
  /** Background for flattening alpha templates into non-alpha presets. */
  background?: string;
}

export type RenderResult =
  | { ok: true; output: string; frames: number; warnings: string[] }
  | { ok: false; cancelled?: boolean; message: string };

export interface RenderProgress {
  frame: number;
  totalFrames: number;
}

export interface PulpApi {
  getLibrary(): Promise<LibraryIndex>;
  rescanLibrary(): Promise<LibraryIndex>;
  /** Opens a folder picker; resolves to the updated index, or null if cancelled. */
  addLibraryFolder(): Promise<LibraryIndex | null>;
  ffmpegStatus(): Promise<FfmpegInfo>;
  /** Opens a save dialog, then renders. */
  render(request: RenderRequest): Promise<RenderResult>;
  cancelRender(): Promise<void>;
  onRenderProgress(listener: (progress: RenderProgress) => void): () => void;
}

export const TEMPLATE_SCHEME = 'pulp-template';

/** Template ids are lowercase and dot/dash separated, so they are valid URL hosts as-is. */
export function templateUrlFor(templateId: string, entry = 'index.html'): string {
  return `${TEMPLATE_SCHEME}://${templateId}/${entry.split('/').map(encodeURIComponent).join('/')}`;
}
