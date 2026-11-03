/**
 * Parameters by picking (milestone 55's second piece). A graphic composed on
 * the canvas is layer stacks, so a property someone wants to hand to the next
 * person — a line's words, a colour, a picture — already has one home: the
 * layer that draws it. An **exposure** is therefore pure metadata: a name
 * bound to one property of one layer, never a second copy of the value. The
 * Parameters tab shows the exposures as a form of their own, each control
 * editing the very layer it names, and saving the canvas as a template folder
 * (the milestone's fifth piece) will turn them into manifest parameters.
 *
 * Exposures ride under `@expose` in the same bag of raw values as the
 * parameters and the layer stacks, so they travel wherever those already do —
 * the undo history, presets, projects, collection cards — without a second
 * channel (the `@layers` rule, src/core/params.ts).
 */

import { sanitizeImageValue, type ImageValue } from './image-slot';
import type { Layer, LayerValues } from './layers';
import { isValidColor } from './manifest';

export const EXPOSE_KEY = '@expose';

/** What can be picked: a text layer's words, a text or shape layer's colour, an image layer's picture. */
export const EXPOSABLE_PROPS = ['text', 'color', 'image'] as const;
export type ExposableProp = (typeof EXPOSABLE_PROPS)[number];

/** Enough for any form a person would fill in; past it the template wants hand-written structure. */
export const MAX_EXPOSED = 40;

/** One picked property: the name it was given, and the layer property it is bound to. */
export interface ExposedParam {
  /** Identifier-shaped, unique in the list: what a manifest parameter id will be when the canvas is saved. */
  id: string;
  /** The name the person gave it, shown over its control and editable. */
  label: string;
  /** The binding: this property of this layer of this block. */
  block: string;
  layer: string;
  prop: ExposableProp;
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a stored list, keeping only whole, well-shaped entries with unique ids; anything else is left out. */
export function sanitizeExpose(raw: unknown): ExposedParam[] {
  if (!Array.isArray(raw)) return [];
  const out: ExposedParam[] = [];
  const taken = new Set<string>();
  for (const entry of raw) {
    if (out.length >= MAX_EXPOSED) break;
    if (!isRecord(entry)) continue;
    const { id, label, block, layer, prop } = entry;
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || taken.has(id)) continue;
    if (typeof label !== 'string' || label.trim() === '') continue;
    if (typeof block !== 'string' || block === '' || typeof layer !== 'string' || layer === '') continue;
    if (!(EXPOSABLE_PROPS as readonly unknown[]).includes(prop)) continue;
    taken.add(id);
    out.push({ id, label: label.trim(), block, layer, prop: prop as ExposableProp });
  }
  return out;
}

/** The exposures riding with a bag of raw values; [] when none were picked. */
export function exposeIn(raw: Record<string, unknown>): ExposedParam[] {
  return sanitizeExpose(raw[EXPOSE_KEY]);
}

/** The raw values with the exposures put in, or with them taken out when there are none. */
export function withExpose(params: Record<string, unknown>, expose: readonly ExposedParam[]): Record<string, unknown> {
  const out = { ...params };
  if (expose.length === 0) delete out[EXPOSE_KEY];
  else out[EXPOSE_KEY] = [...expose];
  return out;
}

/** Which of a layer's properties can be picked: words and colour on a line, colour on a shape, the picture on a still. */
export function exposableProps(layer: Pick<Layer, 'type'>): ExposableProp[] {
  if (layer.type === 'text') return ['text', 'color'];
  if (layer.type === 'shape') return ['color'];
  if (layer.type === 'image') return ['image'];
  return [];
}

/** What a picked property is called where it is offered and when it is first named. */
export const PROP_LABELS: Record<ExposableProp, string> = { text: 'Words', color: 'Colour', image: 'Picture' };

/** The name a fresh exposure starts with: "Line 1 words" — the person's to change. */
export function suggestedLabel(layerLabel: string, prop: ExposableProp): string {
  return `${layerLabel} ${PROP_LABELS[prop].toLowerCase()}`;
}

/** An identifier for a label — "Who it is" becomes who_it_is — kept unique against what is taken. */
export function exposeId(label: string, taken: ReadonlySet<string>): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'p$1') || 'parameter';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** The layer an exposure is bound to, as the stacks hold it now; undefined once it has gone or changed type. */
export function boundLayer(exposure: ExposedParam, layers: LayerValues): Layer | undefined {
  const layer = (layers[exposure.block] ?? []).find((l) => l.id === exposure.layer);
  if (!layer) return undefined;
  return exposableProps(layer).includes(exposure.prop) ? layer : undefined;
}

/** Only the exposures whose layer and property are still there to edit: what a form shows, what a save keeps. */
export function pruneExpose(expose: readonly ExposedParam[], layers: LayerValues): ExposedParam[] {
  return expose.filter((e) => boundLayer(e, layers) !== undefined);
}

/** An exposure's current value: the words, the colour, or the picture — read off the layer, never stored twice. */
export function exposedValue(exposure: ExposedParam, layers: LayerValues): string | ImageValue | null | undefined {
  const layer = boundLayer(exposure, layers);
  if (!layer) return undefined;
  if (exposure.prop === 'text' && layer.type === 'text') return layer.text;
  if (exposure.prop === 'color' && (layer.type === 'text' || layer.type === 'shape')) return layer.color;
  if (exposure.prop === 'image' && layer.type === 'image') return layer.image;
  return undefined;
}

/**
 * The stacks with an exposure's value set: the bound layer edited in place,
 * everything else untouched. A value the property cannot take — a colour that
 * is not one, words for a picture — changes nothing, so a caller can hand
 * anything through and trust the stacks.
 */
export function withExposedValue(exposure: ExposedParam, layers: LayerValues, value: unknown): LayerValues {
  const layer = boundLayer(exposure, layers);
  if (!layer) return layers;
  let changed: Layer | null = null;
  if (exposure.prop === 'text' && layer.type === 'text' && typeof value === 'string') changed = { ...layer, text: value };
  if (exposure.prop === 'color' && (layer.type === 'text' || layer.type === 'shape') && isValidColor(value)) {
    changed = { ...layer, color: (value as string).toLowerCase() };
  }
  if (exposure.prop === 'image' && layer.type === 'image') {
    const image = sanitizeImageValue(value);
    if (image !== undefined) changed = { ...layer, image };
  }
  if (!changed) return layers;
  return { ...layers, [exposure.block]: (layers[exposure.block] ?? []).map((l) => (l.id === exposure.layer ? changed! : l)) };
}
