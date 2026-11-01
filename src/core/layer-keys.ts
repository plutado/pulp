/**
 * Keyframes on layers (milestone 51): a layer's position, scale, rotation and
 * opacity over time. One track per layer, each key the whole pose at a moment
 * — which is what "set at the playhead by changing a value" writes — and the
 * value between keys travels by the earlier key's easing.
 *
 * Keys are in seconds of the graphic **as it is watched** (milestone 30's
 * chosen length), like a span, and their offsets are fractions of the frame,
 * like a placement — so one stored track is right at every size and shape. A
 * layer with keys moves by them **instead of** its static placement: the keys
 * are where it is, moment by moment, and two answers to one question would
 * drift.
 *
 * Pure, and mirrored in the template bridge (src/core/runtime.ts), the way
 * the layout is: change both or neither. The preview and the render both draw
 * through the bridge's copy, so they agree to the frame by construction.
 */

/**
 * How the value travels from a key to the next. The eases are CSS's own
 * curves, which is what hands already know; `hold` stays put until the next
 * key; `curve` is a cubic bezier of the key's own.
 */
export const KEY_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'curve'] as const;
export type KeyEasing = (typeof KEY_EASINGS)[number];

/** A cubic bezier's control points, x1 y1 x2 y2; the xs are held to 0..1 so time never runs backwards. */
export type KeyCurve = [number, number, number, number];

/** What `curve` starts from: CSS's `ease`. */
export const DEFAULT_CURVE: KeyCurve = [0.25, 0.1, 0.25, 1];

export interface LayerKey {
  /** Seconds of the graphic as it is watched. */
  at: number;
  /** The pose: offsets as fractions of the frame, a scale factor, degrees, and 0 to 1. */
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  opacity: number;
  /** How the value travels from here to the next key. */
  easing: KeyEasing;
  /** The bezier when `easing` is "curve". */
  curve?: KeyCurve;
}

/** A pose with nothing moved: what a key starts from. */
export const IDENTITY_KEY: Omit<LayerKey, 'at' | 'easing'> = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };

export const KEY_LIMITS = {
  /** Keys per layer. Past this a track is an export from somewhere else, not a thing set by hand. */
  count: 120,
  offset: { min: -1, max: 1 },
  scale: { min: 0.05, max: 10 },
  opacity: { min: 0, max: 1 },
} as const;

/** What a fresh key travels by: the gentle default an editor expects. */
export const DEFAULT_KEY_EASING: KeyEasing = 'ease-in-out';

/**
 * CSS's cubic bezier, solved for a progress: x1,y1,x2,y2 with the xs in 0..1,
 * so x(t) is monotonic and bisection always lands. Mirrored in the bridge.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const sample = (p1: number, p2: number, t: number) => ((1 - t) * (1 - t) * 3 * t * p1) + ((1 - t) * 3 * t * t * p2) + (t * t * t);
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 24; i++) {
    const sx = sample(x1, x2, t);
    if (Math.abs(sx - x) < 1e-5) break;
    if (sx < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sample(y1, y2, t);
}

/** A key's easing applied to a progress, 0..1 → 0..1. Mirrored in the bridge. */
export function easeKey(easing: KeyEasing, curve: KeyCurve | undefined, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (easing === 'hold') return 0;
  if (easing === 'linear') return p;
  if (easing === 'ease-in') return cubicBezier(0.42, 0, 1, 1, p);
  if (easing === 'ease-out') return cubicBezier(0, 0, 0.58, 1, p);
  if (easing === 'ease-in-out') return cubicBezier(0.42, 0, 0.58, 1, p);
  const c = curve ?? DEFAULT_CURVE;
  return cubicBezier(c[0], c[1], c[2], c[3], p);
}

/** The pose a key holds, without its timing. */
export interface KeyedPose {
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  opacity: number;
}

/**
 * The pose at a moment: the first key's before it, the last key's after it,
 * and between two keys the earlier one's easing carries every value together.
 * Works unchanged on keys whose offsets were scaled to pixels, since scaling
 * commutes with the lerp — which is how the bridge uses it. Mirrored there.
 */
export function keyedPoseAt(keys: readonly LayerKey[], time: number): KeyedPose | null {
  if (keys.length === 0) return null;
  const t = Number.isFinite(time) ? time : 0;
  const first = keys[0]!;
  if (t <= first.at) return pose(first);
  const last = keys[keys.length - 1]!;
  if (t >= last.at) return pose(last);
  let a = first;
  let b = last;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i]!.at >= t) {
      a = keys[i - 1]!;
      b = keys[i]!;
      break;
    }
  }
  const span = Math.max(1e-6, b.at - a.at);
  const eased = easeKey(a.easing, a.curve, (t - a.at) / span);
  return {
    dx: a.dx + (b.dx - a.dx) * eased,
    dy: a.dy + (b.dy - a.dy) * eased,
    scale: a.scale + (b.scale - a.scale) * eased,
    rotate: a.rotate + (b.rotate - a.rotate) * eased,
    opacity: a.opacity + (b.opacity - a.opacity) * eased,
  };
}

function pose(key: LayerKey): KeyedPose {
  return { dx: key.dx, dy: key.dy, scale: key.scale, rotate: key.rotate, opacity: key.opacity };
}

/** A key list with this key written at its time: replaced where one sits within half a frame, inserted in order otherwise. */
export function withKeyAt(keys: readonly LayerKey[], key: LayerKey): LayerKey[] {
  const at = Math.round(key.at * 1000) / 1000;
  const next = keys.filter((k) => Math.abs(k.at - at) > 0.016);
  next.push({ ...key, at });
  next.sort((a, b) => a.at - b.at);
  return next.slice(0, KEY_LIMITS.count);
}

/**
 * The key at `index` moved to a moment, its pose and easing unchanged: taken
 * out, then written back by `withKeyAt`'s own rule — so dragging a mark onto
 * another key replaces it, exactly as writing a key there would. What a drag
 * on a bar's mark does (src/renderer/stage-bars.ts), always from the list as
 * it stood when the drag began.
 */
export function keyMovedTo(keys: readonly LayerKey[], index: number, at: number): LayerKey[] {
  const key = keys[index];
  if (!key) return [...keys];
  return withKeyAt(keys.filter((_, i) => i !== index), { ...key, at: Math.max(0, at) });
}

/**
 * Keys with every field in range, from anything at all: sorted, deduplicated
 * by time, counted. `undefined` when the input is not a list; an empty list is
 * no keys at all, so a layer nobody has keyed serializes as it always did.
 */
export function sanitizeKeys(input: unknown): LayerKey[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const clamp = (v: unknown, limit: { min: number; max: number }, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(limit.max, Math.max(limit.min, v)) : fallback;
  const out: LayerKey[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at < 0) continue;
    const easing = (KEY_EASINGS as readonly string[]).includes(r.easing as string) ? (r.easing as KeyEasing) : DEFAULT_KEY_EASING;
    let curve: KeyCurve | undefined;
    if (easing === 'curve') {
      const c = Array.isArray(r.curve) ? r.curve : [];
      const n = (v: unknown, limit: { min: number; max: number }, fb: number) => clamp(v, limit, fb);
      curve = [n(c[0], { min: 0, max: 1 }, DEFAULT_CURVE[0]), n(c[1], { min: -2, max: 3 }, DEFAULT_CURVE[1]), n(c[2], { min: 0, max: 1 }, DEFAULT_CURVE[2]), n(c[3], { min: -2, max: 3 }, DEFAULT_CURVE[3])];
    }
    out.push({
      at: Math.round(Math.min(36_000, r.at) * 1000) / 1000,
      dx: clamp(r.dx, KEY_LIMITS.offset, 0),
      dy: clamp(r.dy, KEY_LIMITS.offset, 0),
      scale: clamp(r.scale, KEY_LIMITS.scale, 1),
      rotate: typeof r.rotate === 'number' && Number.isFinite(r.rotate) ? Math.max(-3600, Math.min(3600, r.rotate)) : 0,
      opacity: clamp(r.opacity, KEY_LIMITS.opacity, 1),
      easing,
      ...(curve ? { curve } : {}),
    });
  }
  out.sort((a, b) => a.at - b.at);
  const deduped = out.filter((k, i) => i === 0 || k.at - out[i - 1]!.at > 1e-6);
  return deduped.slice(0, KEY_LIMITS.count);
}
