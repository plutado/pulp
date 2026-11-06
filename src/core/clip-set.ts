/**
 * Clip sets as one asset (milestone 32): stock motion graphics often come as
 * separate files that belong together — an intro, a loop and an outro — so a
 * graphic can run for any length. Pulp shows the three as one item that
 * stretches: the intro plays once, the loop repeats for as long as the chosen
 * length needs, and the outro plays at the end. Milestone 30's parts, with the
 * files supplying them instead of a template.
 *
 * This is the pure part: which files in a folder make a set, and which part
 * and which moment of it belong to a given moment of the result. The stage's
 * preview, a render of the item, and a video layer playing it all ask the same
 * function, so a set cannot play one way on the stage and another in the file.
 */

/** The three parts, in the order they play. */
export const CLIP_SET_PARTS = ['intro', 'loop', 'outro'] as const;
export type ClipSetPart = (typeof CLIP_SET_PARTS)[number];

/**
 * The words a file's name ends with (or starts with) to say which part it is, as stock libraries
 * name them: "Title_In.mov", "Title - Loop.mov", "Title (Outro).mov", "Title entry.mov".
 */
const PART_WORDS: Record<ClipSetPart, readonly string[]> = {
  intro: ['intro', 'in', 'entry', 'enter', 'start', 'open', 'opening', 'begin', 'anim in', 'animate in'],
  loop: ['loop', 'loopable', 'hold', 'idle', 'cycle', 'middle', 'mid'],
  outro: ['outro', 'out', 'exit', 'end', 'close', 'closing', 'anim out', 'animate out'],
};

/** A set's files, by part: the loop always, and an intro, an outro or both. */
export interface ClipSetFiles {
  intro?: string;
  loop: string;
  outro?: string;
}

/** A set as a folder holds it: the name the parts share, and each part's file name. */
export interface FoundClipSet {
  /** The name the parts share, as the item is called: "Lower Third Swoosh". */
  name: string;
  files: ClipSetFiles;
}

/** How long each part runs for, in seconds; a part a set does not have is 0. */
export interface ClipSetTiming {
  intro: number;
  loop: number;
  outro: number;
}

const SEPARATORS = /[\s_\-.]+/g;

/** A name as words, for matching: "Lower_Third-Swoosh (In)" → "lower third swoosh in". */
function words(stem: string): string {
  return stem.replace(/[()[\]{}]/g, ' ').replace(SEPARATORS, ' ').trim().toLowerCase();
}

/**
 * Which part a file is, and the name it shares with the rest of its set: a part word at the end
 * of the name ("Swoosh In") or at its start ("In Swoosh"), with the shared name left over. A name
 * that is only a part word ("Loop.mov") is the folder's set, named by the folder.
 */
export function clipSetPartOf(fileName: string): { part: ClipSetPart; base: string } | null {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const w = words(stem);
  // Longest part words first, so "anim in" is not read as "in".
  const all = CLIP_SET_PARTS.flatMap((part) => PART_WORDS[part].map((word) => ({ part, word }))).sort((a, b) => b.word.length - a.word.length);
  for (const { part, word } of all) {
    if (w === word) return { part, base: '' };
    if (w.endsWith(` ${word}`)) return { part, base: w.slice(0, -word.length - 1) };
    if (w.startsWith(`${word} `)) return { part, base: w.slice(word.length + 1) };
  }
  return null;
}

/** The set's name as it reads: the shared part of the first file's own name, in its own capitals. */
function displayName(fileName: string, base: string, folder: string): string {
  if (base === '') return folder;
  const dot = fileName.lastIndexOf('.');
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[()[\]{}]/g, ' ').replace(SEPARATORS, ' ').trim();
  // The same words as `base`, cut from the original so its capitals are kept.
  const at = stem.toLowerCase().indexOf(base);
  return at >= 0 ? stem.slice(at, at + base.length) : base;
}

/**
 * The clip sets in one folder, from its video files' names: files whose names differ only by a
 * part word, with the same extension, and a loop among them. A loop with no intro and no outro is
 * just a clip, and a folder with two loops of the same name is not a set (which would play?).
 * Every file belongs to one set at most; the rest are left as they are.
 */
export function groupClipSets(fileNames: readonly string[], folderName: string): FoundClipSet[] {
  const byBase = new Map<string, { part: ClipSetPart; file: string; base: string }[]>();
  for (const file of fileNames) {
    const found = clipSetPartOf(file);
    if (!found) continue;
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    const key = `${found.base}|${ext}`;
    const list = byBase.get(key) ?? [];
    list.push({ part: found.part, file, base: found.base });
    byBase.set(key, list);
  }
  const sets: FoundClipSet[] = [];
  for (const members of byBase.values()) {
    const of = (part: ClipSetPart) => members.filter((m) => m.part === part);
    const [loop, intro, outro] = [of('loop'), of('intro'), of('outro')];
    if (loop.length !== 1 || intro.length > 1 || outro.length > 1) continue;
    if (intro.length === 0 && outro.length === 0) continue;
    const first = (intro[0] ?? loop[0])!;
    sets.push({
      name: displayName(first.file, first.base, folderName),
      files: { ...(intro[0] ? { intro: intro[0].file } : {}), loop: loop[0]!.file, ...(outro[0] ? { outro: outro[0].file } : {}) },
    });
  }
  return sets.sort((a, b) => a.name.localeCompare(b.name));
}

/** The set's own length: each part once. What it runs for when no length is asked. */
export function clipSetNaturalSeconds(timing: ClipSetTiming): number {
  return timing.intro + timing.loop + timing.outro;
}

/**
 * Which part plays at `time` seconds of a result `length` seconds long, and how far into that
 * part: `null` before the start and from the end on.
 *
 * - Long enough for both ends: the intro plays once from the start, the outro ends exactly at the
 *   end, and the loop repeats in between — its last pass cut where the outro begins.
 * - Shorter than the intro and the outro together: the outro keeps the end, since a graphic must
 *   leave cleanly, and the intro has what is left before it. Shorter than the outro alone, the
 *   outro plays its last `length` seconds.
 */
export function clipSetMomentAt(time: number, timing: ClipSetTiming, length: number): { part: ClipSetPart; at: number } | null {
  if (!Number.isFinite(time) || time < -1e-9 || time >= length - 1e-9 || length <= 0) return null;
  const t = Math.max(0, time);
  const { intro, loop, outro } = timing;
  if (length >= intro + outro) {
    if (t < intro) return { part: 'intro', at: t };
    const outroStart = length - outro;
    if (outro > 0 && t >= outroStart - 1e-9) return { part: 'outro', at: Math.max(0, t - outroStart) };
    if (loop <= 0) return null;
    return { part: 'loop', at: (t - intro) % loop };
  }
  const outroStart = Math.max(0, length - outro);
  if (t < outroStart) return { part: 'intro', at: t };
  return { part: 'outro', at: t - outroStart + Math.max(0, outro - length) };
}

/**
 * How a result `length` seconds long is cut from the parts, for ffmpeg: how much of the intro
 * from its start, how long the loop repeats for, and from where in the outro and for how long.
 * The same rule as `clipSetMomentAt`, as spans rather than moments.
 */
export function clipSetSpans(timing: ClipSetTiming, length: number): { intro: number; loop: number; outroFrom: number; outro: number } {
  const { intro, outro } = timing;
  if (length >= intro + outro) return { intro, loop: Math.max(0, length - intro - outro), outroFrom: 0, outro };
  const outroPlays = Math.min(outro, length);
  return { intro: Math.max(0, length - outroPlays), loop: 0, outroFrom: outro - outroPlays, outro: outroPlays };
}

/**
 * The frame of the set's parts laid end to end (intro, then loop, then outro: what a video layer
 * is handed) that belongs to `time` seconds of a result `length` seconds long, counted at `fps`.
 */
export function clipSetFrameAt(time: number, timing: ClipSetTiming, length: number, fps: number): number | null {
  const moment = clipSetMomentAt(time, timing, length);
  if (!moment) return null;
  const frames = { intro: Math.round(timing.intro * fps), loop: Math.round(timing.loop * fps), outro: Math.round(timing.outro * fps) };
  const base = moment.part === 'intro' ? 0 : moment.part === 'loop' ? frames.intro : frames.intro + frames.loop;
  const within = Math.min(Math.max(0, frames[moment.part] - 1), Math.floor(moment.at * fps + 1e-9));
  return base + within;
}

/**
 * ffmpeg's inputs and filter for a set stitched to `length` seconds: each part trimmed to its
 * span, the loop's input repeated as often as needed, all at one rate and size, end to end. The
 * caller adds the output. Alpha is kept (RGBA throughout).
 */
export function clipSetStitchArgs(
  paths: ClipSetFiles,
  timing: ClipSetTiming,
  length: number,
  video: { fps: number; width: number; height: number },
): string[] {
  const spans = clipSetSpans(timing, length);
  const inputs: string[] = [];
  const chains: string[] = [];
  const labels: string[] = [];
  const norm = `fps=${video.fps},scale=${video.width}:${video.height}:force_original_aspect_ratio=decrease,pad=${video.width}:${video.height}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,setsar=1`;
  const add = (file: string, from: number, duration: number, loop: boolean) => {
    if (duration <= 1e-6) return;
    const n = inputs.filter((a) => a === '-i').length;
    if (loop) inputs.push('-stream_loop', '-1');
    inputs.push('-i', file);
    chains.push(`[${n}:v]trim=start=${from.toFixed(6)}:duration=${duration.toFixed(6)},setpts=PTS-STARTPTS,${norm}[p${n}]`);
    labels.push(`[p${n}]`);
  };
  if (paths.intro) add(paths.intro, 0, spans.intro, false);
  add(paths.loop, 0, spans.loop, true);
  if (paths.outro) add(paths.outro, spans.outroFrom, spans.outro, false);
  const graph = [...chains, `${labels.join('')}concat=n=${labels.length}:v=1:a=0[set]`].join(';');
  return ['-v', 'error', '-nostdin', ...inputs, '-filter_complex', graph, '-map', '[set]', '-an', '-frames:v', String(Math.max(1, Math.round(length * video.fps)))];
}

/**
 * ffmpeg arguments that write frames `window.first` to `window.first + window.frames - 1` of a
 * set's parts laid end to end, each once, to stdout as a PNG stream: what a video layer is handed
 * (src/main/clip-grant.ts). `filters` (a grade, a scale) run after the parts are joined, at the
 * set's own size.
 */
export function clipSetFramesArgs(
  paths: ClipSetFiles,
  timing: ClipSetTiming,
  own: { fps: number; width: number; height: number },
  window: { first: number; frames: number },
  filters: string,
): string[] {
  const all = clipSetStitchArgs(paths, timing, clipSetNaturalSeconds(timing), own);
  const at = all.indexOf('-filter_complex');
  const graph = all[at + 1]!.replace(/\[set\]$/, '[joined]');
  const last = window.first + window.frames - 1;
  return [
    ...all.slice(0, at),
    // i18n-exempt(technical): an FFmpeg filter graph
    '-filter_complex', `${graph};[joined]select='between(n\\,${window.first}\\,${last})',setpts=N/FRAME_RATE/TB${filters ? `,${filters}` : ''},format=rgba[out]`,
    '-map', '[out]', '-an', '-frames:v', String(window.frames),
    '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
  ];
}
