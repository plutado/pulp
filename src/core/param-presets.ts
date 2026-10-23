/**
 * Saved parameter presets ("Show A", "Show B") per template. Pure. A preset
 * stores only the values that differ from the template's defaults, so a
 * template whose defaults change later flows through untouched fields;
 * applying one quietly drops parameters the template no longer has.
 */

import type { TemplateManifest } from './manifest';
import { resolveParams } from './params';

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
  return out;
}

/** Stored values for a template as it is now: parameters it no longer declares are dropped without comment. */
export function applyPreset(manifest: Pick<TemplateManifest, 'parameters'>, values: PresetValues): PresetValues {
  const known = new Set(manifest.parameters.map((p) => p.id));
  const out: PresetValues = {};
  for (const [id, value] of Object.entries(values)) if (known.has(id)) out[id] = value;
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
