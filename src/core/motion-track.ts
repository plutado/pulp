/**
 * Motion tracking (milestone 76): a point or a box on a clip, followed from
 * frame to frame, so a layer can be pinned to something moving in the footage
 * without keyframing it by hand. All on the machine.
 *
 * A track belongs to the clip, not to a cut or a layer: its samples are in
 * seconds of the clip's file and in fractions of the clip's own picture, so
 * the same track is right wherever the cut sits on the timeline, however the
 * picture is letterboxed into the frame, and at every size and shape. The
 * project keeps its tracks under `@tracks` beside the cut track and the
 * captions (src/core/params.ts); pinning a layer bakes keyframes from a track
 * (src/core/track-pin.ts) that a person can still edit like any others.
 *
 * The tracker is block matching over small color proxy frames — color, not
 * luma, since a red mark on green grass is all but invisible in gray — pure
 * and in one place: a patch around the point is found again in the next frame within a
 * search window around where its motion predicts it, by the sum of squared
 * differences with most of the brightness difference taken out — so a change
 * of lighting is not a change of place, while a flat patch still cannot pass
 * for a flat patch of another shade — and the match is refined to a fraction
 * of a pixel by fitting a parabola to the error around the best whole pixel.
 * A patch inside a flat shape matches a whole plateau of places equally well;
 * the plateau's center is taken, which is where the shape's center is. The
 * patch is taken afresh from each frame found, so a target that turns or
 * changes is still followed; a frame where nothing matches well is marked
 * with a low confidence and the point holds where it was — the stage draws
 * such frames for a person to fix — and the last believed patch is what the
 * following frames are searched for.
 */

export type TrackKind = 'point' | 'box';

/** One moment of a track: the clip's second and where the target is, as fractions of its picture. */
export interface TrackSample {
  /** Seconds into the clip's file. */
  at: number;
  /** The target's center as fractions of the clip's picture, 0..1 across and down. */
  x: number;
  y: number;
  /** How well the frame matched, 0..1; low is a frame to look at. */
  c: number;
}

export interface MotionTrack {
  /** Unique within the project: letters, digits and underscores. */
  id: string;
  /** The library clip the track was made on; never a path. */
  clip: string;
  kind: TrackKind;
  /** The tracked patch, as fractions of the clip's picture: a point's is small and fixed, a box's is the box. */
  size: { w: number; h: number };
  /** The clip seconds the track runs between, inclusive at both ends. */
  from: number;
  to: number;
  /** Frames per second the samples step at: the clip's own rate. */
  fps: number;
  /** In order of `at`, one per frame of the window. */
  samples: TrackSample[];
}

export const TRACK_LIMITS = {
  /** Tracks per project. */
  count: 64,
  /** Samples per track: thirty seconds at sixty frames a second. */
  samples: 1800,
  /** A point's patch, as a fraction of the picture's width; a box is at least this and at most the picture. */
  size: { min: 0.01, max: 1 },
} as const;

/** What a point tracks: a small patch about it, this fraction of the picture's width. */
export const POINT_PATCH_FRACTION = 0.05;

/** Below this a frame's match is not believed and the point is held; the stage draws such frames for fixing. */
export const LOST_CONFIDENCE = 0.35;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/** A fresh track id, unlike any in `taken`. */
export function newTrackId(taken: readonly string[]): string {
  let n = 1;
  while (taken.includes(`track_${n}`)) n += 1;
  return `track_${n}`;
}

/** A track with every field in range, or null for anything that is not one. */
export function sanitizeMotionTrack(input: unknown): MotionTrack | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.id)) return null;
  if (typeof raw.clip !== 'string' || raw.clip.trim() === '') return null;
  const kind: TrackKind = raw.kind === 'box' ? 'box' : 'point';
  if (!finite(raw.from) || !finite(raw.to) || raw.to < raw.from || raw.from < 0) return null;
  if (!finite(raw.fps) || raw.fps <= 0 || raw.fps > 240) return null;
  const sizeRaw = typeof raw.size === 'object' && raw.size !== null ? (raw.size as Record<string, unknown>) : {};
  const w = finite(sizeRaw.w) ? Math.min(TRACK_LIMITS.size.max, Math.max(TRACK_LIMITS.size.min, sizeRaw.w)) : POINT_PATCH_FRACTION;
  const h = finite(sizeRaw.h) ? Math.min(TRACK_LIMITS.size.max, Math.max(TRACK_LIMITS.size.min, sizeRaw.h)) : w;
  if (!Array.isArray(raw.samples)) return null;
  const samples: TrackSample[] = [];
  for (const s of raw.samples) {
    if (typeof s !== 'object' || s === null) continue;
    const r = s as Record<string, unknown>;
    if (!finite(r.at) || !finite(r.x) || !finite(r.y)) continue;
    samples.push({ at: Math.round(r.at * 1000) / 1000, x: round4(clamp01(r.x)), y: round4(clamp01(r.y)), c: finite(r.c) ? round4(clamp01(r.c)) : 1 });
  }
  samples.sort((a, b) => a.at - b.at);
  const unique: TrackSample[] = [];
  for (const s of samples) {
    if (unique.length > 0 && Math.abs(unique[unique.length - 1]!.at - s.at) < 1e-6) unique[unique.length - 1] = s;
    else unique.push(s);
  }
  if (unique.length === 0) return null;
  return { id: raw.id, clip: raw.clip, kind, size: { w: round4(w), h: round4(h) }, from: Math.round(raw.from * 1000) / 1000, to: Math.round(raw.to * 1000) / 1000, fps: raw.fps, samples: unique.slice(0, TRACK_LIMITS.samples) };
}

/** The project's tracks, each well formed and uniquely named, or null when there are none. */
export function sanitizeMotionTracks(input: unknown): MotionTrack[] | null {
  if (!Array.isArray(input)) return null;
  const out: MotionTrack[] = [];
  const ids = new Set<string>();
  for (const raw of input) {
    const track = sanitizeMotionTrack(raw);
    if (!track || ids.has(track.id)) continue;
    ids.add(track.id);
    out.push(track);
    if (out.length >= TRACK_LIMITS.count) break;
  }
  return out.length > 0 ? out : null;
}

/** Where the track puts the target at a clip second: the nearest samples, lerped; held at its ends. */
export function trackPositionAt(track: Pick<MotionTrack, 'samples'>, at: number): TrackSample | null {
  const s = track.samples;
  if (s.length === 0) return null;
  if (at <= s[0]!.at) return s[0]!;
  if (at >= s[s.length - 1]!.at) return s[s.length - 1]!;
  for (let i = 1; i < s.length; i++) {
    if (s[i]!.at >= at) {
      const a = s[i - 1]!;
      const b = s[i]!;
      const f = (at - a.at) / Math.max(1e-6, b.at - a.at);
      return { at, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, c: Math.min(a.c, b.c) };
    }
  }
  return s[s.length - 1]!;
}

/**
 * A track with the samples from `at` on replaced by `next` (milestone 76's
 * "fix a bad track"): what re-tracking from a corrected frame writes back.
 * Samples before `at` are kept as they were.
 */
export function trackSpliced(track: MotionTrack, at: number, next: readonly TrackSample[]): MotionTrack {
  const kept = track.samples.filter((s) => s.at < at - 1e-6);
  const samples = [...kept, ...next].sort((a, b) => a.at - b.at);
  return { ...track, samples };
}

// ---------------------------------------------------------------- the tracker

/** Frames of one size, each `width * height * channels` bytes: gray (1) or RGB (3), pixel by pixel. */
export interface GrayFrames {
  width: number;
  height: number;
  frames: readonly Uint8Array[];
  /** Bytes per pixel; 1 when left out, as a gray frame is. */
  channels?: number;
}

export interface TrackStart {
  /** The frame the point was picked on. */
  index: number;
  /** The target's center in pixels of the frames. */
  x: number;
  y: number;
}

export interface TrackedPoint {
  index: number;
  x: number;
  y: number;
  /** 0..1: how well the patch matched. */
  c: number;
}

export interface TrackOptions {
  /** The patch's size in pixels (odd numbers center best); at least 3. */
  patch: { w: number; h: number };
  /** How far from the predicted place the match is sought, in pixels. */
  radius?: number;
  /** Track forward from the start (default true) and back to the first frame (default true). */
  forward?: boolean;
  backward?: boolean;
}

/** How much of a difference in mean brightness still counts: half, so lighting may change but a shade is not a shape. */
const BRIGHTNESS_WEIGHT = 0.5;
/** Levels per channel a match may differ by and still be the same place: what compression noise comes to. */
const PLATEAU_LEVELS = 4;

interface Patch {
  /** `w × h × channels` bytes, pixel by pixel. */
  data: Uint8Array;
  /** Each channel's mean over the patch. */
  means: number[];
}

/**
 * The sum of squared differences between a patch and a window at (x, y), both
 * `w × h`, over every channel, with half of each channel's brightness
 * difference taken out. A window partly off the frame is matched on what is
 * there, scaled up, so an edge is not a wall.
 */
function zssd(frame: Uint8Array, width: number, height: number, channels: number, x0: number, y0: number, patch: Patch, w: number, h: number): number {
  const sums = new Array<number>(channels).fill(0);
  let sumDiff2 = 0;
  let n = 0;
  for (let j = 0; j < h; j++) {
    const y = y0 + j;
    if (y < 0 || y >= height) continue;
    const row = y * width;
    for (let i = 0; i < w; i++) {
      const x = x0 + i;
      if (x < 0 || x >= width) continue;
      const at = (row + x) * channels;
      const from = (j * w + i) * channels;
      for (let c = 0; c < channels; c++) {
        const v = frame[at + c]!;
        const d = v - patch.data[from + c]!;
        sums[c]! += v;
        sumDiff2 += d * d;
      }
      n += 1;
    }
  }
  if (n < (w * h) / 2) return Number.POSITIVE_INFINITY;
  let brightness = 0;
  for (let c = 0; c < channels; c++) {
    const meanDiff = sums[c]! / n - patch.means[c]!;
    brightness += n * meanDiff * meanDiff;
  }
  const z = Math.max(0, sumDiff2 - brightness * (1 - BRIGHTNESS_WEIGHT));
  return (z / n) * (w * h);
}

/** The patch from an origin, read from a frame; pixels off the frame read as the nearest edge. */
function cut(frame: Uint8Array, width: number, height: number, channels: number, x0: number, y0: number, w: number, h: number): Patch {
  const data = new Uint8Array(w * h * channels);
  const means = new Array<number>(channels).fill(0);
  for (let j = 0; j < h; j++) {
    const y = Math.min(height - 1, Math.max(0, y0 + j));
    for (let i = 0; i < w; i++) {
      const x = Math.min(width - 1, Math.max(0, x0 + i));
      for (let c = 0; c < channels; c++) {
        const v = frame[(y * width + x) * channels + c]!;
        data[(j * w + i) * channels + c] = v;
        means[c]! += v;
      }
    }
  }
  return { data, means: means.map((m) => m / (w * h)) };
}

/**
 * The offset of a parabola's bottom through three equally spaced samples, held
 * to half a step — and zero where the curve is too flat to mean anything: on a
 * plateau the neighbors differ by noise alone, and a fraction fitted to noise
 * would only jitter the point.
 */
function subpixel(before: number, at: number, after: number, noise: number): number {
  const denom = before - 2 * at + after;
  if (!Number.isFinite(denom) || denom <= noise) return 0;
  return Math.max(-0.5, Math.min(0.5, (before - after) / (2 * denom)));
}

/**
 * Follow a target through the frames from where it was picked: forward to the
 * last frame and back to the first. Returns one point per frame, in frame
 * order, the start frame's at the picked place with full confidence.
 *
 * Positions are continuous, pixel-centre coordinates: a pixel at column i
 * spans i..i+1 and is centred at i + 0.5, which is what a point picked on the
 * picture and a shape drawn by an expression both mean.
 */
export function trackPatch(frames: GrayFrames, start: TrackStart, options: TrackOptions): TrackedPoint[] {
  const { width, height } = frames;
  const channels = Math.max(1, Math.round(frames.channels ?? 1));
  const w = Math.max(3, Math.round(options.patch.w));
  const h = Math.max(3, Math.round(options.patch.h));
  const radius = Math.max(2, Math.round(options.radius ?? Math.max(8, Math.max(w, h))));
  const count = frames.frames.length;
  if (count === 0) return [];
  const begin = Math.min(count - 1, Math.max(0, Math.round(start.index)));
  const out: TrackedPoint[] = new Array<TrackedPoint>(count);
  out[begin] = { index: begin, x: start.x, y: start.y, c: 1 };
  const half = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  // The patch about a continuous point: the pixel under it is its centre pixel.
  const originOf = (px: number, py: number): { x: number; y: number } => ({ x: Math.floor(px) - half.x, y: Math.floor(py) - half.y });
  const noise = w * h * channels * PLATEAU_LEVELS * PLATEAU_LEVELS;

  const follow = (step: 1 | -1): void => {
    let x = start.x;
    let y = start.y;
    let vx = 0;
    let vy = 0;
    let lost = false;
    // The patch searched for: the last believed frame's, so a frame where the target was missing
    // does not become what the next frame is searched for.
    const startOrigin = originOf(x, y);
    let template = cut(frames.frames[begin]!, width, height, channels, startOrigin.x, startOrigin.y, w, h);
    for (let index = begin + step; index >= 0 && index < count; index += step) {
      const frame = frames.frames[index]!;
      // Looked for about where its motion says it will be; a lost target is looked for where it was.
      const origin = originOf(lost ? x : x + vx, lost ? y : y + vy);
      let best = Number.POSITIVE_INFINITY;
      let bdx = 0;
      let bdy = 0;
      const costs = new Map<number, number>();
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cost = zssd(frame, width, height, channels, origin.x + dx, origin.y + dy, template, w, h);
          costs.set(dy * 4096 + dx, cost);
          // Nearest the prediction among equals, so the plateau walk below starts inside it.
          if (cost < best - 1e-9 || (Math.abs(cost - best) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(bdx) + Math.abs(bdy))) {
            best = cost;
            bdx = dx;
            bdy = dy;
          }
        }
      }
      const at = (dx: number, dy: number): number => {
        const known = costs.get(dy * 4096 + dx);
        return known !== undefined ? known : zssd(frame, width, height, channels, origin.x + dx, origin.y + dy, template, w, h);
      };
      // A patch inside a flat shape matches a plateau of places within compression noise of the
      // best. Its extent is walked along each axis from the best match — a stray inclusion off
      // the axis cannot move it — and its middle is where the shape itself is centred.
      const extent = (from: number, step2: (k: number) => number): [number, number] => {
        let lo = from;
        let hi = from;
        while (lo - 1 >= -radius && step2(lo - 1) <= best + noise) lo -= 1;
        while (hi + 1 <= radius && step2(hi + 1) <= best + noise) hi += 1;
        return [lo, hi];
      };
      const [xl, xh] = extent(bdx, (k) => at(k, bdy));
      const cx = (xl + xh) / 2;
      const [yl, yh] = extent(bdy, (k) => at(Math.round(cx), k));
      const cy = (yl + yh) / 2;
      // Off a plateau the parabola through the neighbours gives the fraction; on one, the middle does.
      const fx = xl === xh ? bdx + subpixel(at(bdx - 1, bdy), best, at(bdx + 1, bdy), noise) : cx;
      const fy = yl === yh ? bdy + subpixel(at(bdx, bdy - 1), best, at(bdx, bdy + 1), noise) : cy;
      // Confidence from the root-mean-square difference per channel against half the range.
      const rms = Number.isFinite(best) ? Math.sqrt(best / (w * h * channels)) : 255;
      const c = clamp01(1 - rms / 128);
      const nx = origin.x + fx + half.x + 0.5;
      const ny = origin.y + fy + half.y + 0.5;
      if (c < LOST_CONFIDENCE) {
        // Not believed: the point holds, and the next frame is looked for where it was, for the same patch.
        lost = true;
        out[index] = { index, x, y, c };
        continue;
      }
      lost = false;
      vx = nx - x;
      vy = ny - y;
      x = nx;
      y = ny;
      out[index] = { index, x, y, c };
      const next = originOf(x, y);
      template = cut(frame, width, height, channels, next.x, next.y, w, h);
    }
  };
  if (options.forward !== false) follow(1);
  if (options.backward !== false) follow(-1);
  return out.filter((p): p is TrackedPoint => p !== undefined).sort((a, b) => a.index - b.index);
}

/** Tracked proxy points as a track's samples: pixels to picture fractions, frames to clip seconds. */
export function samplesFromPoints(points: readonly TrackedPoint[], frames: Pick<GrayFrames, 'width' | 'height'>, from: number, fps: number): TrackSample[] {
  return points.map((p) => ({ at: Math.round((from + p.index / fps) * 1000) / 1000, x: round4(clamp01(p.x / frames.width)), y: round4(clamp01(p.y / frames.height)), c: round4(p.c) }));
}

/** Frames as one contiguous rawvideo buffer, split: a frame short at the end is dropped rather than read half. */
export function splitGrayFrames(buffer: Uint8Array, width: number, height: number, channels = 1): GrayFrames {
  const size = width * height * channels;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + size <= buffer.length; at += size) frames.push(buffer.subarray(at, at + size));
  return { width, height, frames, ...(channels !== 1 ? { channels } : {}) };
}

/** The channels a clip is tracked in: red, green and blue, since what moves may differ from its ground in hue alone. */
export const TRACK_CHANNELS = 3;

/** The proxy a clip is tracked at: this wide, its height following the picture, both even. */
export const TRACK_PROXY_WIDTH = 320;

export function trackProxySize(clip: { width: number; height: number }): { width: number; height: number } {
  const width = Math.min(TRACK_PROXY_WIDTH, Math.max(16, Math.round(clip.width / 2) * 2));
  const height = Math.max(16, Math.round((clip.height * width) / Math.max(1, clip.width) / 2) * 2);
  return { width, height };
}

/**
 * ffmpeg's arguments for the frames a track is run over: the window of the
 * clip's file from `from`, scaled to the proxy, in RGB, raw, to stdout. Pure,
 * so the test reads the command rather than spawning it.
 */
export function trackFramesArgs(input: string, from: number, seconds: number, proxy: { width: number; height: number }): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-ss', from.toFixed(6), '-i', input, '-t', Math.max(0.001, seconds).toFixed(6),
    '-an', '-vf', `scale=${proxy.width}:${proxy.height}:flags=bilinear,format=rgb24`,
    '-f', 'rawvideo', 'pipe:1',
  ];
}
