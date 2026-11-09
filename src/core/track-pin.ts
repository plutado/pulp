/**
 * Pinning a layer to a motion track (milestone 76): the track's samples, in
 * the clip's own seconds and picture fractions, become the layer's keyframes
 * (milestone 51) in the graphic's seconds and the frame's fractions — through
 * the cut that plays the clip (where on the timeline each clip second lands,
 * src/core/cut-track.ts) and the letterbox the cut's picture is drawn in
 * (how the stage and the render place a clip's picture in the frame).
 *
 * A pin keeps the layer where it stands at the moment it is pinned, and moves
 * it from there by however the target moves: the layer's offset from the
 * target stays what it was. With a second track, the distance between the two
 * points scales the layer and their bearing turns it, about the layer's own
 * center, as a hand following two corners would. The keys are linear, one per
 * tracked frame, thinned to the few the motion needs — and then they are keys
 * like any others, dragged, eased and deleted by hand.
 */

import { cutTimelineTime, cutSourceTime, type Cut } from './cut-track';
import { KEY_LIMITS, type LayerKey, type KeyedPose } from './layer-keys';
import type { MotionTrack } from './motion-track';
import { trackPositionAt } from './motion-track';

export interface Size {
  width: number;
  height: number;
}

export interface PxBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a cut's picture is drawn in the frame: fitted whole and centered, the
 * pad showing at the sides or above and below. Mirrors the stage's drawing of
 * a cut (src/renderer/stage-track.ts) and the render's letterboxing.
 */
export function cutPictureBox(frame: Size, clip: Size): PxBox {
  const scale = Math.min(frame.width / Math.max(1, clip.width), frame.height / Math.max(1, clip.height));
  const width = clip.width * scale;
  const height = clip.height * scale;
  return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height };
}

/** A track's picture fraction as a point on the frame, in frame pixels. */
export function trackPointOnFrame(sample: { x: number; y: number }, box: PxBox): { x: number; y: number } {
  return { x: box.x + sample.x * box.width, y: box.y + sample.y * box.height };
}

/** The inverse: a frame point as a fraction of the cut's picture, for the point a person picks. */
export function framePointOnPicture(point: { x: number; y: number }, box: PxBox): { x: number; y: number } {
  return { x: box.width > 0 ? (point.x - box.x) / box.width : 0, y: box.height > 0 ? (point.y - box.y) / box.height : 0 };
}

export interface PinInput {
  /** The track the layer follows, and a second whose distance and bearing from the first scale and turn it. */
  track: MotionTrack;
  second?: MotionTrack;
  /** The cut that plays the clip, and where it starts on the timeline. */
  cut: Pick<Cut, 'from' | 'to' | 'speed' | 'hold'>;
  cutStart: number;
  frame: Size;
  clip: Size;
  /** The moment the pin is made, in the graphic's seconds, and the layer's pose there: the pin keeps it there. */
  at: number;
  pose: KeyedPose;
  /** How far a key may stray from the straight line between its neighbors before it must stay, in frame fractions. */
  tolerance?: number;
}

const DEFAULT_TOLERANCE = 0.0015;
const degrees = (radians: number): number => (radians * 180) / Math.PI;
const round = (v: number, places = 5): number => Math.round(v * 10 ** places) / 10 ** places;

/**
 * The keys a pin writes: one per tracked frame of the cut's window, thinned.
 * Each key's offset is the layer's pose at the pin moment plus the target's
 * movement since then, as fractions of the frame; with a second track, the
 * scale and the angle follow the two points' distance and bearing.
 */
export function pinKeys(input: PinInput): LayerKey[] {
  const box = cutPictureBox(input.frame, input.clip);
  const { track, second, cut, cutStart, frame, pose } = input;
  // The clip second under the pin moment, which the keys are measured against.
  const anchorSource = cutSourceTime(cut, input.at - cutStart);
  const p0 = trackPositionAt(track, anchorSource);
  if (!p0) return [];
  const q0 = second ? trackPositionAt(second, anchorSource) : null;
  const P0 = trackPointOnFrame(p0, box);
  const Q0 = q0 ? trackPointOnFrame(q0, box) : null;
  const d0 = Q0 ? Math.hypot(Q0.x - P0.x, Q0.y - P0.y) : 0;
  const a0 = Q0 ? Math.atan2(Q0.y - P0.y, Q0.x - P0.x) : 0;
  const keys: LayerKey[] = [];
  for (const sample of track.samples) {
    if (sample.at < cut.from - 1e-6 || sample.at > cut.to + 1e-6) continue;
    const at = round(cutStart + cutTimelineTime(cut, sample.at), 3);
    const P = trackPointOnFrame(sample, box);
    let scale = pose.scale;
    let rotate = pose.rotate;
    if (second && Q0 && d0 > 1e-6) {
      const q = trackPositionAt(second, sample.at);
      if (q) {
        const Q = trackPointOnFrame(q, box);
        const d = Math.hypot(Q.x - P.x, Q.y - P.y);
        scale = pose.scale * (d / d0);
        rotate = pose.rotate + degrees(Math.atan2(Q.y - P.y, Q.x - P.x) - a0);
      }
    }
    keys.push({
      at,
      dx: round(pose.dx + (P.x - P0.x) / frame.width),
      dy: round(pose.dy + (P.y - P0.y) / frame.height),
      scale: round(Math.min(KEY_LIMITS.scale.max, Math.max(KEY_LIMITS.scale.min, scale))),
      rotate: round(rotate),
      opacity: pose.opacity,
      easing: 'linear',
    });
  }
  // One key per moment: a cut played slower than the clip lands two clip frames on one timeline instant.
  const distinct: LayerKey[] = [];
  for (const key of keys) {
    if (distinct.length > 0 && Math.abs(distinct[distinct.length - 1]!.at - key.at) < 0.0005) distinct[distinct.length - 1] = key;
    else distinct.push(key);
  }
  return thinKeys(distinct, input.tolerance ?? DEFAULT_TOLERANCE, KEY_LIMITS.count);
}

/** How far a key stands from the straight line between two others, in the pose's own units weighted to frame fractions. */
function deviation(key: LayerKey, a: LayerKey, b: LayerKey): number {
  const span = Math.max(1e-6, b.at - a.at);
  const f = (key.at - a.at) / span;
  const lerp = (p: number, q: number): number => p + (q - p) * f;
  // Scale and angle count in roughly comparable terms: a hundredth of scale and a degree as a thousandth of the frame.
  return Math.max(
    Math.abs(key.dx - lerp(a.dx, b.dx)),
    Math.abs(key.dy - lerp(a.dy, b.dy)),
    Math.abs(key.scale - lerp(a.scale, b.scale)) * 0.1,
    Math.abs(key.rotate - lerp(a.rotate, b.rotate)) * 0.001,
  );
}

/**
 * The fewest keys that keep the motion within `tolerance` of the full set
 * (Douglas–Peucker over the pose), and never more than `max`: when the
 * tolerance alone leaves too many, it is widened until they fit. The first
 * and last keys always stay.
 */
export function thinKeys(keys: readonly LayerKey[], tolerance: number, max: number): LayerKey[] {
  if (keys.length <= 2) return [...keys];
  let eps = Math.max(0, tolerance);
  for (let round = 0; round < 40; round++) {
    const keep = new Array<boolean>(keys.length).fill(false);
    keep[0] = true;
    keep[keys.length - 1] = true;
    const stack: [number, number][] = [[0, keys.length - 1]];
    while (stack.length > 0) {
      const [lo, hi] = stack.pop()!;
      let worst = -1;
      let worstAt = -1;
      for (let i = lo + 1; i < hi; i++) {
        const d = deviation(keys[i]!, keys[lo]!, keys[hi]!);
        if (d > worst) {
          worst = d;
          worstAt = i;
        }
      }
      if (worstAt >= 0 && worst > eps) {
        keep[worstAt] = true;
        stack.push([lo, worstAt], [worstAt, hi]);
      }
    }
    const kept = keys.filter((_, i) => keep[i]);
    if (kept.length <= max) return kept;
    eps = eps === 0 ? 1e-5 : eps * 1.5;
  }
  // Still too many on a motion that never settles: every nth key, the ends kept.
  const step = Math.ceil((keys.length - 1) / (max - 1));
  const out = keys.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== keys[keys.length - 1]) out.push(keys[keys.length - 1]!);
  return out;
}
