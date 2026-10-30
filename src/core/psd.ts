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

export const PSD_EXTENSION = '.psd';

/** The blend modes Pulp draws; anything else is drawn as normal and named. */
export const PSD_BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'] as const;
export type PsdBlend = (typeof PSD_BLENDS)[number];

const BLEND_KEYS: Record<string, PsdBlend> = {
  norm: 'normal',
  'mul ': 'multiply',
  scrn: 'screen',
  over: 'overlay',
  dark: 'darken',
  lite: 'lighten',
  diff: 'difference',
  pass: 'normal',
};

const BLEND_NAMES: Record<string, string> = {
  diss: 'dissolve', idiv: 'color burn', lbrn: 'linear burn', dkCl: 'darker color', 'div ': 'color dodge', lddg: 'linear dodge',
  lgCl: 'lighter color', sLit: 'soft light', hLit: 'hard light', vLit: 'vivid light', lLit: 'linear light', pLit: 'pin light',
  hMix: 'hard mix', smud: 'exclusion', fsub: 'subtract', fdiv: 'divide', 'hue ': 'hue', 'sat ': 'saturation', colr: 'color', 'lum ': 'luminosity',
};

/** Additional-info keys that mean a layer is something Pulp cannot reproduce, and what to call it. */
const LIMIT_KEYS: Record<string, string> = {
  lfx2: 'layer effects', lrFX: 'layer effects', lmfx: 'layer effects',
  SoLd: 'smart object', PlLd: 'smart object', SoLE: 'smart object',
  SoCo: 'fill layer', GdFl: 'fill layer', PtFl: 'fill layer',
  levl: 'adjustment layer (levels)', curv: 'adjustment layer (curves)', brit: 'adjustment layer (brightness/contrast)',
  hue2: 'adjustment layer (hue/saturation)', blnc: 'adjustment layer (color balance)', selc: 'adjustment layer (selective color)',
  mixr: 'adjustment layer (channel mixer)', grdm: 'adjustment layer (gradient map)', phfl: 'adjustment layer (photo filter)',
  expA: 'adjustment layer (exposure)', vibA: 'adjustment layer (vibrance)', blwh: 'adjustment layer (black and white)',
  nvrt: 'adjustment layer (invert)', post: 'adjustment layer (posterize)', thrs: 'adjustment layer (threshold)',
  clrL: 'adjustment layer (color lookup)',
  vmsk: 'vector mask', vsms: 'vector mask', vogk: 'vector mask',
  TySh: 'text layer (its rendered pixels are used)',
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
  layers: Omit<PsdLayer, 'pixels'>[];
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
    if (this.at + n > this.bytes.length) throw new Error('the file ends early');
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

/** One channel's samples as bytes, whatever the depth: 16-bit takes the high byte. */
function readChannel(r: Reader, width: number, height: number, depth: number, compression: number, length: number | null): Uint8Array {
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
  } else {
    throw new Error(`compression ${compression} (zip) is not supported`);
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
  if (r.ascii(4) !== '8BIM') throw new Error('a layer record is not where it should be');
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
  if (maskLength > 0) limits.push('layer mask (not applied)');
  if (clipping) limits.push('clipping mask (drawn unclipped)');
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
      if (!limits.includes(LIMIT_KEYS[key]!)) limits.push(LIMIT_KEYS[key]!);
    }
    // Lengths are padded to an even count; what a block held past what was read is skipped.
    r.at = dataStart + length + (length % 2);
  }
  r.at = extraEnd;
  return { top, left, bottom, right, channels, blendKey, opacity, clipping, visible: (flags & 2) === 0, name, section, limits };
}

/**
 * Read a `.psd`. Version 1 (not `.psb`), RGB or grayscale, 8 or 16 bits per
 * channel, raw or RLE; anything else is refused by name rather than half-read.
 */
export function parsePsd(bytes: Uint8Array): PsdResult {
  try {
    if (bytes.length < 26 || String.fromCharCode(...bytes.subarray(0, 4)) !== '8BPS') return { ok: false, message: 'not a Photoshop file (no 8BPS signature)' };
    const r = new Reader(bytes);
    r.skip(4);
    const version = r.u16();
    if (version !== 1) return { ok: false, message: version === 2 ? 'a large-document .psb file is not supported' : `unknown version ${version}` };
    r.skip(6);
    const channelCount = r.u16();
    const height = r.u32();
    const width = r.u32();
    const depth = r.u16();
    const modeCode = r.u16();
    if (width === 0 || height === 0 || width > 30_000 || height > 30_000) return { ok: false, message: `an unreadable size, ${width} × ${height}` };
    if (depth !== 8 && depth !== 16) return { ok: false, message: `${depth}-bit channels are not supported (8 and 16 are)` };
    const mode = modeCode === 3 ? 'rgb' : modeCode === 1 ? 'grayscale' : null;
    if (!mode) return { ok: false, message: `colour mode ${modeCode} is not supported (RGB and grayscale are)` };
    const gray = mode === 'grayscale';
    const limits: string[] = [];

    r.skip(r.u32()); // colour mode data
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
            channels.set(ch.id, readChannel(r, w, h, depth, compression, dataLength));
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
          if (!BLEND_KEYS[raw.blendKey]) layerLimits.push(`blend mode "${BLEND_NAMES[raw.blendKey] ?? raw.blendKey.trim()}" drawn as normal`);
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
          g.layer.name = g.layer.name || 'Group';
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
        limits.push('the stored composite uses zip compression, which is not read; the layers are composited instead');
      }
      if (channels.size > 0) composite = interleave(channels, count, gray);
    } catch {
      limits.push('the stored composite could not be read; the layers are composited instead');
    }
    if (layers.length === 0) limits.push('the file has no layers; only the flattened picture');
    if (depth === 16) limits.push('16-bit channels are read down to 8 bits');
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
    layers: doc.layers.map(({ pixels: _pixels, ...rest }) => rest),
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

function blendChannel(mode: PsdBlend, cb: number, cs: number): number {
  switch (mode) {
    case 'multiply': return cb * cs;
    case 'screen': return cb + cs - cb * cs;
    case 'overlay': return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'darken': return Math.min(cb, cs);
    case 'lighten': return Math.max(cb, cs);
    case 'difference': return Math.abs(cb - cs);
    default: return cs;
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
        for (let c = 0; c < 3; c += 1) {
          const cs = px[s + c]! / 255;
          const cb = out[d + c]!;
          const blended = (1 - ab) * cs + ab * blendChannel(layer.blend, cb, cs);
          out[d + c] = ao > 0 ? ((1 - as) * cb * ab + as * blended) / ao : 0;
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

/** The layers a split places: the drawn, shown, non-group layers, top first so the stack reads as the file does. */
export function placeableLayers(outline: Pick<PsdOutline, 'layers'>, hidden: ReadonlySet<string>): PsdOutline['layers'] {
  return outline.layers.filter((l) => l.kind === 'layer' && l.width > 0 && l.height > 0 && layerShown(outline.layers, l.id, hidden));
}

/** A sentence on what the file has that Pulp does not reproduce, across all its layers; empty when nothing. */
export function psdLimitSummary(outline: Pick<PsdOutline, 'layers' | 'limits' | 'hasComposite'>): string {
  const kinds = new Set<string>();
  for (const layer of outline.layers) for (const limit of layer.limits) kinds.add(limit.replace(/ \(.*\)$/, '').replace(/^blend mode .*$/, 'other blend modes'));
  const parts = [...kinds];
  if (parts.length === 0 && outline.limits.length === 0) return '';
  const named = parts.length > 0 ? `Not reproduced: ${parts.join(', ')}.` : '';
  const fallback = outline.hasComposite ? ' The picture Photoshop stored is used where layers cannot be drawn.' : '';
  return `${named}${outline.limits.length > 0 ? ` ${outline.limits.join('. ')}.` : ''}${fallback}`.trim();
}
