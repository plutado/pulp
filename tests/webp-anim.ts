/**
 * Reading an animated WebP back (milestone 82's tests): ffmpeg 8 cannot
 * decode one — its WebP demuxer reads stills only and says "image data not
 * found" — so the file's own RIFF chunks are read here. Enough for a test:
 * the canvas, whether it says it has alpha and animation, how often it
 * loops, and each frame's duration.
 *
 * libwebp merges consecutive frames whose change it would not store into one
 * longer frame, so a WebP's frame count is at most the frames it was given;
 * the durations always add up to the clip's length.
 */

export interface WebpAnimation {
  width: number;
  height: number;
  /** The VP8X header's alpha flag. */
  alpha: boolean;
  /** The VP8X header's animation flag. */
  animated: boolean;
  /** The ANIM chunk's loop count; 0 is forever. Undefined for a still. */
  loops?: number;
  /** Milliseconds each frame is shown for, in order. */
  durations: number[];
}

/** The chunks of a WebP, or null when the bytes are not one. */
export function readWebp(bytes: Uint8Array): WebpAnimation | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.length < 30 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
  const out: WebpAnimation = { width: 0, height: 0, alpha: false, animated: false, durations: [] };
  for (let at = 12; at + 8 <= bytes.length;) {
    const name = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (name === 'VP8X') {
      const flags = bytes[body]!;
      out.alpha = (flags & 0x10) !== 0;
      out.animated = (flags & 0x02) !== 0;
      out.width = u24(body + 4) + 1;
      out.height = u24(body + 7) + 1;
    } else if (name === 'ANIM') {
      out.loops = view.getUint16(body + 4, true);
    } else if (name === 'ANMF') {
      out.durations.push(u24(body + 12));
    }
    // Chunks are padded to an even length.
    at = body + size + (size & 1);
  }
  return out;
}
