/**
 * Laying a block's layers out for one frame (milestone 23). The declarations
 * live in `src/core/layers.ts`; this is what they become at a pixel size: the
 * block's box, each layer's own box inside it, and for text the lines it breaks
 * into with a baseline each.
 *
 * Two halves, and they must agree:
 *
 * - `blockStates` turns the template's blocks and the chosen layers into the
 *   per-frame `state.blocks` the template is handed. Pure arithmetic, no text
 *   measurement, so the host can do it.
 * - `layoutBlock` finishes the job — wrapping, shrinking, stacking — and needs
 *   to measure text, so it takes a `measure` callback. The bridge script
 *   (`BRIDGE_SCRIPT` in src/core/runtime.ts) carries the same algorithm with
 *   the canvas as its measurer, the way `fitImage` and the bridge's `fitBox`
 *   already mirror each other: **change both or neither.** This copy is the one
 *   with unit tests, and the end-to-end pixel checks hold the bridge to it.
 *
 * Units: a layer's size, the gap and the space before a layer are fractions of
 * the frame's **short side**, so a design holds at every resolution and reads
 * the same wide, tall and square. Letter spacing is in em of the layer's own
 * size; line height is a multiple of it.
 */

import type { Size } from './aspect';
import { boxFor, fitImage, type ImageValue, type PxBox } from './image-slot';
import { DEFAULT_MAX_LINES, type Block, type ImageLayer, type Layer, type LayerValues, type TextCase, type TextLayer } from './layers';
import type { TemplateManifest } from './manifest';

/**
 * The line box a text layer occupies: ascent above the baseline, descent below,
 * one em together. A single-line layer is therefore exactly its own size tall,
 * which is what a designer means by "a 60 px line".
 */
export const ASCENT = 0.8;
export const DESCENT = 1 - ASCENT;

/** A wrapped layer that does not fit is tried again this much smaller, this many times. */
export const SHRINK_STEP = 0.92;
export const SHRINK_TRIES = 12;

interface LayerStateBase {
  id: string;
  label: string;
  /** Where it sits in the drawn stack; hidden layers are left out, so the stack closes up. */
  position: number;
  /** Room before this layer along the stack, in pixels of this frame. */
  spaceBefore: number;
  align: 'left' | 'center' | 'right';
}

export interface TextLayerState extends LayerStateBase {
  type: 'text';
  text: string;
  family: string;
  /** The declared size in pixels of this frame, before any shrinking to fit. */
  fontSize: number;
  weight: number;
  italic: boolean;
  case: TextCase;
  /** In em of the size, as declared. */
  letterSpacing: number;
  kerning: boolean;
  lineHeight: number;
  color: string;
  overflow: 'wrap' | 'shrink' | 'truncate';
  maxLines: number;
}

export interface ImageLayerState extends LayerStateBase {
  type: 'image';
  /** The chosen library still, or null: nothing is drawn and no room is taken. */
  image: ImageValue | null;
  /** The picture's height in pixels of this frame; its width follows its own shape. */
  size: number;
}

export type LayerState = TextLayerState | ImageLayerState;

/** One block, laid out as far as it can be without measuring text. */
export interface BlockState {
  id: string;
  label: string;
  /** The block's box in pixels of this frame. */
  box: PxBox;
  direction: 'column' | 'row';
  /** Between layers, in pixels of this frame. */
  gap: number;
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** The layers that are drawn, in stack order. */
  layers: LayerState[];
}

/** One line of a text layer, placed. */
export interface LaidLine {
  text: string;
  /** The baseline's y in pixels of this frame. */
  baseline: number;
  /** The left edge of the line, after its alignment. */
  x: number;
  width: number;
}

export type LaidLayer = (TextLayerState | ImageLayerState) & {
  /** Where the layer sits, in pixels of this frame. */
  box: PxBox;
  /** The size it is actually set at, after shrinking to fit; text only. */
  size?: number;
  lines?: LaidLine[];
  /** What the template asked for this layer, applied when it is drawn. */
  draw: LayerDraw;
};

export interface LaidBlock {
  id: string;
  box: PxBox;
  layers: LaidLayer[];
}

/** What a template may change about one layer for one frame: its motion, and the spacing the layout measures with. */
export interface LayerDraw {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  /** In em, replacing the layer's own for this frame; a template animating its tracking passes it here. */
  letterSpacing?: number;
}

export interface LayoutOptions {
  /** A box to lay the block out in instead of its own, for a template animating the block itself. */
  box?: PxBox;
  /** Per layer, by stack position: what it is drawn with. Anything left out keeps its own value. */
  each?: (layer: LayerState, position: number) => Partial<LayerDraw> | undefined;
}

/** Measures `text` at a font; the bridge hands the canvas's measurer, tests a stub. */
export type Measure = (text: string, font: { family: string; fontSize: number; weight: number; italic: boolean }) => number;

/** A picture's width over its height, or null when the layer has none to draw. */
export type ImageAspect = (layer: ImageLayerState) => number | null;

const DEFAULT_DRAW: LayerDraw = { alpha: 1, dx: 0, dy: 0, scale: 1 };

export function applyCase(text: string, how: TextCase): string {
  if (how === 'upper') return text.toUpperCase();
  if (how === 'lower') return text.toLowerCase();
  if (how === 'title') return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return text;
}

/** A layer's width at a size, with its letter spacing: measured per character when there is any, so drawing and measuring agree. */
export function textWidth(text: string, layer: TextLayerState, fontSize: number, spacingEm: number, measure: Measure): number {
  const font = { family: layer.family, fontSize, weight: layer.weight, italic: layer.italic };
  const spacing = spacingEm * fontSize;
  if (spacing === 0 && layer.kerning) return measure(text, font);
  let total = 0;
  for (let i = 0; i < text.length; i++) total += measure(text[i]!, font) + (i < text.length - 1 ? spacing : 0);
  return total;
}

/** Greedy word wrap; `ok` is false when a single word is wider than the room, which is what makes a layer shrink. */
function wrapWords(text: string, maxWidth: number, layer: TextLayerState, fontSize: number, spacingEm: number, measure: Measure): { lines: string[]; ok: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let ok = true;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || textWidth(candidate, layer, fontSize, spacingEm, measure) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
    if (textWidth(line, layer, fontSize, spacingEm, measure) > maxWidth) ok = false;
  }
  if (line) lines.push(line);
  return { lines, ok };
}

/**
 * The lines a text layer takes in the room it has, and the size it ends up at.
 * `wrap` breaks at the width and shrinks only when that is not enough (a word
 * too long, or more lines than it may take); `shrink` keeps one line and scales
 * it down to fit; `truncate` keeps one line and cuts it with an ellipsis.
 */
export function layoutTextLayer(layer: TextLayerState, maxWidth: number, spacingEm: number, measure: Measure): { size: number; lines: string[] } {
  const text = applyCase(layer.text, layer.case);
  if (text.trim() === '') return { size: layer.fontSize, lines: [] };
  if (layer.overflow === 'shrink') {
    const width = textWidth(text, layer, layer.fontSize, spacingEm, measure);
    const size = width > maxWidth && width > 0 ? (layer.fontSize * maxWidth) / width : layer.fontSize;
    return { size, lines: [text] };
  }
  if (layer.overflow === 'truncate') {
    if (textWidth(text, layer, layer.fontSize, spacingEm, measure) <= maxWidth) return { size: layer.fontSize, lines: [text] };
    let cut = text;
    while (cut.length > 0 && textWidth(`${cut}…`, layer, layer.fontSize, spacingEm, measure) > maxWidth) cut = cut.slice(0, -1);
    return { size: layer.fontSize, lines: [`${cut.trimEnd()}…`] };
  }
  let size = layer.fontSize;
  let wrapped = wrapWords(text, maxWidth, layer, size, spacingEm, measure);
  for (let tries = 1; tries < SHRINK_TRIES && !(wrapped.ok && wrapped.lines.length <= layer.maxLines); tries++) {
    size *= SHRINK_STEP;
    wrapped = wrapWords(text, maxWidth, layer, size, spacingEm, measure);
  }
  return { size, lines: wrapped.lines };
}

/** Where a line of `width` starts, inside a box of `boxWidth` at `boxX`. */
function alignedX(align: 'left' | 'center' | 'right', boxX: number, boxWidth: number, width: number): number {
  if (align === 'left') return boxX;
  if (align === 'right') return boxX + boxWidth - width;
  return boxX + (boxWidth - width) / 2;
}

/**
 * Lay a block out for one frame: every layer measured, wrapped or shrunk, then
 * stacked in order with the gaps and the space before each, and the whole stack
 * placed in the box by its alignment. The stack position a layer ends up at is
 * what a template animates by, so a layer added in the middle takes the
 * movement of the position it is in.
 *
 * A layer that draws nothing — empty text, an image not chosen — takes no room
 * and no gap, so the stack closes up around it exactly as a hidden one does.
 */
export function layoutBlock(block: BlockState, measure: Measure, imageAspect: ImageAspect, options: LayoutOptions = {}): LaidBlock {
  const box = options.box ?? block.box;
  const column = block.direction === 'column';

  // What each layer is: its text broken into lines at the size it ends up at, or its picture's
  // size. Measured once, then placed; `extent` is along the stack, `cross` across it.
  const measured = block.layers.map((layer, position) => {
    const draw: LayerDraw = { ...DEFAULT_DRAW, ...(options.each?.(layer, position) ?? {}) };
    if (layer.type === 'text') {
      const spacing = draw.letterSpacing ?? layer.letterSpacing;
      const { size, lines } = layoutTextLayer(layer, box.width, spacing, measure);
      const widths = lines.map((line) => textWidth(line, layer, size, spacing, measure));
      const height = lines.length === 0 ? 0 : (lines.length - 1) * size * layer.lineHeight + size;
      const width = widths.reduce((widest, w) => Math.max(widest, w), 0);
      return { layer, draw, size, lines, widths, width, height, extent: column ? height : width, cross: column ? width : height };
    }
    const aspect = layer.image === null ? null : imageAspect(layer);
    if (aspect === null) return { layer, draw, size: 0, lines: [], widths: [], width: 0, height: 0, extent: 0, cross: 0 };
    const height = layer.size;
    const width = Math.min(box.width, height * Math.max(0.01, aspect));
    const scaled = width / Math.max(0.01, aspect);
    return { layer, draw, size: 0, lines: [], widths: [], width, height: scaled, extent: column ? scaled : width, cross: column ? width : scaled };
  });

  let total = 0;
  let drawn = 0;
  for (const m of measured) {
    if (m.extent <= 0) continue;
    if (drawn > 0) total += block.gap;
    total += m.layer.spaceBefore + m.extent;
    drawn++;
  }

  // The stack is placed along its own direction — a column by the block's vertical alignment, a
  // row by its horizontal one — and each layer is placed across it by the other.
  const along = column ? box.height : box.width;
  const place = column ? block.verticalAlign : block.align;
  const offset = place === 'top' || place === 'left' ? 0 : place === 'bottom' || place === 'right' ? along - total : (along - total) / 2;
  let cursor = (column ? box.y : box.x) + offset;
  let placed = 0;
  const layers: LaidLayer[] = [];

  for (const m of measured) {
    const { layer, draw } = m;
    if (m.extent <= 0) {
      layers.push({ ...layer, box: { x: box.x, y: box.y, width: 0, height: 0 }, ...(layer.type === 'text' ? { size: m.size, lines: [] } : {}), draw });
      continue;
    }
    if (placed > 0) cursor += block.gap;
    cursor += layer.spaceBefore;
    const laidBox: PxBox = column
      ? { x: box.x, y: cursor, width: box.width, height: m.extent }
      : { x: cursor, y: crossStart(block.verticalAlign, box.y, box.height, m.cross), width: m.extent, height: m.cross };
    if (layer.type === 'text') {
      const step = m.size * layer.lineHeight;
      const lines: LaidLine[] = m.lines.map((text, i) => ({
        text,
        width: m.widths[i] ?? 0,
        x: alignedX(layer.align, laidBox.x, laidBox.width, m.widths[i] ?? 0),
        baseline: laidBox.y + i * step + ASCENT * m.size,
      }));
      layers.push({ ...layer, box: laidBox, size: m.size, lines, draw });
    } else {
      // The picture keeps its own shape inside the room the stack gave it.
      const width = m.width;
      layers.push({ ...layer, box: { x: alignedX(layer.align, laidBox.x, laidBox.width, width), y: laidBox.y, width, height: m.height }, draw });
    }
    cursor += m.extent;
    placed++;
  }
  return { id: block.id, box, layers };
}

/** Where a layer sits across a row, by the block's vertical alignment. */
function crossStart(verticalAlign: 'top' | 'middle' | 'bottom', boxY: number, boxHeight: number, extent: number): number {
  if (verticalAlign === 'top') return boxY;
  if (verticalAlign === 'bottom') return boxY + boxHeight - extent;
  return boxY + (boxHeight - extent) / 2;
}

/** The per-frame state for one block: its box and layers in pixels, hidden ones left out. */
export function blockState(block: Block, layers: readonly Layer[], size: Size): BlockState {
  const frac = boxFor(block.box, size);
  const short = Math.min(size.width, size.height);
  const drawn = layers.filter((l) => !l.hidden);
  return {
    id: block.id,
    label: block.label,
    box: { x: frac.x * size.width, y: frac.y * size.height, width: frac.width * size.width, height: frac.height * size.height },
    direction: block.direction,
    gap: block.gap * short,
    align: block.align,
    verticalAlign: block.verticalAlign,
    layers: drawn.map((layer, position) => layerState(layer, position, short)),
  };
}

function layerState(layer: Layer, position: number, short: number): LayerState {
  const base = { id: layer.id, label: layer.label, position, spaceBefore: layer.spaceBefore * short, align: layer.align ?? 'left' };
  if (layer.type === 'text') {
    const text = layer as TextLayer;
    return {
      ...base,
      type: 'text',
      text: text.text,
      family: text.family,
      fontSize: text.size * short,
      weight: text.weight,
      italic: text.italic,
      case: text.case,
      letterSpacing: text.letterSpacing,
      kerning: text.kerning,
      lineHeight: text.lineHeight,
      color: text.color,
      overflow: text.overflow,
      maxLines: text.maxLines ?? DEFAULT_MAX_LINES,
      align: text.align,
    };
  }
  const image = layer as ImageLayer;
  return { ...base, type: 'image', image: image.image, size: image.size * short, align: image.align };
}

/** Every block of a template, laid out as far as the host can take it. */
export function blockStates(manifest: Pick<TemplateManifest, 'blocks'>, layers: LayerValues, size: Size): Record<string, BlockState> {
  const out: Record<string, BlockState> = {};
  for (const block of manifest.blocks) out[block.id] = blockState(block, layers[block.id] ?? block.layers, size);
  return out;
}

/** Where a layer's picture lands inside the room the stack gave it: contained and centred, as an image slot. */
export function fitLayerImage(layer: LaidLayer, imageW: number, imageH: number): PxBox {
  return fitImage(layer.box, imageW, imageH, 'contain', 'center', 0);
}

/** The text of every text layer, by layer id: what an image slot's `fallbackText` reads when it names one. */
export function layerTexts(blocks: Record<string, BlockState>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of Object.values(blocks)) {
    for (const layer of block.layers) {
      if (layer.type === 'text' && out[layer.id] === undefined) out[layer.id] = layer.text;
    }
  }
  return out;
}

/** The images the blocks' layers have chosen, one entry per layer that has one. */
export function layerImageChoices(blocks: Record<string, BlockState>): ImageValue[] {
  const out: ImageValue[] = [];
  for (const block of Object.values(blocks)) {
    for (const layer of block.layers) {
      if (layer.type === 'image' && layer.image) out.push(layer.image);
    }
  }
  return out;
}

/** The library ids the blocks' image layers need, so the grant covers them like a slot's (ADR 0013). */
export function layerImageIds(blocks: Record<string, BlockState>): string[] {
  return [...new Set(layerImageChoices(blocks).map((image) => image.id))];
}
