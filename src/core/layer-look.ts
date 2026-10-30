/**
 * How a layer looks (milestone 28): what is set once on a layer and not
 * animated — its opacity, a drop shadow, an outer glow, an outline, a blur, a
 * blend mode and a colour adjustment, and for a picture or a clip, rounded
 * corners and soft edges. Drawn by the host around the template's own draw of
 * the layer, as its placement and its transitions are, so templates need no
 * changes.
 *
 * Every size here is a fraction of the frame's **short side**, as a layer's
 * own size is, so a look holds at every resolution and reads the same wide,
 * tall and square; the Parameters tab shows them as a percentage. Colours are
 * `#rrggbb` or `#rrggbbaa`, so a shadow carries its own strength.
 *
 * A look that says nothing is no look at all and is not stored, so a layer
 * nobody has styled serializes exactly as it did. The bridge script
 * (`BRIDGE_SCRIPT` in src/core/runtime.ts) does the drawing and mirrors the
 * arithmetic of `lookPixels`: **change both or neither.** This copy is the one
 * with unit tests.
 */

import { isValidColor } from './manifest';

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface LayerLook {
  /** 0 to 1; 1 is as the template draws it. Multiplied into whatever the frame already gave the layer. */
  opacity: number;
  /** A drop shadow, drawn when it has a distance or a softness; its colour carries its strength. */
  shadowColor: string;
  /** How far the shadow sits from the layer, as a fraction of the frame's short side. */
  shadowDistance: number;
  /** Which way it falls: degrees clockwise, 0 to the right and 90 straight down. */
  shadowAngle: number;
  /** How blurred its edge is, as a fraction of the frame's short side; 0 is hard. */
  shadowSoftness: number;
  /** An outer glow, drawn when it has a size. */
  glowColor: string;
  glowSize: number;
  /** An outline around the layer, drawn when it has a width: a stroke around type, a frame around a picture. */
  outlineColor: string;
  outlineWidth: number;
  /** A blur of the layer itself, as a fraction of the frame's short side. */
  blur: number;
  blend: BlendMode;
  /** -1 to 1; 0 leaves the brightness alone. */
  brightness: number;
  /** 0 to 2; 1 leaves the colour alone, 0 is grey. */
  saturation: number;
  /** A colour washed half way over the layer's own, or null for none. */
  tint: string | null;
  /** Rounded corners on a picture or a clip, as a fraction of the frame's short side; nothing to type. */
  corners: number;
  /** Soft edges on a picture or a clip: how far in from the edge the fade runs. Nothing to type. */
  feather: number;
}

/** What every layer has until someone says otherwise: exactly what the template draws. */
export const DEFAULT_LOOK: LayerLook = {
  opacity: 1,
  shadowColor: '#00000073',
  shadowDistance: 0,
  shadowAngle: 90,
  shadowSoftness: 0,
  glowColor: '#ffffffd9',
  glowSize: 0,
  outlineColor: '#000000',
  outlineWidth: 0,
  blur: 0,
  blend: 'normal',
  brightness: 0,
  saturation: 1,
  tint: null,
  corners: 0,
  feather: 0,
};

/** What each number may be; validation and the fields share them. Sizes are fractions of the short side. */
export const LOOK_LIMITS = {
  opacity: { min: 0, max: 1 },
  size: { min: 0, max: 0.25 },
  angle: { min: -180, max: 180 },
  brightness: { min: -1, max: 1 },
  saturation: { min: 0, max: 2 },
} as const;

/** The strength a tint is washed over the layer with; a full wash would be milestone 22's "tinted" treatment. */
export const TINT_STRENGTH = 0.5;

/** True when a look changes nothing about how the template draws the layer. */
export function isDefaultLook(look: LayerLook | undefined): boolean {
  if (!look) return true;
  return (Object.keys(DEFAULT_LOOK) as (keyof LayerLook)[]).every((k) => look[k] === DEFAULT_LOOK[k]);
}

/** True when the look wants a drop shadow drawn. */
export function hasShadow(look: LayerLook): boolean {
  return look.shadowDistance > 0 || look.shadowSoftness > 0;
}

/**
 * The look in pixels of a frame whose short side is `short`: what the canvas
 * is handed. The shadow's offset comes from its angle and distance; the
 * filter is the CSS filter string the colour adjustment and the blur come to,
 * or an empty string for none.
 */
export interface LookPixels {
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  glowBlur: number;
  outlineWidth: number;
  corners: number;
  feather: number;
  filter: string;
  composite: 'source-over' | Exclude<BlendMode, 'normal'>;
}

export function lookPixels(look: LayerLook, short: number): LookPixels {
  const px = (fraction: number) => Math.round(fraction * short * 100) / 100;
  const radians = (look.shadowAngle * Math.PI) / 180;
  const distance = px(look.shadowDistance);
  const parts: string[] = [];
  if (look.blur > 0) parts.push(`blur(${px(look.blur)}px)`);
  if (look.brightness !== 0) parts.push(`brightness(${Math.round((1 + look.brightness) * 1000) / 1000})`);
  if (look.saturation !== 1) parts.push(`saturate(${Math.round(look.saturation * 1000) / 1000})`);
  return {
    shadowBlur: px(look.shadowSoftness),
    shadowOffsetX: Math.round(Math.cos(radians) * distance * 100) / 100,
    shadowOffsetY: Math.round(Math.sin(radians) * distance * 100) / 100,
    glowBlur: px(look.glowSize),
    outlineWidth: px(look.outlineWidth),
    corners: px(look.corners),
    feather: px(look.feather),
    filter: parts.join(' '),
    composite: look.blend === 'normal' ? 'source-over' : look.blend,
  };
}

/**
 * Milestone 22's image effects, as the look they always were: a shadow that
 * falls straight down by a twenty-fifth of the picture's height and blurs by
 * an eighth of it, or a glow a quarter of its height across, white or the tint.
 * `height` is the picture's height as a fraction of the short side, which is
 * what those sizes were measured against, so a saved picture draws as it did.
 */
export function lookFromImageEffect(effect: 'none' | 'shadow' | 'glow', height: number, glowColor: string): Partial<LayerLook> {
  if (effect === 'shadow') return { shadowColor: '#00000073', shadowDistance: height * 0.04, shadowAngle: 90, shadowSoftness: height * 0.12 };
  if (effect === 'glow') return { glowColor, glowSize: height * 0.25 };
  return {};
}

type Issue = (field: string, message: string) => void;

function inRange(v: unknown, limit: { min: number; max: number }): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= limit.min && v <= limit.max;
}

/** A tidy fraction: four decimals is finer than any field offers and keeps a stored look short. */
function tidy(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * A layer's look, read against a base: an object naming any of the fields,
 * each checked as everywhere else here — a wrong one is reported and the
 * base's kept. `null` clears a look a stored stack carried, and a look that
 * comes to the default is no look at all.
 */
export function readLook(raw: unknown, base: LayerLook | undefined, issue: Issue): LayerLook | undefined {
  if (raw === undefined) return base ? { ...base } : undefined;
  if (raw === null) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issue('look', 'must be an object of look settings, such as {"opacity":0.5,"blur":0.01}');
    return base ? { ...base } : undefined;
  }
  const r = raw as Record<string, unknown>;
  const out: LayerLook = { ...(base ?? DEFAULT_LOOK) };
  const number = (key: keyof LayerLook, limit: { min: number; max: number }, what: string) => {
    if (r[key] === undefined) return;
    if (inRange(r[key], limit)) (out as unknown as Record<string, number>)[key] = tidy(r[key]);
    else issue(`look.${key}`, `must be ${what} from ${limit.min} to ${limit.max}`);
  };
  const colour = (key: 'shadowColor' | 'glowColor' | 'outlineColor') => {
    if (r[key] === undefined) return;
    if (typeof r[key] === 'string' && isValidColor(r[key])) out[key] = r[key].toLowerCase();
    else issue(`look.${key}`, 'must be a colour such as #rrggbb or #rrggbbaa');
  };
  number('opacity', LOOK_LIMITS.opacity, 'a number');
  colour('shadowColor');
  number('shadowDistance', LOOK_LIMITS.size, 'a fraction of the frame\'s short side');
  number('shadowAngle', LOOK_LIMITS.angle, 'an angle in degrees');
  number('shadowSoftness', LOOK_LIMITS.size, 'a fraction of the frame\'s short side');
  colour('glowColor');
  number('glowSize', LOOK_LIMITS.size, 'a fraction of the frame\'s short side');
  colour('outlineColor');
  number('outlineWidth', LOOK_LIMITS.size, 'a fraction of the frame\'s short side');
  number('blur', LOOK_LIMITS.size, 'a fraction of the frame\'s short side');
  if (r.blend !== undefined) {
    if ((BLEND_MODES as readonly unknown[]).includes(r.blend)) out.blend = r.blend as BlendMode;
    else issue('look.blend', `must be one of: ${BLEND_MODES.join(', ')}`);
  }
  number('brightness', LOOK_LIMITS.brightness, 'a number');
  number('saturation', LOOK_LIMITS.saturation, 'a number');
  if (r.tint !== undefined) {
    if (r.tint === null) out.tint = null;
    else if (typeof r.tint === 'string' && isValidColor(r.tint)) out.tint = r.tint.toLowerCase();
    else issue('look.tint', 'must be a colour such as #rrggbb, or null for none');
  }
  number('corners', LOOK_LIMITS.size, 'a fraction of the frame\'s short side');
  number('feather', LOOK_LIMITS.size, 'a fraction of the frame\'s short side');
  return isDefaultLook(out) ? undefined : out;
}
