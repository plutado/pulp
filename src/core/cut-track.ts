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
 * Pure arithmetic over plain values: the lane (src/renderer/cut-track.ts)
 * computes with these and never keeps a second answer of its own.
 */

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

/** One shot: a window of a library clip, in seconds of the file. */
export interface Cut {
  /** The library clip it plays. */
  id: string;
  /** Seconds into the file the cut plays from. */
  from: number;
  /** Seconds into the file it plays to; always at least MIN_CUT_SECONDS past `from`. */
  to: number;
}

/** The track: its cuts in timeline order. An object, so a transition on a cut has a home to come. */
export interface CutTrack {
  cuts: Cut[];
}

const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/** A whole clip as a cut: what a drop from the results brings. */
export function cutFromClip(id: string, duration: number): Cut {
  return { id, from: 0, to: ms(Math.max(MIN_CUT_SECONDS, duration)) };
}

export function cutSeconds(cut: Cut): number {
  return Math.max(0, cut.to - cut.from);
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
  const first: Cut = { ...cut, to: ms(cut.from + within) };
  const second: Cut = { ...cut, from: ms(cut.from + within) };
  const cuts = [...track.cuts];
  cuts.splice(index, 1, first, second);
  return { cuts };
}

/** What the track shows at a moment: which cut, and the second of its file — or null past the track's end. */
export function trackSourceAt(track: CutTrack, time: number): { id: string; index: number; seconds: number } | null {
  const index = cutIndexAt(track, time);
  if (index === null) return null;
  const cut = track.cuts[index]!;
  return { id: cut.id, index, seconds: cut.from + (time - cutWindows(track)[index]!.start) };
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
export function trackAudio(track: CutTrack): { value: SoundValue; span: LayerSpan }[] {
  const windows = cutWindows(track);
  return track.cuts.map((cut, index) => ({
    value: { ...EMPTY_SOUND, id: cut.id, inPoint: cut.from, outPoint: cut.to, ending: 'once' as const, delay: windows[index]!.start },
    span: { start: windows[index]!.start, end: windows[index]!.end },
  }));
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
    if (from === null || to === null || to - from < MIN_CUT_SECONDS) continue;
    cuts.push({ id: r.id.trim(), from, to });
    if (cuts.length === CUT_TRACK_LIMITS.count) break;
  }
  return cuts.length > 0 ? { cuts } : null;
}
