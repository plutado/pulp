/**
 * Compositing one captured frame over another (milestone 50): how the
 * captions are burned into a render. The template's page and the caption
 * style's page are captured separately — two offscreen windows, the same
 * size — and the caption bitmap is laid over the graphic's before the frame
 * goes to ffmpeg, so the encoder sees one picture and no second input.
 *
 * The bitmaps are in whatever layout the capture probe measured
 * (src/core/capture-format.ts): the channel order does not matter to an
 * "over", only where the alpha is and whether the colors are already
 * multiplied by it, which decides the arithmetic. Pure, in place, and tested
 * on small buffers; a 1080p frame is two million pixels through the loop.
 */

import type { CaptureFormat } from './capture-format';

/**
 * `over` laid over `under`, in place in `under`. Both hold `width × height`
 * pixels of four bytes, alpha last, as both known layouts have it. A fully
 * transparent `over` pixel leaves `under` as it was; a fully opaque one
 * replaces it; between, the usual over operator — in premultiplied form when
 * the capture is premultiplied, which is one multiply fewer per channel.
 */
export function compositeOver(under: Uint8Array, over: Uint8Array, format: Pick<CaptureFormat, 'premultiplied'>): void {
  const n = Math.min(under.length, over.length) - (Math.min(under.length, over.length) % 4);
  if (format.premultiplied) {
    for (let i = 0; i < n; i += 4) {
      const a = over[i + 3]!;
      if (a === 0) continue;
      if (a === 255) {
        under[i] = over[i]!;
        under[i + 1] = over[i + 1]!;
        under[i + 2] = over[i + 2]!;
        under[i + 3] = 255;
        continue;
      }
      const keep = 255 - a;
      under[i] = Math.min(255, over[i]! + ((under[i]! * keep + 127) / 255) | 0);
      under[i + 1] = Math.min(255, over[i + 1]! + ((under[i + 1]! * keep + 127) / 255) | 0);
      under[i + 2] = Math.min(255, over[i + 2]! + ((under[i + 2]! * keep + 127) / 255) | 0);
      under[i + 3] = Math.min(255, a + ((under[i + 3]! * keep + 127) / 255) | 0);
    }
    return;
  }
  for (let i = 0; i < n; i += 4) {
    const a = over[i + 3]!;
    if (a === 0) continue;
    if (a === 255) {
      under[i] = over[i]!;
      under[i + 1] = over[i + 1]!;
      under[i + 2] = over[i + 2]!;
      under[i + 3] = 255;
      continue;
    }
    // Straight alpha: the result's alpha first, then each color weighted by its own coverage.
    const sa = a / 255;
    const da = under[i + 3]! / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) continue;
    for (let c = 0; c < 3; c++) {
      under[i + c] = Math.round((over[i + c]! * sa + under[i + c]! * da * (1 - sa)) / outA);
    }
    under[i + 3] = Math.round(outA * 255);
  }
}
