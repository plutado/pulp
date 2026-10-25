/**
 * Image slots (milestone 22, ADR 0013): an `image` parameter is a box in a
 * template's layout that a chosen library still is drawn into, inside the
 * template's own animated layers, so a logo follows every move the graphic
 * makes. This module is the pure part: what a slot declares, what its value
 * looks like, where an image lands inside a box, and the per-frame slot state
 * the host hands the template. The bridge script carries the same placement
 * arithmetic (src/core/runtime.ts) so a template needs one call to draw a slot.
 */

import { aspectOf, type Size } from './aspect';
import { isValidColor, type ValidationIssue } from './manifest';

export const IMAGE_FITS = ['contain', 'cover'] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

export const IMAGE_ALIGNS = ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

/** How the image's colours are treated: as they are, tinted with one colour, or flattened to white or black for contrast. */
export const IMAGE_TREATMENTS = ['original', 'tinted', 'white', 'black'] as const;
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];

export const IMAGE_EFFECTS = ['none', 'shadow', 'glow'] as const;
export type ImageEffect = (typeof IMAGE_EFFECTS)[number];

/** A box as fractions of the frame: x and y from the top left, width and height of the frame. */
export interface SlotBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One box for every shape, or one per aspect id ("16:9") with an optional "default". */
export type SlotBoxes = SlotBox | Record<string, SlotBox>;

/**
 * The value an image parameter holds: which library still, how it is treated,
 * and whether the slot is drawn at all. `null` is "no image, and the slot
 * shows its fallback".
 *
 * **Hidden** is not the same as empty: nothing is drawn in the slot, not even
 * the fallback, and the chosen image is kept for when it is shown again. A
 * hidden slot therefore has a value even with no image (`id: null`), which is
 * the one case where a value carries no id.
 */
export interface ImageValue {
  /** Library item id (a 24-hex string), never a path; null only when the slot is hidden with nothing chosen. */
  id: string | null;
  treatment: ImageTreatment;
  /** The colour for the tinted treatment; `#rrggbb`. */
  tint: string;
  effect: ImageEffect;
  /** Kept, but not drawn: the slot stays empty and its fallback is not shown either. */
  hidden: boolean;
}

const ID_PATTERN = /^[0-9a-f]{24}$/;
export const DEFAULT_TINT = '#ffffff';

export function isSlotBox(value: unknown): value is SlotBox {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  const frac = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!frac(b.x) || !frac(b.y) || !frac(b.width) || !frac(b.height) || b.width <= 0 || b.height <= 0) return false;
  return b.x + b.width <= 1.0001 && b.y + b.height <= 1.0001;
}

/**
 * Validate a declared box, or one per aspect, reporting what is wrong at `path`.
 * Shared by image slots and by blocks (src/core/layers.ts), which place things the same way.
 */
export function validateSlotBoxes(box: unknown, path: string, errors: ValidationIssue[]): SlotBoxes | null {
  if (isSlotBox(box)) return box;
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObject(box) && Object.keys(box).length > 0 && Object.values(box).every(isObject)) {
    const start = errors.length;
    for (const [key, value] of Object.entries(box)) {
      if (key !== 'default' && !/^\d+:\d+$/.test(key)) errors.push({ path: `${path}.${key}`, message: 'must be an aspect id such as "16:9", or "default"' });
      if (!isSlotBox(value)) errors.push({ path: `${path}.${key}`, message: 'must be { x, y, width, height } as fractions of the frame, inside it' });
    }
    return errors.length === start ? (box as Record<string, SlotBox>) : null;
  }
  errors.push({ path, message: 'must be { x, y, width, height } as fractions of the frame, or one such box per aspect' });
  return null;
}

/**
 * Read an image value from untrusted input: a library id, or an object with
 * one. Returns null for "no image" (null, undefined, an empty string), and
 * undefined when the input is not usable.
 */
export function sanitizeImageValue(input: unknown): ImageValue | null | undefined {
  if (input === null || input === undefined || input === '') return null;
  // A string is an id, the word "hidden", or — from the command line and CSV, where everything is
  // text — a JSON object.
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (input.trim().toLowerCase() === 'hidden') return { id: null, treatment: 'original', tint: DEFAULT_TINT, effect: 'none', hidden: true };
    if (input.trim().startsWith('{')) {
      try {
        raw = JSON.parse(input);
      } catch {
        return undefined;
      }
    } else raw = { id: input.trim() };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && ID_PATTERN.test(r.id) ? r.id : null;
  const hidden = r.hidden === true;
  // Saying `id: null` is saying the slot is empty; an object with no usable id and nothing else to
  // say — no id at all, or one that is not an id — is input that cannot be used, and is reported.
  if (id === null && !hidden) return 'id' in r && r.id === null ? null : undefined;
  const treatment = (IMAGE_TREATMENTS as readonly string[]).includes(r.treatment as string) ? (r.treatment as ImageTreatment) : 'original';
  const tint = isValidColor(r.tint) ? r.tint.slice(0, 7).toLowerCase() : DEFAULT_TINT;
  const effect = (IMAGE_EFFECTS as readonly string[]).includes(r.effect as string) ? (r.effect as ImageEffect) : 'none';
  return { id, treatment, tint, effect, hidden };
}

/** The slot's box for a frame shape: the per-aspect one, the "default", or the single box. */
export function boxFor(boxes: SlotBoxes, size: Size): SlotBox {
  if (isSlotBox(boxes)) return boxes;
  const aspect = aspectOf(size.width, size.height);
  return boxes[aspect] ?? boxes.default ?? Object.values(boxes)[0] ?? { x: 0, y: 0, width: 1, height: 1 };
}

export interface PxBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where an image of `imageW` × `imageH` lands inside `box`: `contain` fits the
 * whole image, `cover` fills the box and crops; the margin is a fraction of the
 * box's shorter side kept clear on every edge; the alignment places a smaller
 * image within what is left. Mirrored in the bridge (BRIDGE_SCRIPT) so the two
 * cannot disagree: change both or neither.
 */
export function fitImage(box: PxBox, imageW: number, imageH: number, fit: ImageFit, align: ImageAlign, margin: number): PxBox {
  const inset = Math.max(0, Math.min(0.45, margin)) * Math.min(box.width, box.height);
  const innerW = Math.max(1, box.width - inset * 2);
  const innerH = Math.max(1, box.height - inset * 2);
  const scale = fit === 'cover' ? Math.max(innerW / imageW, innerH / imageH) : Math.min(innerW / imageW, innerH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  const ax = align.endsWith('left') || align === 'left' ? 0 : align.endsWith('right') || align === 'right' ? 1 : 0.5;
  const ay = align.startsWith('top') ? 0 : align.startsWith('bottom') ? 1 : 0.5;
  return { x: box.x + inset + (innerW - w) * ax, y: box.y + inset + (innerH - h) * ay, width: w, height: h };
}

/** What a template is told about one slot for one frame; the bridge adds the decoded picture. */
export interface ImageSlotState {
  /** The chosen image, or null when the slot is empty and the fallback applies. */
  id: string | null;
  treatment: ImageTreatment;
  tint: string;
  effect: ImageEffect;
  fit: ImageFit;
  align: ImageAlign;
  margin: number;
  /** The slot's box in pixels of this frame. */
  box: PxBox;
  /** The text the slot falls back to when no image is chosen, or null when it has none — or is hidden. */
  fallback: string | null;
  /** The slot is kept but not drawn: no image, no fallback, and the design closes the space up. */
  hidden: boolean;
}

/** The manifest fields this module reads, so it can take a validated parameter without importing the manifest types. */
export interface ImageSlotParam {
  id: string;
  type: 'image';
  box: SlotBoxes;
  fit: ImageFit;
  align: ImageAlign;
  margin: number;
  fallbackText?: string;
}

/**
 * Every image slot a template has, laid out for this frame size with the chosen
 * values. A slot's fallback text is a parameter's value or, where the piece's
 * words are layers, the text of the layer it names (`fallbackLayers`).
 */
export function imageSlots(
  parameters: readonly { id: string; type: string }[],
  values: Record<string, unknown>,
  size: Size,
  fallbackLayers: Readonly<Record<string, string>> = {},
): Record<string, ImageSlotState> {
  const slots: Record<string, ImageSlotState> = {};
  for (const param of parameters) {
    if (param.type !== 'image') continue;
    const p = param as ImageSlotParam;
    const value = sanitizeImageValue(values[p.id]) ?? null;
    const hidden = value?.hidden === true;
    const frac = boxFor(p.box, size);
    // Hidden means nothing is drawn there: no image to hand over, and no fallback to stand in for it.
    const fallbackRaw = hidden || !p.fallbackText ? undefined : values[p.fallbackText] ?? fallbackLayers[p.fallbackText];
    slots[p.id] = {
      id: hidden ? null : value?.id ?? null,
      treatment: value?.treatment ?? 'original',
      tint: value?.tint ?? DEFAULT_TINT,
      effect: value?.effect ?? 'none',
      fit: p.fit,
      align: p.align,
      margin: p.margin,
      box: { x: frac.x * size.width, y: frac.y * size.height, width: frac.width * size.width, height: frac.height * size.height },
      fallback: typeof fallbackRaw === 'string' ? fallbackRaw : null,
      hidden,
    };
  }
  return slots;
}

/** The images a frame set needs decoded: one per distinct id and treatment, which is what the bridge caches by. */
export interface ImageRequest {
  id: string;
  treatment: ImageTreatment;
  tint: string;
}

export function imageRequests(slots: Record<string, ImageSlotState>): ImageRequest[] {
  const out = new Map<string, ImageRequest>();
  for (const slot of Object.values(slots)) {
    if (!slot.id) continue;
    const key = imageRequestKey(slot);
    if (!out.has(key)) out.set(key, { id: slot.id, treatment: slot.treatment, tint: slot.tint });
  }
  return [...out.values()];
}

export function imageRequestKey(r: { id: string | null; treatment: ImageTreatment; tint: string }): string {
  return `${r.id ?? ''}|${r.treatment}|${r.treatment === 'tinted' ? r.tint : ''}`;
}

/** The library ids a set of slots needs access to: what the grant covers. */
export function chosenImageIds(slots: Record<string, ImageSlotState>): string[] {
  return [...new Set(Object.values(slots).map((s) => s.id).filter((id): id is string => id !== null))];
}

/** What a chosen image is, for the render cache: a replaced file under the same id renders afresh. */
export interface ImageStamp {
  id: string;
  size: number;
  mtimeMs: number;
}

/** The ids an image-slot value set names, in a stable order, for cache keys and grants. */
export function imageIdsIn(parameters: readonly { id: string; type: string }[], values: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const p of parameters) {
    if (p.type !== 'image') continue;
    const v = sanitizeImageValue(values[p.id]);
    if (v?.id && !v.hidden && !ids.includes(v.id)) ids.push(v.id);
  }
  return ids.sort();
}

/** A library still that a CSV cell may name by file: its name as the user sees it, and its id. */
export interface ImportedImage {
  name: string;
  id: string;
}

/**
 * A CSV cell for an image column: a library id or a JSON value is taken as is;
 * anything else is a file name, looked up among the Imported folder's stills
 * (case-insensitive, with or without the extension). Undefined when nothing
 * matches, so the caller can name the row.
 */
export function resolveImageCell(cell: unknown, imported: readonly ImportedImage[]): ImageValue | null | undefined {
  const direct = sanitizeImageValue(cell);
  if (direct !== undefined) return direct;
  if (typeof cell !== 'string') return undefined;
  const want = cell.trim().toLowerCase();
  const stem = want.replace(/\.[a-z0-9]+$/, '');
  const hit = imported.find((i) => {
    const name = i.name.toLowerCase();
    return name === want || name.replace(/\.[a-z0-9]+$/, '') === stem;
  });
  return hit ? { id: hit.id, treatment: 'original', tint: DEFAULT_TINT, effect: 'none', hidden: false } : undefined;
}

/**
 * Bounds on what a logo may be, so a user file cannot stall the first frame:
 * the file is refused above this size before anything is loaded, and the bridge
 * decodes into a bitmap no longer than MAX_BITMAP_SIDE on its long side.
 */
export const MAX_IMAGE_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_BITMAP_SIDE = 4096;
