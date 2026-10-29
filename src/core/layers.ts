/**
 * Blocks and layers (milestone 23). A template declares **blocks**: a box per
 * aspect where layers may live. **Layers** stack inside a block — the
 * template's own as defaults, and whatever the person using it adds — and
 * take their part of the template's movement from their position in the
 * stack, so an added line enters, moves and leaves with the design.
 *
 * This module is the pure part: what a block and a layer declare, the
 * typography a text layer starts from, validation shared by the manifest and
 * by the values a person builds at use time, and the resolution of those
 * values against the template's own layers. Milestone 22's image slots are
 * untouched: a slot is the author's, a layer is the user's.
 *
 * Units: sizes, gaps and space before a layer are fractions of the frame's
 * short side, so they hold at every resolution and shape; letter spacing is
 * in em of the layer's size; line height is a multiple of it.
 */

import { sanitizeImageValue, validateSlotBoxes, type ImageValue, type SlotBoxes } from './image-slot';
import { sanitizeClipValue, type ClipValue } from './video-layer';
import {
  DEFAULT_TRANSITION, DEFAULT_TRANSITIONS, isTemplateMovement, isWholeGraphic, LAYER_TRANSITIONS, roundSeconds,
  TRANSITION_DIRECTIONS, TRANSITION_LIMITS, type LayerSpan, type LayerTransition, type LayerTransitions,
} from './layer-time';
import { MAX_LENGTH_SECONDS } from './timing';
import { isValidColor, type TemplateManifest, type ValidationIssue } from './manifest';

export const LAYER_TYPES = ['text', 'image', 'video'] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const BLOCK_DIRECTIONS = ['column', 'row'] as const;
export type BlockDirection = (typeof BLOCK_DIRECTIONS)[number];

export const LAYER_ALIGNS = ['left', 'center', 'right'] as const;
export type LayerAlign = (typeof LAYER_ALIGNS)[number];

export const VERTICAL_ALIGNS = ['top', 'middle', 'bottom'] as const;
export type VerticalAlign = (typeof VERTICAL_ALIGNS)[number];

export const TEXT_CASES = ['none', 'upper', 'lower', 'title'] as const;
export type TextCase = (typeof TEXT_CASES)[number];

export const TEXT_OVERFLOWS = ['wrap', 'shrink', 'truncate'] as const;
export type TextOverflow = (typeof TEXT_OVERFLOWS)[number];

/**
 * How a layer arrived, before milestone 28 gave it two ends. A stored stack —
 * a preset, a collection card, a `--param @layers` — may still carry one, and
 * is read as the entrance it always was: the type becomes `transition.in` over
 * the half second it always took, and the delay becomes the layer's own start,
 * which is the same moment on the same clock at the template's own length.
 * Nothing writes one any more.
 */
export const LAYER_MOTIONS = ['template', 'fade', 'slide', 'scale', 'none'] as const;
export type LayerMotionType = (typeof LAYER_MOTIONS)[number];

export interface LayerMotion {
  type: LayerMotionType;
  /** Seconds the layer waited before it came in. */
  delay: number;
}

export const DEFAULT_MOTION: LayerMotion = { type: 'template', delay: 0 };

/**
 * Where a person put a layer (milestone 25): an offset from where the block
 * stacked it, as fractions of the frame's width and height, and a scale about
 * the layer's own centre. The host applies it around the template's draw of
 * that layer, so a placed layer still enters, moves and leaves with the
 * design. Kept **per aspect** (plus "default"), so a layout placed at 16:9
 * never moves what was placed at 9:16.
 */
export interface LayerPlacement {
  /** Across, as a fraction of the frame's width; negative is left. */
  dx: number;
  /** Down, as a fraction of the frame's height; negative is up. */
  dy: number;
  /** About the layer's centre; 1 is the size the stack gave it. */
  scale: number;
  /** About the layer's centre, in degrees clockwise; 0 is as the stack set it (milestone 29). */
  rotate: number;
}

export type LayerPlacements = Record<string, LayerPlacement>;

export const IDENTITY_PLACEMENT: LayerPlacement = { dx: 0, dy: 0, scale: 1, rotate: 0 };

/**
 * An angle in degrees, folded into (-180, 180]. An angle is cyclic, so a value
 * outside that is a different way of writing one inside it rather than a
 * mistake: 270 means -90, and a preset or a CSV cell saying so is read, not
 * refused. (`dx`, `dy` and `scale` are reported when out of range, because for
 * those a number past the end really is wrong.)
 */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((degrees % 360) + 540) % 360 - 180;
  // The fold above lands exactly -180 for a half turn; 180 is the friendlier way to write it.
  const settled = wrapped === -180 ? 180 : wrapped;
  // Hundredths: finer than any handle or field offers, and it keeps the stored value tidy.
  return Math.round(settled * 100) / 100 + 0;
}

/** True when a placement leaves the layer exactly where its stack put it. */
export function isIdentityPlacement(p: LayerPlacement): boolean {
  return p.dx === 0 && p.dy === 0 && p.scale === 1 && p.rotate === 0;
}

/** How text is set: what a block's text layers start from, and what one layer can override. */
export interface Typography {
  /** A font family name; the bundled set and imported families arrive with later items. */
  family: string;
  /** Fraction of the frame's short side. */
  size: number;
  /** 100 to 900. */
  weight: number;
  italic: boolean;
  case: TextCase;
  /** In em of the size; may be negative. */
  letterSpacing: number;
  kerning: boolean;
  /** A multiple of the size. */
  lineHeight: number;
  /** `#rrggbb` or `#rrggbbaa`, lowercase. */
  color: string;
  align: LayerAlign;
  /** What happens when the text does not fit the block. */
  overflow: TextOverflow;
}

/** Lines a wrapped text layer may take when it does not say (src/core/layer-layout.ts). */
export const DEFAULT_MAX_LINES = 3;

export const DEFAULT_TYPOGRAPHY: Typography = {
  family: 'Inter',
  size: 0.06,
  weight: 400,
  italic: false,
  case: 'none',
  letterSpacing: 0,
  kerning: true,
  lineHeight: 1.2,
  color: '#ffffff',
  align: 'left',
  overflow: 'wrap',
};

/** An image layer's height when the template or the person does not say, as a fraction of the frame's short side. */
export const DEFAULT_IMAGE_LAYER_SIZE = 0.12;

/** What each number may be; validation and use-time sanitizing share them. */
export const LAYER_LIMITS = {
  size: { min: 0.001, max: 1 },
  weight: { min: 100, max: 900 },
  letterSpacing: { min: -0.5, max: 2 },
  lineHeight: { min: 0.5, max: 4 },
  spaceBefore: { min: 0, max: 1 },
  gap: { min: 0, max: 1 },
  maxLines: { min: 1, max: 20 },
  /** A stored `motion`'s delay, which is read as the layer's own start. */
  motionDelay: { min: 0, max: 10 },
  placementOffset: { min: -1, max: 1 },
  placementScale: { min: 0.05, max: 10 },
  /** A layer's own start and end, in seconds of the graphic; no graphic may run longer than this. */
  spanSeconds: { min: 0, max: MAX_LENGTH_SECONDS },
} as const;

interface LayerBase {
  /** Unique within its block. Letters, digits and underscore, not starting with a digit. */
  id: string;
  label: string;
  /** The template's: a required layer cannot be removed. Never set from use-time input. */
  required: boolean;
  /** Kept but not drawn; the stack closes up around it. */
  hidden: boolean;
  /** Room before this layer along the stack, as a fraction of the frame's short side. */
  spaceBefore: number;
  /**
   * How it arrives and how it leaves: the template's own movement for its
   * position at either end, or the person's own (src/core/layer-time.ts).
   * Absent until a layer is given one, which is the template's at both ends.
   */
  transition?: LayerTransitions;
  /** Where the person put it, by aspect; absent until a layer is moved or scaled on the stage. */
  placement?: LayerPlacements;
  /**
   * When it comes and goes, in seconds of the graphic as it is watched
   * (milestone 30's chosen length, not the template's own clock); absent until
   * a layer is given a time of its own, which is the whole graphic
   * (src/core/layer-time.ts).
   */
  span?: LayerSpan;
}

export interface TextLayer extends LayerBase, Typography {
  type: 'text';
  text: string;
  /** Lines a `wrap` layer may take before it is set smaller instead; 3 when it does not say. */
  maxLines: number;
}

/**
 * A clip playing inside the graphic (milestone 26). It takes its room the way
 * an image layer does — a height as a fraction of the frame, width from the
 * clip's shape — and `clip` says which clip and how it plays; the host decodes
 * it for the template's own time (`video-layer.ts`).
 */
export interface VideoLayer extends LayerBase {
  type: 'video';
  /** A library clip with its in and out points, ending, speed and delay, or null: nothing chosen, nothing drawn. */
  clip: ClipValue | null;
  /** The picture's height as a fraction of the frame's short side; its width follows its shape, capped by the block. */
  size: number;
  align: LayerAlign;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  /** A library still with its treatment (milestone 22), or null: nothing chosen, nothing drawn, no room taken. */
  image: ImageValue | null;
  /** The picture's height as a fraction of the frame's short side; its width follows its shape, capped by the block. */
  size: number;
  align: LayerAlign;
}

export type Layer = TextLayer | ImageLayer | VideoLayer;

/** Layers that take their room from a picture rather than from type. */
export type PictureLayer = ImageLayer | VideoLayer;

export interface Block {
  id: string;
  label: string;
  /** Fractions of the frame; one box, or one per aspect id with an optional "default" (as an image slot). */
  box: SlotBoxes;
  /** Layers stack top to bottom in a column, left to right in a row. */
  direction: BlockDirection;
  /** Between layers, as a fraction of the frame's short side. */
  gap: number;
  /** Where layers sit across the box's width, and the default for text layers. */
  align: LayerAlign;
  /** Where the stack sits in the box's height (a row: where each layer sits in the row). */
  verticalAlign: VerticalAlign;
  /** Whether layers may be added beyond the template's own. */
  open: boolean;
  /** What this block's text layers start from. */
  typography: Typography;
  /** The template's own layers: the defaults, in stack order. */
  layers: Layer[];
}

/** Layer stacks by block id: what a person has built at use time, or the template's defaults. */
export type LayerValues = Record<string, Layer[]>;

export interface LayerIssue {
  block: string;
  layer?: string;
  message: string;
}

export interface ResolveLayersResult {
  values: LayerValues;
  issues: LayerIssue[];
}

const LAYER_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function inRange(value: unknown, limit: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= limit.min && value <= limit.max;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/**
 * A field-by-field reader: every typography field is optional and falls back
 * to `base`; a present field that is wrong is reported and the base kept, so
 * the manifest validator and the use-time sanitizer apply one set of rules.
 */
const TYPOGRAPHY_KEYS = ['family', 'size', 'weight', 'italic', 'case', 'letterSpacing', 'kerning', 'lineHeight', 'color', 'align', 'overflow'] as const;

/** Only the typography of a layer or a block, so a spread of it cannot carry other fields along. */
export function pickTypography(from: Typography): Typography {
  const t = {} as Record<string, unknown>;
  for (const key of TYPOGRAPHY_KEYS) t[key] = from[key];
  return t as unknown as Typography;
}

function readTypography(raw: Record<string, unknown>, base: Typography, path: string, issue: (field: string, message: string) => void): Typography {
  const t: Typography = pickTypography(base);
  if (raw.family !== undefined) {
    if (isNonEmptyString(raw.family)) t.family = raw.family.trim();
    else issue('family', 'must be a non-empty font family name');
  }
  if (raw.size !== undefined) {
    if (inRange(raw.size, LAYER_LIMITS.size)) t.size = raw.size;
    else issue('size', `must be a fraction of the frame's short side, from ${LAYER_LIMITS.size.min} to ${LAYER_LIMITS.size.max}`);
  }
  if (raw.weight !== undefined) {
    if (Number.isInteger(raw.weight) && inRange(raw.weight, LAYER_LIMITS.weight)) t.weight = raw.weight as number;
    else issue('weight', 'must be an integer from 100 to 900');
  }
  for (const key of ['italic', 'kerning'] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] === 'boolean') t[key] = raw[key] as boolean;
    else issue(key, 'must be a boolean');
  }
  if (raw.case !== undefined) {
    if (oneOf(TEXT_CASES, raw.case)) t.case = raw.case;
    else issue('case', `must be one of: ${TEXT_CASES.join(', ')}`);
  }
  if (raw.letterSpacing !== undefined) {
    if (inRange(raw.letterSpacing, LAYER_LIMITS.letterSpacing)) t.letterSpacing = raw.letterSpacing;
    else issue('letterSpacing', `must be a number in em, from ${LAYER_LIMITS.letterSpacing.min} to ${LAYER_LIMITS.letterSpacing.max}`);
  }
  if (raw.lineHeight !== undefined) {
    if (inRange(raw.lineHeight, LAYER_LIMITS.lineHeight)) t.lineHeight = raw.lineHeight;
    else issue('lineHeight', `must be a multiple of the size, from ${LAYER_LIMITS.lineHeight.min} to ${LAYER_LIMITS.lineHeight.max}`);
  }
  if (raw.color !== undefined) {
    if (isValidColor(raw.color)) t.color = raw.color.toLowerCase();
    else issue('color', 'must be a color in #RRGGBB or #RRGGBBAA form');
  }
  if (raw.align !== undefined) {
    if (oneOf(LAYER_ALIGNS, raw.align)) t.align = raw.align;
    else issue('align', `must be one of: ${LAYER_ALIGNS.join(', ')}`);
  }
  if (raw.overflow !== undefined) {
    if (oneOf(TEXT_OVERFLOWS, raw.overflow)) t.overflow = raw.overflow;
    else issue('overflow', `must be one of: ${TEXT_OVERFLOWS.join(', ')}`);
  }
  void path;
  return t;
}

/**
 * A stored `motion`, read against a base: an object naming a `type` and a
 * `delay`, either of which may be left out. A wrong field is reported and the
 * base kept, as everywhere else here. Nothing writes one any more; this is how
 * the ones already saved are read (`readTransitions`).
 */
function readMotion(raw: unknown, base: LayerMotion, issue: (field: string, message: string) => void): LayerMotion {
  if (raw === undefined) return { ...base };
  if (!isRecord(raw)) {
    issue('motion', `must be an object naming a type (${LAYER_MOTIONS.join(', ')}) and an optional delay in seconds`);
    return { ...base };
  }
  const out = { ...base };
  if (raw.type !== undefined) {
    if (oneOf(LAYER_MOTIONS, raw.type)) out.type = raw.type;
    else issue('motion.type', `must be one of: ${LAYER_MOTIONS.join(', ')}`);
  }
  if (raw.delay !== undefined) {
    if (inRange(raw.delay, LAYER_LIMITS.motionDelay)) out.delay = raw.delay;
    else issue('motion.delay', `must be a number of seconds from ${LAYER_LIMITS.motionDelay.min} to ${LAYER_LIMITS.motionDelay.max}`);
  }
  return out;
}

/** One end of a layer, read against a base: a type, how long it takes, and which edge it travels from. */
function readTransition(raw: unknown, base: LayerTransition, end: 'in' | 'out', issue: (field: string, message: string) => void): LayerTransition {
  if (raw === undefined) return { ...base };
  if (!isRecord(raw)) {
    issue(`transition.${end}`, `must be an object naming a type (${LAYER_TRANSITIONS.join(', ')}), seconds and a direction`);
    return { ...base };
  }
  const out = { ...base };
  if (raw.type !== undefined) {
    if (oneOf(LAYER_TRANSITIONS, raw.type)) out.type = raw.type;
    else issue(`transition.${end}.type`, `must be one of: ${LAYER_TRANSITIONS.join(', ')}`);
  }
  if (raw.seconds !== undefined) {
    if (inRange(raw.seconds, TRANSITION_LIMITS.seconds)) out.seconds = roundSeconds(raw.seconds);
    else issue(`transition.${end}.seconds`, `must be a number of seconds from ${TRANSITION_LIMITS.seconds.min} to ${TRANSITION_LIMITS.seconds.max}`);
  }
  if (raw.direction !== undefined) {
    if (oneOf(TRANSITION_DIRECTIONS, raw.direction)) out.direction = raw.direction;
    else issue(`transition.${end}.direction`, `must be one of: ${TRANSITION_DIRECTIONS.join(', ')}`);
  }
  return out;
}

/**
 * A layer's two ends, read against a base: an object with `in` and `out`,
 * either of which may be left out. The template's movement at both ends is no
 * transition at all, so a layer nobody has given one serializes as it did.
 */
function readTransitions(raw: unknown, base: LayerTransitions | undefined, issue: (field: string, message: string) => void): LayerTransitions | undefined {
  if (raw === null) return undefined;
  if (raw !== undefined && !isRecord(raw)) {
    issue('transition', 'must be an object with in and out, such as {"in":{"type":"fade","seconds":0.4}}');
    return base ? { in: { ...base.in }, out: { ...base.out } } : undefined;
  }
  const from = base ?? DEFAULT_TRANSITIONS;
  const given = (raw ?? {}) as Record<string, unknown>;
  const out: LayerTransitions = {
    in: readTransition(given.in, from.in, 'in', issue),
    out: readTransition(given.out, from.out, 'out', issue),
  };
  return isTemplateMovement(out) ? undefined : out;
}

/**
 * The entrance a stored `motion` means, for a stack saved before milestone 28:
 * the same shape over the same half second it always took, going the way the
 * stack goes, and nothing said about leaving. Its delay is the layer's own
 * start, which is the moment it always was.
 */
function transitionsFromMotion(motion: LayerMotion): { transition?: LayerTransitions; start: number } {
  const start = Math.max(0, motion.delay);
  if (motion.type === 'template') return { start };
  return { transition: { in: { ...DEFAULT_TRANSITION, type: motion.type }, out: { ...DEFAULT_TRANSITION } }, start };
}

/**
 * One aspect's placement, read against identity: a wrong field is reported and
 * identity kept for it, as everywhere else here.
 */
function readOnePlacement(raw: unknown, issue: (field: string, message: string) => void): LayerPlacement | null {
  if (!isRecord(raw)) {
    issue('placement', 'each aspect must be an object of dx, dy, scale and rotate');
    return null;
  }
  const out = { ...IDENTITY_PLACEMENT };
  for (const key of ['dx', 'dy'] as const) {
    if (raw[key] === undefined) continue;
    if (inRange(raw[key], LAYER_LIMITS.placementOffset)) out[key] = raw[key] as number;
    else issue(`placement.${key}`, `must be a fraction of the frame, from ${LAYER_LIMITS.placementOffset.min} to ${LAYER_LIMITS.placementOffset.max}`);
  }
  if (raw.scale !== undefined) {
    if (inRange(raw.scale, LAYER_LIMITS.placementScale)) out.scale = raw.scale;
    else issue('placement.scale', `must be a factor from ${LAYER_LIMITS.placementScale.min} to ${LAYER_LIMITS.placementScale.max}`);
  }
  if (raw.rotate !== undefined) {
    if (typeof raw.rotate === 'number' && Number.isFinite(raw.rotate)) out.rotate = normalizeAngle(raw.rotate);
    else issue('placement.rotate', 'must be an angle in degrees');
  }
  return out;
}

/**
 * A layer's placements, read against a base: an object keyed by aspect id (or
 * "default"), each an offset, a scale and an angle. An identity entry is dropped, and a
 * placement that ends up empty is no placement at all, so an unmoved layer
 * serializes exactly as it always did.
 */
function readPlacement(raw: unknown, base: LayerPlacements | undefined, issue: (field: string, message: string) => void): LayerPlacements | undefined {
  if (raw === undefined) return base ? { ...base } : undefined;
  if (raw === null) return undefined;
  if (!isRecord(raw)) {
    issue('placement', 'must be an object of placements by aspect id, such as {"16:9":{"dx":0.1}}');
    return base ? { ...base } : undefined;
  }
  const out: LayerPlacements = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'default' && !/^\d+:\d+$/.test(key)) {
      issue('placement', `"${key}" is not an aspect id such as "16:9", or "default"`);
      continue;
    }
    const one = readOnePlacement(value, issue);
    if (!one) continue;
    // An identity entry is no placement at all, so an untouched layer serializes as it always did.
    if (isIdentityPlacement(one)) continue;
    out[key] = one;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The placement an aspect key answers with: its own, else "default", else identity. */
export function placementFor(placements: LayerPlacements | undefined, aspect: string): LayerPlacement {
  return placements?.[aspect] ?? placements?.default ?? IDENTITY_PLACEMENT;
}

/**
 * A layer's own start and end, read against a base: an object naming `start`
 * and `end` in seconds, either of which may be left out, and `end: null` for
 * "as long as the graphic". A span that leaves the layer on screen for the
 * whole graphic is no span at all, so a layer nobody has timed serializes
 * exactly as it always did.
 *
 * What a start past the graphic's end, or an end before its start, comes to is
 * settled when the frame is drawn and the graphic's length is known
 * (`spanWindow` in src/core/layer-time.ts), not here: the length is a use-time
 * choice and the same stored span is right at every one of them.
 */
function readSpan(raw: unknown, base: LayerSpan | undefined, issue: (field: string, message: string) => void): LayerSpan | undefined {
  if (raw === undefined) return base ? { ...base } : undefined;
  if (raw === null) return undefined;
  if (!isRecord(raw)) {
    issue('span', 'must be an object of start and end in seconds, such as {"start":2,"end":8}');
    return base ? { ...base } : undefined;
  }
  const out: LayerSpan = base ? { ...base } : { start: 0, end: null };
  if (raw.start !== undefined) {
    if (inRange(raw.start, LAYER_LIMITS.spanSeconds)) out.start = roundSeconds(raw.start);
    else issue('span.start', `must be a number of seconds from ${LAYER_LIMITS.spanSeconds.min} to ${LAYER_LIMITS.spanSeconds.max}`);
  }
  if (raw.end !== undefined) {
    if (raw.end === null) out.end = null;
    else if (inRange(raw.end, LAYER_LIMITS.spanSeconds)) out.end = roundSeconds(raw.end);
    else issue('span.end', `must be a number of seconds from ${LAYER_LIMITS.spanSeconds.min} to ${LAYER_LIMITS.spanSeconds.max}, or null to run to the end`);
  }
  return isWholeGraphic(out) ? undefined : out;
}

type LayerBaseFields = Pick<LayerBase, 'label' | 'hidden' | 'spaceBefore' | 'transition' | 'placement' | 'span'>;

/** The fields a layer of either type has, read against a base the same way as typography. */
function readLayerBase(raw: Record<string, unknown>, base: LayerBaseFields, issue: (field: string, message: string) => void): LayerBaseFields {
  const out = { ...base };
  // A stack saved before milestone 28 carries a `motion` and no `transition`: it is read as the
  // entrance it always was, and its delay as the start it always was. Anything that names a
  // transition of its own has already been through this and the old field is left alone.
  const legacy = raw.motion !== undefined && raw.transition === undefined
    ? transitionsFromMotion(readMotion(raw.motion, { ...DEFAULT_MOTION }, issue))
    : null;
  const transition = readTransitions(raw.transition, legacy?.transition ?? base.transition, issue);
  if (transition) out.transition = transition;
  else delete out.transition;
  const placement = readPlacement(raw.placement, base.placement, issue);
  if (placement) out.placement = placement;
  else delete out.placement;
  const spanBase = legacy && legacy.start > 0 && raw.span === undefined ? { start: legacy.start, end: null } : base.span;
  const span = readSpan(raw.span, spanBase, issue);
  if (span) out.span = span;
  else delete out.span;
  if (raw.label !== undefined) {
    if (isNonEmptyString(raw.label)) out.label = raw.label.trim();
    else issue('label', 'must be a non-empty string');
  }
  if (raw.hidden !== undefined) {
    if (typeof raw.hidden === 'boolean') out.hidden = raw.hidden;
    else issue('hidden', 'must be a boolean');
  }
  if (raw.spaceBefore !== undefined) {
    if (inRange(raw.spaceBefore, LAYER_LIMITS.spaceBefore)) out.spaceBefore = raw.spaceBefore;
    else issue('spaceBefore', `must be a fraction of the frame's short side, from 0 to ${LAYER_LIMITS.spaceBefore.max}`);
  }
  return out;
}

/** A fresh layer of a type, as a block hands it out: the block's typography, the default image size, nothing required. */
export function newLayer(type: LayerType, block: Pick<Block, 'typography' | 'align'>, id: string, label?: string): Layer {
  const fallbackLabel = type === 'text' ? 'Text' : type === 'video' ? 'Video' : 'Image';
  const base: LayerBase = { id, label: label ?? fallbackLabel, required: false, hidden: false, spaceBefore: 0 };
  if (type === 'text') return { ...base, ...block.typography, type: 'text', text: '', maxLines: DEFAULT_MAX_LINES };
  if (type === 'video') return { ...base, type: 'video', clip: null, size: DEFAULT_IMAGE_LAYER_SIZE, align: block.align };
  return { ...base, type: 'image', image: null, size: DEFAULT_IMAGE_LAYER_SIZE, align: block.align };
}

/**
 * Validate one of a template's own layers. Text layers start from the block's
 * typography and override what they name; an image layer carries no image,
 * since a template cannot ship a library id. Fills every default, so readers
 * see complete layers.
 */
export function validateLayer(raw: unknown, path: string, block: Pick<Block, 'typography' | 'align'>, errors: ValidationIssue[]): Layer | null {
  if (!isRecord(raw)) {
    errors.push({ path, message: 'must be an object' });
    return null;
  }
  const start = errors.length;
  const issue = (field: string, message: string) => errors.push({ path: `${path}.${field}`, message });
  if (typeof raw.id !== 'string' || !LAYER_ID_PATTERN.test(raw.id)) issue('id', 'must be an identifier (letters, digits, underscore; not starting with a digit)');
  if (!isNonEmptyString(raw.label)) issue('label', 'must be a non-empty string');
  if (!oneOf(LAYER_TYPES, raw.type)) {
    issue('type', `must be one of: ${LAYER_TYPES.join(', ')}`);
    return null;
  }
  if (raw.required !== undefined && typeof raw.required !== 'boolean') issue('required', 'must be a boolean');
  const id = typeof raw.id === 'string' ? raw.id : '';
  const fresh = newLayer(raw.type, block, id, typeof raw.label === 'string' ? raw.label.trim() : undefined);
  const base = readLayerBase(raw, fresh, issue);
  const common: LayerBase = { id, label: base.label, required: raw.required === true, hidden: base.hidden, spaceBefore: base.spaceBefore, ...(base.transition ? { transition: base.transition } : {}), ...(base.placement ? { placement: base.placement } : {}), ...(base.span ? { span: base.span } : {}) };
  let layer: Layer;
  if (raw.type === 'text') {
    if (typeof raw.text !== 'string') issue('text', 'must be a string (the layer\'s default text)');
    let maxLines = DEFAULT_MAX_LINES;
    if (raw.maxLines !== undefined) {
      if (Number.isInteger(raw.maxLines) && inRange(raw.maxLines, LAYER_LIMITS.maxLines)) maxLines = raw.maxLines as number;
      else issue('maxLines', `must be an integer from ${LAYER_LIMITS.maxLines.min} to ${LAYER_LIMITS.maxLines.max}`);
    }
    layer = { ...common, ...readTypography(raw, block.typography, path, issue), type: 'text', text: typeof raw.text === 'string' ? raw.text : '', maxLines };
  } else {
    // A template ships no library ids, so neither an image nor a clip is declared here.
    const chosen = raw.type === 'video' ? 'clip' : 'image';
    const kind = raw.type === 'video' ? 'a video layer has no clip of its own' : 'an image layer has no image of its own';
    if (raw[chosen] !== undefined && raw[chosen] !== null) issue(chosen, `${kind}: leave it out or set it to null`);
    let size = DEFAULT_IMAGE_LAYER_SIZE;
    if (raw.size !== undefined) {
      if (inRange(raw.size, LAYER_LIMITS.size)) size = raw.size;
      else issue('size', `must be a fraction of the frame's short side, from ${LAYER_LIMITS.size.min} to ${LAYER_LIMITS.size.max}`);
    }
    let align = block.align;
    if (raw.align !== undefined) {
      if (oneOf(LAYER_ALIGNS, raw.align)) align = raw.align;
      else issue('align', `must be one of: ${LAYER_ALIGNS.join(', ')}`);
    }
    layer = raw.type === 'video'
      ? { ...common, type: 'video', clip: null, size, align }
      : { ...common, type: 'image', image: null, size, align };
  }
  return errors.length === start ? layer : null;
}

/** Validate a block from a manifest, filling every default; its layers are validated against its typography. */
export function validateBlock(raw: unknown, path: string, errors: ValidationIssue[]): Block | null {
  if (!isRecord(raw)) {
    errors.push({ path, message: 'must be an object' });
    return null;
  }
  const start = errors.length;
  const issue = (field: string, message: string) => errors.push({ path: `${path}.${field}`, message });
  if (typeof raw.id !== 'string' || !LAYER_ID_PATTERN.test(raw.id)) issue('id', 'must be an identifier (letters, digits, underscore; not starting with a digit)');
  if (!isNonEmptyString(raw.label)) issue('label', 'must be a non-empty string');
  const box = validateSlotBoxes(raw.box, `${path}.box`, errors);

  let direction: BlockDirection = 'column';
  if (raw.direction !== undefined) {
    if (oneOf(BLOCK_DIRECTIONS, raw.direction)) direction = raw.direction;
    else issue('direction', `must be one of: ${BLOCK_DIRECTIONS.join(', ')}`);
  }
  let gap = 0;
  if (raw.gap !== undefined) {
    if (inRange(raw.gap, LAYER_LIMITS.gap)) gap = raw.gap;
    else issue('gap', `must be a fraction of the frame's short side, from 0 to ${LAYER_LIMITS.gap.max}`);
  }
  let align: LayerAlign = 'left';
  if (raw.align !== undefined) {
    if (oneOf(LAYER_ALIGNS, raw.align)) align = raw.align;
    else issue('align', `must be one of: ${LAYER_ALIGNS.join(', ')}`);
  }
  let verticalAlign: VerticalAlign = 'top';
  if (raw.verticalAlign !== undefined) {
    if (oneOf(VERTICAL_ALIGNS, raw.verticalAlign)) verticalAlign = raw.verticalAlign;
    else issue('verticalAlign', `must be one of: ${VERTICAL_ALIGNS.join(', ')}`);
  }
  let open = true;
  if (raw.open !== undefined) {
    if (typeof raw.open === 'boolean') open = raw.open;
    else issue('open', 'must be a boolean');
  }
  // The block's alignment is the typography's unless the typography says otherwise.
  let typography: Typography = { ...DEFAULT_TYPOGRAPHY, align };
  if (raw.typography !== undefined) {
    if (isRecord(raw.typography)) typography = readTypography(raw.typography, typography, `${path}.typography`, (field, message) => errors.push({ path: `${path}.typography.${field}`, message }));
    else issue('typography', 'must be an object');
  }

  const layers: Layer[] = [];
  if (raw.layers !== undefined) {
    if (!Array.isArray(raw.layers)) issue('layers', 'must be an array');
    else {
      const seen = new Set<string>();
      raw.layers.forEach((l, i) => {
        const layer = validateLayer(l, `${path}.layers[${i}]`, { typography, align }, errors);
        if (!layer) return;
        if (seen.has(layer.id)) {
          errors.push({ path: `${path}.layers[${i}].id`, message: `duplicate layer id "${layer.id}"` });
          return;
        }
        seen.add(layer.id);
        layers.push(layer);
      });
    }
  }
  if (errors.length !== start || !box) return null;
  return { id: raw.id as string, label: (raw.label as string).trim(), box, direction, gap, align, verticalAlign, open, typography, layers };
}

/** The template's own stacks, one per block, as fresh copies. */
export function defaultLayers(manifest: Pick<TemplateManifest, 'blocks'>): LayerValues {
  const values: LayerValues = {};
  for (const block of manifest.blocks) values[block.id] = block.layers.map((l) => ({ ...l }));
  return values;
}

/** True when the template declares anything layers could live in. */
export function hasBlocks(manifest: Pick<TemplateManifest, 'blocks'>): boolean {
  return manifest.blocks.length > 0;
}

/**
 * Read one use-time layer against its base: the template's own layer of that
 * id, or a fresh layer of the type for an added one. Every field present and
 * right is taken; a wrong one is reported and the base kept; `required` and
 * `type` are the template's and never change.
 */
function sanitizeLayer(raw: Record<string, unknown>, base: Layer, block: Block, report: (message: string) => void): Layer {
  const issue = (field: string, message: string) => report(`${field} ${message}; kept`);
  const common = readLayerBase(raw, base, issue);
  /**
   * The layer, with `common` over its base. The optionals need saying twice: spreading `common`
   * cannot clear a key it does not have, so a `"placement": null` or `"span": null` — how a
   * stored stack says "back to the template's" — would otherwise let the base's own value
   * through.
   */
  const settled = <T extends Layer>(layer: T): T => {
    const out = { ...layer };
    if (!common.transition) delete out.transition;
    if (!common.placement) delete out.placement;
    if (!common.span) delete out.span;
    return out;
  };
  if (base.type === 'text') {
    const typography = readTypography(raw, base, '', issue);
    let text = base.text;
    if (raw.text !== undefined) {
      if (typeof raw.text === 'string') text = raw.text;
      else issue('text', 'must be a string');
    }
    let maxLines = base.maxLines;
    if (raw.maxLines !== undefined) {
      if (Number.isInteger(raw.maxLines) && inRange(raw.maxLines, LAYER_LIMITS.maxLines)) maxLines = raw.maxLines as number;
      else issue('maxLines', `must be an integer from ${LAYER_LIMITS.maxLines.min} to ${LAYER_LIMITS.maxLines.max}`);
    }
    return settled({ ...base, ...common, ...typography, text, maxLines });
  }
  let image = base.type === 'image' ? base.image : null;
  if (base.type === 'image' && raw.image !== undefined) {
    const value = sanitizeImageValue(raw.image);
    if (value === undefined) issue('image', 'must be a library id with an optional treatment, or null');
    else image = value;
  }
  let clip = base.type === 'video' ? base.clip : null;
  if (base.type === 'video' && raw.clip !== undefined) {
    const value = sanitizeClipValue(raw.clip);
    if (value === undefined) issue('clip', 'must be a library id with optional in, out, ending, speed and delay, or null');
    else clip = value;
  }
  let size = base.size;
  if (raw.size !== undefined) {
    if (inRange(raw.size, LAYER_LIMITS.size)) size = raw.size;
    else issue('size', `must be a fraction of the frame's short side, from ${LAYER_LIMITS.size.min} to ${LAYER_LIMITS.size.max}`);
  }
  let align = base.align;
  if (raw.align !== undefined) {
    if (oneOf(LAYER_ALIGNS, raw.align)) align = raw.align;
    else issue('align', `must be one of: ${LAYER_ALIGNS.join(', ')}`);
  }
  void block;
  if (base.type === 'video') return settled({ ...base, ...common, clip, size, align });
  return settled({ ...base, ...common, image, size, align });
}

/**
 * Read the layer stacks given as text — `--param @layers={...}` on the command
 * line — as JSON, and say plainly what is wrong rather than falling back to
 * the template's own. A stack that merely sets a property oddly is still
 * resolved and reported by `resolveLayers`; what fails here is text that is
 * not an object of stacks, a block the template does not have, or a layer that
 * is neither one of the template's own nor a complete new one.
 *
 * What is given **patches** the template's layers: naming one layer changes
 * that one and leaves the rest as the template has them, and an entry with a
 * type is added to the end. (A stored stack — a preset, a collection card — is
 * the whole stack and replaces it; see `resolveLayers`.) To take a line out of
 * a render, hide it: `{"id":"title","hidden":true}`.
 */
export function parseLayersArgument(text: string, manifest: Pick<TemplateManifest, 'blocks'>): { ok: true; layers: LayerValues } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: `layers: not valid JSON (${(err as Error).message}).` };
  }
  if (!isRecord(raw)) return { ok: false, message: 'layers: expected an object of layer stacks by block id, such as {"strap":[{"id":"name","text":"Ada"}]}.' };
  const known = manifest.blocks.map((b) => b.id);
  const problems: string[] = [];
  for (const [blockId, stack] of Object.entries(raw)) {
    const block = manifest.blocks.find((b) => b.id === blockId);
    if (!block) {
      problems.push(`"${blockId}" is not a block of this template${known.length > 0 ? ` (it has ${known.map((b) => `"${b}"`).join(', ')})` : ' (it declares none)'}`);
      continue;
    }
    if (!Array.isArray(stack)) {
      problems.push(`"${blockId}" must be an array of layers`);
      continue;
    }
    stack.forEach((entry, i) => {
      if (!isRecord(entry)) {
        problems.push(`"${blockId}" layer ${i} must be an object`);
        return;
      }
      const own = typeof entry.id === 'string' ? block.layers.find((l) => l.id === entry.id) : undefined;
      if (own) return;
      if (typeof entry.id === 'string' && !oneOf(LAYER_TYPES, entry.type)) {
        const ids = block.layers.map((l) => `"${l.id}"`).join(', ');
        problems.push(`"${blockId}" has no layer "${entry.id}"${ids ? ` (it has ${ids})` : ''}; to add one, give it a type of ${LAYER_TYPES.join(' or ')}`);
        return;
      }
      if (!oneOf(LAYER_TYPES, entry.type)) problems.push(`"${blockId}" layer ${i} needs an id of one of its layers, or a type of ${LAYER_TYPES.join(' or ')} to add one`);
      else if (!block.open) problems.push(`"${blockId}" takes no more layers`);
    });
  }
  if (problems.length > 0) return { ok: false, message: `layers: ${problems.join('; ')}.` };
  // Patch: every block starts as the template has it, and what was given lands on top of it.
  const patched: Record<string, Record<string, unknown>[]> = {};
  for (const block of manifest.blocks) {
    const given = (raw[block.id] ?? []) as Record<string, unknown>[];
    const byId = new Map(given.filter((e) => typeof e.id === 'string').map((e) => [e.id as string, e]));
    const stack: Record<string, unknown>[] = block.layers.map((l) => ({ id: l.id, ...(byId.get(l.id) ?? {}) }));
    for (const entry of given) {
      if (typeof entry.id === 'string' && block.layers.some((l) => l.id === entry.id)) continue;
      stack.push(entry);
    }
    patched[block.id] = stack;
  }
  return { ok: true, layers: resolveLayers(manifest, patched).values };
}

/**
 * Resolve use-time layer values — from the Parameters tab, a preset, a
 * collection file, a CSV row or the command line, so untrusted — against the
 * template's blocks. The result holds every block, in the input's order where
 * it gave one: the template's layers with the fields the input changed, the
 * layers it added (to open blocks only), and every required layer, put back
 * where the template had it if the input dropped it. Anything unusable falls
 * back and is reported rather than thrown, as parameters do.
 */
export function resolveLayers(manifest: Pick<TemplateManifest, 'blocks'>, input: unknown): ResolveLayersResult {
  const issues: LayerIssue[] = [];
  const values: LayerValues = {};
  if (input !== undefined && input !== null && !isRecord(input)) {
    issues.push({ block: '', message: 'layers must be an object of stacks by block id; using the template\'s' });
    input = undefined;
  }
  const given = (input ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(given)) {
    if (!manifest.blocks.some((b) => b.id === key)) issues.push({ block: key, message: 'not a block of this template; ignored' });
  }
  for (const block of manifest.blocks) {
    const raw = given[block.id];
    if (raw === undefined) {
      values[block.id] = block.layers.map((l) => ({ ...l }));
      continue;
    }
    if (!Array.isArray(raw)) {
      issues.push({ block: block.id, message: 'must be an array of layers; using the template\'s' });
      values[block.id] = block.layers.map((l) => ({ ...l }));
      continue;
    }
    const stack: Layer[] = [];
    const used = new Set<string>();
    let added = 0;
    const freshId = (): string => {
      let id: string;
      do id = `layer_${++added}`;
      while (used.has(id) || block.layers.some((l) => l.id === id));
      return id;
    };
    raw.forEach((entry, i) => {
      if (!isRecord(entry)) {
        issues.push({ block: block.id, message: `layer ${i} is not an object; dropped` });
        return;
      }
      const own = typeof entry.id === 'string' ? block.layers.find((l) => l.id === entry.id) : undefined;
      if (own && used.has(own.id)) {
        issues.push({ block: block.id, layer: own.id, message: 'appears twice; the second dropped' });
        return;
      }
      let base: Layer;
      if (own) {
        if (entry.type !== undefined && entry.type !== own.type) issues.push({ block: block.id, layer: own.id, message: `is a ${own.type} layer; its type cannot change` });
        base = own;
      } else {
        if (!oneOf(LAYER_TYPES, entry.type)) {
          issues.push({ block: block.id, message: `layer ${i} has no type (${LAYER_TYPES.join(', ')}); dropped` });
          return;
        }
        if (!block.open) {
          issues.push({ block: block.id, message: `is full: added ${entry.type} layer dropped` });
          return;
        }
        let id = typeof entry.id === 'string' && LAYER_ID_PATTERN.test(entry.id) && !used.has(entry.id) ? entry.id : '';
        if (id === '') {
          if (entry.id !== undefined) issues.push({ block: block.id, message: `layer ${i} has an unusable id; renamed` });
          id = freshId();
        }
        base = newLayer(entry.type, block, id);
      }
      const layer = sanitizeLayer(entry, base, block, (message) => issues.push({ block: block.id, layer: base.id, message }));
      used.add(layer.id);
      stack.push(layer);
    });
    // Required layers come back where the template had them.
    block.layers.forEach((own, index) => {
      if (!own.required || used.has(own.id)) return;
      issues.push({ block: block.id, layer: own.id, message: 'is required; put back' });
      stack.splice(Math.min(index, stack.length), 0, { ...own });
      used.add(own.id);
    });
    values[block.id] = stack;
  }
  return { values, issues };
}
