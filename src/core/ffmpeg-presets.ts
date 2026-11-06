/**
 * Preset availability against an encoder list. Pure and free of Node APIs so
 * the UI can import it (ffmpeg.ts itself spawns processes).
 */

import type { OutputPreset } from './render-plan';
import { tr } from './i18n';

/** Short reason a preset is unavailable with this ffmpeg (for the preset list), or null if it is usable. */
export function presetUnavailableReason(encoders: readonly string[], preset: OutputPreset): string | null {
  if (encoders.length === 0 || encoders.includes(preset.encoder)) return null;
  return preset.platformNote
    ? tr('preset.unavailable.no-encoder.note', { encoder: preset.encoder, note: preset.platformNote })
    : tr('preset.unavailable.no-encoder', { encoder: preset.encoder });
}
