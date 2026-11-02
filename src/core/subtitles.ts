/**
 * Subtitle files from the captions layer (milestone 50): the lines written as
 * SubRip (`.srt`) and WebVTT (`.vtt`) beside the video, for the platforms and
 * players that take captions as a file rather than as pixels.
 *
 * A cue is a line: it starts when the line's first word is said and ends when
 * its last word is done, held clear of the cue after it, since two cues on
 * screen at once read as a mistake in every player. Times are written against
 * the **rendered** file, not the project: a render trimmed to its in and out
 * points shifts every cue by the in point and drops the lines outside, so the
 * file beside the video lines up with the video.
 *
 * Pure: the main process writes what these return and nothing else.
 */

import { lineEnd, lineStart, lineText, type CaptionsValue } from './captions';

export interface SubtitleCue {
  /** Seconds into the rendered file. */
  start: number;
  end: number;
  text: string;
}

/** A cue is on screen for at least this long, so a one-word line is readable rather than a flicker. */
const MIN_CUE_SECONDS = 0.5;

/**
 * The captions as cues of the rendered file: `from` and `to` are the stretch
 * of the project the render covers, in seconds. Lines wholly outside it go;
 * a line straddling an edge is clipped to it.
 */
export function subtitleCues(captions: CaptionsValue, window: { from: number; to: number }): SubtitleCue[] {
  const from = Math.max(0, window.from);
  const to = Math.max(from, window.to);
  const cues: SubtitleCue[] = [];
  const lines = captions.lines.filter((line) => line.words.length > 0);
  lines.forEach((line, i) => {
    const start = lineStart(line);
    const next = lines[i + 1];
    // Held at least a moment, and never into the next cue.
    let end = Math.max(lineEnd(line), start + MIN_CUE_SECONDS);
    if (next) end = Math.min(end, lineStart(next));
    if (end <= start) end = start + 0.001;
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (b - a <= 0.001) return;
    const round = (v: number) => Math.round((v - from) * 1000) / 1000;
    cues.push({ start: round(a), end: round(b), text: lineText(line) });
  });
  return cues;
}

/** `HH:MM:SS` and the milliseconds, joined by the separator each format wants. */
function stamp(seconds: number, separator: string): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000);
  const two = (v: number) => String(v).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)}${separator}${String(ms).padStart(3, '0')}`;
}

/** SubRip: numbered cues, a comma before the milliseconds, a blank line between. */
export function srtText(cues: readonly SubtitleCue[]): string {
  return cues.map((cue, i) => `${i + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cue.text}\n`).join('\n');
}

/** WebVTT: the header, then the cues with a full stop before the milliseconds. */
export function vttText(cues: readonly SubtitleCue[]): string {
  const body = cues.map((cue) => `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cue.text}\n`).join('\n');
  return `WEBVTT\n\n${body}`;
}

/**
 * Where the subtitle files go: beside the render with its own name and the
 * subtitle extension; a sequence's frame pattern is dropped, as the cover's is.
 */
export function subtitleOutputPaths(output: string): { srt: string; vtt: string } {
  const slash = Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'));
  const dir = output.slice(0, slash + 1);
  let file = output.slice(slash + 1).replace(/_%0?\d*d(?=\.[^.]*$|$)/, '');
  const dot = file.lastIndexOf('.');
  file = dot > 0 ? file.slice(0, dot) : file;
  return { srt: `${dir}${file}.srt`, vtt: `${dir}${file}.vtt` };
}

/** Where the alpha caption track goes (milestone 50): beside the render, "-captions.mov", whatever the render's own format. */
export function captionTrackOutputPath(output: string): string {
  const slash = Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'));
  const dir = output.slice(0, slash + 1);
  let file = output.slice(slash + 1).replace(/_%0?\d*d(?=\.[^.]*$|$)/, '');
  const dot = file.lastIndexOf('.');
  file = dot > 0 ? file.slice(0, dot) : file;
  return `${dir}${file}-captions.mov`;
}
