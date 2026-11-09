/**
 * Music that dips under a voice (milestone 80): a music layer named to duck
 * under a chosen voice layer drops by a set depth while the voice speaks and
 * comes back after, with nothing drawn by hand.
 *
 * **From the voice itself, as one curve.** The voice's file is measured once
 * — its loudest sample in every fiftieth of a second (`levelsFromPcm`) — and
 * the stretches where it speaks become a piecewise-linear gain: down over
 * `speed` seconds into each stretch, held at the floor while it lasts, and
 * back up over twice that once it ends. The preview multiplies its element's
 * volume by `duckGainAt`; the render runs `duckVolumeFilter`, an ffmpeg
 * `volume` expression over the very same points. A sidechain compressor would
 * do it inside ffmpeg alone, but the preview's elements cannot run one, and
 * what is heard while playing must be what renders.
 *
 * **Looking ahead.** The dip starts falling `speed` seconds before the first
 * word, so the voice never arrives over music still at full level: the mix
 * knows what comes next, as a person riding a fader by ear does after one
 * listen.
 *
 * **Short pauses keep the dip.** Two stretches closer than the time it takes
 * to come back up and go down again, plus a breath, are one: music that rose
 * for half a second between sentences would pump.
 *
 * Pure. Which layers are voices and how a moment of the graphic maps into
 * the voice's file is `layer-audio.ts`'s business (`voiceSpans`).
 */

/** A music layer's dip: which layer it dips under, how far and how quickly. */
export interface DuckValue {
  /** The voice layer, as `block.layer`. A layer that is not there dips nothing. */
  under: string;
  /** Decibels the music drops while the voice speaks. */
  depth: number;
  /** Seconds the drop takes; the return takes `DUCK_RELEASE_FACTOR` times as long. */
  speed: number;
}

export const DUCK_LIMITS = {
  depth: { min: 1, max: 40 },
  speed: { min: 0.05, max: 2 },
} as const;

/** What a new dip starts at: far enough to clear a voice, quick enough to sound deliberate. */
export const DEFAULT_DUCK: Omit<DuckValue, 'under'> = { depth: 12, speed: 0.25 };

/** The music comes back this many times slower than it went down: a quick dip and an easy return. */
export const DUCK_RELEASE_FACTOR = 2;

/** A pause shorter than this, on top of the down-and-up, is a breath and keeps the music down. */
export const DUCK_HOLD_SECONDS = 0.3;

/** The step a voice is measured in: one level per fiftieth of a second. */
export const LEVEL_STEP_SECONDS = 0.02;

/** The rate a voice is decoded at to be measured: mono, low, enough for a level. */
export const LEVEL_RATE = 8_000;

/** A voice speaks when it reaches this far under its own loudest moment… */
export const VOICE_RELATIVE = 0.1;
/** …and never below this, so a file of room tone does not count as speech. As a byte, about -40 dBFS. */
export const VOICE_FLOOR = 3;

/** One stretch where the voice speaks, in the graphic's seconds. */
export interface DuckSpan {
  from: number;
  to: number;
}

/** A dip worked out for one render or one preview: its settings and where the voice speaks. */
export interface ResolvedDuck {
  depth: number;
  speed: number;
  spans: readonly DuckSpan[];
}

function clamp(v: number, limit: { min: number; max: number }): number {
  return Math.min(limit.max, Math.max(limit.min, v));
}

/** A dip read from anything at all; `undefined` when it is not one. */
export function sanitizeDuck(input: unknown): DuckValue | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const r = input as Record<string, unknown>;
  const under = typeof r.under === 'string' ? r.under.trim() : '';
  if (under === '' || /\s|\|/.test(under)) return undefined;
  const depth = typeof r.depth === 'number' && Number.isFinite(r.depth) ? clamp(Math.round(r.depth * 10) / 10, DUCK_LIMITS.depth) : DEFAULT_DUCK.depth;
  const speed = typeof r.speed === 'number' && Number.isFinite(r.speed) ? clamp(Math.round(r.speed * 1000) / 1000, DUCK_LIMITS.speed) : DEFAULT_DUCK.speed;
  return { under, depth, speed };
}

/** The short form presets, collections and CSV carry: `block.layer|depth|speed`. */
export function duckToText(duck: DuckValue): string {
  return `${duck.under}|${duck.depth}|${duck.speed}`;
}

export function duckFromText(text: string): DuckValue | undefined {
  const [under, depth, speed] = text.split('|');
  return sanitizeDuck({
    under,
    ...(depth !== undefined && depth !== '' ? { depth: Number(depth) } : {}),
    ...(speed !== undefined && speed !== '' ? { speed: Number(speed) } : {}),
  });
}

/** ffmpeg: the whole file as mono 16-bit samples on stdout, for levels to be taken from. */
export function levelArgs(input: string): string[] {
  return ['-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', String(LEVEL_RATE), '-f', 's16le', '-'];
}

/** The loudest sample in each step of the file, as a byte: silence 0, full scale 255. */
export function levelsFromPcm(pcm: Uint8Array, rate = LEVEL_RATE): Uint8Array {
  const samples = Math.floor(pcm.length / 2);
  const per = Math.max(1, Math.round(rate * LEVEL_STEP_SECONDS));
  const out = new Uint8Array(Math.ceil(samples / per));
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let step = 0; step < out.length; step++) {
    const end = Math.min(samples, (step + 1) * per);
    let loudest = 0;
    for (let i = step * per; i < end; i++) {
      const v = Math.abs(view.getInt16(i * 2, true));
      if (v > loudest) loudest = v;
    }
    out[step] = Math.min(255, Math.round((loudest / 32768) * 255));
  }
  return out;
}

/** The level a voice must reach to count as speaking: a tenth of its loudest, and never under the floor. */
export function voiceThreshold(levels: ArrayLike<number>): number {
  let loudest = 0;
  for (let i = 0; i < levels.length; i++) if ((levels[i] ?? 0) > loudest) loudest = levels[i]!;
  return Math.max(VOICE_FLOOR, Math.ceil(loudest * VOICE_RELATIVE));
}

/** Is the voice speaking at this second of its own file? */
export function speakingAt(levels: ArrayLike<number>, threshold: number, fileSeconds: number): boolean {
  const at = Math.floor(fileSeconds / LEVEL_STEP_SECONDS + 1e-9);
  if (at < 0 || at >= levels.length) return false;
  return (levels[at] ?? 0) >= threshold;
}

/** The music's level at the bottom of the dip, as a gain: -12 dB is about a quarter. */
export function duckFloor(depth: number): number {
  return 10 ** (-clamp(depth, DUCK_LIMITS.depth) / 20);
}

/**
 * The dip's gain as points to draw straight lines between, in the graphic's
 * seconds: four per stretch — still full, at the floor, still at the floor,
 * full again — after stretches too close to come back between are made one.
 * Before the first point and after the last the gain is 1.
 */
export function duckPoints(duck: ResolvedDuck): { t: number; v: number }[] {
  const speed = clamp(duck.speed, DUCK_LIMITS.speed);
  const release = speed * DUCK_RELEASE_FACTOR;
  const floor = duckFloor(duck.depth);
  const sorted = [...duck.spans].filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  const merged: DuckSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.from - last.to < speed + release + DUCK_HOLD_SECONDS) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged.flatMap((span) => [
    { t: span.from - speed, v: 1 },
    { t: span.from, v: floor },
    { t: span.to, v: floor },
    { t: span.to + release, v: 1 },
  ]);
}

/** The dip's gain at a moment of the graphic, 0 to 1: what the preview multiplies its volume by. */
export function duckGainAt(duck: ResolvedDuck | undefined, time: number): number {
  if (!duck || duck.spans.length === 0) return 1;
  const points = duckPoints(duck);
  if (points.length === 0 || time <= points[0]!.t || time >= points[points.length - 1]!.t) return 1;
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    if (time >= b.t) continue;
    const a = points[i - 1]!;
    const span = Math.max(1e-6, b.t - a.t);
    return a.v + (b.v - a.v) * Math.min(1, Math.max(0, (time - a.t) / span));
  }
  return 1;
}

/**
 * The render's dip: a `volume` filter whose expression is the same straight
 * lines between the same points, evaluated per audio frame on the graphic's
 * clock — or null when there is nothing to dip under. Mirrors `duckGainAt`:
 * change both or neither.
 */
export function duckVolumeFilter(duck: ResolvedDuck | undefined): string | null {
  if (!duck || duck.spans.length === 0) return null;
  const points = duckPoints(duck);
  if (points.length === 0) return null;
  // A negative number is bracketed: the dip before a voice at the very start begins before zero.
  const num = (v: number): string => {
    const r = Math.round(v * 1e6) / 1e6;
    return r < 0 ? `(${r})` : String(r);
  };
  // From the last point back: if(lt(t,T1),1, if(lt(t,T2), lerp(1,2), ... 1))
  let expr = '1';
  for (let i = points.length - 1; i >= 1; i--) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const span = Math.max(1e-6, b.t - a.t);
    const lerp = `${num(a.v)}+(${num(b.v - a.v)})*clip((t-${num(a.t)})/${num(span)},0,1)`;
    expr = `if(lt(t,${num(b.t)}),${lerp},${expr})`;
  }
  expr = `if(lt(t,${num(points[0]!.t)}),1,${expr})`;
  return `volume='${expr}':eval=frame`;
}
