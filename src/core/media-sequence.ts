/**
 * Frame sequences: a run of numbered image files read as one clip
 * (milestone 26). A great deal of asset stock ships this way — `fire_0001.png`
 * to `fire_0120.png` in a folder — and indexed a file at a time it fills the
 * results with a hundred near-identical cards instead of one clip to place.
 *
 * Pure: names in, groups out — no Node imports, so the window can read a
 * sequence entry as readily as the scan writes one. The scan calls
 * `groupSequences` with one folder's file names and indexes what comes back;
 * nothing here touches disk.
 */

/** A file name's extension, lower-cased, with its dot; "" when it has none. */
function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

import type { MediaMetadata } from './media-meta';

/**
 * Extensions whose numbered runs are read as one clip: the formats that carry
 * an alpha channel and are actually used for frame sequences. JPEG is left out
 * on purpose — numbered JPEGs are far more often a folder of photographs than
 * a clip, and grouping those would hide them.
 */
export const SEQUENCE_EXTENSIONS: readonly string[] = ['.png', '.tif', '.tiff', '.exr', '.dpx'];

/**
 * Frames a run needs before it counts as a sequence. Below this a numbered run
 * is far more likely to be variants (`logo-1.png`, `logo-2.png`) than frames,
 * and grouping those would hide pictures someone meant to see separately.
 */
export const SEQUENCE_MIN_FRAMES = 8;

/**
 * Frames per second a sequence is read at. **Nothing in a folder of frames
 * records a rate** — it is carried by the thing that plays them — so Pulp
 * states one rather than guessing per file: its own default render rate, the
 * rate most bundled templates run at. It decides only the clip's duration and
 * how its hover-scrub is spread; the frames themselves are untouched.
 */
export const SEQUENCE_FPS = 30;

export interface MediaSequence {
  /** The folder holding the frames. */
  dir: string;
  /** The name before the frame number: "fire_" of "fire_0001.png". */
  stem: string;
  /** Lower-case extension, with its dot. */
  ext: string;
  /** Digits in a frame number, so 4 for "0001"; frames all share one width. */
  digits: number;
  /** The first frame's number, which is not always 0 or 1. */
  start: number;
  /** How many frames, all consecutive from `start`. */
  count: number;
}

/** One frame's file name, "fire_0007.png". */
export function sequenceFrameName(seq: MediaSequence, frame: number): string {
  const n = seq.start + Math.max(0, Math.min(seq.count - 1, Math.floor(frame)));
  return `${seq.stem}${String(n).padStart(seq.digits, '0')}${seq.ext}`;
}

/**
 * The name ffmpeg's image2 demuxer takes for the whole run, "fire_%04d.png".
 * Note `start` is handed to ffmpeg separately, as `-start_number`.
 */
export function sequencePatternName(seq: MediaSequence): string {
  return `${seq.stem}%0${seq.digits}d${seq.ext}`;
}

/**
 * A sequence's key for the library: the pattern, which names the run as a
 * whole and stays put when a frame is added at the end. A single file's key is
 * its path, and no file is named `%04d`, so the two cannot collide.
 */
export function sequenceKeyName(seq: MediaSequence): string {
  return sequencePatternName(seq);
}

/** Seconds a sequence runs for at `SEQUENCE_FPS`. */
export function sequenceDuration(count: number, fps = SEQUENCE_FPS): number {
  return Math.round((Math.max(0, count) / Math.max(1, fps)) * 1000) / 1000;
}

/**
 * The frame a poster should come from: a tenth of the way in, as a clip's
 * thumbnail is sampled, so a sequence that fades up is not postered black.
 */
export function sequencePosterFrame(count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(count / 10)));
}

/** Frame numbers a hover-scrub strip samples: evenly spread, first to last. */
export function sequenceStripFrames(count: number, frames: number): number[] {
  const last = Math.max(0, count - 1);
  if (frames <= 1) return [Math.floor(last / 2)];
  return Array.from({ length: frames }, (_, i) => Math.round((i * last) / (frames - 1)));
}

/**
 * What a sequence's first frame says about the whole clip. The frame gives the
 * picture — size, pixel format, and so whether it carries alpha — and the run
 * gives what one frame cannot: how long it is, and at what rate.
 */
export function sequenceMetadata(frame: MediaMetadata | null, seq: MediaSequence, fps = SEQUENCE_FPS): MediaMetadata | null {
  if (!frame) return null;
  return { ...frame, duration: sequenceDuration(seq.count, fps), fps };
}

/** A file name split into the part before its trailing digits, those digits, and the extension. */
function splitNumbered(name: string): { stem: string; number: number; digits: number; ext: string } | null {
  const ext = fileExtension(name);
  if (!SEQUENCE_EXTENSIONS.includes(ext)) return null;
  const base = name.slice(0, name.length - ext.length);
  const match = /^(.*?)(\d+)$/.exec(base);
  if (!match) return null;
  const [, stem, digits] = match;
  // A number long enough to overflow is not a frame count; it is an id or a date stamp.
  if (digits!.length > 9) return null;
  return { stem: stem!, number: Number(digits), digits: digits!.length, ext };
}

/**
 * Group one folder's file names into frame sequences and everything else.
 *
 * A sequence is **consecutive**: a run with a hole in it is left as separate
 * files, because a clip that silently skips a missing frame is worse than
 * seeing that a frame is missing. A folder may hold several runs, and a run
 * that is long enough while its neighbours are not takes only its own frames.
 * Frames of different digit widths (`f_1.png` beside `f_0001.png`) are
 * different runs, which is also how ffmpeg's demuxer reads them.
 */
export function groupSequences(
  dir: string,
  names: readonly string[],
  minFrames = SEQUENCE_MIN_FRAMES,
): { sequences: MediaSequence[]; singles: string[] } {
  const runs = new Map<string, { stem: string; ext: string; digits: number; numbers: Map<number, string> }>();
  const singles: string[] = [];
  for (const name of names) {
    const parsed = splitNumbered(name);
    if (!parsed) {
      singles.push(name);
      continue;
    }
    const groupKey = `${parsed.stem}\u0000${parsed.digits}\u0000${parsed.ext}`;
    const run = runs.get(groupKey) ?? { stem: parsed.stem, ext: parsed.ext, digits: parsed.digits, numbers: new Map<number, string>() };
    // A duplicate number can only come from two spellings of one name; keep the first and
    // let the other stand on its own rather than dropping it.
    if (run.numbers.has(parsed.number)) singles.push(name);
    else run.numbers.set(parsed.number, name);
    runs.set(groupKey, run);
  }

  const sequences: MediaSequence[] = [];
  for (const run of runs.values()) {
    const numbers = [...run.numbers.keys()].sort((a, b) => a - b);
    let i = 0;
    while (i < numbers.length) {
      let end = i;
      while (end + 1 < numbers.length && numbers[end + 1] === numbers[end]! + 1) end += 1;
      const length = end - i + 1;
      if (length >= minFrames) {
        sequences.push({ dir, stem: run.stem, ext: run.ext, digits: run.digits, start: numbers[i]!, count: length });
      } else {
        for (let k = i; k <= end; k++) singles.push(run.numbers.get(numbers[k]!)!);
      }
      i = end + 1;
    }
  }
  sequences.sort((a, b) => a.stem.localeCompare(b.stem) || a.start - b.start);
  singles.sort((a, b) => a.localeCompare(b));
  return { sequences, singles };
}
