/**
 * Auto-reframe for vertical video (milestone 77): wide footage cut to a tall
 * frame follows its subject instead of taking the middle, on the machine, with
 * nothing sent anywhere. Pure: the subject found in frames the main process
 * reads (the same color proxy the motion tracker uses), a crop path that eases
 * rather than jitters and starts again at each cut, and the keys a cut keeps
 * — which a hand can still move on the stage.
 *
 * **Finding the subject.** Each frame is scored in blocks: skin tone first (a
 * face, or a hand, is what a viewer looks at), then what moves against the
 * frame before, then what stands out by contrast. A frame with skin in it
 * follows the skin; one without follows the motion and the contrast together.
 *
 * **A steady crop.** Within a shot the found centers are averaged over a
 * window of frames and the crop moves only when the subject has strayed past a
 * dead zone, so a subject swaying in place does not drag the frame with it. A
 * shot boundary — a frame that differs from the one before more than a cut
 * does — starts the path again, so the crop snaps to the new subject rather
 * than easing across the cut.
 *
 * **The crop.** The frame is filled (the picture scaled to cover it) and the
 * window is centered on the path, clamped so the window stays inside the
 * picture. The same arithmetic places the stage's drawing and the render's
 * crop expression, so the two agree.
 */

import type { ReframeKey } from './cut-track';
import type { GrayFrames } from './motion-track';

export interface Size {
  width: number;
  height: number;
}

export interface SubjectPoint {
  /** The subject's center as fractions of the picture. */
  x: number;
  y: number;
  /** How surely: the share of the frame's saliency the chosen region carried, 0..1. */
  c: number;
  /** Whether skin was what decided it. */
  face: boolean;
}

export interface SubjectPath {
  /** One per frame, in frame order. */
  points: SubjectPoint[];
  /** Frame indices where a new shot begins (the first frame is always one). */
  shots: number[];
}

/** Blocks a frame is scored in: this many pixels square at the proxy. */
export const REFRAME_BLOCK = 8;
/** Mean absolute frame difference (0..255) above which a frame begins a new shot. */
export const SHOT_THRESHOLD = 40;
/** Frames averaged on either side when the path is steadied: half a second at 30 fps. */
export const STEADY_WINDOW = 15;
/** The crop moves only once the subject has strayed this far from its center, as a fraction of the picture. */
export const DEAD_ZONE = 0.04;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Skin, by the classic YCbCr rule, from RGB. */
function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/** Gray of a pixel, whatever the frame's channels. */
function gray(frame: Uint8Array, at: number, channels: number): number {
  if (channels === 1) return frame[at]!;
  return 0.299 * frame[at]! + 0.587 * frame[at + 1]! + 0.114 * frame[at + 2]!;
}

/** The mean absolute difference between two frames' grays, 0..255, sampled on a coarse grid. */
export function frameDifference(a: Uint8Array, b: Uint8Array, width: number, height: number, channels: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const at = (y * width + x) * channels;
      sum += Math.abs(gray(a, at, channels) - gray(b, at, channels));
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Where the subject is in one frame: its blocks scored for skin, for motion
 * against the frame before (none for a shot's first frame) and for contrast,
 * and the weighted center of the strongest kind taken.
 */
export function findSubject(frame: Uint8Array, previous: Uint8Array | null, size: Size & { channels: number }): SubjectPoint {
  const { width, height, channels } = size;
  const cols = Math.max(1, Math.floor(width / REFRAME_BLOCK));
  const rows = Math.max(1, Math.floor(height / REFRAME_BLOCK));
  const skin = new Float64Array(cols * rows);
  const motion = new Float64Array(cols * rows);
  const contrast = new Float64Array(cols * rows);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let skinCount = 0;
      let diff = 0;
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      for (let y = by * REFRAME_BLOCK; y < (by + 1) * REFRAME_BLOCK; y++) {
        for (let x = bx * REFRAME_BLOCK; x < (bx + 1) * REFRAME_BLOCK; x++) {
          const at = (y * width + x) * channels;
          const g = gray(frame, at, channels);
          sum += g;
          sum2 += g * g;
          n += 1;
          if (channels === 3 && isSkin(frame[at]!, frame[at + 1]!, frame[at + 2]!)) skinCount += 1;
          if (previous) diff += Math.abs(g - gray(previous, at, channels));
        }
      }
      const i = by * cols + bx;
      skin[i] = n ? skinCount / n : 0;
      motion[i] = n ? diff / n : 0;
      const mean = n ? sum / n : 0;
      contrast[i] = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
    }
  }
  const centroid = (weights: Float64Array, floor: number): { x: number; y: number; share: number } | null => {
    let max = 0;
    for (let i = 0; i < weights.length; i++) if (weights[i]! > max) max = weights[i]!;
    if (max <= floor) return null;
    // Only the strongest blocks count, so a faint spread does not pull the center to the middle.
    const cut = max * 0.5;
    let wx = 0;
    let wy = 0;
    let total = 0;
    let all = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]!;
      all += w;
      if (w < cut) continue;
      wx += w * ((i % cols) + 0.5) * REFRAME_BLOCK;
      wy += w * (Math.floor(i / cols) + 0.5) * REFRAME_BLOCK;
      total += w;
    }
    if (total <= 0) return null;
    return { x: clamp01(wx / total / width), y: clamp01(wy / total / height), share: all > 0 ? total / all : 0 };
  };
  // Skin first: a block over half skin, somewhere, is a face or a hand, and that is the subject.
  const face = centroid(skin, 0.5);
  if (face) return { x: face.x, y: face.y, c: Math.min(1, face.share + 0.5), face: true };
  // Else what moves and what stands out, each on its own scale, together.
  const combined = new Float64Array(cols * rows);
  let maxMotion = 0;
  let maxContrast = 0;
  for (let i = 0; i < combined.length; i++) {
    if (motion[i]! > maxMotion) maxMotion = motion[i]!;
    if (contrast[i]! > maxContrast) maxContrast = contrast[i]!;
  }
  for (let i = 0; i < combined.length; i++) {
    combined[i] = (maxMotion > 2 ? (2 * motion[i]!) / maxMotion : 0) + (maxContrast > 2 ? contrast[i]! / maxContrast : 0);
  }
  const found = centroid(combined, 0.05);
  if (!found) return { x: 0.5, y: 0.5, c: 0, face: false };
  return { x: found.x, y: found.y, c: Math.min(1, found.share), face: false };
}

/** The subject through every frame, and where the shots begin. */
export function subjectPath(frames: GrayFrames): SubjectPath {
  const channels = Math.max(1, Math.round(frames.channels ?? 1));
  const size = { width: frames.width, height: frames.height, channels };
  const points: SubjectPoint[] = [];
  const shots: number[] = [];
  let previous: Uint8Array | null = null;
  frames.frames.forEach((frame, index) => {
    const boundary = index === 0 || (previous !== null && frameDifference(previous, frame, size.width, size.height, channels) > SHOT_THRESHOLD);
    if (boundary) shots.push(index);
    points.push(findSubject(frame, boundary ? null : previous, size));
    previous = frame;
  });
  return { points, shots };
}

export interface SteadyOptions {
  /** The frame the crop fills, and the clip's picture, so the window's size — and so how far the center may go — is known. */
  frame: Size;
  clip: Size;
  window?: number;
  deadZone?: number;
}

/**
 * The window the frame cuts out of the picture when the picture covers it, as
 * fractions of the picture: a tall frame over a wide clip takes a slice of
 * the width and all of the height. The center may range only where the window
 * stays inside.
 */
export function coverWindowSize(frame: Size, clip: Size): { w: number; h: number } {
  const scale = Math.max(frame.width / Math.max(1, clip.width), frame.height / Math.max(1, clip.height));
  return { w: Math.min(1, frame.width / scale / Math.max(1, clip.width)), h: Math.min(1, frame.height / scale / Math.max(1, clip.height)) };
}

/** A center held to where the window stays inside the picture. */
export function clampCentre(centre: { x: number; y: number }, window: { w: number; h: number }): { x: number; y: number } {
  return {
    x: Math.min(1 - window.w / 2, Math.max(window.w / 2, centre.x)),
    y: Math.min(1 - window.h / 2, Math.max(window.h / 2, centre.y)),
  };
}

/**
 * The source rectangle, in pixels of the picture, that the frame shows for a
 * center: the stage draws it with `drawImage`, and the render's crop takes the
 * same rectangle scaled. Mirrored by `reframeCropFilter`: change both or neither.
 */
export function coverWindow(frame: Size, clip: Size, centre: { x: number; y: number }): { x: number; y: number; width: number; height: number } {
  const size = coverWindowSize(frame, clip);
  const c = clampCentre(centre, size);
  return { x: (c.x - size.w / 2) * clip.width, y: (c.y - size.h / 2) * clip.height, width: size.w * clip.width, height: size.h * clip.height };
}

/**
 * The found centers steadied into the path the crop follows: within each shot
 * a moving average over a window of frames, then a crop center that moves only
 * once the subject has left a dead zone about it — and snaps at a shot's first
 * frame — held to where the window stays inside the picture.
 */
export function steadyPath(path: SubjectPath, options: SteadyOptions): { x: number; y: number }[] {
  const window = coverWindowSize(options.frame, options.clip);
  const half = Math.max(0, Math.round(options.window ?? STEADY_WINDOW));
  const dead = options.deadZone ?? DEAD_ZONE;
  const out: { x: number; y: number }[] = [];
  const shots = [...path.shots, path.points.length];
  for (let s = 0; s < shots.length - 1; s++) {
    const from = shots[s]!;
    const to = shots[s + 1]!;
    // Averaged inside the shot alone, each frame weighted by how surely its subject was found.
    // The window shrinks evenly toward the shot's ends, so the average never leans on one side
    // and trails a subject that is moving — which at a shot's last frames would leave it at the
    // crop's edge just before the cut.
    const averaged: { x: number; y: number }[] = [];
    for (let i = from; i < to; i++) {
      let wx = 0;
      let wy = 0;
      let total = 0;
      const reach = Math.min(half, i - from, to - 1 - i);
      for (let j = i - reach; j <= i + reach; j++) {
        const p = path.points[j]!;
        const w = 0.05 + p.c;
        wx += p.x * w;
        wy += p.y * w;
        total += w;
      }
      averaged.push({ x: wx / total, y: wy / total });
    }
    // The crop follows with a dead zone: it stays until the subject has strayed, then moves to it.
    let centre = clampCentre(averaged[0]!, window);
    for (const target of averaged) {
      const want = clampCentre(target, window);
      if (Math.abs(want.x - centre.x) > dead || Math.abs(want.y - centre.y) > dead) centre = want;
      out.push(centre);
    }
  }
  return out;
}

/**
 * The keys a cut keeps for a steadied path: one where the path bends, the
 * first and last of every shot — a shot's last frame and the next's first a
 * frame apart, so the lerp between them is the cut itself — and never more
 * than a cut may hold.
 */
export function reframeKeysFrom(path: { x: number; y: number }[], shots: readonly number[], from: number, fps: number, tolerance = 0.005, max = 240): ReframeKey[] {
  if (path.length === 0) return [];
  const at = (i: number): number => Math.round((from + i / fps) * 1000) / 1000;
  const keep = new Array<boolean>(path.length).fill(false);
  const bounds = [...shots, path.length];
  for (let s = 0; s < bounds.length - 1; s++) {
    const lo = bounds[s]!;
    const hi = bounds[s + 1]! - 1;
    if (hi < lo) continue;
    keep[lo] = true;
    keep[hi] = true;
    // Douglas–Peucker over the shot: a point stays where the straight line between its neighbors misses it.
    const stack: [number, number][] = [[lo, hi]];
    while (stack.length > 0) {
      const [a, b] = stack.pop()!;
      let worst = -1;
      let worstAt = -1;
      for (let i = a + 1; i < b; i++) {
        const f = (i - a) / Math.max(1, b - a);
        const lx = path[a]!.x + (path[b]!.x - path[a]!.x) * f;
        const ly = path[a]!.y + (path[b]!.y - path[a]!.y) * f;
        const d = Math.max(Math.abs(path[i]!.x - lx), Math.abs(path[i]!.y - ly));
        if (d > worst) {
          worst = d;
          worstAt = i;
        }
      }
      if (worstAt >= 0 && worst > tolerance) {
        keep[worstAt] = true;
        stack.push([a, worstAt], [worstAt, b]);
      }
    }
  }
  let keys = path.map((p, i) => ({ at: at(i), x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000, keep: keep[i]! })).filter((k) => k.keep).map(({ at: a, x, y }) => ({ at: a, x, y }));
  if (keys.length > max) {
    const step = Math.ceil(keys.length / max);
    keys = keys.filter((_, i) => i % step === 0 || i === keys.length - 1);
  }
  return keys;
}

/** A single key at a clip second: the frame kept on the picture's middle, which is what a plain fill does. */
export function centredReframe(from: number): ReframeKey[] {
  return [{ at: Math.round(from * 1000) / 1000, x: 0.5, y: 0.5 }];
}

/**
 * The render's crop for a reframed cut, as ffmpeg filters: the picture scaled
 * to cover the frame, then cropped to the frame about the path's center at the
 * cut's own time — a piecewise-linear expression over the keys, in seconds of
 * the cut on the timeline, held at its ends and clamped inside the picture.
 * Mirrors `coverWindow`: change both or neither.
 */
export function reframeCropFilter(frame: Size, keys: readonly ReframeKey[], timelineAt: (clipSeconds: number) => number): string {
  const num = (v: number): string => String(Math.round(v * 1e6) / 1e6);
  const expr = (axis: 'x' | 'y'): string => {
    const dim = axis === 'x' ? 'iw' : 'ih';
    const out = axis === 'x' ? 'ow' : 'oh';
    const points = keys.map((k) => ({ t: timelineAt(k.at), v: k[axis] }));
    // One key, or none that differ: a constant.
    let centre: string;
    if (points.length <= 1) centre = num(points[0]?.v ?? 0.5);
    else {
      // From the last key back: if(lt(t,T1), lerp(0,1), if(lt(t,T2), lerp(1,2), ... Vn))
      centre = num(points[points.length - 1]!.v);
      for (let i = points.length - 2; i >= 0; i--) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const span = Math.max(1e-6, b.t - a.t);
        const lerp = `${num(a.v)}+(${num(b.v - a.v)})*clip((t-${num(a.t)})/${num(span)},0,1)`;
        centre = `if(lt(t,${num(b.t)}),${lerp},${centre})`;
      }
    }
    return `clip((${centre})*${dim}-${out}/2,0,${dim}-${out})`;
  };
  return `scale=${frame.width}:${frame.height}:force_original_aspect_ratio=increase,crop=${frame.width}:${frame.height}:'${expr('x')}':'${expr('y')}'`;
}
