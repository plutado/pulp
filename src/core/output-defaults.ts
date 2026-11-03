/**
 * Output defaults per type, and one-click output presets per kind of asset
 * (milestone 14, in part). Two sides of the same thought: the settings a lower
 * third renders with are the settings every lower third renders with, so the
 * Output tab can remember them — and for the common kinds there is a known
 * good answer that one click should set.
 *
 * A **type default** is the slice of the Output tab worth remembering for a
 * kind of thing: the output preset, the shape and size, a rate override, the
 * flatten background and the matte. Not the trim, the cover, a LUT or the
 * captions — those belong to one piece, not to a kind. Keyed by the template's
 * type (src/core/taxonomy.ts: declared, or mapped from its category), stored
 * in settings.json, applied when an item of that type is shown — under the
 * session's platform lean, which stays the stronger word where both speak.
 *
 * An **asset preset** is a named bundle of those choices for a common kind of
 * asset, offered only where it fits: a transparent overlay for anything drawn
 * on alpha, the editor-safe pair for editors that cannot read alpha, a flat
 * full-screen background. Clicking one sets the controls; it writes nothing
 * until the person renders or saves it as the type's default.
 *
 * Pure: the catalog, the sanitizing and the matching, shared by the window
 * and the settings file.
 */

import { isBuiltInAspect } from './aspect';
import { isValidColor, type TemplateCategory } from './manifest';
import { OUTPUT_PRESETS, type PresetId } from './render-plan';
import { isBuiltInType } from './taxonomy';

/** What the Output tab remembers for a type: the choices that describe a kind of output, none that describe one piece. */
export interface TypeOutputDefault {
  presetId: PresetId;
  /** The shape, when one was chosen; applied only to a template that draws it. */
  aspect?: string;
  /** An exact size, when one was chosen; both or neither. */
  width?: number;
  height?: number;
  /** A frame-rate override, when one was set; absent is the template's own rate. */
  fps?: number;
  /** The flatten background, when the preset has no alpha to keep. */
  background?: string;
  /** A matte file beside the render. */
  matte?: boolean;
}

/** Pixel bounds a remembered size is held to, the same as a manifest's. */
const SIZE = { min: 16, max: 8192 } as const;

/** One remembered default, read from anything at all; null when there is nothing usable in it. */
export function sanitizeTypeOutputDefault(raw: unknown): TypeOutputDefault | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.presetId !== 'string' || !(r.presetId in OUTPUT_PRESETS)) return null;
  const out: TypeOutputDefault = { presetId: r.presetId as PresetId };
  if (typeof r.aspect === 'string' && isBuiltInAspect(r.aspect)) out.aspect = r.aspect;
  const size = (v: unknown): number | null =>
    Number.isInteger(v) && (v as number) >= SIZE.min && (v as number) <= SIZE.max ? (v as number) : null;
  const width = size(r.width);
  const height = size(r.height);
  if (width !== null && height !== null) {
    out.width = width;
    out.height = height;
  }
  if (typeof r.fps === 'number' && Number.isFinite(r.fps) && r.fps > 0 && r.fps <= 240) out.fps = r.fps;
  if (isValidColor(r.background)) out.background = (r.background as string).toLowerCase();
  if (r.matte === true) out.matte = true;
  return out;
}

/** The whole settings entry: only built-in type ids, only usable defaults. */
export function sanitizeTypeOutputDefaults(raw: unknown): Record<string, TypeOutputDefault> {
  const out: Record<string, TypeOutputDefault> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [type, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isBuiltInType(type)) continue;
    const d = sanitizeTypeOutputDefault(value);
    if (d) out[type] = d;
  }
  return out;
}

// ---------------------------------------------------------------- one-click presets per kind of asset

export interface AssetOutputPreset {
  id: string;
  label: string;
  /** One sentence on what it sets and who it is for. */
  tip: string;
  /** Offered only where it fits: a required alpha, and/or a category list. Empty is everywhere. */
  appliesTo: { alpha?: boolean; categories?: readonly TemplateCategory[] };
  /** What one click sets; everything else on the tab is left as it stands. */
  choices: Pick<TypeOutputDefault, 'presetId' | 'background' | 'matte'>;
}

export const ASSET_OUTPUT_PRESETS: readonly AssetOutputPreset[] = [
  {
    id: 'transparent-overlay',
    label: 'Transparent overlay',
    tip: 'ProRes 4444 with the alpha kept: drops straight onto footage in Premiere Pro, Resolve or Final Cut.',
    appliesTo: { alpha: true },
    choices: { presetId: 'prores-4444' },
  },
  {
    id: 'editor-safe',
    label: 'Editor-safe, with matte',
    tip: 'H.264 flattened over black with the alpha beside it as a gray matte file, for editors and pipelines that cannot read an alpha channel.',
    appliesTo: { alpha: true },
    choices: { presetId: 'h264-mp4', background: '#000000', matte: true },
  },
  {
    id: 'full-screen-background',
    label: 'Full-screen background',
    tip: 'H.264 of the whole frame: a background to cut shots over, sized and paced by the template.',
    appliesTo: { categories: ['background'] },
    choices: { presetId: 'h264-mp4', background: '#000000' },
  },
  {
    id: 'web-alpha',
    label: 'Web overlay (VP9)',
    tip: 'WebM VP9 with alpha: small files for browsers, OBS and web players that take transparency.',
    appliesTo: { alpha: true },
    choices: { presetId: 'webm-vp9-alpha' },
  },
];

/** The presets that fit this template: its alpha, its category. A background drawn on alpha is offered both kinds. */
export function assetPresetsFor(manifest: { alpha: boolean; category: TemplateCategory }): AssetOutputPreset[] {
  return ASSET_OUTPUT_PRESETS.filter((p) => {
    if (p.appliesTo.alpha !== undefined && p.appliesTo.alpha !== manifest.alpha) return false;
    if (p.appliesTo.categories && !p.appliesTo.categories.includes(manifest.category)) return false;
    return true;
  });
}
