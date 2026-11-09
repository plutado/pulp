/**
 * Lottie animations read as templates (milestone 35). Lottie is the animated
 * vector format After Effects exports through Bodymovin: a JSON document (or a
 * `.lottie` archive, a zip of one or more of them with their images) describing
 * shapes, text, images and their keyframes. It is motion graphics already made,
 * so Pulp reads it as an item that plays, renders and is edited like a
 * template rather than as a picture: the library makes a manifest from the
 * file — its size, frame rate and length — and its editable text and colors
 * become parameters, saved with the item like any other.
 *
 * The pure part: telling a Lottie JSON from any other, reading the document and
 * a `.lottie` archive, finding what the file exposes (its slots where it has
 * them, otherwise its text layers and fill colors), applying parameter values
 * to the document, naming what the player cannot draw, and the manifest.
 * The page that draws it is src/core/lottie-page.ts; the main process serves
 * both (src/main/lottie-service.ts, src/main/protocol.ts).
 *
 * The player is lottie-web (MIT), its "light" build: the SVG renderer without
 * expressions and effects, which is the build that runs without `eval` under
 * the template CSP. What that build leaves out is said on the item.
 */

import { ASPECT_IDS, aspectOf, MAX_DIMENSION, MIN_DIMENSION } from './aspect';
import { STRUCTURE_LIMITS, type TemplateStructure } from './timing';
import type { LottieBinding, LottieDocumentMeta, LottieFormat, LottieInfo, LottieMarker, LottieNote, LottiePath, LottieTarget, LottieTheme, LottieThemeRule } from './lottie-types';
import { SOURCE_TRANSLATOR, type MessageId, type Translator } from './i18n';
import { LOTTIE_FIT_PARAM, LOTTIE_THEME_PARAM } from './lottie-types';
import { validateManifest, type TemplateParameter, type ValidationResult } from './manifest';
import { typeInfo } from './taxonomy';
import { readZip } from './zip';

export const LOTTIE_EXTENSIONS: readonly string[] = ['.json', '.lottie'];

/** A file that might be a Lottie, by name: a `.lottie` is one by its extension; a `.json` has to look like one. */
export function isLottieCandidate(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.lottie') || lower.endsWith('.json');
}

/**
 * Does the head of a JSON file look like a Lottie? Bodymovin writes the frame
 * rate, in and out points and size first, before the (often large) assets and
 * layers, so the first few kilobytes are enough to tell a Lottie from a
 * settings file without parsing the whole thing. Mistakes cost nothing: a
 * candidate is still parsed and checked in full before it becomes an item.
 */
export function sniffLottieJson(head: string): boolean {
  const key = (k: string) => new RegExp(`"${k}"\\s*:`).test(head);
  return key('fr') && key('op') && key('w') && key('h') && (key('layers') || key('assets') || key('ip') || key('v'));
}

export type LottieData = Record<string, unknown>;

/**
 * What a Lottie file may say about itself that the format has no field for.
 * Lottie carries no license and no reliable author, so a file that wants to
 * state them does it under a key of its own — the same `x-` rule the template
 * manifest gives its extensions (docs/template-format.md). Every other tool
 * ignores it, and a file without one is read exactly as before: the license is
 * "not stated", which is the truth about most of them.
 *
 * Pulp's own starter set (src/core/lottie-starter.ts) writes it, which is how
 * twenty bundled animations say they are CC0.
 */
export interface LottieExtras {
  license?: string;
  author?: string;
}

const EXTRAS_KEY = 'x-pulp';

export function lottieExtras(data: LottieData): LottieExtras {
  const raw = data[EXTRAS_KEY];
  if (!isRecord(raw)) return {};
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  // Bodymovin's own `meta.a` is the nearest thing the format has to an author, so it stands in.
  const meta = isRecord(data.meta) ? data.meta : {};
  return { ...(text(raw.license) ? { license: text(raw.license) } : {}), ...(text(raw.author) ?? text(meta.a) ? { author: text(raw.author) ?? text(meta.a) } : {}) };
}

export interface LottieDocument extends LottieDocumentMeta {
  data: LottieData;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Read one Lottie JSON document; throws with a plain message when it is not one. */
export function parseLottie(text: string): LottieDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`not valid JSON: ${(err as Error).message}`, { cause: err }); // i18n-exempt(diagnostic)
  }
  return lottieDocument(raw);
}

/** The document from already-parsed JSON. */
export function lottieDocument(raw: unknown): LottieDocument {
  if (!isRecord(raw)) throw new Error('not a Lottie animation (the document is not an object)'); // i18n-exempt(diagnostic)
  if (!Array.isArray(raw.layers)) throw new Error('not a Lottie animation (no layers)'); // i18n-exempt(diagnostic)
  const fps = raw.fr;
  const ip = raw.ip ?? 0;
  const op = raw.op;
  const w = raw.w;
  const h = raw.h;
  if (!finite(fps) || fps <= 0 || fps > 240) throw new Error('an unusable frame rate ("fr")'); // i18n-exempt(diagnostic)
  if (!finite(ip) || !finite(op) || op <= ip) throw new Error('an unusable length ("ip" and "op")'); // i18n-exempt(diagnostic)
  if (!finite(w) || !finite(h) || w < MIN_DIMENSION || h < MIN_DIMENSION || w > MAX_DIMENSION || h > MAX_DIMENSION) {
    throw new Error(`an unusable size (${String(w)} × ${String(h)}; ${MIN_DIMENSION} to ${MAX_DIMENSION} pixels a side)`); // i18n-exempt(diagnostic)
  }
  const markers: LottieMarker[] = [];
  if (Array.isArray(raw.markers)) {
    for (const m of raw.markers) {
      if (!isRecord(m) || !finite(m.tm)) continue;
      const name = typeof m.cm === 'string' ? m.cm.trim() : '';
      markers.push({ name: name || `marker ${markers.length + 1}`, time: round3((m.tm - ip) / fps), duration: finite(m.dr) && m.dr > 0 ? round3(m.dr / fps) : 0 });
    }
  }
  return {
    data: raw,
    name: typeof raw.nm === 'string' && raw.nm.trim() ? raw.nm.trim() : undefined,
    version: typeof raw.v === 'string' ? raw.v : undefined,
    width: Math.round(w),
    height: Math.round(h),
    fps,
    inPoint: ip,
    outPoint: op,
    markers,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------- .lottie archives

export interface DotLottie {
  /** The first animation, which stands for the archive where one must. */
  document: LottieDocument;
  /** Every animation the archive holds, in the manifest's order: each becomes an item of its own (milestone 35). */
  animations: { id: string; document: LottieDocument }[];
  /** Pictures inside the archive by their file name (the part after the last slash). */
  images: Map<string, Buffer>;
  /** The archive's author, when its manifest says. */
  author?: string;
  /** The themes the archive carries, read in full: each a named set of slot values (milestone 35). */
  themes: LottieTheme[];
  /** What the archive carries that is not read: states, an unreadable animation or theme. */
  limits: LottieNote[];
}

/**
 * A theme file's rules as Lottie slot properties. The dotLottie theming format
 * is `{rules: [{id, type, value | keyframes, animations?}]}`: a static `value`
 * becomes `{a: 0, k: value}`, `keyframes` become `{a: 1, k: keyframes}`, and a
 * Gradient's stops are flattened the way Lottie writes gradient data. An older
 * theme file is a plain map of slot id to value, read the same way. Rules that
 * cannot be made into a property (Image) are skipped and counted.
 */
function themeRules(raw: unknown): { rules: LottieThemeRule[]; skipped: string[] } {
  const rules: LottieThemeRule[] = [];
  const skipped: string[] = [];
  const property = (rule: Record<string, unknown>): unknown | undefined => {
    if (Array.isArray(rule.keyframes) && rule.keyframes.length > 0) return { a: 1, k: rule.keyframes };
    if (rule.value === undefined) return undefined;
    if (rule.type === 'Gradient' && Array.isArray(rule.value)) {
      // Stops [{color: [r,g,b,a?], offset}] to Lottie's gradient data: [o,r,g,b]* then [o,a]* when any stop has alpha.
      const stops = rule.value.filter((s): s is Record<string, unknown> => isRecord(s) && Array.isArray(s.color) && typeof s.offset === 'number');
      if (stops.length === 0) return undefined;
      const flat = stops.flatMap((s) => [s.offset as number, ...(s.color as number[]).slice(0, 3)]);
      const withAlpha = stops.some((s) => (s.color as number[]).length === 4);
      const alphas = withAlpha ? stops.flatMap((s) => [s.offset as number, (s.color as number[])[3] ?? 1]) : [];
      return { p: stops.length, k: { a: 0, k: [...flat, ...alphas] } };
    }
    if (rule.type === 'Image') return undefined;
    return { a: 0, k: rule.value };
  };
  if (isRecord(raw) && Array.isArray(raw.rules)) {
    for (const rule of raw.rules) {
      if (!isRecord(rule) || typeof rule.id !== 'string') continue;
      const p = property(rule);
      if (p === undefined) {
        skipped.push(rule.id);
        continue;
      }
      const animations = Array.isArray(rule.animations) ? rule.animations.filter((a): a is string => typeof a === 'string') : undefined;
      rules.push({ sid: rule.id, p, ...(animations && animations.length > 0 ? { animations } : {}) });
    }
    return { rules, skipped };
  }
  if (isRecord(raw)) {
    // The older format: a map of slot id to a property, or to a bare value.
    for (const [sid, value] of Object.entries(raw)) {
      if (isRecord(value) && 'p' in value) rules.push({ sid, p: value.p });
      else if (value !== undefined) rules.push({ sid, p: { a: 0, k: value } });
    }
  }
  return { rules, skipped };
}

const fileName = (path: string): string => path.split('/').pop() ?? path;

/**
 * Read a `.lottie`: a zip whose `manifest.json` lists its animations, each a
 * Lottie JSON under `animations/` (or `a/` in the newer layout), with images
 * under `images/` (or `i/`) and themes under `themes/` (or `t/`). Every
 * animation is read — each becomes a library item of its own — and every
 * theme, each a named set of slot values a Theme parameter picks from
 * (milestone 35). One that cannot be read is skipped and named in the limits.
 */
export function readDotLottie(bytes: Buffer): DotLottie {
  const entries = readZip(bytes, { maxBytes: 256 * 1024 * 1024, maxEntries: 2000 });
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  let ids: string[] = [];
  let themeIds: string[] = [];
  let author: string | undefined;
  const limits: LottieNote[] = [];
  const manifestBytes = byName.get('manifest.json');
  if (manifestBytes) {
    try {
      const manifest = JSON.parse(manifestBytes.toString('utf8')) as unknown;
      if (isRecord(manifest)) {
        if (Array.isArray(manifest.animations)) {
          ids = manifest.animations.map((a) => (isRecord(a) && typeof a.id === 'string' ? a.id : '')).filter(Boolean);
        }
        if (Array.isArray(manifest.themes)) {
          themeIds = manifest.themes.map((t) => (isRecord(t) && typeof t.id === 'string' ? t.id : typeof t === 'string' ? t : '')).filter(Boolean);
        }
        if (typeof manifest.author === 'string' && manifest.author.trim()) author = manifest.author.trim();
        if ((Array.isArray(manifest.states) && manifest.states.length > 0) || entries.some((e) => /^(states|s)\//.test(e.name))) limits.push({ id: 'lottie.limit.states' });
      }
    } catch {
      limits.push({ id: 'lottie.limit.manifest' });
    }
  }
  const animationFile = (id: string): string | undefined => [`animations/${id}.json`, `a/${id}.json`].find((n) => byName.has(n));
  if (ids.length === 0) {
    // No manifest, or one that names nothing: every animation file there is, in archive order.
    ids = entries.filter((e) => /^(animations|a)\/[^/]+\.json$/.test(e.name)).map((e) => fileName(e.name).replace(/\.json$/, ''));
  }
  const animations: { id: string; document: LottieDocument }[] = [];
  for (const id of ids) {
    const file = animationFile(id);
    if (!file) continue;
    try {
      animations.push({ id, document: parseLottie(byName.get(file)!.toString('utf8')) });
    } catch {
      limits.push({ id: 'lottie.limit.animation-unread', values: { id } });
    }
  }
  if (animations.length === 0) throw new Error('not a dotLottie archive (no animation inside)'); // i18n-exempt(diagnostic)
  const images = new Map<string, Buffer>();
  for (const e of entries) {
    if (/^(images|i)\//.test(e.name)) images.set(fileName(e.name), e.data);
  }
  // Themes: the manifest's list, else every theme file there is.
  const themeFile = (id: string): string | undefined => [`themes/${id}.json`, `t/${id}.json`].find((n) => byName.has(n));
  if (themeIds.length === 0) {
    themeIds = entries.filter((e) => /^(themes|t)\/[^/]+\.json$/.test(e.name)).map((e) => fileName(e.name).replace(/\.json$/, ''));
  }
  const themes: LottieTheme[] = [];
  const skippedRules: string[] = [];
  for (const id of themeIds) {
    const file = themeFile(id);
    if (!file) continue;
    try {
      const read = themeRules(JSON.parse(byName.get(file)!.toString('utf8')));
      skippedRules.push(...read.skipped.map((sid) => `${id}: ${sid}`));
      if (read.rules.length > 0) themes.push({ id, rules: read.rules });
      else if (read.skipped.length === 0) limits.push({ id: 'lottie.limit.theme-unread', values: { id } });
    } catch {
      limits.push({ id: 'lottie.limit.theme-unread', values: { id } });
    }
  }
  if (skippedRules.length > 0) limits.push({ id: 'lottie.limit.theme-unsupported', values: { rules: skippedRules.join(', ') } });
  return { document: animations[0]!.document, animations, images, ...(author ? { author } : {}), themes, limits };
}

// ---------------------------------------------------------------- what the file exposes

export interface LottieEditables {
  parameters: TemplateParameter[];
  bindings: LottieBinding[];
  /** What was found but left alone, said on the item. */
  limits: LottieNote[];
}

/** A layer's name: the file's own, or Pulp's ("Layer 3") with the message it is said by. */
interface LayerName {
  name: string;
  note?: LottieNote;
}

/** What a color parameter is called, by what the color is: "{name} fill", "{name} text color". */
const COLOR_LABELS: Record<'fill' | 'stroke' | 'solid' | 'text', MessageId> = {
  fill: 'lottie.param.color.fill',
  stroke: 'lottie.param.color.stroke',
  solid: 'lottie.param.color.solid',
  text: 'lottie.param.color.text',
};

interface ColorUse {
  hex: string;
  /** The first place it was seen, for the label. */
  name: string;
  /** Set when that name is Pulp's own ("Layer 3"), so it can be said in another language. */
  nameNote?: LottieNote;
  what: 'fill' | 'stroke' | 'solid' | 'text';
  targets: LottieTarget[];
}

const GENERIC_NAME = /^(?:group|fill|stroke|shape(?: layer)?|rectangle|ellipse|polystar|path|layer|text(?: layer)?|solid|null|precomp|comp|composition|slot|colou?r)\s*\d*$/i;

function usefulName(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const trimmed = c.trim().replace(/\s+/g, ' ');
    if (trimmed && !GENERIC_NAME.test(trimmed)) return trimmed.length > 40 ? `${trimmed.slice(0, 39).trimEnd()}…` : trimmed;
  }
  return undefined;
}

/** A static color property's components in 0..1, or null for one that is animated, bound to a slot, or not a color. */
function staticColor(prop: unknown): number[] | null {
  if (!isRecord(prop) || typeof prop.sid === 'string') return null;
  if (prop.a === 1) return null;
  const k = prop.k;
  if (!Array.isArray(k) || (k.length !== 3 && k.length !== 4) || !k.every(finite)) return null;
  // Older exports wrote channels in 0..255.
  const over = k.some((v) => v > 1);
  return k.map((v) => Math.max(0, Math.min(1, over ? v / 255 : v)));
}

const toHex = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');

/** `#rrggbb` of components in 0..1. */
export function rgbHex(components: readonly number[]): string {
  return `#${toHex(components[0] ?? 0)}${toHex(components[1] ?? 0)}${toHex(components[2] ?? 0)}`;
}

/** Components in 0..1 of a `#rrggbb` or `#rrggbbaa`, or null. */
export function hexComponents(hex: unknown): { r: number; g: number; b: number; a: number; hex: string } | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1, hex: `#${m[1]!.toLowerCase()}` };
}

/** The text document of a static text property (one keyframe), with where its string lives; null otherwise. */
function staticTextDoc(prop: unknown, at: LottiePath): { doc: Record<string, unknown>; path: LottiePath } | null {
  if (!isRecord(prop) || typeof prop.sid === 'string') return null;
  const k = prop.k;
  if (!Array.isArray(k) || k.length !== 1 || !isRecord(k[0]) || !isRecord(k[0].s) || typeof k[0].s.t !== 'string') return null;
  return { doc: k[0].s, path: [...at, 'k', 0, 's', 't'] };
}

/**
 * The text and colors a file exposes: its slots where it has them, and its
 * static text layers and fill, stroke, solid and text colors. Each distinct
 * color is one parameter, however many shapes use it, so a palette stays a
 * palette. Text and colors bound to slots are reached through the slot only.
 */
export function lottieEditables(data: LottieData): LottieEditables {
  const parameters: TemplateParameter[] = [];
  const bindings: LottieBinding[] = [];
  const limits: LottieNote[] = [];
  const colours: ColorUse[] = [];
  const texts: { element: string; elementNote?: LottieNote; value: string; target: LottieTarget }[] = [];
  const animatedTexts: string[] = [];

  const addColour = (components: number[], target: LottieTarget, name: string, what: ColorUse['what'], nameNote?: LottieNote): void => {
    const hex = rgbHex(components);
    const existing = colours.find((c) => c.hex === hex);
    if (existing) existing.targets.push(target);
    else colours.push({ hex, name, ...(nameNote ? { nameNote } : {}), what, targets: [target] });
  };

  // Slots first (Lottie 1.0 theming): what the author chose to expose.
  if (isRecord(data.slots)) {
    for (const [sid, slot] of Object.entries(data.slots)) {
      if (!isRecord(slot) || !isRecord(slot.p)) continue;
      const at: LottiePath = ['slots', sid, 'p'];
      const label = usefulName(sid) ?? sid;
      const text = staticTextDoc(slot.p, at);
      if (text) {
        texts.push({ element: label, value: String(text.doc.t).replace(/\r/g, '\n'), target: { kind: 'text', path: text.path } });
        continue;
      }
      const colour = staticColor(slot.p);
      if (colour) addColour(colour, { kind: colour.length === 4 ? 'rgba' : 'rgb', path: [...at, 'k'] }, label, 'fill');
    }
  }

  const walkShapes = (shapes: unknown, at: LottiePath, layerName: LayerName, groupName: string | undefined): void => {
    if (!Array.isArray(shapes)) return;
    shapes.forEach((shape, i) => {
      if (!isRecord(shape)) return;
      const here: LottiePath = [...at, i];
      if (shape.ty === 'gr') {
        walkShapes(shape.it, [...here, 'it'], layerName, usefulName(shape.nm) ?? groupName);
        return;
      }
      if (shape.ty !== 'fl' && shape.ty !== 'st') return;
      const colour = staticColor(shape.c);
      if (!colour) return;
      const own = usefulName(shape.nm) ?? groupName;
      addColour(colour, { kind: colour.length === 4 ? 'rgba' : 'rgb', path: [...here, 'c', 'k'] }, own ?? layerName.name, shape.ty === 'fl' ? 'fill' : 'stroke', own ? undefined : layerName.note);
    });
  };

  const walkLayers = (layers: unknown, at: LottiePath): void => {
    if (!Array.isArray(layers)) return;
    layers.forEach((layer, i) => {
      if (!isRecord(layer)) return;
      const here: LottiePath = [...at, i];
      // A layer the file leaves unnamed is named by Pulp, in Pulp's words.
      const own = usefulName(layer.nm);
      const note: LottieNote | undefined = own ? undefined : { id: 'lottie.layer', values: { n: i + 1 } };
      const layerName: LayerName = { name: own ?? SOURCE_TRANSLATOR(note!.id, note!.values), ...(note ? { note } : {}) };
      if (layer.ty === 5 && isRecord(layer.t)) {
        const text = staticTextDoc(layer.t.d, [...here, 't', 'd']);
        if (text) {
          texts.push({ element: layerName.name, ...(layerName.note ? { elementNote: layerName.note } : {}), value: String(text.doc.t).replace(/\r/g, '\n'), target: { kind: 'text', path: text.path } });
          const fill = text.doc.fc;
          if (Array.isArray(fill) && (fill.length === 3 || fill.length === 4) && fill.every(finite)) {
            addColour(fill.map((v) => Math.max(0, Math.min(1, v))), { kind: fill.length === 4 ? 'rgba' : 'rgb', path: [...text.path.slice(0, -1), 'fc'] }, layerName.name, 'text', layerName.note);
          }
        } else if (isRecord(layer.t.d) && Array.isArray(layer.t.d.k) && layer.t.d.k.length > 1) {
          animatedTexts.push(layerName.name);
        }
        return;
      }
      if (layer.ty === 1 && typeof layer.sc === 'string') {
        const c = hexComponents(layer.sc);
        if (c) addColour([c.r, c.g, c.b], { kind: 'hex', path: [...here, 'sc'] }, layerName.name, 'solid', layerName.note);
        return;
      }
      if (layer.ty === 4) walkShapes(layer.shapes, [...here, 'shapes'], layerName, undefined);
    });
  };

  walkLayers(data.layers, ['layers']);
  if (Array.isArray(data.assets)) {
    data.assets.forEach((asset, i) => {
      if (isRecord(asset) && Array.isArray(asset.layers)) walkLayers(asset.layers, ['assets', i, 'layers']);
    });
  }

  // Fonts the file names but does not carry (milestone 35's last item): each becomes a font
  // parameter, so the text set in it can be put in any family — a bundled one, an import, or
  // whatever is installed. A file that carries its letters as glyph outlines (`chars`) draws
  // them whatever the family says, so there is nothing to pick there.
  const fonts: { name: string; target: LottieTarget }[] = [];
  if (!Array.isArray(data.chars) && isRecord(data.fonts) && Array.isArray(data.fonts.list)) {
    data.fonts.list.forEach((font, i) => {
      if (!isRecord(font)) return;
      const family = typeof font.fFamily === 'string' && font.fFamily.trim() ? font.fFamily.trim() : typeof font.fName === 'string' ? font.fName.trim() : '';
      if (!family) return;
      fonts.push({ name: family, target: { kind: 'font', path: ['fonts', 'list', i, 'fFamily'] } });
    });
  }

  texts.forEach((t, i) => {
    const id = `text${i + 1}`;
    const label: LottieNote = { id: 'lottie.param.text' };
    parameters.push({ id, type: 'text', label: SOURCE_TRANSLATOR(label.id), element: t.element, default: t.value, ...(t.value.includes('\n') ? { multiline: true } : {}) });
    bindings.push({ id, type: 'text', targets: [t.target], label, ...(t.elementNote ? { element: t.elementNote } : {}) });
  });
  colours.forEach((c, i) => {
    const id = `color${i + 1}`;
    const others = c.targets.length - 1;
    // The name is the file's (a layer or a shape); what it colors, and the sentence around it, are Pulp's.
    const label: LottieNote = { id: COLOR_LABELS[c.what], values: { name: c.name } };
    const element: LottieNote = { id: 'lottie.element.colors' };
    const description: LottieNote | undefined = others > 0 ? { id: 'lottie.param.color.also', values: { count: others } } : undefined;
    parameters.push({
      id,
      type: 'color',
      label: SOURCE_TRANSLATOR(label.id, label.values),
      element: SOURCE_TRANSLATOR(element.id),
      default: c.hex,
      ...(description ? { description: SOURCE_TRANSLATOR(description.id, description.values) } : {}),
    });
    bindings.push({ id, type: 'color', targets: c.targets, label, element, ...(description ? { description } : {}), ...(c.nameNote ? { nameNote: c.nameNote } : {}) });
  });
  fonts.forEach((f, i) => {
    const id = `font${i + 1}`;
    const label: LottieNote = { id: 'lottie.param.font' };
    const element: LottieNote = { id: 'lottie.element.fonts' };
    const description: LottieNote = { id: 'lottie.param.font.description', values: { name: f.name } };
    parameters.push({ id, type: 'font', label: SOURCE_TRANSLATOR(label.id), element: SOURCE_TRANSLATOR(element.id), description: SOURCE_TRANSLATOR(description.id, description.values), default: f.name });
    bindings.push({ id, type: 'font', targets: [f.target], label, element, description });
  });
  if (animatedTexts.length > 0) limits.push({ id: 'lottie.limit.animated-text', values: { layers: animatedTexts.join(', ') } });
  return { parameters, bindings, limits };
}

/** The Theme setting a dotLottie with themes gets: one of the looks the file carries, or the file as it is. */
export function lottieThemeParameter(themes: readonly LottieTheme[], t: Translator = SOURCE_TRANSLATOR): TemplateParameter {
  return {
    id: LOTTIE_THEME_PARAM,
    type: 'select',
    label: t('lottie.theme'),
    element: t('lottie.element.colors'),
    description: t('lottie.theme.description'),
    default: '',
    options: [
      { value: '', label: t('lottie.theme.none') },
      // A theme's id is the file's own word, like a layer's name: shown as it is, tidied for reading.
      ...themes.map((theme) => ({ value: theme.id, label: humanizeFileName(theme.id) })),
    ],
  };
}

/** The Fit setting every Lottie gets: how it sits in a frame of another shape or size, in a language. */
export function lottieFitParameter(t: Translator = SOURCE_TRANSLATOR): TemplateParameter {
  return {
    id: LOTTIE_FIT_PARAM,
    type: 'select',
    label: t('lottie.fit'),
    element: t('lottie.element.frame'),
    description: t('lottie.fit.description'),
    default: 'fit',
    options: [
      { value: 'fit', label: t('lottie.fit.fit') },
      { value: 'fill', label: t('lottie.fit.fill') },
      { value: 'center', label: t('lottie.fit.center') },
    ],
  };
}

// ---------------------------------------------------------------- applying values

function setAt(root: unknown, path: LottiePath, value: unknown): void {
  let o: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (o === null || typeof o !== 'object') return;
    o = (o as Record<string | number, unknown>)[path[i]!];
  }
  if (o !== null && typeof o === 'object') (o as Record<string | number, unknown>)[path[path.length - 1]!] = value;
}

export interface ApplyLottieOptions {
  /** The themes a dotLottie carries; `params.theme` picks one by id (milestone 35). */
  themes?: readonly LottieTheme[];
  /** Which animation of the archive this is, for theme rules scoped to some animations. */
  animation?: string;
  /**
   * Each parameter's default. With a theme chosen, a parameter still at its
   * default is left to the theme — writing the default back would undo the
   * theme with the same color it replaced — and one a person changed wins.
   */
  defaults?: Record<string, unknown>;
}

/**
 * The document with the chosen theme and the parameter values written in: a
 * deep copy, the original untouched. The theme goes first — each rule is a
 * slot's new value — and then the parameters over it. Mirrors `applied` in the
 * page script (src/core/lottie-page.ts): change both or neither. Text uses
 * Lottie's `\r` line breaks; a color's alpha goes only where the file kept
 * four components; a font is a family name in the file's font list.
 */
export function applyLottieParams(data: LottieData, bindings: readonly LottieBinding[], params: Record<string, unknown>, options: ApplyLottieOptions = {}): LottieData {
  const copy = JSON.parse(JSON.stringify(data)) as LottieData;
  const chosen = typeof params[LOTTIE_THEME_PARAM] === 'string' ? (options.themes ?? []).find((t) => t.id === params[LOTTIE_THEME_PARAM]) : undefined;
  if (chosen) {
    for (const rule of chosen.rules) {
      if (rule.animations && options.animation !== undefined && !rule.animations.includes(options.animation)) continue;
      setAt(copy, ['slots', rule.sid, 'p'], JSON.parse(JSON.stringify(rule.p)));
    }
  }
  for (const b of bindings) {
    const v = params[b.id];
    if (v === undefined || v === null) continue;
    if (chosen && options.defaults && v === options.defaults[b.id]) continue;
    for (const t of b.targets) {
      if (t.kind === 'text' || t.kind === 'font') {
        setAt(copy, t.path, t.kind === 'font' ? String(v) : String(v).replace(/\r\n|\n/g, '\r'));
        continue;
      }
      const c = hexComponents(v);
      if (!c) continue;
      if (t.kind === 'hex') setAt(copy, t.path, c.hex);
      else if (t.kind === 'rgb') setAt(copy, t.path, [c.r, c.g, c.b]);
      else setAt(copy, t.path, [c.r, c.g, c.b, c.a]);
    }
  }
  return copy;
}

/**
 * The document as the page is handed it: fonts the file would fetch from the
 * web are turned into plain family names, since the template CSP blocks the
 * fetch anyway and the player would otherwise wait five seconds for each
 * before drawing. The family name stays, so an installed font of that name is
 * used and the fallback is the browser's.
 */
export function prepareLottieData(data: LottieData): LottieData {
  const copy = JSON.parse(JSON.stringify(data)) as LottieData;
  if (isRecord(copy.fonts) && Array.isArray(copy.fonts.list)) {
    for (const font of copy.fonts.list) {
      if (!isRecord(font)) continue;
      if (isWebPath(font.fPath) || font.origin === 1 || font.origin === 2 || font.origin === 3) {
        font.fPath = '';
        font.origin = 0;
        delete font.fOrigin;
      }
    }
  }
  return copy;
}

const isWebPath = (v: unknown): boolean => typeof v === 'string' && /^(?:https?:)?\/\//i.test(v);

// ---------------------------------------------------------------- limits

/** Features of the file the player cannot draw, each named once. */
export function lottieLimits(data: LottieData): LottieNote[] {
  const limits: LottieNote[] = [];
  let expressions = 0;
  let effects = 0;
  let threeD = false;
  let cameras = 0;
  let audio = 0;
  const walk = (node: unknown, inLayer: boolean): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, inLayer);
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.x === 'string' && node.x.trim() !== '' && ('k' in node || 'a' in node)) expressions += 1;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'ef' && Array.isArray(value) && value.length > 0 && inLayer) effects += 1;
      walk(value, inLayer || key === 'layers');
    }
  };
  const layersOf = (layers: unknown): void => {
    if (!Array.isArray(layers)) return;
    for (const layer of layers) {
      if (!isRecord(layer)) continue;
      if (layer.ddd === 1) threeD = true;
      if (layer.ty === 13) cameras += 1;
      if (layer.ty === 6) audio += 1;
    }
  };
  walk(data, false);
  layersOf(data.layers);
  if (Array.isArray(data.assets)) for (const a of data.assets) if (isRecord(a)) layersOf(a.layers);
  if (expressions > 0) limits.push({ id: 'lottie.limit.expressions', values: { count: expressions } });
  if (effects > 0) limits.push({ id: 'lottie.limit.effects', values: { count: effects } });
  if (threeD || cameras > 0) limits.push({ id: 'lottie.limit.three-d' });
  if (audio > 0) limits.push({ id: 'lottie.limit.audio', values: { count: audio } });
  if (isRecord(data.fonts) && Array.isArray(data.fonts.list)) {
    const web = data.fonts.list.filter((f) => isRecord(f) && (isWebPath(f.fPath) || f.origin === 1 || f.origin === 2 || f.origin === 3)).map((f) => String((f as Record<string, unknown>).fFamily ?? (f as Record<string, unknown>).fName ?? 'a font'));
    if (web.length > 0) limits.push({ id: 'lottie.limit.web-fonts', values: { fonts: [...new Set(web)].join(', ') } });
  }
  if (Array.isArray(data.assets)) {
    const web = data.assets.filter((a) => isRecord(a) && typeof a.p === 'string' && a.e !== 1 && (isWebPath(a.u) || isWebPath(a.p)));
    if (web.length > 0) limits.push({ id: 'lottie.limit.web-pictures', values: { count: web.length } });
  }
  return limits;
}

/** The files beside a `.json` Lottie (or inside a `.lottie`) that its image assets name, as the page will ask for them. */
export function lottieAssetPaths(data: LottieData): string[] {
  const out: string[] = [];
  if (!Array.isArray(data.assets)) return out;
  for (const a of data.assets) {
    if (!isRecord(a) || typeof a.p !== 'string' || a.e === 1 || /^data:/i.test(a.p)) continue;
    const u = typeof a.u === 'string' ? a.u : '';
    if (isWebPath(u) || isWebPath(a.p)) continue;
    const joined = `${u}${a.p}`.replace(/^(?:\.\/|\/)+/, '').replace(/\/{2,}/g, '/');
    if (joined && !out.includes(joined)) out.push(joined);
  }
  return out;
}

// ---------------------------------------------------------------- timing from markers

/**
 * What a marker's name says it is. Bodymovin carries whatever the animator
 * typed in the composition, so the names are matched forgivingly — case and
 * surrounding space never matter, and the words people actually use for each
 * part are all accepted.
 */
const MARKER_WORDS: Record<'intro' | 'loop' | 'outro', readonly string[]> = {
  intro: ['intro', 'in', 'entrance', 'enter', 'start', 'begin'],
  loop: ['loop', 'hold', 'middle', 'idle', 'sustain'],
  outro: ['outro', 'out', 'exit', 'leave', 'end', 'finish'],
};

/** Which part a marker names, or null when it names something else. */
export function markerPart(name: string): 'intro' | 'loop' | 'outro' | null {
  const word = name.trim().toLowerCase().replace(/[^a-z]+/g, '');
  for (const [part, words] of Object.entries(MARKER_WORDS) as ['intro' | 'loop' | 'outro', readonly string[]][]) {
    if (words.includes(word)) return part;
  }
  return null;
}

/**
 * The structure a Lottie's markers describe (milestone 35), in milestone 30's
 * terms, so an animation stretches to any length the way a template does.
 *
 * A marker for the loop or hold says it outright: the entrance runs to where
 * it starts, the exit from where it ends. Markers for the intro and the outro
 * say the same thing from the other side. A lone loop marker spanning the
 * whole animation — or one named loop with no duration at all — says the
 * graphic repeats rather than holds. Anything else is no structure: the
 * animation plays at its own length, which is what every Lottie did before.
 *
 * Returns null rather than a problem: a file's markers are the animator's
 * business, and ones Pulp cannot read are simply not a structure.
 */
export function lottieStructure(markers: readonly LottieMarker[], duration: number): TemplateStructure | null {
  if (duration <= 0) return null;
  const named = markers.map((m) => ({ ...m, part: markerPart(m.name) }));
  const loop = named.find((m) => m.part === 'loop');
  const intro = named.find((m) => m.part === 'intro');
  const outro = named.find((m) => m.part === 'outro');

  // A loop marker that covers the whole animation says it repeats; so does one with no span,
  // which is how a point marker names a graphic that simply goes round.
  if (loop && !intro && !outro) {
    const covers = loop.duration <= 0 || loop.time <= TIMING_SLACK && loop.time + loop.duration >= duration - TIMING_SLACK;
    if (covers) return { kind: 'loop' };
  }

  // Where the hold begins and ends, from whichever markers said so.
  const holdFrom = loop && loop.duration > 0 ? loop.time : intro ? intro.time + intro.duration : null;
  const holdTo = loop && loop.duration > 0 ? loop.time + loop.duration : outro ? outro.time : null;
  if (holdFrom === null || holdTo === null) return null;
  const from = Math.max(0, Math.min(duration, round3(holdFrom)));
  const to = Math.max(0, Math.min(duration, round3(holdTo)));
  // The parts must be in order and leave a hold worth stretching; markers that do not are
  // the animator's own business and simply do not make a structure.
  if (to - from < STRUCTURE_LIMITS.minHold) return null;
  return { kind: 'hold', holdFrom: from, holdTo: to };
}

/** How near an edge counts as being at it: a marker is placed by hand, to the frame at best. */
const TIMING_SLACK = 0.05;

// ---------------------------------------------------------------- the manifest

export interface LottieManifestInput {
  /** The library's id for the item; the manifest id is made from it. */
  id: string;
  name: string;
  format: LottieFormat;
  /** The themes a dotLottie carries: a Theme parameter picks one (milestone 35). */
  dotLottieThemes?: LottieTheme[];
  /** A built-in type the folders named, if any. */
  type?: string;
  themes?: string[];
  tags?: string[];
  author?: string;
  /** What the file said about itself under its own key, where it said anything (`lottieExtras`). */
  extras?: LottieExtras;
  editables: LottieEditables;
  limits: LottieNote[];
}

/** The manifest id a Lottie item gets from its library id: a valid template id and URL host. */
export function lottieManifestId(libraryId: string): string {
  return `lottie-${libraryId}`;
}

/** A template type to the manifest category that stands for it; "other" when none does. */
export function categoryForType(type: string | undefined): string {
  if (!type) return 'other';
  if (type === 'lower-third') return 'lower-third';
  if (type === 'animated-loop') return 'background';
  const group = typeInfo(type)?.group;
  if (group === 'titles') return 'title';
  if (group === 'transitions') return 'transition';
  if (group === 'overlays') return 'overlay';
  return 'other';
}

/** A structure as a manifest writes it, for the validator to read back (src/core/timing.ts). */
function structureManifest(structure: TemplateStructure): Record<string, unknown> {
  if (structure.kind === 'loop') return { loop: true };
  if (structure.kind === 'scale') return { scale: true };
  return { holdFrom: structure.holdFrom, holdTo: structure.holdTo };
}

const even = (n: number): number => (n % 2 === 0 ? n : n + 1);

/** A file name as a title: "my-lower_third.json" reads "My lower third". */
export function humanizeFileName(name: string): string {
  const stem = name.replace(/\.(json|lottie)$/i, '').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stem) return SOURCE_TRANSLATOR('lottie.name.untitled');
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * What Pulp says about a Lottie file, in a language: its kind, size, length and rate, its markers,
 * whether they let it stretch, and what the player cannot draw. Made from what the scan records
 * (LottieInfo), so the window can say it again in whatever language it is in.
 */
export function lottieDescription(
  doc: Pick<LottieInfo, 'format' | 'width' | 'height' | 'fps' | 'inPoint' | 'outPoint' | 'markers'>,
  limits: readonly LottieNote[],
  t: Translator,
): string {
  const frames = doc.outPoint - doc.inPoint;
  const stretches = lottieStructure(doc.markers, round3(frames / doc.fps));
  const size = { width: doc.width, height: doc.height, frames, fps: doc.fps };
  return [
    t(doc.format === 'lottie' ? 'lottie.description.archive' : 'lottie.description.animation', size),
    ...(doc.markers.length > 0 ? [t('lottie.description.markers', { markers: doc.markers.map((m) => m.name).join(t('lottie.list.separator')) })] : []),
    ...(stretches ? [t(stretches.kind === 'loop' ? 'lottie.description.loops' : 'lottie.description.holds')] : []),
    ...(limits.length > 0 ? [t('lottie.description.not-drawn', { limits: lottieLimitsText(limits, t) })] : []),
  ].join(t('lottie.description.separator'));
}

/** What the player cannot draw, as one list in a language. */
export function lottieLimitsText(limits: readonly LottieNote[], t: Translator): string {
  return limits.map((l) => t(l.id, l.values)).join(t('lottie.limits.separator'));
}

/**
 * The manifest a Lottie file is read into, validated like any other: the file's
 * own size (rounded up to even, as encoders need) as the default resolution,
 * every built-in aspect declared so the animation can be fitted, filled or
 * centered in any frame, its frame rate and length, transparent, and its
 * editable text and colors as parameters with the Fit setting.
 */
export function lottieManifest(doc: LottieDocumentMeta, input: LottieManifestInput): ValidationResult {
  const width = even(doc.width);
  const height = even(doc.height);
  const own = aspectOf(width, height);
  const frames = doc.outPoint - doc.inPoint;
  const description = lottieDescription({ ...doc, format: input.format }, input.limits, SOURCE_TRANSLATOR);
  // What its markers say may stretch (milestone 35), in milestone 30's terms: an icon with an
  // intro and an outro holds between them, a seamless one loops, and one that says nothing keeps
  // the length it was drawn at.
  const structure = lottieStructure(doc.markers, round3(frames / doc.fps));
  const raw: Record<string, unknown> = {
    formatVersion: 1,
    id: lottieManifestId(input.id),
    name: input.name,
    description,
    version: doc.version && /^\d+\.\d+\.\d+$/.test(doc.version) ? doc.version : '1.0.0',
    ...(input.extras?.author ?? input.author ? { author: input.extras?.author ?? input.author } : {}),
    // The format carries no license, so a file that does not say under its own key is "not
    // stated" — the truth, which the Info tab shows rather than a guess.
    license: input.extras?.license ?? 'not stated',
    category: categoryForType(input.type),
    ...(input.type ? { type: input.type } : {}),
    ...(input.themes && input.themes.length > 0 ? { themes: input.themes } : {}),
    tags: [...new Set(['lottie', ...(input.tags ?? [])])],
    duration: round3(frames / doc.fps),
    ...(structure ? { structure: structureManifest(structure) } : {}),
    fps: doc.fps,
    width,
    height,
    aspects: [own, ...ASPECT_IDS.filter((a) => a !== own)],
    alpha: true,
    entry: 'index.html',
    parameters: [
      ...input.editables.parameters,
      ...(input.dotLottieThemes && input.dotLottieThemes.length > 0 ? [lottieThemeParameter(input.dotLottieThemes)] : []),
      lottieFitParameter(),
    ],
  };
  return validateManifest(raw);
}

/** Everything the library keeps about the file beside its manifest. */
export function lottieInfo(
  doc: LottieDocumentMeta,
  path: string,
  format: LottieFormat,
  bindings: LottieBinding[],
  limits: LottieNote[],
  animations?: string[],
  options: { animation?: string; themes?: LottieTheme[] } = {},
): LottieInfo {
  return {
    path,
    format,
    width: doc.width,
    height: doc.height,
    fps: doc.fps,
    inPoint: doc.inPoint,
    outPoint: doc.outPoint,
    markers: doc.markers,
    limits,
    ...(animations && animations.length > 1 ? { animations } : {}),
    ...(options.animation !== undefined && animations && animations.length > 1 ? { animation: options.animation } : {}),
    ...(options.themes && options.themes.length > 0 ? { themes: options.themes } : {}),
    bindings,
  };
}
