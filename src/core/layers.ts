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
import { isValidColor, type TemplateManifest, type ValidationIssue } from './manifest';

export const LAYER_TYPES = ['text', 'image'] as const;
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
}

export interface TextLayer extends LayerBase, Typography {
  type: 'text';
  text: string;
  /** Lines a `wrap` layer may take before it is set smaller instead; 3 when it does not say. */
  maxLines: number;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  /** A library still with its treatment (milestone 22), or null: nothing chosen, nothing drawn, no room taken. */
  image: ImageValue | null;
  /** The picture's height as a fraction of the frame's short side; its width follows its shape, capped by the block. */
  size: number;
  align: LayerAlign;
}

export type Layer = TextLayer | ImageLayer;

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

/** The fields a layer of either type has, read against a base the same way as typography. */
function readLayerBase(raw: Record<string, unknown>, base: Pick<LayerBase, 'label' | 'hidden' | 'spaceBefore'>, issue: (field: string, message: string) => void): Pick<LayerBase, 'label' | 'hidden' | 'spaceBefore'> {
  const out = { ...base };
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
  const base: LayerBase = { id, label: label ?? (type === 'text' ? 'Text' : 'Image'), required: false, hidden: false, spaceBefore: 0 };
  if (type === 'text') return { ...base, ...block.typography, type: 'text', text: '', maxLines: DEFAULT_MAX_LINES };
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
  const common: LayerBase = { id, label: base.label, required: raw.required === true, hidden: base.hidden, spaceBefore: base.spaceBefore };
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
    if (raw.image !== undefined && raw.image !== null) issue('image', 'an image layer has no image of its own: leave it out or set it to null');
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
    layer = { ...common, type: 'image', image: null, size, align };
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
    return { ...base, ...common, ...typography, text, maxLines };
  }
  let image = base.image;
  if (raw.image !== undefined) {
    const value = sanitizeImageValue(raw.image);
    if (value === undefined) issue('image', 'must be a library id with an optional treatment, or null');
    else image = value;
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
  return { ...base, ...common, image, size, align };
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
