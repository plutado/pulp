/**
 * Preset availability against an encoder list. Pure and free of Node APIs so
 * the UI can import it (ffmpeg.ts itself spawns processes).
 *
 * What a preset's encoder needs is the feature table's (milestone 88,
 * src/core/ffmpeg-needs.ts): an encoder that comes from a library says which
 * library a build has to be configured with, and where the fix is, so the
 * preset list, the render's refusal and Settings say one thing.
 */

import type { OutputPreset } from './render-plan';
import { tr } from './i18n';
import { featureForEncoder, needFor } from './ffmpeg-needs';

/** Short reason a preset is unavailable with this ffmpeg (for the preset list), or null if it is usable. */
export function presetUnavailableReason(encoders: readonly string[], preset: OutputPreset): string | null {
  if (encoders.length === 0 || encoders.includes(preset.encoder)) return null;
  if (preset.platformNote) return tr('preset.unavailable.no-encoder.note', { encoder: preset.encoder, note: preset.platformNote });
  const feature = featureForEncoder(preset.encoder);
  const library = feature ? needFor(feature).library : undefined;
  return library
    ? tr('preset.unavailable.no-library', { encoder: preset.encoder, library })
    : tr('preset.unavailable.no-encoder', { encoder: preset.encoder });
}
