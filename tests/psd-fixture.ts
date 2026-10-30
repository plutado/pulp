/**
 * A `.psd` writer for the tests (milestone 33): enough of the format to make
 * fixtures with named layers, groups, visibility, opacity, blend modes, raw or
 * RLE channels, 8 or 16 bits, and a stored composite — generated, never
 * shipped. Mirrors what src/core/psd.ts reads; nothing in the app writes a PSD.
 */

export type FixtureCompression = 'raw' | 'rle' | 'zip' | 'zip-prediction';

export interface FixtureLayer {
  name: string;
  /** Canvas rectangle. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Straight RGBA, width × height × 4. */
  rgba: Uint8Array;
  visible?: boolean;
  opacity?: number;
  blendKey?: string;
  clipping?: boolean;
  /** Additional-info keys to write with empty bodies, for naming limits ("lfx2", "SoLd"). */
  extraKeys?: string[];
  /** Write the name as unicode too ('luni'), which real files always do. */
  unicodeName?: boolean;
}

export interface FixtureGroup {
  group: string;
  layers: FixtureItem[];
  visible?: boolean;
  opacity?: number;
}

export type FixtureItem = FixtureLayer | FixtureGroup;

export interface FixtureOptions {
  width: number;
  height: number;
  /** Bottom first. */
  layers: FixtureItem[];
  /** Straight RGBA for the stored composite; omitted writes a transparent one. */
  composite?: Uint8Array;
  rle?: boolean;
  /** How layer channels are stored; `rle: true` is shorthand for 'rle'. Zip needs a deflate (node:zlib). */
  compression?: FixtureCompression;
  deflate?: (bytes: Uint8Array) => Uint8Array;
  depth?: 8 | 16;
  grayscale?: boolean;
  version?: number;
}

class Writer {
  parts: number[] = [];
  u8(n: number): void { this.parts.push(n & 0xff); }
  u16(n: number): void { this.u8(n >> 8); this.u8(n); }
  u32(n: number): void { this.u16(n >>> 16); this.u16(n & 0xffff); }
  i32(n: number): void { this.u32(n >>> 0); }
  ascii(s: string): void { for (const ch of s) this.u8(ch.charCodeAt(0)); }
  bytes(b: Uint8Array | number[]): void { for (const x of b) this.u8(x); }
  get length(): number { return this.parts.length; }
  done(): Uint8Array { return new Uint8Array(this.parts); }
}

/** PackBits, the simple way: literal runs of up to 128 bytes. Valid RLE, not tight. */
export function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < row.length; i += 128) {
    const run = row.subarray(i, Math.min(row.length, i + 128));
    out.push(run.length - 1, ...run);
  }
  return new Uint8Array(out);
}

function channelBytes(samples: Uint8Array, depth: 8 | 16): Uint8Array {
  if (depth === 8) return samples;
  const out = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    out[i * 2] = samples[i]!;
    out[i * 2 + 1] = 0;
  }
  return out;
}

/** Row-delta prediction, the encode side of src/core/psd.ts's undoPrediction: bytes at 8 bits, 16-bit values at 16. */
export function applyPrediction(bytes: Uint8Array, width: number, height: number, depth: 8 | 16): Uint8Array {
  const out = new Uint8Array(bytes);
  if (depth === 16) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width * 2;
      for (let x = width - 1; x >= 1; x -= 1) {
        const at = row + x * 2;
        const value = ((out[at]! << 8) | out[at + 1]!) - ((out[at - 2]! << 8) | out[at - 1]!);
        out[at] = (value >> 8) & 0xff;
        out[at + 1] = value & 0xff;
      }
    }
    return out;
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = width - 1; x >= 1; x -= 1) out[row + x] = (out[row + x]! - out[row + x - 1]!) & 0xff;
  }
  return out;
}

/** One channel's image data for a layer: compression word, then the samples. */
function writeChannelData(samples: Uint8Array, width: number, height: number, depth: 8 | 16, compression: FixtureCompression, deflate?: (bytes: Uint8Array) => Uint8Array): Uint8Array {
  const w = new Writer();
  const bytes = channelBytes(samples, depth);
  const rowBytes = width * (depth === 16 ? 2 : 1);
  if (compression === 'raw') {
    w.u16(0);
    w.bytes(bytes);
    return w.done();
  }
  if (compression === 'zip' || compression === 'zip-prediction') {
    if (!deflate) throw new Error('a zip fixture needs a deflate');
    w.u16(compression === 'zip' ? 2 : 3);
    w.bytes(deflate(compression === 'zip' ? bytes : applyPrediction(bytes, width, height, depth)));
    return w.done();
  }
  w.u16(1);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y += 1) rows.push(packBits(bytes.subarray(y * rowBytes, (y + 1) * rowBytes)));
  for (const r of rows) w.u16(r.length);
  for (const r of rows) w.bytes(r);
  return w.done();
}

function plane(rgba: Uint8Array, channel: number): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i += 1) out[i] = rgba[i * 4 + channel]!;
  return out;
}

interface FlatRecord {
  layer: FixtureLayer | null;
  name: string;
  section: number;
  visible: boolean;
  opacity: number;
  blendKey: string;
}

/** Bottom-first file order: a group's hidden divider, its children, then the group's own record. */
function flatten(items: FixtureItem[]): FlatRecord[] {
  const out: FlatRecord[] = [];
  for (const item of items) {
    if ('group' in item) {
      out.push({ layer: null, name: '</Layer group>', section: 3, visible: true, opacity: 1, blendKey: 'pass' });
      out.push(...flatten(item.layers));
      out.push({ layer: null, name: item.group, section: 1, visible: item.visible ?? true, opacity: item.opacity ?? 1, blendKey: 'pass' });
    } else {
      out.push({ layer: item, name: item.name, section: 0, visible: item.visible ?? true, opacity: item.opacity ?? 1, blendKey: item.blendKey ?? 'norm' });
    }
  }
  return out;
}

export function writePsd(options: FixtureOptions): Uint8Array {
  const { width, height } = options;
  const depth = options.depth ?? 8;
  const rle = options.rle ?? false;
  const compression: FixtureCompression = options.compression ?? (rle ? 'rle' : 'raw');
  const gray = options.grayscale ?? false;
  const colourChannels = gray ? [0] : [0, 1, 2];
  const w = new Writer();
  w.ascii('8BPS');
  w.u16(options.version ?? 1);
  w.bytes(new Uint8Array(6));
  w.u16(colourChannels.length + 1);
  w.u32(height);
  w.u32(width);
  w.u16(depth);
  w.u16(gray ? 1 : 3);
  w.u32(0); // colour mode data
  w.u32(0); // image resources

  const records = flatten(options.layers);
  const layerInfo = new Writer();
  layerInfo.u16(records.length);
  const channelData: Uint8Array[] = [];
  for (const rec of records) {
    const l = rec.layer;
    const ids = l ? [...colourChannels, -1] : [];
    const datas = l
      ? ids.map((id) => writeChannelData(plane(l.rgba, id === -1 ? 3 : id), l.width, l.height, depth, compression, options.deflate))
      : [];
    layerInfo.i32(l ? l.top : 0);
    layerInfo.i32(l ? l.left : 0);
    layerInfo.i32(l ? l.top + l.height : 0);
    layerInfo.i32(l ? l.left + l.width : 0);
    layerInfo.u16(ids.length);
    ids.forEach((id, i) => {
      layerInfo.u16(id & 0xffff);
      layerInfo.u32(datas[i]!.length);
    });
    layerInfo.ascii('8BIM');
    layerInfo.ascii(rec.blendKey.padEnd(4, ' ').slice(0, 4));
    layerInfo.u8(Math.round(rec.opacity * 255));
    layerInfo.u8(l?.clipping ? 1 : 0);
    layerInfo.u8(rec.visible ? 0 : 2);
    layerInfo.u8(0);
    const extra = new Writer();
    extra.u32(0); // no mask
    extra.u32(0); // no blending ranges
    const nameBytes = [...rec.name].map((c) => c.charCodeAt(0) & 0xff);
    extra.u8(nameBytes.length);
    extra.bytes(nameBytes);
    extra.bytes(new Uint8Array((4 - ((nameBytes.length + 1) % 4)) % 4));
    const block = (key: string, body: Uint8Array) => {
      extra.ascii('8BIM');
      extra.ascii(key);
      extra.u32(body.length);
      extra.bytes(body);
      if (body.length % 2 === 1) extra.u8(0);
    };
    if (l?.unicodeName ?? true) {
      const u = new Writer();
      u.u32(rec.name.length);
      for (const ch of rec.name) u.u16(ch.charCodeAt(0));
      block('luni', u.done());
    }
    if (rec.section !== 0) {
      const s = new Writer();
      s.u32(rec.section);
      block('lsct', s.done());
    }
    for (const key of l?.extraKeys ?? []) block(key, new Uint8Array([1, 2, 3])); // odd, to exercise the padding
    layerInfo.u32(extra.length);
    layerInfo.bytes(extra.done());
    channelData.push(...datas);
  }
  for (const d of channelData) layerInfo.bytes(d);
  if (layerInfo.length % 2 === 1) layerInfo.u8(0);

  const layerMask = new Writer();
  if (records.length > 0) {
    layerMask.u32(layerInfo.length);
    layerMask.bytes(layerInfo.done());
    layerMask.u32(0); // global layer mask info
  }
  w.u32(layerMask.length);
  w.bytes(layerMask.done());

  // The stored composite, planar, all rows' lengths first under RLE.
  const composite = options.composite ?? new Uint8Array(width * height * 4);
  const planes = [...colourChannels.map((c) => plane(composite, c)), plane(composite, 3)].map((p) => channelBytes(p, depth));
  const rowBytes = width * (depth === 16 ? 2 : 1);
  if (!rle) {
    w.u16(0);
    for (const p of planes) w.bytes(p);
  } else {
    w.u16(1);
    const rows = planes.flatMap((p) => Array.from({ length: height }, (_, y) => packBits(p.subarray(y * rowBytes, (y + 1) * rowBytes))));
    for (const r of rows) w.u16(r.length);
    for (const r of rows) w.bytes(r);
  }
  return w.done();
}

/** A solid rectangle of one colour, as straight RGBA. */
export function solid(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) out.set(rgba, i * 4);
  return out;
}
