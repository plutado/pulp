/**
 * A template's poster (milestone 34): the frame its card shows. Eighty-four of
 * the 125 bundled posters, taken always from the middle of the timeline, came
 * out nearly one flat colour — overlays caught mid-way with little drawn — so
 * cards read as placeholders and as each other. The poster is now chosen from
 * frames spread over the timeline by how much each one shows, a manifest may
 * name its best moment with `posterAt`, and a transparent template's poster is
 * cropped to what it draws plus a margin, so a lower third fills its card
 * instead of sitting as a sliver. The full frame stays on the stage and in the
 * Info tab.
 *
 * This is the pure half — which frames to look at, how to measure one, which to
 * take, where to crop, and the ffmpeg arguments. The main process captures the
 * frames and runs ffmpeg (src/main/library-service.ts).
 */

import { stripFrameIndices } from './hover-scrub';
import { THUMB_SCALE } from './thumbnails';

/** The size a candidate frame is read at to be measured: enough to see what is drawn, cheap to move. */
export const PROBE_WIDTH = 48;
export const PROBE_HEIGHT = 27;

/** Pixels this transparent or more are not drawn. */
const VISIBLE_ALPHA = 24;

/**
 * The frames worth measuring: the hover strip's spread over the timeline — the
 * same frames a card scrubs through — or the one moment a manifest names.
 */
export function posterCandidateFrames(totalFrames: number, fps: number, posterAt?: number): number[] {
  const last = Math.max(0, Math.floor(totalFrames) - 1);
  if (posterAt !== undefined && Number.isFinite(posterAt) && posterAt >= 0) return [Math.min(last, Math.round(posterAt * fps))];
  return [...new Set(stripFrameIndices(totalFrames))];
}

export interface FrameMeasure {
  /** The share of the frame that is drawn at all: 0 to 1. */
  coverage: number;
  /** How much the drawn part varies in tone — 0 for one flat colour, towards 1 for a picture. */
  spread: number;
  /** Where the drawn part is, in probe pixels, inclusive; null when nothing is drawn. */
  bbox: { left: number; top: number; right: number; bottom: number } | null;
}

/**
 * What one frame shows, from its pixels as RGBA bytes at the probe size. An
 * opaque template's coverage is one; what tells its frames apart is the spread.
 */
export function measureFrame(rgba: Uint8Array, width: number, height: number): FrameMeasure {
  const total = width * height;
  let drawn = 0;
  let sum = 0;
  const lumas: number[] = [];
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let i = 0; i < total; i += 1) {
    const at = i * 4;
    const a = rgba[at + 3] ?? 0;
    if (a < VISIBLE_ALPHA) continue;
    drawn += 1;
    const luma = (0.2126 * (rgba[at] ?? 0) + 0.7152 * (rgba[at + 1] ?? 0) + 0.0722 * (rgba[at + 2] ?? 0)) / 255;
    lumas.push(luma);
    sum += luma;
    const x = i % width;
    const y = Math.floor(i / width);
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  if (drawn === 0) return { coverage: 0, spread: 0, bbox: null };
  const mean = sum / drawn;
  const variance = lumas.reduce((n, l) => n + (l - mean) * (l - mean), 0) / drawn;
  // A standard deviation of a quarter of the range is already a strongly varied picture.
  const spread = Math.min(1, Math.sqrt(variance) / 0.25);
  return { coverage: drawn / total, spread, bbox: { left, top, right, bottom } };
}

/** How much a frame has to show: what is drawn, weighted by how varied it is. */
export function posterScore(m: FrameMeasure): number {
  return m.coverage * (0.2 + m.spread);
}

/** A frame that would read as a placeholder: next to nothing drawn, or one flat colour. */
export function isNearlyUniform(m: FrameMeasure): boolean {
  return m.coverage < 0.02 || m.spread < 0.03;
}

/**
 * Which candidate to take: the one that shows the most. Among frames within a
 * tenth of the best, the one nearest the middle of the run, which is what the
 * poster always was — so a template whose frames show alike keeps its old poster.
 */
export function choosePosterFrame(measures: readonly FrameMeasure[]): number {
  if (measures.length === 0) return 0;
  const scores = measures.map(posterScore);
  const best = Math.max(...scores);
  const middle = (measures.length - 1) / 2;
  let pick = 0;
  let pickDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i]! < best * 0.9) continue;
    const distance = Math.abs(i - middle);
    if (distance < pickDistance) {
      pick = i;
      pickDistance = distance;
    }
  }
  return pick;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where to crop a transparent template's poster: the drawn part, scaled from
 * probe pixels to the frame, with a margin around it. Null when there is nothing
 * to gain — nothing drawn, or the drawing already fills most of the frame — so an
 * overlay that covers the picture keeps the whole picture. The crop never drops
 * below a third of the frame's width, so a small bug does not become a blur, and
 * its sides come out even, as video sizes must.
 */
export function contentCrop(
  bbox: FrameMeasure['bbox'],
  frame: { width: number; height: number },
  probe: { width: number; height: number } = { width: PROBE_WIDTH, height: PROBE_HEIGHT },
  marginFraction = 0.1,
): CropRect | null {
  if (!bbox) return null;
  const sx = frame.width / probe.width;
  const sy = frame.height / probe.height;
  // A probe pixel is a block of the frame: the right and bottom edges include their whole block.
  let left = bbox.left * sx;
  let top = bbox.top * sy;
  let right = (bbox.right + 1) * sx;
  let bottom = (bbox.bottom + 1) * sy;
  if ((right - left) * (bottom - top) >= 0.8 * frame.width * frame.height) return null;
  const margin = Math.max(right - left, bottom - top) * marginFraction;
  left -= margin;
  top -= margin;
  right += margin;
  bottom += margin;
  // Not smaller than a third of the frame across, grown about the centre.
  const minWidth = frame.width / 3;
  if (right - left < minWidth) {
    const centre = (left + right) / 2;
    left = centre - minWidth / 2;
    right = centre + minWidth / 2;
  }
  const minHeight = minWidth * (frame.height / frame.width);
  if (bottom - top < minHeight) {
    const centre = (top + bottom) / 2;
    top = centre - minHeight / 2;
    bottom = centre + minHeight / 2;
  }
  // Inside the frame: a window that runs past an edge slides back in rather than being cut,
  // so the floor on its size holds in a corner too; only then is anything clamped.
  if (right > frame.width) { left -= right - frame.width; right = frame.width; }
  if (bottom > frame.height) { top -= bottom - frame.height; bottom = frame.height; }
  if (left < 0) { right -= left; left = 0; }
  if (top < 0) { bottom -= top; top = 0; }
  right = Math.min(frame.width, right);
  bottom = Math.min(frame.height, bottom);
  const even = (n: number) => Math.floor(n / 2) * 2;
  const width = Math.max(2, even(right - left));
  const height = Math.max(2, even(bottom - top));
  const x = Math.max(0, Math.min(frame.width - width, even(left)));
  const y = Math.max(0, Math.min(frame.height - height, even(top)));
  if (width >= frame.width && height >= frame.height) return null;
  return { x, y, width, height };
}

/** ffmpeg: a captured PNG on stdin, its pixels at the probe size as raw RGBA on stdout. */
export function probeFrameArgs(width = PROBE_WIDTH, height = PROBE_HEIGHT): string[] {
  return ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', 'pipe:0', '-vf', `scale=${width}:${height}`, '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'];
}

/** ffmpeg: the chosen PNG on stdin, cropped where there is a crop, shrunk into the cache. */
export function posterFromFrameArgs(output: string, crop: CropRect | null): string[] {
  const filters = [...(crop ? [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`] : []), THUMB_SCALE, 'format=rgba'];
  return ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', 'pipe:0', '-frames:v', '1', '-vf', filters.join(','), '-f', 'image2', output];
}
