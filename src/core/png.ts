/**
 * A PNG from RGBA pixels (milestone 33): what a layered file's composite and
 * its single layers are handed to the window and the template page as, since
 * nothing in a browser decodes a `.psd`. Pure apart from the deflate, which
 * the caller supplies (node:zlib in the main process) so this stays testable
 * without it.
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
