/**
 * Video layers (milestone 26): a clip playing inside a graphic, and the
 * arithmetic that decides which of its frames belongs to a given moment of the
 * template's own time.
 *
 * Pure, and deliberately the only place that decision is made: the preview,
 * the render and any test all ask the same function, so a clip cannot drift
 * between what is scrubbed and what is written. Everything here works in
 * seconds and converts to a frame index once, at the end — the clip's rate is
 * rarely the render's, and counting in frames would compound that difference
 * over the length of a shot.
 */

import type { MediaSequence } from './media-sequence';

/** How the clip plays when it reaches its out point. */
export const CLIP_ENDINGS = ['loop', 'once'] as const;
export type ClipEnding = (typeof CLIP_ENDINGS)[number];

export const CLIP_LIMITS = {
  /** Slower than a tenth is a still with extra steps; faster than ten is a flicker. */
  speed: { min: 0.1, max: 10 },
  /** Seconds to wait before the clip starts, within the graphic. */
  delay: { min: 0, max: 600 },
} as const;

export const DEFAULT_CLIP_SPEED = 1;

/**
 * A clip chosen for a layer. `id` is a library id and nothing else — the page
 * never sees a path, and the host reads only the clips a layer names, by the
 * same grant images use (ADR 0013).
 */
export interface ClipValue {
  id: string | null;
  /** Clip frame the layer starts from; clamped into the clip when it is measured. */
  inPoint: number;
  /** Last clip frame shown, inclusive; -1 means "to the end", whatever the length turns out to be. */
  outPoint: number;
  ending: ClipEnding;
  /** 1 plays at the recorded rate, 2 twice as fast. */
  speed: number;
  /** Seconds into the graphic before the clip starts. */
  delay: number;
  /** Chosen but not drawn, and taking no room, like a hidden image. */
  hidden: boolean;
}

export const EMPTY_CLIP: ClipValue = {
  id: null,
  inPoint: 0,
  outPoint: -1,
  ending: 'loop',
  speed: DEFAULT_CLIP_SPEED,
  delay: 0,
  hidden: false,
};

/** What the host measured about a clip: enough to turn a moment into a frame. */
export interface ClipSource {
  /** Frames in the whole clip. */
  frames: number;
  /** The clip's own rate, which is rarely the render's. */
  fps: number;
  /** Set when the clip is a folder of frames rather than one file. */
  sequence?: MediaSequence;
}

/**
 * The window of the clip a value selects, as frame indices, clamped to what
 * the clip actually holds. An out point of -1, or one past the end, means the
 * last frame; an in point past the out point collapses to a single frame
 * rather than an empty window, so a mis-set pair still shows something.
 */
export function clipWindow(value: Pick<ClipValue, 'inPoint' | 'outPoint'>, source: ClipSource): { first: number; last: number; frames: number } {
  const total = Math.max(0, Math.floor(source.frames));
  if (total === 0) return { first: 0, last: 0, frames: 0 };
  const last = value.outPoint < 0 || value.outPoint > total - 1 ? total - 1 : Math.floor(value.outPoint);
  const first = Math.min(Math.max(0, Math.floor(value.inPoint)), last);
  return { first, last, frames: last - first + 1 };
}

/** Seconds the chosen window runs for at the clip's own rate, before speed is applied. */
export function clipWindowSeconds(value: ClipValue, source: ClipSource): number {
  const { frames } = clipWindow(value, source);
  return frames / Math.max(1, source.fps);
}

/** Seconds the layer is on screen for: the window at the chosen speed. A looping clip has no end, so this is one pass. */
export function clipPassSeconds(value: ClipValue, source: ClipSource): number {
  return clipWindowSeconds(value, source) / clipSpeed(value.speed);
}

function clipSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return DEFAULT_CLIP_SPEED;
  return Math.min(CLIP_LIMITS.speed.max, Math.max(CLIP_LIMITS.speed.min, speed));
}

/**
 * Which frame of the clip belongs to `time` seconds into the graphic, or
 * `null` when the layer has nothing to draw then.
 *
 * Nothing to draw happens twice: before the start delay has passed, and after
 * a `once` clip has played its window out. A `once` clip **clears** rather
 * than freezing on its last frame — these are mostly effects, and an
 * explosion that stops and stays is worse than one that ends. A `loop` clip
 * runs forever, so it is only ever absent during its delay.
 */
export function clipFrameAt(time: number, value: ClipValue, source: ClipSource): number | null {
  if (!Number.isFinite(time) || value.id === null || value.hidden) return null;
  const { first, last, frames } = clipWindow(value, source);
  if (frames === 0) return null;
  const delay = Math.max(0, value.delay);
  const elapsed = (time - delay) * clipSpeed(value.speed);
  // Before the clip starts. A hair under zero is the start, not "not yet": a frame boundary
  // computed in seconds can land a rounding step early.
  if (elapsed < -1e-9) return null;
  const windowSeconds = frames / Math.max(1, source.fps);
  let within = Math.max(0, elapsed);
  if (value.ending === 'loop') {
    within = within % windowSeconds;
  } else if (within >= windowSeconds - 1e-9) {
    return null;
  }
  const offset = Math.floor(within * Math.max(1, source.fps) + 1e-9);
  return Math.min(last, first + Math.max(0, offset));
}

/**
 * Where in the **handed window** a moment lands: the same answer as
 * `clipFrameAt`, counted from the window's first frame rather than the clip's.
 * The page is given the window's frames and nothing else — it never learns
 * what the in point was — so this is the index it draws by.
 */
export function clipWindowIndexAt(time: number, value: ClipValue, source: ClipSource): number | null {
  const frame = clipFrameAt(time, value, source);
  if (frame === null) return null;
  return frame - clipWindow(value, source).first;
}

/**
 * Every clip frame a render needs, in the order it needs them, for one layer.
 * The host decodes a clip once per render and walks it forward, so what it
 * wants is the whole list up front rather than a frame at a time; `null`
 * marks a render frame the layer is absent for.
 */
export function clipFramePlan(value: ClipValue, source: ClipSource, renderFrames: number, renderFps: number): (number | null)[] {
  const fps = Math.max(1, renderFps);
  return Array.from({ length: Math.max(0, Math.floor(renderFrames)) }, (_, i) => clipFrameAt(i / fps, value, source));
}

/** A clip value with every field in range, from anything at all; `undefined` when the input is not one. */
export function sanitizeClipValue(input: unknown): ClipValue | null | undefined {
  if (input === null) return null;
  if (typeof input === 'string') {
    const text = input.trim();
    if (text === '') return null;
    if (text.toLowerCase() === 'hidden') return { ...EMPTY_CLIP, hidden: true };
    return { ...EMPTY_CLIP, id: text };
  }
  if (typeof input !== 'object') return undefined;
  const r = input as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.trim() !== '' ? r.id.trim() : null;
  if (id === null && r.hidden !== true) return null;
  const whole = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback);
  const inPoint = Math.max(0, whole(r.inPoint, 0));
  const outPoint = Math.max(-1, whole(r.outPoint, -1));
  const ending = (CLIP_ENDINGS as readonly string[]).includes(r.ending as string) ? (r.ending as ClipEnding) : 'loop';
  const speed = typeof r.speed === 'number' && Number.isFinite(r.speed) ? clipSpeed(r.speed) : DEFAULT_CLIP_SPEED;
  const rawDelay = typeof r.delay === 'number' && Number.isFinite(r.delay) ? r.delay : 0;
  const delay = Math.min(CLIP_LIMITS.delay.max, Math.max(CLIP_LIMITS.delay.min, Math.round(rawDelay * 1000) / 1000));
  return { id, inPoint, outPoint, ending, speed, delay, hidden: r.hidden === true };
}

/** The same value written short, for presets, collections and CSV: defaults are left out. */
export function clipValueToText(value: ClipValue | null): string {
  if (value === null) return '';
  if (value.id === null) return value.hidden ? 'hidden' : '';
  const parts = [value.id];
  if (value.inPoint !== 0) parts.push(`in=${value.inPoint}`);
  if (value.outPoint !== -1) parts.push(`out=${value.outPoint}`);
  if (value.ending !== 'loop') parts.push(`ending=${value.ending}`);
  if (value.speed !== DEFAULT_CLIP_SPEED) parts.push(`speed=${value.speed}`);
  if (value.delay !== 0) parts.push(`delay=${value.delay}`);
  if (value.hidden) parts.push('hidden');
  return parts.join(' ');
}

/** The short names the text form uses, against the fields they set. */
const TEXT_KEYS: Record<string, string> = { in: 'inPoint', out: 'outPoint', ending: 'ending', speed: 'speed', delay: 'delay' };

/** Read what `clipValueToText` wrote: an id, then any of the settings as `key=value`. */
export function clipValueFromText(text: string): ClipValue | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (trimmed.toLowerCase() === 'hidden') return { ...EMPTY_CLIP, hidden: true };
  const [id, ...rest] = trimmed.split(/\s+/);
  const fields: Record<string, unknown> = { id };
  for (const part of rest) {
    if (part.toLowerCase() === 'hidden') {
      fields.hidden = true;
      continue;
    }
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const field = TEXT_KEYS[part.slice(0, at).toLowerCase()];
    if (!field) continue;
    const raw = part.slice(at + 1);
    if (field === 'ending') fields.ending = raw;
    else if (raw.trim() !== '' && Number.isFinite(Number(raw))) fields[field] = Number(raw);
  }
  return sanitizeClipValue(fields) ?? null;
}

/**
 * Every clip id named by a set of layer stacks, however raw. Used where the
 * stacks have not been resolved against a manifest yet — the render cache key
 * is built before the template is loaded — so it reads tolerantly and ignores
 * anything that is not a clip.
 */
export function clipIdsInLayers(layers: unknown): string[] {
  const ids: string[] = [];
  if (typeof layers !== 'object' || layers === null) return ids;
  for (const stack of Object.values(layers as Record<string, unknown>)) {
    if (!Array.isArray(stack)) continue;
    for (const layer of stack) {
      if (typeof layer !== 'object' || layer === null) continue;
      const value = sanitizeClipValue((layer as { clip?: unknown }).clip);
      if (value?.id && !value.hidden && !ids.includes(value.id)) ids.push(value.id);
    }
  }
  return ids.sort();
}
