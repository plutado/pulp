/**
 * Layered Photoshop files (milestone 33): a `.psd` read as a stack of layers —
 * their names, order, visibility, opacity and blend modes, groups as groups —
 * so a layered still from a stock library can be browsed, shown with layers
 * hidden, and placed as one picture or as separate layers, without flattening
 * it first. Reading only: Pulp never writes a `.psd`.
 *
 * What the format has that Pulp cannot reproduce — layer effects, smart
 * objects, adjustment and fill layers, masks, most blend modes — is **named**
 * on the layer rather than silently dropped, and the flattened composite
 * Photoshop stores in the file is the fallback for the whole picture.
 *
 * Pure: bytes in, pixels and structure out. The main process reads the file
 * and encodes PNGs (src/main/psd-service.ts); the fixtures the tests use are
 * generated, never shipped.
 */

import { tr, type MessageId } from './i18n';

export const PSD_EXTENSION = '.psd';

/** The extensions read as layered stills (milestone 33). `.ai` reads through the PDF it carries. */
export const LAYERED_EXTENSIONS = ['.psd', '.ora', '.kra', '.svg', '.ai', '.pdf'] as const;

export function isLayeredExtension(ext: string): boolean {
  return (LAYERED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * The blend modes Pulp draws: every one a canvas draws natively (the W3C
 * compositing set), computed here with the same formulas so the stage, the
 * grant and a render agree. Anything else is drawn as normal and named.
 */
export const PSD_BLENDS = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
] as const;
export type PsdBlend = (typeof PSD_BLENDS)[number];

const BLEND_KEYS: Record<string, PsdBlend> = {
  norm: 'normal',
  'mul ': 'multiply',
  scrn: 'screen',
  over: 'overlay',
  dark: 'darken',
  lite: 'lighten',
  'div ': 'color-dodge',
  idiv: 'color-burn',
  hLit: 'hard-light',
  sLit: 'soft-light',
  diff: 'difference',
  smud: 'exclusion',
  'hue ': 'hue',
  'sat ': 'saturation',
  colr: 'color',
  'lum ': 'luminosity',
  pass: 'normal',
};

/** Photoshop's own modes with no canvas equivalent: drawn as normal, named in words (in the interface's language when read). */
const BLEND_NAMES: Record<string, MessageId> = {
  diss: 'psd.blend.dissolve',
  lbrn: 'psd.blend.linear-burn',
  dkCl: 'psd.blend.darker-color',
  lddg: 'psd.blend.linear-dodge',
  lgCl: 'psd.blend.lighter-color',
  vLit: 'psd.blend.vivid-light',
  lLit: 'psd.blend.linear-light',
  pLit: 'psd.blend.pin-light',
  hMix: 'psd.blend.hard-mix',
  fsub: 'psd.blend.subtract',
  fdiv: 'psd.blend.divide',
};

/** Additional-info keys that mean a layer is something Pulp cannot reproduce, and the message that names it. */
const LIMIT_KEYS: Record<string, MessageId> = {
  lfx2: 'psd.limit.layer-effects', lrFX: 'psd.limit.layer-effects', lmfx: 'psd.limit.layer-effects',
  SoLd: 'psd.limit.smart-object', PlLd: 'psd.limit.smart-object', SoLE: 'psd.limit.smart-object',
  SoCo: 'psd.limit.fill-layer', GdFl: 'psd.limit.fill-layer', PtFl: 'psd.limit.fill-layer',
  levl: 'psd.limit.adjustment.levels',
  curv: 'psd.limit.adjustment.curves',
  brit: 'psd.limit.adjustment.brightness-contrast',
  hue2: 'psd.limit.adjustment.hue-saturation',
  blnc: 'psd.limit.adjustment.color-balance',
  selc: 'psd.limit.adjustment.selective-color',
  mixr: 'psd.limit.adjustment.channel-mixer',
  grdm: 'psd.limit.adjustment.gradient-map',
  phfl: 'psd.limit.adjustment.photo-filter',
  expA: 'psd.limit.adjustment.exposure',
  vibA: 'psd.limit.adjustment.vibrance',
  blwh: 'psd.limit.adjustment.black-and-white',
  nvrt: 'psd.limit.adjustment.invert',
  post: 'psd.limit.adjustment.posterize',
  thrs: 'psd.limit.adjustment.threshold',
  clrL: 'psd.limit.adjustment.color-lookup',
  vmsk: 'psd.limit.vector-mask', vsms: 'psd.limit.vector-mask', vogk: 'psd.limit.vector-mask',
  TySh: 'psd.limit.text-layer',
};

export interface PsdLayer {
  /** "L0", "L1"… by position in the file, bottom first; what a hidden-layer list and a placed layer name. */
  id: string;
  name: string;
  kind: 'layer' | 'group';
  /** As the file has it; a stored hidden list overrides this. */
  visible: boolean;
  /** 0 to 1. */
  opacity: number;
  blend: PsdBlend;
  /** The file's own blend key, for naming one Pulp does not draw. */
  blendKey: string;
  /** Pixel bounds in the canvas; a group's is the union of its children's, an empty layer's is zero. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The group this sits in, or null at the top level. */
  parent: string | null;
  depth: number;
  /** What this layer has that Pulp does not reproduce, in words. */
  limits: string[];
  /** Straight-alpha RGBA of the layer's own bounds; absent for a group or an empty layer. */
  pixels?: Uint8Array;
}

export interface PsdDocument {
  width: number;
  height: number;
  /** Bits per channel in the file: 8 or 16 (16 is read down to 8). */
  depth: number;
  mode: 'rgb' | 'grayscale';
  /** Bottom first, as the file stores them. */
  layers: PsdLayer[];
  /** The flattened picture Photoshop stored; null when the file has none Pulp can read. */
  composite: Uint8Array | null;
  /** What the file as a whole has that Pulp does not reproduce. */
  limits: string[];
}

/** The structure without the pixels: what crosses to the window. */
export interface PsdOutline {
  width: number;
  height: number;
  layers: (Omit<PsdLayer, 'pixels'> & {
    /** False when the layer's pixels cannot be had (Krita's tile format): it cannot be toggled or placed alone. */
    hasPixels?: boolean;
  })[];
  limits: string[];
  hasComposite: boolean;
}

export type PsdResult = { ok: true; document: PsdDocument } | { ok: false; message: string };

// ---------------------------------------------------------------- reading

class Reader {
  at = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number): void {
    if (this.at + n > this.bytes.length) throw new Error('the file ends early'); // i18n-exempt(diagnostic)
  }
  u8(): number { this.need(1); return this.bytes[this.at++]!; }
  u16(): number { this.need(2); const v = this.view.getUint16(this.at); this.at += 2; return v; }
  i16(): number { this.need(2); const v = this.view.getInt16(this.at); this.at += 2; return v; }
  u32(): number { this.need(4); const v = this.view.getUint32(this.at); this.at += 4; return v; }
  i32(): number { this.need(4); const v = this.view.getInt32(this.at); this.at += 4; return v; }
  ascii(n: number): string { this.need(n); const s = String.fromCharCode(...this.bytes.subarray(this.at, this.at + n)); this.at += n; return s; }
  skip(n: number): void { this.need(n); this.at += n; }
  slice(n: number): Uint8Array { this.need(n); const s = this.bytes.subarray(this.at, this.at + n); this.at += n; return s; }
}

/** PackBits, as PSD's RLE is: a count byte, then a literal run or one byte repeated. */
export function unpackBits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0;
  let o = 0;
  while (i < src.length && o < expected) {
    const n = src[i++]!;
    if (n < 128) {
      const run = n + 1;
      out.set(src.subarray(i, i + Math.min(run, expected - o)), o);
      i += run;
      o += run;
    } else if (n > 128) {
      const run = 257 - n;
      const value = src[i++] ?? 0;
      out.fill(value, o, Math.min(expected, o + run));
      o += run;
    }
    // 128 is a no-op.
  }
  return out;
}

/** Zlib's inflate, as node:zlib's inflateSync gives it; injected so this module stays pure. */
export type Inflate = (bytes: Uint8Array) => Uint8Array;

/**
 * Undo zip-with-prediction (compression 3) in place: each row is stored as
 * deltas — of bytes at 8 bits, of big-endian 16-bit values at 16 — so the
 * samples come back by summing along the row.
 */
export function undoPrediction(raw: Uint8Array, width: number, height: number, depth: number): Uint8Array {
  if (depth === 16) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width * 2;
      for (let x = 1; x < width; x += 1) {
        const at = row + x * 2;
        const prev = ((raw[at - 2]! << 8) | raw[at - 1]!);
        const value = (prev + ((raw[at]! << 8) | raw[at + 1]!)) & 0xffff;
        raw[at] = value >> 8;
        raw[at + 1] = value & 0xff;
      }
    }
    return raw;
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 1; x < width; x += 1) raw[row + x] = (raw[row + x]! + raw[row + x - 1]!) & 0xff;
  }
  return raw;
}

/** One channel's samples as bytes, whatever the depth: 16-bit takes the high byte. */
function readChannel(r: Reader, width: number, height: number, depth: number, compression: number, length: number | null, inflate: Inflate | undefined): Uint8Array {
  const count = width * height;
  const bytesPer = depth === 16 ? 2 : 1;
  const start = r.at;
  let raw: Uint8Array;
  if (compression === 0) {
    raw = r.slice(count * bytesPer);
  } else if (compression === 1) {
    const rowLengths: number[] = [];
    for (let y = 0; y < height; y += 1) rowLengths.push(r.u16());
    raw = new Uint8Array(count * bytesPer);
    const rowBytes = width * bytesPer;
    for (let y = 0; y < height; y += 1) raw.set(unpackBits(r.slice(rowLengths[y]!), rowBytes), y * rowBytes);
  } else if (compression === 2 || compression === 3) {
    // Zip: one zlib stream per channel. With prediction (3), rows are deltas.
    if (!inflate) throw new Error('zip-compressed layer data needs an inflate, and none was given'); // i18n-exempt(diagnostic)
    if (length === null) throw new Error('zip-compressed data with no stated length'); // i18n-exempt(diagnostic)
    const inflated = inflate(r.slice(length));
    if (inflated.length < count * bytesPer) throw new Error('zip-compressed channel data is shorter than the layer'); // i18n-exempt(diagnostic)
    raw = compression === 3 ? undoPrediction(inflated.subarray(0, count * bytesPer), width, height, depth) : inflated.subarray(0, count * bytesPer);
  } else {
    throw new Error(`compression ${compression} is not one the format has`); // i18n-exempt(diagnostic)
  }
  if (length !== null) r.at = start + length;
  if (bytesPer === 1) return raw;
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) out[i] = raw[i * 2]!;
  return out;
}

/** Planar channels into straight RGBA. Grayscale is replicated; a missing alpha is opaque. */
function interleave(channels: Map<number, Uint8Array>, count: number, gray: boolean): Uint8Array {
  const out = new Uint8Array(count * 4);
  const r = channels.get(0);
  const g = gray ? r : channels.get(1);
  const b = gray ? r : channels.get(2);
  const a = channels.get(-1);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = r?.[i] ?? 0;
    out[i * 4 + 1] = g?.[i] ?? 0;
    out[i * 4 + 2] = b?.[i] ?? 0;
    out[i * 4 + 3] = a?.[i] ?? 255;
  }
  return out;
}

interface RawLayer {
  top: number; left: number; bottom: number; right: number;
  channels: { id: number; length: number }[];
  blendKey: string; opacity: number; clipping: boolean; visible: boolean;
  name: string; section: number; limits: string[];
}

function readLayerRecord(r: Reader): RawLayer {
  const top = r.i32();
  const left = r.i32();
  const bottom = r.i32();
  const right = r.i32();
  const channelCount = r.u16();
  const channels: { id: number; length: number }[] = [];
  for (let c = 0; c < channelCount; c += 1) channels.push({ id: r.i16(), length: r.u32() });
  if (r.ascii(4) !== '8BIM') throw new Error('a layer record is not where it should be'); // i18n-exempt(diagnostic)
  const blendKey = r.ascii(4);
  const opacity = r.u8() / 255;
  const clipping = r.u8() !== 0;
  const flags = r.u8();
  r.skip(1);
  const extraLength = r.u32();
  const extraEnd = r.at + extraLength;
  const maskLength = r.u32();
  r.skip(maskLength);
  const rangesLength = r.u32();
  r.skip(rangesLength);
  const nameLength = r.u8();
  let name = r.ascii(nameLength);
  // The pascal name is padded to a multiple of four, counting its length byte.
  r.skip((4 - ((nameLength + 1) % 4)) % 4);
  let section = 0;
  const limits: string[] = [];
  if (maskLength > 0) limits.push(tr('psd.limit.layer-mask'));
  if (clipping) limits.push(tr('psd.limit.clipping-mask'));
  while (r.at + 12 <= extraEnd) {
    const sig = r.ascii(4);
    if (sig !== '8BIM' && sig !== '8B64') break;
    const key = r.ascii(4);
    const length = r.u32();
    const dataStart = r.at;
    if (key === 'luni') {
      const chars = r.u32();
      let s = '';
      for (let i = 0; i < chars; i += 1) s += String.fromCharCode(r.u16());
      name = s.replace(/\0+$/, '') || name;
    } else if (key === 'lsct') {
      section = r.u32();
    } else if (LIMIT_KEYS[key]) {
      const limit = tr(LIMIT_KEYS[key]!);
      if (!limits.includes(limit)) limits.push(limit);
    }
    // Lengths are padded to an even count; what a block held past what was read is skipped.
    r.at = dataStart + length + (length % 2);
  }
  r.at = extraEnd;
  return { top, left, bottom, right, channels, blendKey, opacity, clipping, visible: (flags & 2) === 0, name, section, limits };
}

/**
 * Read a `.psd`. Version 1 (not `.psb`), RGB or grayscale, 8 or 16 bits per
 * channel; raw, RLE, or — given an inflate — zip with or without prediction in
 * the layer data. Anything else is refused by name rather than half-read.
 */
export function parsePsd(bytes: Uint8Array, options: { inflate?: Inflate } = {}): PsdResult {
  try {
    // i18n-exempt(diagnostic)
    if (bytes.length < 26 || String.fromCharCode(...bytes.subarray(0, 4)) !== '8BPS') return { ok: false, message: 'not a Photoshop file (no 8BPS signature)' };
    const r = new Reader(bytes);
    r.skip(4);
    const version = r.u16();
    if (version !== 1) return { ok: false, message: version === 2 ? tr('psd.refused.psb') : `unknown version ${version}` }; // i18n-exempt(diagnostic)
    r.skip(6);
    const channelCount = r.u16();
    const height = r.u32();
    const width = r.u32();
    const depth = r.u16();
    const modeCode = r.u16();
    // i18n-exempt(diagnostic)
    if (width === 0 || height === 0 || width > 30_000 || height > 30_000) return { ok: false, message: `an unreadable size, ${width} × ${height}` };
    if (depth !== 8 && depth !== 16) return { ok: false, message: tr('psd.refused.depth', { depth }) };
    const mode = modeCode === 3 ? 'rgb' : modeCode === 1 ? 'grayscale' : null;
    if (!mode) return { ok: false, message: tr('psd.refused.color-mode', { mode: modeCode }) };
    const gray = mode === 'grayscale';
    const limits: string[] = [];

    r.skip(r.u32()); // color mode data
    r.skip(r.u32()); // image resources

    const layerMaskLength = r.u32();
    const layerMaskEnd = r.at + layerMaskLength;
    const layers: PsdLayer[] = [];
    if (layerMaskLength > 0) {
      const layerInfoLength = r.u32();
      const layerInfoEnd = r.at + layerInfoLength;
      if (layerInfoLength > 0) {
        const count = Math.abs(r.i16());
        const raws: RawLayer[] = [];
        for (let i = 0; i < count; i += 1) raws.push(readLayerRecord(r));
        // Channel image data follows, one layer at a time in the same order.
        const pixelsByIndex: (Uint8Array | undefined)[] = [];
        for (const raw of raws) {
          const w = raw.right - raw.left;
          const h = raw.bottom - raw.top;
          const channels = new Map<number, Uint8Array>();
          for (const ch of raw.channels) {
            const compression = r.u16();
            const dataLength = ch.length - 2;
            if (ch.id < -1 || w <= 0 || h <= 0) {
              // A mask channel has its own rectangle; an empty layer has nothing: skipped by length.
              r.skip(dataLength);
              continue;
            }
            channels.set(ch.id, readChannel(r, w, h, depth, compression, dataLength, options.inflate));
          }
          pixelsByIndex.push(w > 0 && h > 0 && channels.size > 0 ? interleave(channels, w * h, gray) : undefined);
        }
        // Groups: in file order (bottom first) a hidden divider (type 3) opens a group and the
        // group's own record (type 1 or 2) closes and names it, so a stack of open groups does it.
        const open: { id: string; children: PsdLayer[]; layer: PsdLayer }[] = [];
        raws.forEach((raw, i) => {
          const id = `L${i}`;
          const parent = open.length > 0 ? open[open.length - 1]!.id : null;
          const depthHere = open.length;
          const blend = BLEND_KEYS[raw.blendKey] ?? 'normal';
          const layerLimits = [...raw.limits];
          if (!BLEND_KEYS[raw.blendKey]) {
            const named = BLEND_NAMES[raw.blendKey];
            layerLimits.push(tr('psd.limit.blend', { mode: named ? tr(named) : raw.blendKey.trim() }));
          }
          if (raw.section === 3) {
            // The divider stands in for the group until its own record arrives.
            const group: PsdLayer = { id, name: '', kind: 'group', visible: true, opacity: 1, blend: 'normal', blendKey: 'pass', left: 0, top: 0, width: 0, height: 0, parent, depth: depthHere, limits: [] };
            layers.push(group);
            open.push({ id, children: [], layer: group });
            return;
          }
          if (raw.section === 1 || raw.section === 2) {
            const closing = open.pop();
            if (closing) {
              closing.layer.name = raw.name;
              closing.layer.visible = raw.visible;
              closing.layer.opacity = raw.opacity;
              closing.layer.blend = blend;
              closing.layer.blendKey = raw.blendKey;
              closing.layer.limits = layerLimits.filter((l) => !l.startsWith('blend mode') || raw.blendKey !== 'pass');
              const box = union(closing.children);
              Object.assign(closing.layer, box);
            }
            return;
          }
          const pixels = pixelsByIndex[i];
          const layer: PsdLayer = {
            id, name: raw.name, kind: 'layer', visible: raw.visible, opacity: raw.opacity, blend, blendKey: raw.blendKey,
            left: raw.left, top: raw.top, width: Math.max(0, raw.right - raw.left), height: Math.max(0, raw.bottom - raw.top),
            parent, depth: depthHere, limits: layerLimits, ...(pixels ? { pixels } : {}),
          };
          layers.push(layer);
          if (open.length > 0) open[open.length - 1]!.children.push(layer);
        });
        // A group left open is a file that ended oddly; it keeps a plain name.
        for (const g of open) {
          g.layer.name = g.layer.name || tr('layered.layer.default-group');
          Object.assign(g.layer, union(g.children));
        }
      }
      r.at = layerInfoEnd;
      r.at = layerMaskEnd;
    }

    // The merged picture Photoshop stores: planar channels, the whole image at once.
    let composite: Uint8Array | null = null;
    try {
      const compression = r.u16();
      const count = width * height;
      const bytesPer = depth === 16 ? 2 : 1;
      const channels = new Map<number, Uint8Array>();
      const ids = gray ? [0, -1] : [0, 1, 2, -1];
      if (compression === 0) {
        for (let c = 0; c < channelCount; c += 1) {
          const raw = r.slice(count * bytesPer);
          if (c < ids.length) channels.set(ids[c]!, bytesPer === 1 ? raw : raw.filter((_, j) => j % 2 === 0));
        }
      } else if (compression === 1) {
        const rowLengths: number[] = [];
        for (let i = 0; i < channelCount * height; i += 1) rowLengths.push(r.u16());
        const rowBytes = width * bytesPer;
        for (let c = 0; c < channelCount; c += 1) {
          const raw = new Uint8Array(count * bytesPer);
          for (let y = 0; y < height; y += 1) raw.set(unpackBits(r.slice(rowLengths[c * height + y]!), rowBytes), y * rowBytes);
          if (c < ids.length) channels.set(ids[c]!, bytesPer === 1 ? raw : raw.filter((_, j) => j % 2 === 0));
        }
      } else {
        limits.push(tr('psd.limit.composite-zip'));
      }
      if (channels.size > 0) composite = interleave(channels, count, gray);
    } catch {
      limits.push(tr('psd.limit.composite-unreadable'));
    }
    if (layers.length === 0) limits.push(tr('psd.limit.no-layers'));
    if (depth === 16) limits.push(tr('psd.limit.sixteen-bit'));
    return { ok: true, document: { width, height, depth, mode, layers, composite, limits } };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function union(children: readonly PsdLayer[]): { left: number; top: number; width: number; height: number } {
  const drawn = children.filter((c) => c.width > 0 && c.height > 0);
  if (drawn.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
  const left = Math.min(...drawn.map((c) => c.left));
  const top = Math.min(...drawn.map((c) => c.top));
  const right = Math.max(...drawn.map((c) => c.left + c.width));
  const bottom = Math.max(...drawn.map((c) => c.top + c.height));
  return { left, top, width: right - left, height: bottom - top };
}

// ---------------------------------------------------------------- structure

export function psdOutline(doc: PsdDocument): PsdOutline {
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map(({ pixels, ...rest }) => ({ ...rest, hasPixels: rest.kind === 'group' || pixels !== undefined })),
    limits: doc.limits,
    hasComposite: doc.composite !== null,
  };
}

/** The layers as the file shows them: top first, for a list a person reads. */
export function layersTopFirst<T extends { id: string }>(layers: readonly T[]): T[] {
  return [...layers].reverse();
}

/** The ids the file itself hides: what a hidden list starts from when nothing is stored. */
export function fileHiddenLayers(layers: readonly Pick<PsdLayer, 'id' | 'visible'>[]): string[] {
  return layers.filter((l) => !l.visible).map((l) => l.id);
}

/** Whether a layer is drawn, given a hidden list: hidden itself, or inside a hidden group. */
export function layerShown(layers: readonly Pick<PsdLayer, 'id' | 'parent'>[], id: string, hidden: ReadonlySet<string>): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  let at = byId.get(id);
  while (at) {
    if (hidden.has(at.id)) return false;
    at = at.parent ? byId.get(at.parent) : undefined;
  }
  return true;
}

// ---------------------------------------------------------------- compositing

// The separable blend modes, per channel, with the W3C compositing formulas a canvas uses.
function blendChannel(mode: PsdBlend, cb: number, cs: number): number {
  switch (mode) {
    case 'multiply': return cb * cs;
    case 'screen': return cb + cs - cb * cs;
    case 'overlay': return blendChannel('hard-light', cs, cb);
    case 'darken': return Math.min(cb, cs);
    case 'lighten': return Math.max(cb, cs);
    case 'color-dodge': return cb === 0 ? 0 : cs === 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 'color-burn': return cb === 1 ? 1 : cs === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 'hard-light': return cs <= 0.5 ? blendChannel('multiply', cb, 2 * cs) : blendChannel('screen', cb, 2 * cs - 1);
    case 'soft-light': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 'difference': return Math.abs(cb - cs);
    case 'exclusion': return cb + cs - 2 * cb * cs;
    default: return cs;
  }
}

// The non-separable modes work on the whole color: one of hue, saturation and
// luminosity is taken from the source, the rest kept from the backdrop.
type Rgb = [number, number, number];

function lum(c: Rgb): number {
  return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
}

function clipColor(c: Rgb): Rgb {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as Rgb;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as Rgb;
  return out;
}

function setLum(c: Rgb, l: number): Rgb {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

function sat(c: Rgb): number {
  return Math.max(...c) - Math.min(...c);
}

function setSat(c: Rgb, s: number): Rgb {
  const order = [0, 1, 2].sort((a, b) => c[a]! - c[b]!);
  const [minI, midI, maxI] = order as [number, number, number];
  const out: Rgb = [0, 0, 0];
  if (c[maxI]! > c[minI]!) {
    out[midI] = ((c[midI]! - c[minI]!) * s) / (c[maxI]! - c[minI]!);
    out[maxI] = s;
  }
  return out;
}

/** One pixel's blended color: the separable modes per channel, the color modes on the triple. */
export function blendPixel(mode: PsdBlend, backdrop: Rgb, source: Rgb): Rgb {
  switch (mode) {
    case 'hue': return setLum(setSat(source, sat(backdrop)), lum(backdrop));
    case 'saturation': return setLum(setSat(backdrop, sat(source)), lum(backdrop));
    case 'color': return setLum(source, lum(backdrop));
    case 'luminosity': return setLum(backdrop, lum(source));
    default: return [blendChannel(mode, backdrop[0], source[0]), blendChannel(mode, backdrop[1], source[1]), blendChannel(mode, backdrop[2], source[2])];
  }
}

/** A group's own opacity multiplies everything in it, as does its parent's. */
function effectiveOpacity(layers: readonly PsdLayer[], layer: PsdLayer): number {
  const byId = new Map(layers.map((l) => [l.id, l]));
  let opacity = layer.opacity;
  let at = layer.parent ? byId.get(layer.parent) : undefined;
  while (at) {
    opacity *= at.opacity;
    at = at.parent ? byId.get(at.parent) : undefined;
  }
  return opacity;
}

/**
 * The picture with a set of layers hidden: every shown layer painted bottom
 * to top over transparency, with its opacity and the blend modes Pulp draws.
 * A file with no layers Pulp can draw answers with its stored composite.
 */
export function compositePsd(doc: PsdDocument, hidden: ReadonlySet<string> = new Set(fileHiddenLayers(doc.layers))): Uint8Array {
  const { width, height } = doc;
  const drawable = doc.layers.filter((l) => l.kind === 'layer' && l.pixels && layerShown(doc.layers, l.id, hidden));
  if (drawable.length === 0 && doc.composite && doc.layers.every((l) => l.kind !== 'layer' || !l.pixels)) return doc.composite;
  const out = new Float32Array(width * height * 4);
  for (const layer of drawable) {
    const opacity = effectiveOpacity(doc.layers, layer);
    if (opacity <= 0) continue;
    const px = layer.pixels!;
    const x0 = Math.max(0, layer.left);
    const y0 = Math.max(0, layer.top);
    const x1 = Math.min(width, layer.left + layer.width);
    const y1 = Math.min(height, layer.top + layer.height);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const s = ((y - layer.top) * layer.width + (x - layer.left)) * 4;
        const as = (px[s + 3]! / 255) * opacity;
        if (as <= 0) continue;
        const d = (y * width + x) * 4;
        const ab = out[d + 3]!;
        const ao = as + ab * (1 - as);
        const source: Rgb = [px[s]! / 255, px[s + 1]! / 255, px[s + 2]! / 255];
        const backdrop: Rgb = [out[d]!, out[d + 1]!, out[d + 2]!];
        const mixed = blendPixel(layer.blend, backdrop, source);
        for (let c = 0; c < 3; c += 1) {
          const blended = (1 - ab) * source[c]! + ab * mixed[c]!;
          out[d + c] = ao > 0 ? ((1 - as) * backdrop[c]! * ab + as * blended) / ao : 0;
        }
        out[d + 3] = ao;
      }
    }
  }
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.round(Math.max(0, Math.min(1, out[i]!)) * 255);
  return bytes;
}

/** One layer alone, on the whole canvas, its own opacity baked into the alpha: what a separate placed layer draws. */
export function layerOnCanvas(doc: PsdDocument, id: string): { pixels: Uint8Array; width: number; height: number; left: number; top: number } | null {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || layer.kind !== 'layer' || !layer.pixels || layer.width === 0 || layer.height === 0) return null;
  const pixels = new Uint8Array(layer.pixels);
  const opacity = layer.opacity;
  if (opacity < 1) for (let i = 3; i < pixels.length; i += 4) pixels[i] = Math.round(pixels[i]! * opacity);
  return { pixels, width: layer.width, height: layer.height, left: layer.left, top: layer.top };
}

/** Where a layer sits in its canvas, as fractions: what keeps its position when it is placed on its own. */
export function layerCanvasBox(doc: Pick<PsdDocument, 'width' | 'height'>, layer: Pick<PsdLayer, 'left' | 'top' | 'width' | 'height'>): { x: number; y: number; width: number; height: number } {
  return { x: layer.left / doc.width, y: layer.top / doc.height, width: layer.width / doc.width, height: layer.height / doc.height };
}

/** The layers a split places: the drawn, shown, non-group layers whose pixels can be had, top first so the stack reads as the file does. */
export function placeableLayers(outline: Pick<PsdOutline, 'layers'>, hidden: ReadonlySet<string>): PsdOutline['layers'] {
  return outline.layers.filter((l) => l.kind === 'layer' && l.width > 0 && l.height > 0 && l.hasPixels !== false && layerShown(outline.layers, l.id, hidden));
}

/** Is a layer's limit the "blend mode … drawn as normal" one, in the language it was read in now? */
function isBlendLimit(limit: string): boolean {
  const [before = '', after = ''] = tr('psd.limit.blend', { mode: '\u0000' }).split('\u0000');
  return limit.length > before.length + after.length && limit.startsWith(before) && limit.endsWith(after);
}

/**
 * A sentence on what the file has that Pulp does not reproduce, across all its layers; empty when nothing.
 * Its sentences are messages of their own; the list of kinds is joined with a comma, and the document's
 * own limits with full stops, here.
 */
export function psdLimitSummary(outline: Pick<PsdOutline, 'layers' | 'limits' | 'hasComposite'>): string {
  const kinds = new Set<string>();
  for (const layer of outline.layers) for (const limit of layer.limits) kinds.add(isBlendLimit(limit) ? tr('psd.summary.other-blend-modes') : limit.replace(/ \(.*\)$/, ''));
  const parts = [...kinds];
  if (parts.length === 0 && outline.limits.length === 0) return '';
  const named = parts.length > 0 ? tr('psd.summary.not-reproduced', { kinds: parts.join(', ') }) : '';
  const fallback = outline.hasComposite ? ` ${tr('psd.summary.stored-picture')}` : '';
  return `${named}${outline.limits.length > 0 ? ` ${outline.limits.join('. ')}.` : ''}${fallback}`.trim();
}
