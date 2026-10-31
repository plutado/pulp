/**
 * Lottie animations read as templates (milestone 35). Lottie is the animated
 * vector format After Effects exports through Bodymovin: a JSON document (or a
 * `.lottie` archive, a zip of one or more of them with their images) describing
 * shapes, text, images and their keyframes. It is motion graphics already made,
 * so Pulp reads it as an item that plays, renders and is edited like a
 * template rather than as a picture: the library makes a manifest from the
 * file — its size, frame rate and length — and its editable text and colours
 * become parameters, saved with the item like any other.
 *
 * The pure part: telling a Lottie JSON from any other, reading the document and
 * a `.lottie` archive, finding what the file exposes (its slots where it has
 * them, otherwise its text layers and fill colours), applying parameter values
 * to the document, naming what the player cannot draw, and the manifest.
 * The page that draws it is src/core/lottie-page.ts; the main process serves
 * both (src/main/lottie-service.ts, src/main/protocol.ts).
 *
 * The player is lottie-web (MIT), its "light" build: the SVG renderer without
 * expressions and effects, which is the build that runs without `eval` under
 * the template CSP. What that build leaves out is said on the item.
 */

import { ASPECT_IDS, aspectOf, MAX_DIMENSION, MIN_DIMENSION } from './aspect';
import type { LottieBinding, LottieDocumentMeta, LottieFormat, LottieInfo, LottieMarker, LottiePath, LottieTarget } from './lottie-types';
import { LOTTIE_FIT_PARAM } from './lottie-types';
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
    throw new Error(`not valid JSON: ${(err as Error).message}`, { cause: err });
  }
  return lottieDocument(raw);
}

/** The document from already-parsed JSON. */
export function lottieDocument(raw: unknown): LottieDocument {
  if (!isRecord(raw)) throw new Error('not a Lottie animation (the document is not an object)');
  if (!Array.isArray(raw.layers)) throw new Error('not a Lottie animation (no layers)');
  const fps = raw.fr;
  const ip = raw.ip ?? 0;
  const op = raw.op;
  const w = raw.w;
  const h = raw.h;
  if (!finite(fps) || fps <= 0 || fps > 240) throw new Error('an unusable frame rate ("fr")');
  if (!finite(ip) || !finite(op) || op <= ip) throw new Error('an unusable length ("ip" and "op")');
  if (!finite(w) || !finite(h) || w < MIN_DIMENSION || h < MIN_DIMENSION || w > MAX_DIMENSION || h > MAX_DIMENSION) {
    throw new Error(`an unusable size (${String(w)} × ${String(h)}; ${MIN_DIMENSION} to ${MAX_DIMENSION} pixels a side)`);
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
  document: LottieDocument;
  /** The ids of every animation the archive holds, the shown one first. */
  animations: string[];
  /** Pictures inside the archive by their file name (the part after the last slash). */
  images: Map<string, Buffer>;
  /** The archive's author, when its manifest says. */
  author?: string;
  /** What the archive carries that is not read: themes, states. */
  limits: string[];
}

const fileName = (path: string): string => path.split('/').pop() ?? path;

/**
 * Read a `.lottie`: a zip whose `manifest.json` lists its animations, each a
 * Lottie JSON under `animations/` (or `a/` in the newer layout), with images
 * under `images/` (or `i/`). The first listed animation is the one shown.
 */
export function readDotLottie(bytes: Buffer): DotLottie {
  const entries = readZip(bytes, { maxBytes: 256 * 1024 * 1024, maxEntries: 2000 });
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  let ids: string[] = [];
  let author: string | undefined;
  const limits: string[] = [];
  const manifestBytes = byName.get('manifest.json');
  if (manifestBytes) {
    try {
      const manifest = JSON.parse(manifestBytes.toString('utf8')) as unknown;
      if (isRecord(manifest)) {
        if (Array.isArray(manifest.animations)) {
          ids = manifest.animations.map((a) => (isRecord(a) && typeof a.id === 'string' ? a.id : '')).filter(Boolean);
        }
        if (typeof manifest.author === 'string' && manifest.author.trim()) author = manifest.author.trim();
        if ((Array.isArray(manifest.themes) && manifest.themes.length > 0) || entries.some((e) => /^(themes|t)\//.test(e.name))) limits.push('its themes are not read; colours are edited one by one');
        if ((Array.isArray(manifest.states) && manifest.states.length > 0) || entries.some((e) => /^(states|s)\//.test(e.name))) limits.push('its interactive states are not read; the animation plays as one');
      }
    } catch {
      limits.push('its manifest.json could not be read; the first animation found is shown');
    }
  }
  const animationFile = (id: string): string | undefined => [`animations/${id}.json`, `a/${id}.json`].find((n) => byName.has(n));
  if (ids.length === 0) {
    // No manifest, or one that names nothing: every animation file there is, in archive order.
    ids = entries.filter((e) => /^(animations|a)\/[^/]+\.json$/.test(e.name)).map((e) => fileName(e.name).replace(/\.json$/, ''));
  }
  const first = ids.map((id) => ({ id, file: animationFile(id) })).find((a) => a.file !== undefined);
  if (!first) throw new Error('not a dotLottie archive (no animation inside)');
  const document = parseLottie(byName.get(first.file!)!.toString('utf8'));
  const images = new Map<string, Buffer>();
  for (const e of entries) {
    if (/^(images|i)\//.test(e.name)) images.set(fileName(e.name), e.data);
  }
  if (ids.length > 1) limits.push(`the archive holds ${ids.length} animations; the first (${first.id}) is shown`);
  return { document, animations: [first.id, ...ids.filter((id) => id !== first.id)], images, ...(author ? { author } : {}), limits };
}

// ---------------------------------------------------------------- what the file exposes

export interface LottieEditables {
  parameters: TemplateParameter[];
  bindings: LottieBinding[];
  /** What was found but left alone, said on the item. */
  limits: string[];
}

interface ColorUse {
  hex: string;
  /** The first place it was seen, for the label. */
  name: string;
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

/** A static colour property's components in 0..1, or null for one that is animated, bound to a slot, or not a colour. */
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
 * The text and colours a file exposes: its slots where it has them, and its
 * static text layers and fill, stroke, solid and text colours. Each distinct
 * colour is one parameter, however many shapes use it, so a palette stays a
 * palette. Text and colours bound to slots are reached through the slot only.
 */
export function lottieEditables(data: LottieData): LottieEditables {
  const parameters: TemplateParameter[] = [];
  const bindings: LottieBinding[] = [];
  const limits: string[] = [];
  const colours: ColorUse[] = [];
  const texts: { label: string; element: string; value: string; target: LottieTarget }[] = [];
  const animatedTexts: string[] = [];

  const addColour = (components: number[], target: LottieTarget, name: string, what: ColorUse['what']): void => {
    const hex = rgbHex(components);
    const existing = colours.find((c) => c.hex === hex);
    if (existing) existing.targets.push(target);
    else colours.push({ hex, name, what, targets: [target] });
  };

  // Slots first (Lottie 1.0 theming): what the author chose to expose.
  if (isRecord(data.slots)) {
    for (const [sid, slot] of Object.entries(data.slots)) {
      if (!isRecord(slot) || !isRecord(slot.p)) continue;
      const at: LottiePath = ['slots', sid, 'p'];
      const label = usefulName(sid) ?? sid;
      const text = staticTextDoc(slot.p, at);
      if (text) {
        texts.push({ label: 'Text', element: label, value: String(text.doc.t).replace(/\r/g, '\n'), target: { kind: 'text', path: text.path } });
        continue;
      }
      const colour = staticColor(slot.p);
      if (colour) addColour(colour, { kind: colour.length === 4 ? 'rgba' : 'rgb', path: [...at, 'k'] }, label, 'fill');
    }
  }

  const walkShapes = (shapes: unknown, at: LottiePath, layerName: string, groupName: string | undefined): void => {
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
      const name = usefulName(shape.nm) ?? groupName ?? layerName;
      addColour(colour, { kind: colour.length === 4 ? 'rgba' : 'rgb', path: [...here, 'c', 'k'] }, name, shape.ty === 'fl' ? 'fill' : 'stroke');
    });
  };

  const walkLayers = (layers: unknown, at: LottiePath): void => {
    if (!Array.isArray(layers)) return;
    layers.forEach((layer, i) => {
      if (!isRecord(layer)) return;
      const here: LottiePath = [...at, i];
      const layerName = usefulName(layer.nm) ?? `Layer ${i + 1}`;
      if (layer.ty === 5 && isRecord(layer.t)) {
        const text = staticTextDoc(layer.t.d, [...here, 't', 'd']);
        if (text) {
          texts.push({ label: 'Text', element: layerName, value: String(text.doc.t).replace(/\r/g, '\n'), target: { kind: 'text', path: text.path } });
          const fill = text.doc.fc;
          if (Array.isArray(fill) && (fill.length === 3 || fill.length === 4) && fill.every(finite)) {
            addColour(fill.map((v) => Math.max(0, Math.min(1, v))), { kind: fill.length === 4 ? 'rgba' : 'rgb', path: [...text.path.slice(0, -1), 'fc'] }, layerName, 'text');
          }
        } else if (isRecord(layer.t.d) && Array.isArray(layer.t.d.k) && layer.t.d.k.length > 1) {
          animatedTexts.push(layerName);
        }
        return;
      }
      if (layer.ty === 1 && typeof layer.sc === 'string') {
        const c = hexComponents(layer.sc);
        if (c) addColour([c.r, c.g, c.b], { kind: 'hex', path: [...here, 'sc'] }, layerName, 'solid');
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

  texts.forEach((t, i) => {
    const id = `text${i + 1}`;
    parameters.push({ id, type: 'text', label: t.label, element: t.element, default: t.value, ...(t.value.includes('\n') ? { multiline: true } : {}) });
    bindings.push({ id, type: 'text', targets: [t.target] });
  });
  colours.forEach((c, i) => {
    const id = `color${i + 1}`;
    const others = c.targets.length - 1;
    const what = c.what === 'text' ? 'text colour' : c.what === 'solid' ? 'solid' : c.what;
    parameters.push({
      id,
      type: 'color',
      label: `${c.name} ${what}`,
      element: 'Colours',
      default: c.hex,
      ...(others > 0 ? { description: `Also used in ${others} other ${others === 1 ? 'place' : 'places'}.` } : {}),
    });
    bindings.push({ id, type: 'color', targets: c.targets });
  });
  if (animatedTexts.length > 0) limits.push(`text that changes over time is not editable: ${animatedTexts.join(', ')}`);
  return { parameters, bindings, limits };
}

/** The Fit setting every Lottie gets: how it sits in a frame of another shape or size. */
export function lottieFitParameter(): TemplateParameter {
  return {
    id: LOTTIE_FIT_PARAM,
    type: 'select',
    label: 'Fit',
    element: 'Frame',
    description: 'How the animation sits in a frame of another shape or size.',
    default: 'fit',
    options: [
      { value: 'fit', label: 'Fit inside the frame' },
      { value: 'fill', label: 'Fill the frame' },
      { value: 'center', label: 'Its own size, centred' },
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

/**
 * The document with parameter values written in: a deep copy, the original
 * untouched. Mirrors `applied` in the page script (src/core/lottie-page.ts):
 * change both or neither. Text uses Lottie's `\r` line breaks; a colour's
 * alpha goes only where the file kept four components.
 */
export function applyLottieParams(data: LottieData, bindings: readonly LottieBinding[], params: Record<string, unknown>): LottieData {
  const copy = JSON.parse(JSON.stringify(data)) as LottieData;
  for (const b of bindings) {
    const v = params[b.id];
    if (v === undefined || v === null) continue;
    for (const t of b.targets) {
      if (t.kind === 'text') {
        setAt(copy, t.path, String(v).replace(/\r\n|\n/g, '\r'));
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
export function lottieLimits(data: LottieData): string[] {
  const limits: string[] = [];
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
  if (expressions > 0) limits.push(`expressions on ${expressions} ${expressions === 1 ? 'property are' : 'properties are'} not run; those properties keep their keyframed values`);
  if (effects > 0) limits.push(`layer effects on ${effects} ${effects === 1 ? 'layer are' : 'layers are'} not drawn`);
  if (threeD || cameras > 0) limits.push('3D layers and cameras are drawn flat');
  if (audio > 0) limits.push(`${audio} audio ${audio === 1 ? 'layer is' : 'layers are'} silent`);
  if (isRecord(data.fonts) && Array.isArray(data.fonts.list)) {
    const web = data.fonts.list.filter((f) => isRecord(f) && (isWebPath(f.fPath) || f.origin === 1 || f.origin === 2 || f.origin === 3)).map((f) => String((f as Record<string, unknown>).fFamily ?? (f as Record<string, unknown>).fName ?? 'a font'));
    if (web.length > 0) limits.push(`fonts the file would fetch from the web are not loaded (${[...new Set(web)].join(', ')}); their text draws in an installed font of that name or the browser's fallback`);
  }
  if (Array.isArray(data.assets)) {
    const web = data.assets.filter((a) => isRecord(a) && typeof a.p === 'string' && a.e !== 1 && (isWebPath(a.u) || isWebPath(a.p)));
    if (web.length > 0) limits.push(`${web.length} ${web.length === 1 ? 'picture' : 'pictures'} the file would fetch from the web ${web.length === 1 ? 'is' : 'are'} not drawn`);
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

// ---------------------------------------------------------------- the manifest

export interface LottieManifestInput {
  /** The library's id for the item; the manifest id is made from it. */
  id: string;
  name: string;
  format: LottieFormat;
  /** A built-in type the folders named, if any. */
  type?: string;
  themes?: string[];
  tags?: string[];
  author?: string;
  editables: LottieEditables;
  limits: string[];
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

const even = (n: number): number => (n % 2 === 0 ? n : n + 1);

/** A file name as a title: "my-lower_third.json" reads "My lower third". */
export function humanizeFileName(name: string): string {
  const stem = name.replace(/\.(json|lottie)$/i, '').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stem) return 'Lottie animation';
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * The manifest a Lottie file is read into, validated like any other: the file's
 * own size (rounded up to even, as encoders need) as the default resolution,
 * every built-in aspect declared so the animation can be fitted, filled or
 * centred in any frame, its frame rate and length, transparent, and its
 * editable text and colours as parameters with the Fit setting.
 */
export function lottieManifest(doc: LottieDocumentMeta, input: LottieManifestInput): ValidationResult {
  const width = even(doc.width);
  const height = even(doc.height);
  const own = aspectOf(width, height);
  const frames = doc.outPoint - doc.inPoint;
  const description = [
    `${input.format === 'lottie' ? 'A dotLottie archive' : 'A Lottie animation'}: ${doc.width} × ${doc.height}, ${frames} frames at ${doc.fps} fps.`,
    ...(doc.markers.length > 0 ? [`Markers: ${doc.markers.map((m) => m.name).join(', ')}.`] : []),
    ...(input.limits.length > 0 ? [`Not drawn: ${input.limits.join('; ')}.`] : []),
  ].join(' ');
  const raw: Record<string, unknown> = {
    formatVersion: 1,
    id: lottieManifestId(input.id),
    name: input.name,
    description,
    version: doc.version && /^\d+\.\d+\.\d+$/.test(doc.version) ? doc.version : '1.0.0',
    ...(input.author ? { author: input.author } : {}),
    // A Lottie file carries no licence of its own; the Info tab says so rather than guessing.
    license: 'not stated',
    category: categoryForType(input.type),
    ...(input.type ? { type: input.type } : {}),
    ...(input.themes && input.themes.length > 0 ? { themes: input.themes } : {}),
    tags: [...new Set(['lottie', ...(input.tags ?? [])])],
    duration: round3(frames / doc.fps),
    fps: doc.fps,
    width,
    height,
    aspects: [own, ...ASPECT_IDS.filter((a) => a !== own)],
    alpha: true,
    entry: 'index.html',
    parameters: [...input.editables.parameters, lottieFitParameter()],
  };
  return validateManifest(raw);
}

/** Everything the library keeps about the file beside its manifest. */
export function lottieInfo(doc: LottieDocumentMeta, path: string, format: LottieFormat, bindings: LottieBinding[], limits: string[], animations?: string[]): LottieInfo {
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
    bindings,
  };
}
