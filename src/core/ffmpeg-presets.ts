/**
 * Preset availability against an encoder list. Pure and free of Node APIs so
 * the UI can import it (ffmpeg.ts itself spawns processes).
 */

import type { OutputPreset } from './render-plan';

/** Short reason a preset is unavailable with this ffmpeg (for the preset list), or null if it is usable. */
export function presetUnavailableReason(encoders: readonly string[], preset: OutputPreset): string | null {
  if (encoders.length === 0 || encoders.includes(preset.encoder)) return null;
  return `no "${preset.encoder}" encoder in this ffmpeg${preset.platformNote ? ` (${preset.platformNote})` : ''}`;
}
