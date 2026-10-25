/**
 * Perceptual hashes of rendered frames, for the visual regression check.
 *
 * A reference image per template, aspect and frame would be hundreds of
 * binaries in a repository that deliberately ships none — the sample media is
 * generated rather than committed for the same reason. A hash is a short
 * string instead: it rides in a JSON file a reviewer can read in a diff, and
 * two frames that look the same hash the same.
 *
 * The hash is a 64-bit average hash: the frame is flattened over black (alpha
 * is part of how a template looks), reduced to an 8 x 8 grid of average
 * luminance, and each cell becomes one bit — is it brighter than the mean. It
 * sees composition and tone, not a pixel, so antialiasing and a font hinted a
 * shade differently on another platform do not fail it, while a moved title, a
 * changed colour or a dropped element do. Pure.
 */

/** The grid the frame is reduced to; 8 x 8 gives the 64 bits of the hash. */
export const HASH_SIDE = 8;

/**
 * How many bits may differ before two frames are called different. Chosen to
 * sit above the noise of antialiasing across platforms and well below a real
 * change: a moved or recoloured element shifts many cells at once.
 */
export const HASH_TOLERANCE = 6;

/** Average luminance per cell of an 8 x 8 grid, from RGBA bytes flattened over black. */
function cellLuma(rgba: Uint8Array | Buffer, width: number, height: number): number[] {
  const cells = new Array<number>(HASH_SIDE * HASH_SIDE).fill(0);
  const counts = new Array<number>(HASH_SIDE * HASH_SIDE).fill(0);
  for (let y = 0; y < height; y++) {
    const row = Math.min(HASH_SIDE - 1, Math.floor((y * HASH_SIDE) / height));
    for (let x = 0; x < width; x++) {
      const col = Math.min(HASH_SIDE - 1, Math.floor((x * HASH_SIDE) / width));
      const i = (y * width + x) * 4;
      // Over black, so transparency reads as dark: what a template leaves clear is part of its look.
      const a = rgba[i + 3]! / 255;
      const luma = (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) * a;
      const at = row * HASH_SIDE + col;
      cells[at] = (cells[at] ?? 0) + luma;
      counts[at] = (counts[at] ?? 0) + 1;
    }
  }
  return cells.map((sum, i) => (counts[i]! > 0 ? sum / counts[i]! : 0));
}

/** The hash of one frame, as 16 hex characters. */
export function frameHash(rgba: Uint8Array | Buffer, width: number, height: number): string {
  if (width <= 0 || height <= 0) return '0'.repeat(16);
  const cells = cellLuma(rgba, width, height);
  const mean = cells.reduce((sum, v) => sum + v, 0) / cells.length;
  let hex = '';
  for (let nibble = 0; nibble < 16; nibble++) {
    let bits = 0;
    for (let bit = 0; bit < 4; bit++) bits = (bits << 1) | (cells[nibble * 4 + bit]! > mean ? 1 : 0);
    hex += bits.toString(16);
  }
  return hex;
}

/** How many bits two hashes differ by; 64 at most. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return HASH_SIDE * HASH_SIDE;
  let apart = 0;
  for (let i = 0; i < a.length; i++) {
    let diff = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (diff) {
      apart += diff & 1;
      diff >>= 1;
    }
  }
  return apart;
}

/** Whether a frame still looks like its reference. */
export function looksSame(hash: string, reference: string, tolerance = HASH_TOLERANCE): boolean {
  return hammingDistance(hash, reference) <= tolerance;
}

/** Where a template's references live, keyed so a failure can name all three. */
export type VisualReferences = Record<string, Record<string, Record<string, string>>>;

/** The frames checked for every template: the start, the middle and near the end. */
export function framesToCheck(totalFrames: number): number[] {
  const last = Math.max(0, totalFrames - 1);
  return [...new Set([Math.min(1, last), Math.floor(last / 2), Math.max(0, last - 1)])].sort((a, b) => a - b);
}
