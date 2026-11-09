/**
 * The cut track (milestone 49): a project's picture track of clips cut end to
 * end under its layers — deliberately one track, not an editing app's many.
 * The shots of a short, with graphics, captions and sound above them.
 *
 * End to end is the model's whole shape: a cut's place on the timeline is the
 * sum of the cuts before it, so there are no gaps to manage, deleting a cut
 * *is* a ripple delete, trimming an end ripples everything after it by
 * construction, and moving a cut is reordering the list. Each cut is a window
 * of its clip in **seconds of the file** (rounded to the millisecond; frame
 * accuracy arrives with playback across cuts), and the track rides in the
 * same bag as the parameters under `@track` (src/core/params.ts), so projects,
 * presets and the undo history carry it the way they carry the layers.
 *
 * A cut may play at a speed, ramp between two, or hold one frame (milestone
 * 56): its seconds on the timeline are then not its seconds of the file, and
 * `cutSeconds` / `cutSourceTime` are the two directions of that, which every
 * other function here goes through.
 *
 * Pure arithmetic over plain values: the lane (src/renderer/cut-track.ts)
 * computes with these and never keeps a second answer of its own.
 */

import { ASPECT_IDS } from './aspect';
import type { LayerSpan } from './layer-time';
import { EMPTY_SOUND, type SoundValue } from './sound-layer';

/** A cut shorter than this is a click, not a shot: about a frame at any sane rate. */
export const MIN_CUT_SECONDS = 0.05;

export const CUT_TRACK_LIMITS = {
  /** Cuts per track. Past this an edit is an editing app's job, which is where Pulp hands over. */
  count: 200,
  /** Seconds into a file; no clip runs longer than a day. */
  seconds: { min: 0, max: 86_400 },
} as const;

/** What a transition between two cuts may be: a dissolve, a dip to a color, or a bundled wipe template. */
export const CUT_TRANSITIONS = ['dissolve', 'dip', 'wipe'] as const;
export type CutTransitionType = (typeof CUT_TRANSITIONS)[number];

export const TRANSITION_LIMITS = { seconds: { min: 0.1, max: 5 } } as const;
export const DEFAULT_TRANSITION_SECONDS = 0.5;

/**
 * A transition on a cut (milestone 49): between this cut and the next, its
 * duration taken from both sides — half before the boundary, half after, with
 * neither side asked for more than it has. A dissolve blends across it, a dip
 * fades to its color and back, and a wipe plays a bundled wipe template over
 * it, scaled to the duration. On the last cut it means nothing and is kept.
 */
export interface CutTransition {
  type: CutTransitionType;
  /** Seconds the transition takes, half from each side. */
  seconds: number;
  /** The dip's color, #RRGGBB; black when it does not say. */
  color?: string;
  /** The wipe's template, a library template id of a bundled wipe. */
  template?: string;
}

/**
 * A cut's sound unlinked from its picture (milestone 49): `lead` starts it
 * earlier — material before `from`, heard under the previous shot, a J cut —
 * and `tail` runs it on after `to` under the next, an L cut; `muted` silences
 * it with the numbers kept. Absent is linked: the sound is the picture's own
 * window, exactly where it is.
 */
export interface CutSound {
  lead?: number;
  tail?: number;
  muted?: true;
}

export const CUT_SOUND_LIMITS = { seconds: { min: 0, max: 10 } } as const;

/**
 * How a cut plays its window (milestone 56): at a rate, or ramping from one
 * rate to another across the cut. The ramp is linear in **timeline** time —
 * the speed heard rises evenly over the shot, which is what an editor's speed
 * ramp does — so the cut runs for `(to - from) / mean(rate, to)` seconds and
 * the file time under a moment is a quadratic (`cutSourceTime`). `smooth`
 * asks the render for frame interpolation where the rate is under one, in
 * place of repeated frames; the preview shows the nearest frame either way.
 */
export interface CutSpeed {
  /** The rate at the start of the cut, 1 being real time. */
  rate: number;
  /** The rate at the end, when it ramps; absent is constant. */
  to?: number;
  /** Smooth slow motion: interpolate frames in the render where the rate is under one. */
  smooth?: true;
}

export const CUT_SPEED_LIMITS = { rate: { min: 0.25, max: 4 } } as const;

/** How long a frozen frame may hold. */
export const CUT_HOLD_LIMITS = { seconds: { min: 0.1, max: 60 } } as const;
export const DEFAULT_HOLD_SECONDS = 2;

/** One shot: a window of a library clip, in seconds of the file. */
export interface Cut {
  /** The library clip it plays. */
  id: string;
  /** Seconds into the file the cut plays from. */
  from: number;
  /** Seconds into the file it plays to; always at least MIN_CUT_SECONDS past `from`. */
  to: number;
  /** The transition into the next cut; absent is a straight cut. */
  transition?: CutTransition;
  /** The sound unlinked from the picture; absent is linked. */
  sound?: CutSound;
  /** The speed it plays at (milestone 56); absent is real time. */
  speed?: CutSpeed;
  /**
   * A freeze frame (milestone 56): the cut shows the frame at `from` for this
   * many seconds and plays nothing. Its window is then a formality — kept at
   * the minimum so the cut is still a cut — and it has no sound.
   */
  hold?: number;
  /**
   * Where the clip's file was when the cut was made, like a collected item's
   * remembered path (src/core/collection.ts): the one name that survives the
   * file moving, so a track in a saved project heals once the moved folder is
   * back in the library (`healedTrack`).
   */
  path?: string;
  /**
   * How the picture is reframed into a frame of another shape (milestone 77),
   * by aspect: the crop's center over the clip's time, as keyframes. Absent for
   * a shape, the picture is letterboxed into it as ever; present, it fills the
   * frame and the crop follows these — the subject, found on the machine, or
   * wherever a hand moved it.
   */
  reframe?: Record<string, ReframeKey[]>;
}

/** One moment of a reframe: the clip's second, and the crop's center as fractions of the clip's picture. */
export interface ReframeKey {
  at: number;
  x: number;
  y: number;
}

export const REFRAME_LIMITS = { keys: 240 } as const;

/** Reframe keys in order, in range, one per moment, or undefined for nothing usable. */
export function sanitizeReframeKeys(raw: unknown): ReframeKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const keys: ReframeKey[] = [];
  for (const k of raw) {
    if (typeof k !== 'object' || k === null) continue;
    const r = k as Record<string, unknown>;
    if (typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at < 0) continue;
    const frac = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000 : null);
    const x = frac(r.x);
    const y = frac(r.y);
    if (x === null || y === null) continue;
    keys.push({ at: ms(r.at), x, y });
  }
  keys.sort((a, b) => a.at - b.at);
  const out: ReframeKey[] = [];
  for (const k of keys) {
    if (out.length > 0 && Math.abs(out[out.length - 1]!.at - k.at) < 1e-6) out[out.length - 1] = k;
    else out.push(k);
  }
  return out.length > 0 ? out.slice(0, REFRAME_LIMITS.keys) : undefined;
}

/** The crop's center at a clip second: the nearest keys lerped, the first and last held past the ends. */
export function reframeCentreAt(keys: readonly ReframeKey[], at: number): { x: number; y: number } {
  if (keys.length === 0) return { x: 0.5, y: 0.5 };
  if (at <= keys[0]!.at) return { x: keys[0]!.x, y: keys[0]!.y };
  const last = keys[keys.length - 1]!;
  if (at >= last.at) return { x: last.x, y: last.y };
  for (let i = 1; i < keys.length; i++) {
    if (keys[i]!.at >= at) {
      const a = keys[i - 1]!;
      const b = keys[i]!;
      const f = (at - a.at) / Math.max(1e-6, b.at - a.at);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return { x: last.x, y: last.y };
}

/** The reframe keys a cut holds for a frame's shape, if any. */
export function cutReframe(cut: Pick<Cut, 'reframe'>, aspect: string): ReframeKey[] | undefined {
  const keys = cut.reframe?.[aspect];
  return keys && keys.length > 0 ? keys : undefined;
}

/** The track with one cut's reframe for a shape replaced; null takes it off, and an empty record goes with it. */
export function withCutReframe(track: CutTrack, index: number, aspect: string, keys: readonly ReframeKey[] | null): CutTrack {
  const cut = track.cuts[index];
  if (!cut) return track;
  const reframe: Record<string, ReframeKey[]> = { ...cut.reframe };
  const clean = keys ? sanitizeReframeKeys(keys) : undefined;
  if (clean) reframe[aspect] = clean;
  else delete reframe[aspect];
  const next: Cut = { ...cut };
  if (Object.keys(reframe).length > 0) next.reframe = reframe;
  else delete next.reframe;
  const cuts = [...track.cuts];
  cuts[index] = next;
  return { cuts };
}

/**
 * The track with a reframe key set at a clip second for one cut and shape: the
 * hand moving the crop at the playhead (milestone 77). A key within a frame of
 * the moment is replaced rather than doubled.
 */
export function withReframeKeyAt(track: CutTrack, index: number, aspect: string, key: ReframeKey, fps: number): CutTrack {
  const cut = track.cuts[index];
  if (!cut) return track;
  const tolerance = 0.5 / Math.max(1, fps);
  const kept = (cutReframe(cut, aspect) ?? []).filter((k) => Math.abs(k.at - key.at) > tolerance);
  return withCutReframe(track, index, aspect, [...kept, key]);
}

/** The track: its cuts in timeline order. An object, so a transition on a cut has a home to come. */
export interface CutTrack {
  cuts: Cut[];
}

const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/** A whole clip as a cut: what a drop from the results brings, remembering where the file was. */
export function cutFromClip(id: string, duration: number, path?: string): Cut {
  return { id, from: 0, to: ms(Math.max(MIN_CUT_SECONDS, duration)), ...(path ? { path } : {}) };
}

/**
 * The track with every cut's clip re-answered (milestone 49's relinking):
 * `lookup` names the clip as the library knows it now — by its id, or by the
 * cut's remembered path once a moved folder is back in the library — or null
 * to leave the cut as it stands. The same track comes back, by identity, when
 * nothing changed, so nobody writes an undo step for a heal that healed
 * nothing.
 */
export function healedTrack(track: CutTrack, lookup: (cut: Cut) => { id: string; path?: string } | null): CutTrack {
  let changed = false;
  const cuts = track.cuts.map((cut) => {
    const found = lookup(cut);
    if (!found || (found.id === cut.id && (found.path ?? cut.path) === cut.path)) return cut;
    changed = true;
    return { ...cut, id: found.id, ...(found.path ? { path: found.path } : {}) };
  });
  return changed ? { cuts } : track;
}

/** A rate inside the limits; anything that is not one is real time. */
function clampRate(rate: unknown): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return 1;
  return Math.min(CUT_SPEED_LIMITS.rate.max, Math.max(CUT_SPEED_LIMITS.rate.min, rate));
}

/** The rates a cut starts and ends at: both one in real time, equal at a constant speed. */
export function cutRates(cut: Pick<Cut, 'speed'>): { start: number; end: number } {
  const start = clampRate(cut.speed?.rate);
  return { start, end: cut.speed?.to === undefined ? start : clampRate(cut.speed.to) };
}

/** Seconds of the file the cut plays: its window, whatever speed it plays at. */
export function cutSourceSeconds(cut: Pick<Cut, 'from' | 'to'>): number {
  return Math.max(0, cut.to - cut.from);
}

/**
 * Seconds the cut takes on the timeline (milestone 56): a freeze frame holds
 * for its own length; anything else is its window over its mean rate, which
 * is exactly the window over the rate when the speed is constant.
 */
export function cutSeconds(cut: Pick<Cut, 'from' | 'to' | 'speed' | 'hold'>): number {
  if (cut.hold !== undefined) return Math.max(0, cut.hold);
  const { start, end } = cutRates(cut);
  return cutSourceSeconds(cut) / ((start + end) / 2);
}

/** The rate playing `within` seconds into the cut on the timeline: the ramp read at that moment. */
export function cutRateAt(cut: Pick<Cut, 'from' | 'to' | 'speed' | 'hold'>, within: number): number {
  if (cut.hold !== undefined) return 0;
  const { start, end } = cutRates(cut);
  const seconds = cutSeconds(cut);
  if (seconds <= 0 || start === end) return start;
  return start + (end - start) * Math.min(1, Math.max(0, within / seconds));
}

/**
 * The second of the file under a moment `within` seconds into the cut on the
 * timeline, clamped to the cut's window — past either edge the edge frame
 * holds, which is what a dissolve's clone-padding holds. A freeze frame is
 * always its one frame. A ramp integrates its rate: r₁t + (r₂ − r₁)t²/2T.
 */
export function cutSourceTime(cut: Pick<Cut, 'from' | 'to' | 'speed' | 'hold'>, within: number): number {
  if (cut.hold !== undefined) return cut.from;
  const { start, end } = cutRates(cut);
  const seconds = cutSeconds(cut);
  const t = Math.min(seconds, Math.max(0, within));
  const consumed = start === end || seconds <= 0 ? start * t : start * t + ((end - start) * t * t) / (2 * seconds);
  return Math.min(cut.to, cut.from + consumed);
}

/**
 * The inverse: how far into the cut, on the timeline, the file reaches
 * `source` seconds — what a split at a moment and a trim by the hand need.
 * For a ramp it is the quadratic solved for t; the arithmetic is the same
 * one `cutSourceTime` integrates, so the two agree to the microsecond.
 */
export function cutTimelineTime(cut: Pick<Cut, 'from' | 'to' | 'speed' | 'hold'>, source: number): number {
  if (cut.hold !== undefined) return 0;
  const { start, end } = cutRates(cut);
  const seconds = cutSeconds(cut);
  const consumed = Math.min(cutSourceSeconds(cut), Math.max(0, source - cut.from));
  if (start === end || seconds <= 0) return consumed / start;
  const a = (end - start) / (2 * seconds);
  return (-start + Math.sqrt(start * start + 4 * a * consumed)) / (2 * a);
}

/** Where each cut sits on the timeline: end to end from zero. */
export function cutWindows(track: CutTrack): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let at = 0;
  for (const cut of track.cuts) {
    const end = at + cutSeconds(cut);
    out.push({ start: at, end });
    at = end;
  }
  return out;
}

export function trackDuration(track: CutTrack): number {
  return track.cuts.reduce((sum, cut) => sum + cutSeconds(cut), 0);
}

/** The cut under a moment of the timeline, or null off the track's end. The boundary belongs to the later cut. */
export function cutIndexAt(track: CutTrack, time: number): number | null {
  if (!Number.isFinite(time) || time < 0) return null;
  const windows = cutWindows(track);
  for (let i = 0; i < windows.length; i++) {
    if (time >= windows[i]!.start && time < windows[i]!.end) return i;
  }
  return null;
}

/** The track with a cut put in at `index`, clamped into the list and to the track's own cap. */
export function withCutInserted(track: CutTrack, index: number, cut: Cut): CutTrack {
  if (track.cuts.length >= CUT_TRACK_LIMITS.count) return track;
  const at = Math.max(0, Math.min(track.cuts.length, Math.floor(index)));
  const cuts = [...track.cuts];
  cuts.splice(at, 0, cut);
  return { cuts };
}

/** The track without the cut at `index`: the ones after close up, which is all a ripple delete is here. */
export function withCutRemoved(track: CutTrack, index: number): CutTrack {
  if (!track.cuts[index]) return track;
  return { cuts: track.cuts.filter((_, i) => i !== index) };
}

/** The cut at `from` moved to sit at `to`, the rest closing around it: a move along an end-to-end track. */
export function withCutMoved(track: CutTrack, from: number, to: number): CutTrack {
  const cut = track.cuts[from];
  if (!cut) return track;
  const target = Math.max(0, Math.min(track.cuts.length - 1, Math.floor(to)));
  if (target === from) return track;
  const cuts = track.cuts.filter((_, i) => i !== from);
  cuts.splice(target, 0, cut);
  return { cuts };
}

/**
 * The cut at `index` with an end trimmed: a new window in the file's own
 * seconds, held inside the file and clear of the other end by MIN_CUT_SECONDS.
 * Everything after ripples by construction. `sourceDuration` is what the
 * library measured the file at, the only bound a `to` can have.
 */
export function withCutWindow(track: CutTrack, index: number, window: { from?: number; to?: number }, sourceDuration: number): CutTrack {
  const cut = track.cuts[index];
  if (!cut) return track;
  const limit = Math.max(MIN_CUT_SECONDS, Number.isFinite(sourceDuration) ? sourceDuration : cut.to);
  let { from, to } = cut;
  if (window.to !== undefined) to = ms(Math.min(limit, Math.max(from + MIN_CUT_SECONDS, window.to)));
  if (window.from !== undefined) from = ms(Math.max(0, Math.min(to - MIN_CUT_SECONDS, window.from)));
  if (from === cut.from && to === cut.to) return track;
  return { cuts: track.cuts.map((c, i) => (i === index ? { ...c, from, to } : c)) };
}

/**
 * The track split at a moment of the timeline: the cut under it becomes two
 * cuts of the same clip meeting there. Within half a minimum of a boundary
 * there is nothing to split, and the track comes back unchanged — the same
 * object, so the caller can tell a split from a no-op and write no undo step.
 */
export function splitAt(track: CutTrack, time: number): CutTrack {
  const index = cutIndexAt(track, time);
  if (index === null) return track;
  const cut = track.cuts[index]!;
  const within = ms(time - cutWindows(track)[index]!.start);
  if (within < MIN_CUT_SECONDS || cutSeconds(cut) - within < MIN_CUT_SECONDS) return track;
  // A freeze frame splits into two holds of the same frame: the moment divides the hold.
  if (cut.hold !== undefined) {
    const cuts = [...track.cuts];
    cuts.splice(index, 1, { ...cut, hold: ms(within) }, { ...cut, hold: ms(cut.hold - within) });
    return { cuts };
  }
  // The file second under the moment; a ramp is cut into two ramps meeting at the rate it had
  // there, so what plays is unchanged — only now in two cuts.
  const at = ms(cutSourceTime(cut, within));
  if (at - cut.from < MIN_CUT_SECONDS || cut.to - at < MIN_CUT_SECONDS) return track;
  const { start, end } = cutRates(cut);
  const rateAt = Math.round(cutRateAt(cut, within) * 1000) / 1000;
  const ramped = cut.speed && start !== end;
  const first: Cut = { ...cut, to: at, ...(ramped ? { speed: { ...cut.speed!, rate: start, to: rateAt } } : {}) };
  const second: Cut = { ...cut, from: at, ...(ramped ? { speed: { ...cut.speed!, rate: rateAt, to: end } } : {}) };
  const cuts = [...track.cuts];
  cuts.splice(index, 1, first, second);
  return { cuts };
}

/** What the track shows at a moment: which cut, and the second of its file — or null past the track's end. */
export function trackSourceAt(track: CutTrack, time: number): { id: string; index: number; seconds: number } | null {
  const index = cutIndexAt(track, time);
  if (index === null) return null;
  const cut = track.cuts[index]!;
  return { id: cut.id, index, seconds: cutSourceTime(cut, time - cutWindows(track)[index]!.start) };
}

/**
 * The track's sound (milestone 48 serves milestone 49): each cut as a
 * sound-shaped value — the cut's window as the in and out points, its place
 * on the timeline as the delay, played once — with its own window as a span.
 * The span's gate fades the ten milliseconds at each boundary, so a cut in
 * the mix is a cut without the click. The whole of milestone 48 then carries
 * it: the preview's elements, the render's chains, the loudness meter and the
 * waveform arithmetic all take these as they take an audio layer's sound.
 */
export interface TrackSound {
  /** Which cut this piece belongs to: a hold has none and a ramp has several, so the pieces are not the cuts. */
  cut: number;
  value: SoundValue;
  span: LayerSpan;
  /** The rate this piece plays at, its pitch kept (milestone 56); absent is real time. */
  speed?: number;
}

/** How finely a ramp's sound is stepped: a slice per this many timeline seconds, within bounds. */
const RAMP_SOUND_SLICE_SECONDS = 0.5;
const RAMP_SOUND_SLICES = { min: 2, max: 12 } as const;

export function trackAudio(track: CutTrack): TrackSound[] {
  const windows = cutWindows(track);
  const out: TrackSound[] = [];
  track.cuts.forEach((cut, index) => {
    // A frozen frame has no sound: there is no moment of the file passing to hear.
    if (cut.sound?.muted || cut.hold !== undefined) return;
    const { start, end } = cutRates(cut);
    if (start !== end) {
      // A ramp's sound (milestone 56): `atempo` and an element's playback rate are each one
      // rate, so the ramp is played as slices of constant speed — each the mean of the ramp over
      // its stretch, so every slice ends on the very file second the picture reaches there and
      // the sound never drifts from the frame. Unlinked offsets do not ramp; they are left off.
      const seconds = cutSeconds(cut);
      const slices = Math.min(RAMP_SOUND_SLICES.max, Math.max(RAMP_SOUND_SLICES.min, Math.ceil(seconds / RAMP_SOUND_SLICE_SECONDS)));
      for (let k = 0; k < slices; k++) {
        const t0 = (seconds * k) / slices;
        const t1 = (seconds * (k + 1)) / slices;
        const s0 = cutSourceTime(cut, t0);
        const s1 = cutSourceTime(cut, t1);
        if (s1 - s0 <= 0.001) continue;
        out.push({
          cut: index,
          value: { ...EMPTY_SOUND, id: cut.id, inPoint: ms(s0), outPoint: ms(s1), ending: 'once' as const, delay: ms(windows[index]!.start + t0) },
          span: { start: ms(windows[index]!.start + t0), end: ms(windows[index]!.start + t1) },
          speed: Math.round(((s1 - s0) / (t1 - t0)) * 1e6) / 1e6,
        });
      }
      return;
    }
    // Unlinked sound (a J or an L cut): the lead starts it earlier — material before `from`,
    // bounded by what the file has before it — and the tail runs it on after `to`, bounded at
    // use by the file's end, as any out point is. The delay and the span move with it, so it is
    // heard under the neighboring shots exactly where it reaches. At a speed, the lead and the
    // tail are file seconds too, and reach as far on the timeline as that speed lets them.
    const lead = Math.min(cut.sound?.lead ?? 0, cut.from, windows[index]!.start * start);
    const tail = cut.sound?.tail ?? 0;
    out.push({
      cut: index,
      value: { ...EMPTY_SOUND, id: cut.id, inPoint: ms(cut.from - lead), outPoint: ms(cut.to + tail), ending: 'once' as const, delay: ms(windows[index]!.start - lead / start) },
      span: { start: ms(windows[index]!.start - lead / start), end: ms(windows[index]!.end + tail / start) },
      ...(start !== 1 ? { speed: start } : {}),
    });
  });
  return out;
}

/**
 * The transition leaving a cut, as it will play (milestone 49): between cut
 * `index` and the next, centered on their boundary, its duration taken from
 * both sides — and neither side asked for more than it has, so a short shot
 * shortens the transition rather than being swallowed by it. Null on the last
 * cut, where there is no next shot to go to, and where there is none.
 */
export function transitionAt(track: CutTrack, index: number): { type: CutTransitionType; seconds: number; at: number; color: string; template?: string } | null {
  const cut = track.cuts[index];
  const next = track.cuts[index + 1];
  const transition = cut?.transition;
  if (!cut || !next || !transition) return null;
  const half = Math.min(transition.seconds / 2, cutSeconds(cut) / 2, cutSeconds(next) / 2);
  const seconds = ms(Math.max(TRANSITION_LIMITS.seconds.min, half * 2));
  return {
    type: transition.type,
    seconds,
    at: ms(cutWindows(track)[index]!.end),
    color: transition.color ?? '#000000',
    ...(transition.template ? { template: transition.template } : {}),
  };
}

/** The cut at `index` with this transition into the next, or none; unchanged when there is no such cut. */
export function withCutTransition(track: CutTrack, index: number, transition: CutTransition | null): CutTrack {
  if (!track.cuts[index]) return track;
  return {
    cuts: track.cuts.map((c, i) => {
      if (i !== index) return c;
      const rest = { ...c };
      delete rest.transition;
      return transition ? { ...rest, transition } : rest;
    }),
  };
}

/** The cut at `index` with its sound linked, muted or offset; unchanged when there is no such cut. */
export function withCutSound(track: CutTrack, index: number, sound: CutSound | null): CutTrack {
  if (!track.cuts[index]) return track;
  return {
    cuts: track.cuts.map((c, i) => {
      if (i !== index) return c;
      const rest = { ...c };
      delete rest.sound;
      return sound && (sound.lead || sound.tail || sound.muted) ? { ...rest, sound } : rest;
    }),
  };
}

/**
 * The cut at `index` at this speed (milestone 56), or back to real time with
 * null. A rate equal at both ends is stored as the one rate; a freeze frame
 * has no speed to set and is left as it is.
 */
export function withCutSpeed(track: CutTrack, index: number, speed: CutSpeed | null): CutTrack {
  const cut = track.cuts[index];
  if (!cut || cut.hold !== undefined) return track;
  let next: CutSpeed | undefined;
  if (speed) {
    const rate = Math.round(clampRate(speed.rate) * 1000) / 1000;
    const to = speed.to === undefined ? undefined : Math.round(clampRate(speed.to) * 1000) / 1000;
    const ramp = to !== undefined && to !== rate;
    if (rate !== 1 || ramp || speed.smooth) next = { rate, ...(ramp ? { to } : {}), ...(speed.smooth ? { smooth: true as const } : {}) };
  }
  return {
    cuts: track.cuts.map((c, i) => {
      if (i !== index) return c;
      const rest = { ...c };
      delete rest.speed;
      return next ? { ...rest, speed: next } : rest;
    }),
  };
}

/** A freeze frame's hold set to this many seconds; unchanged where the cut is not one. */
export function withCutHold(track: CutTrack, index: number, seconds: number): CutTrack {
  const cut = track.cuts[index];
  if (!cut || cut.hold === undefined) return track;
  const hold = ms(Math.min(CUT_HOLD_LIMITS.seconds.max, Math.max(CUT_HOLD_LIMITS.seconds.min, seconds)));
  if (hold === cut.hold) return track;
  return { cuts: track.cuts.map((c, i) => (i === index ? { ...c, hold } : c)) };
}

/**
 * A freeze frame at a moment of the timeline (milestone 56): the cut under
 * it is split there and a hold of the frame at the split goes between the
 * two pieces, so the shot stops, holds, and goes on from the very frame it
 * stopped on. Too near a boundary to split, the hold goes in at that
 * boundary instead, of the frame the later side starts on — a freeze at the
 * head of a shot. Unchanged, by identity, where there is no cut under the
 * moment; one call, so one undo step.
 */
export function withFreezeAt(track: CutTrack, time: number, seconds: number): CutTrack {
  const index = cutIndexAt(track, time);
  if (index === null) return track;
  const split = splitAt(track, time);
  const windows = cutWindows(split);
  // After a split the later piece starts at the moment; without one, the nearest boundary does.
  const at = split === track
    ? (time - windows[index]!.start < windows[index]!.end - time ? index : index + 1)
    : index + 1;
  const frameOf = split.cuts[Math.min(at, split.cuts.length - 1)]!;
  // The frame the later side starts on; at the track's very end, the last frame of the last cut.
  const from = at < split.cuts.length ? frameOf.from : frameOf.to;
  const hold: Cut = {
    id: frameOf.id, from: ms(from), to: ms(from + MIN_CUT_SECONDS),
    hold: ms(Math.min(CUT_HOLD_LIMITS.seconds.max, Math.max(CUT_HOLD_LIMITS.seconds.min, seconds))),
    ...(frameOf.path ? { path: frameOf.path } : {}),
  };
  return withCutInserted(split, at, hold);
}

/**
 * The track with quiet stretches cut out (milestone 49): each range is a
 * stretch of the timeline, as the silence scan maps them; a cut it covers
 * whole goes, a cut it covers partly is split around it, and everything
 * ripples by construction. Pieces shorter than a minimum go with the silence
 * rather than surviving as slivers; the first piece of a cut keeps its sound,
 * the last keeps its transition. One call, so one undo step.
 */
export function withSilencesCut(track: CutTrack, ranges: readonly { start: number; end: number }[]): CutTrack {
  if (ranges.length === 0) return track;
  const windows = cutWindows(track);
  const cuts: Cut[] = [];
  track.cuts.forEach((cut, index) => {
    const { start, end } = windows[index]!;
    // A frozen frame has no sound, so no silence is found in it; it stays as it is.
    if (cut.hold !== undefined) {
      cuts.push(cut);
      return;
    }
    // The stretches of this cut that stay: its window minus every range, in file seconds — the
    // timeline moment mapped through the cut's speed (milestone 56). A ramp is kept whole across
    // the pieces as the rate at each piece's ends, so what plays is unchanged.
    let kept: { from: number; to: number }[] = [{ from: cut.from, to: cut.to }];
    for (const range of ranges) {
      const cutFrom = cutSourceTime(cut, Math.max(0, Math.min(end, range.start) - start));
      const cutTo = cutSourceTime(cut, Math.max(0, Math.min(end, range.end) - start));
      if (cutTo <= cutFrom) continue;
      kept = kept.flatMap((piece) => {
        const out: { from: number; to: number }[] = [];
        if (cutFrom > piece.from) out.push({ from: piece.from, to: Math.min(piece.to, cutFrom) });
        if (cutTo < piece.to) out.push({ from: Math.max(piece.from, cutTo), to: piece.to });
        return out;
      });
    }
    const pieces = kept.filter((piece) => piece.to - piece.from >= MIN_CUT_SECONDS);
    const { start: r0, end: r1 } = cutRates(cut);
    pieces.forEach((piece, i) => {
      const first = i === 0;
      const last = i === pieces.length - 1;
      const speed = cut.speed && (r0 !== r1
        ? { ...cut.speed, rate: Math.round(cutRateAt(cut, cutTimelineTime(cut, piece.from)) * 1000) / 1000, to: Math.round(cutRateAt(cut, cutTimelineTime(cut, piece.to)) * 1000) / 1000 }
        : cut.speed);
      cuts.push({
        id: cut.id,
        from: ms(piece.from),
        to: ms(piece.to),
        ...(cut.path ? { path: cut.path } : {}),
        ...(speed ? { speed } : {}),
        ...(first && cut.sound ? { sound: cut.sound } : {}),
        ...(last && cut.transition ? { transition: cut.transition } : {}),
      });
    });
  });
  return { cuts };
}

/**
 * A moment pulled to the nearest target within `tolerance`, or left where it
 * is: what a trim or a drop snaps by. The targets are the caller's — the
 * cuts, the playhead and the in and out marks — and the tolerance is a few
 * pixels' worth of seconds at the lane's own scale.
 */
export function snapTime(time: number, targets: readonly number[], tolerance: number): number {
  let best = time;
  let distance = tolerance;
  for (const target of targets) {
    const d = Math.abs(target - time);
    if (d <= distance) {
      best = target;
      distance = d;
    }
  }
  return best;
}

/**
 * A track with every field in range, from anything at all: cuts with a clip
 * and a window at least a minimum long, counted. `null` when the input is not
 * a track or holds nothing — an empty track is no track at all, so a project
 * nobody has cut serializes as it always did.
 */
export function sanitizeCutTrack(input: unknown): CutTrack | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = (input as { cuts?: unknown }).cuts;
  if (!Array.isArray(raw)) return null;
  const cuts: Cut[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.trim() === '') continue;
    const second = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? ms(Math.min(CUT_TRACK_LIMITS.seconds.max, Math.max(CUT_TRACK_LIMITS.seconds.min, v))) : null;
    const from = second(r.from);
    const to = second(r.to);
    // A hair under the minimum is the minimum: a window written as from + MIN_CUT_SECONDS can read a
    // billionth short once the two are subtracted, and a freeze frame's formal window is exactly that.
    if (from === null || to === null || to - from < MIN_CUT_SECONDS - 1e-9) continue;
    const cut: Cut = { id: r.id.trim(), from, to };
    const t = r.transition as Record<string, unknown> | undefined;
    if (typeof t === 'object' && t !== null && (CUT_TRANSITIONS as readonly string[]).includes(t.type as string)) {
      const seconds = typeof t.seconds === 'number' && Number.isFinite(t.seconds)
        ? ms(Math.min(TRANSITION_LIMITS.seconds.max, Math.max(TRANSITION_LIMITS.seconds.min, t.seconds)))
        : DEFAULT_TRANSITION_SECONDS;
      const color = typeof t.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color.toLowerCase() : undefined;
      const template = typeof t.template === 'string' && t.template.trim() !== '' ? t.template.trim() : undefined;
      if ((t.type as CutTransitionType) !== 'wipe' || template) {
        cut.transition = { type: t.type as CutTransitionType, seconds, ...(color ? { color } : {}), ...(template ? { template } : {}) };
      }
    }
    if (typeof r.path === 'string' && r.path.trim() !== '') cut.path = r.path.trim();
    // The reframes by shape (milestone 77): only shapes the frames come in, each a usable list of keys.
    if (typeof r.reframe === 'object' && r.reframe !== null) {
      const reframe: Record<string, ReframeKey[]> = {};
      for (const [aspect, keys] of Object.entries(r.reframe as Record<string, unknown>)) {
        if (!ASPECT_IDS.includes(aspect)) continue;
        const clean = sanitizeReframeKeys(keys);
        if (clean) reframe[aspect] = clean;
      }
      if (Object.keys(reframe).length > 0) cut.reframe = reframe;
    }
    const sp = r.speed as Record<string, unknown> | undefined;
    if (typeof sp === 'object' && sp !== null && typeof sp.rate === 'number' && Number.isFinite(sp.rate)) {
      const rate = Math.round(clampRate(sp.rate) * 1000) / 1000;
      const to = typeof sp.to === 'number' && Number.isFinite(sp.to) ? Math.round(clampRate(sp.to) * 1000) / 1000 : undefined;
      const ramp = to !== undefined && to !== rate;
      if (rate !== 1 || ramp || sp.smooth === true) cut.speed = { rate, ...(ramp ? { to } : {}), ...(sp.smooth === true ? { smooth: true } : {}) };
    }
    if (typeof r.hold === 'number' && Number.isFinite(r.hold) && r.hold > 0) {
      cut.hold = ms(Math.min(CUT_HOLD_LIMITS.seconds.max, Math.max(CUT_HOLD_LIMITS.seconds.min, r.hold)));
      // A hold plays nothing, so it has no speed and no sound to carry.
      delete cut.speed;
    }
    const sd = r.sound as Record<string, unknown> | undefined;
    if (typeof sd === 'object' && sd !== null) {
      const offset = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0
        ? ms(Math.min(CUT_SOUND_LIMITS.seconds.max, Math.max(CUT_SOUND_LIMITS.seconds.min, v)))
        : undefined);
      const lead = offset(sd.lead);
      const tail = offset(sd.tail);
      const muted = sd.muted === true;
      if ((lead !== undefined || tail !== undefined || muted) && cut.hold === undefined) {
        cut.sound = { ...(lead !== undefined ? { lead } : {}), ...(tail !== undefined ? { tail } : {}), ...(muted ? { muted: true } : {}) };
      }
    }
    cuts.push(cut);
    if (cuts.length === CUT_TRACK_LIMITS.count) break;
  }
  return cuts.length > 0 ? { cuts } : null;
}
