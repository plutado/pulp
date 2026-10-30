/**
 * PNG, both ways (milestone 33): encoding RGBA pixels — what a layered file's
 * composite and its single layers are handed to the window and the template
 * page as — and decoding the PNGs other layered formats carry inside them
 * (OpenRaster's layers, Krita's merged picture). Pure apart from the deflate
 * and inflate, which the caller supplies (node:zlib in the main process) so
 * this stays testable without them.
 */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** The rows as PNG wants them before compression: a filter byte (none) ahead of each. */
export function filteredRows(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const out = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    out[y * (stride + 1)] = 0;
    out.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return out;
}

/** An 8-bit RGBA PNG. `deflate` is zlib's deflate (with the zlib header), as node:zlib's deflateSync gives it. */
export function encodePng(rgba: Uint8Array, width: number, height: number, deflate: (bytes: Uint8Array) => Uint8Array): Uint8Array {
  if (rgba.length < width * height * 4) throw new Error(`encodePng: ${rgba.length} bytes for ${width} × ${height}`);
  const header = new Uint8Array(13);
  header.set(u32(width), 0);
  header.set(u32(height), 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflate(filteredRows(rgba, width, height))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------- decoding

export interface DecodedPng {
  width: number;
  height: number;
  /** Straight RGBA, 8 bits per channel whatever the file held. */
  rgba: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode an 8-bit, non-interlaced PNG — greyscale, RGB, palette, or either
 * with alpha — to straight RGBA. `inflate` is zlib's, as the encoder's deflate
 * is. Anything else (16-bit, interlaced) is refused by name.
 */
export function decodePng(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): DecodedPng {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || magic.some((b, i) => bytes[i] !== b)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  let alphaTable: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = bytes[at + 16]!;
      colorType = bytes[at + 17]!;
      if (depth !== 8) throw new Error(`${depth}-bit PNG channels are not read (8-bit is)`);
      if (bytes[at + 20] !== 0) throw new Error('an interlaced PNG is not read');
    } else if (type === 'PLTE') palette = new Uint8Array(data);
    else if (type === 'tRNS') alphaTable = new Uint8Array(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (width === 0 || height === 0 || idat.length === 0) throw new Error('a PNG with no picture');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  if (![0, 2, 3, 4, 6].includes(colorType)) throw new Error(`PNG colour type ${colorType} is not read`);
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = inflate(joined);
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('a PNG shorter than its own size');
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? lines[out + x - channels]! : 0;
      const up = y > 0 ? lines[prev + x]! : 0;
      const upLeft = y > 0 && x >= channels ? lines[prev + x - channels]! : 0;
      let v = row[x]!;
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (left + up) >> 1;
      else if (filter === 4) v += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`PNG filter ${filter} is not one the format has`);
      lines[out + x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    if (colorType === 6) rgba.set(lines.subarray(s, s + 4), i * 4);
    else if (colorType === 2) {
      rgba.set(lines.subarray(s, s + 3), i * 4);
      rgba[i * 4 + 3] = 255;
    } else if (colorType === 3) {
      const idx = lines[s]!;
      rgba[i * 4] = palette?.[idx * 3] ?? 0;
      rgba[i * 4 + 1] = palette?.[idx * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = palette?.[idx * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = alphaTable && idx < alphaTable.length ? alphaTable[idx]! : 255;
    } else {
      const grey = lines[s]!;
      rgba[i * 4] = grey;
      rgba[i * 4 + 1] = grey;
      rgba[i * 4 + 2] = grey;
      rgba[i * 4 + 3] = colorType === 4 ? lines[s + 1]! : 255;
    }
  }
  return { width, height, rgba };
}
