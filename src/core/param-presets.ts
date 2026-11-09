/**
 * Saved parameter presets ("Show A", "Show B") per template. Pure. A preset
 * stores only the values that differ from the template's defaults, so a
 * template whose defaults change later flows through untouched fields;
 * applying one quietly drops parameters the template no longer has.
 */

import type { TemplateManifest } from './manifest';
import { withLegacyHold, type HoldManifest } from './legacy-hold';
import { CAPTIONS_KEY, TRACKS_KEY, EXPOSE_KEY, LAYERS_KEY, LENGTH_KEY, resolveParams, SOUND_KEY, TRACK_KEY } from './params';

export type PresetValues = Record<string, unknown>;

export interface PresetFile {
  templateId: string;
  /** Preset name to its stored values. */
  presets: Record<string, PresetValues>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The parameters whose resolved value differs from the default, as raw values to store. */
export function diffFromDefaults(manifest: Pick<TemplateManifest, 'parameters'>, raw: PresetValues): PresetValues {
  const resolved = resolveParams(manifest, raw).values;
  // Defaults are coerced the same way as input (e.g. colors lowercased), so equal values compare equal.
  const defaults = resolveParams(manifest, Object.fromEntries(manifest.parameters.map((p) => [p.id, p.default]))).values;
  const out: PresetValues = {};
  for (const param of manifest.parameters) {
    if (param.id in raw && !same(resolved[param.id], defaults[param.id])) out[param.id] = raw[param.id];
  }
  // The layer stacks ride with the parameters, so a preset keeps the layers the person built.
  if (raw[LAYERS_KEY] !== undefined) out[LAYERS_KEY] = raw[LAYERS_KEY];
  if (raw[TRACK_KEY] !== undefined) out[TRACK_KEY] = raw[TRACK_KEY];
  // And the captions, which are the project's words rather than the template's (milestone 50).
  if (raw[CAPTIONS_KEY] !== undefined) out[CAPTIONS_KEY] = raw[CAPTIONS_KEY];
  // And the motion tracks (milestone 76), which the layers' pins were baked from.
  if (raw[TRACKS_KEY] !== undefined) out[TRACKS_KEY] = raw[TRACKS_KEY];
  // And so does the length, when one was chosen (milestone 30).
  if (raw[LENGTH_KEY] !== undefined) out[LENGTH_KEY] = raw[LENGTH_KEY];
  // And the template's own sound, when a variant was chosen (milestone 16).
  if (raw[SOUND_KEY] !== undefined) out[SOUND_KEY] = raw[SOUND_KEY];
  // And the picked parameters (milestone 55), which name the layers the preset itself carries.
  if (raw[EXPOSE_KEY] !== undefined) out[EXPOSE_KEY] = raw[EXPOSE_KEY];
  return out;
}

/**
 * Stored values for a template as it is now: parameters it no longer declares
 * are dropped without comment — except a "Hold, seconds" saved for one of the
 * eleven templates that lost it, which becomes the length that matches it
 * (src/core/legacy-hold.ts) rather than being thrown away.
 */
export function applyPreset(manifest: HoldManifest & Pick<TemplateManifest, 'parameters'>, values: PresetValues): PresetValues {
  const translated = withLegacyHold(manifest, values);
  const known = new Set(manifest.parameters.map((p) => p.id));
  const out: PresetValues = {};
  for (const [id, value] of Object.entries(translated.params)) if (known.has(id) || id === LAYERS_KEY || id === LENGTH_KEY || id === TRACK_KEY || id === CAPTIONS_KEY || id === TRACKS_KEY || id === SOUND_KEY || id === EXPOSE_KEY) out[id] = value;
  return out;
}

/** A preset file read from disk, cleaned: only object presets with string names under the given template id. */
export function sanitizePresetFile(value: unknown, templateId: string): PresetFile {
  const out: PresetFile = { templateId, presets: {} };
  if (!value || typeof value !== 'object') return out;
  const presets = (value as { presets?: unknown }).presets;
  if (!presets || typeof presets !== 'object' || Array.isArray(presets)) return out;
  for (const [name, values] of Object.entries(presets as Record<string, unknown>)) {
    const trimmed = name.trim();
    if (trimmed && values && typeof values === 'object' && !Array.isArray(values)) out.presets[trimmed] = values as PresetValues;
  }
  return out;
}

/** File name for a template's presets inside the presets folder; ids are lowercase dot/dash, so they are safe as-is. */
export function presetFileName(templateId: string): string {
  return `${templateId.replace(/[^a-z0-9._-]/gi, '_')}.json`;
}
