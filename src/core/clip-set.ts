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

// ---------------------------------------------------------------- several layers in one set

/** One layer of a set (milestone 32): its own intro, loop and outro, named as the collection names it. */
export interface ClipSetLayer {
  name: string;
  files: ClipSetFiles;
}

/** A set as the library lists it: one layer, or several that move together, bottom first. */
export interface FoundLayeredClipSet {
  name: string;
  layers: ClipSetLayer[];
}

/** A layer's words that say it is the base the others sit on, which goes to the bottom. */
const BASE_WORDS = new Set(['main', 'base', 'background', 'bg', 'body', 'core']);

const extOf = (set: FoundClipSet) => set.files.loop.slice(set.files.loop.lastIndexOf('.')).toLowerCase();

/** The layers after the base, the one that says it is the base first and the rest by name. */
function orderLayers(layers: ClipSetLayer[]): ClipSetLayer[] {
  return [...layers].sort((a, b) => Number(BASE_WORDS.has(words(b.name))) - Number(BASE_WORDS.has(words(a.name))) || a.name.localeCompare(b.name));
}

/** A set's name with the first `prefixWords` words taken off: "Swoosh Flare" less "swoosh" is "Flare". */
function remainder(name: string, prefixWords: string): string {
  return name.slice(prefixWords.length).replace(/^[\s_\-.]+/, '').trim() || name;
}

/**
 * Sets that are the layers of one item (milestone 32): a main graphic and a flare, each with its
 * own intro, loop and outro, that move together. Two ways a folder says so, the names in the
 * same format:
 *
 * - **A set whose name the others extend**: "Swoosh" with "Swoosh Flare" and "Swoosh Glow" is one
 *   set with three layers, the bare name at the bottom and the rest named by their extra words.
 * - **The folder names the set**: when no set has the folder's name but two or more begin with
 *   it — "Swoosh Main" and "Swoosh Flare" in a folder called Swoosh — the folder is the set and
 *   the layers are the rest of each name; one that says it is the base goes to the bottom.
 *
 * Every other set is a set of one layer. Layers are listed bottom first, as they are drawn.
 */
export function groupClipSetLayers(sets: readonly FoundClipSet[], folderName: string): FoundLayeredClipSet[] {
  const remaining = new Set(sets);
  const out: FoundLayeredClipSet[] = [];
  // The shortest names first: a name is extended by a longer one, never the other way.
  for (const base of [...sets].sort((a, b) => words(a.name).length - words(b.name).length)) {
    if (!remaining.has(base)) continue;
    const bw = words(base.name);
    if (bw === '') continue;
    const extras = [...remaining].filter((s) => s !== base && extOf(s) === extOf(base) && words(s.name).startsWith(`${bw} `));
    if (extras.length === 0) continue;
    remaining.delete(base);
    for (const s of extras) remaining.delete(s);
    out.push({ name: base.name, layers: [{ name: base.name, files: base.files }, ...orderLayers(extras.map((s) => ({ name: remainder(s.name, bw), files: s.files })))] });
  }
  const fw = words(folderName);
  if (fw !== '') {
    const byExt = new Map<string, FoundClipSet[]>();
    for (const s of remaining) byExt.set(extOf(s), [...(byExt.get(extOf(s)) ?? []), s]);
    for (const group of byExt.values()) {
      if (group.length < 2 || !group.every((s) => words(s.name).startsWith(`${fw} `))) continue;
      for (const s of group) remaining.delete(s);
      out.push({ name: folderName, layers: orderLayers(group.map((s) => ({ name: remainder(s.name, fw), files: s.files }))) });
    }
  }
  for (const s of remaining) out.push({ name: s.name, layers: [{ name: s.name, files: s.files }] });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The set's own length: each part once. What it runs for when no length is asked. */
export function clipSetNaturalSeconds(timing: ClipSetTiming): number {
  return timing.intro + timing.loop + timing.outro;
}

/** A layered set's own length: the longest layer's, each of its parts once; the others repeat their loops to meet it. */
export function clipSetLayersNaturalSeconds(timings: readonly ClipSetTiming[]): number {
  return Math.max(0, ...timings.map(clipSetNaturalSeconds));
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
  return clipSetLayersStitchArgs([{ files: paths, timing }], length, video);
}

/** A layer to stitch: its files and how long each part runs. */
export interface StitchLayer {
  files: ClipSetFiles;
  timing: ClipSetTiming;
  /** The decoder its parts must be read with, where ffmpeg's own would lose their alpha (`alphaDecoderFor`). */
  decoder?: string;
}

/**
 * The same for a set of several layers (milestone 32): each layer stitched to the length by its
 * own parts — its intro once, its loop repeated, its outro at the end — then laid over the one
 * below it, bottom first, alpha blended, so the layers move together however their parts differ.
 * One layer is the plain stitch.
 */
export function clipSetLayersStitchArgs(layers: readonly StitchLayer[], length: number, video: { fps: number; width: number; height: number }): string[] {
  const inputs: string[] = [];
  const chains: string[] = [];
  const norm = `fps=${video.fps},scale=${video.width}:${video.height}:force_original_aspect_ratio=decrease,pad=${video.width}:${video.height}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,setsar=1`;
  const stitched: string[] = [];
  layers.forEach((layer, k) => {
    const spans = clipSetSpans(layer.timing, length);
    const labels: string[] = [];
    const add = (file: string, from: number, duration: number, loop: boolean) => {
      if (duration <= 1e-6) return;
      const n = inputs.filter((a) => a === '-i').length;
      if (loop) inputs.push('-stream_loop', '-1');
      if (layer.decoder) inputs.push('-c:v', layer.decoder);
      inputs.push('-i', file);
      chains.push(`[${n}:v]trim=start=${from.toFixed(6)}:duration=${duration.toFixed(6)},setpts=PTS-STARTPTS,${norm}[p${n}]`);
      labels.push(`[p${n}]`);
    };
    if (layer.files.intro) add(layer.files.intro, 0, spans.intro, false);
    add(layer.files.loop, 0, spans.loop, true);
    if (layer.files.outro) add(layer.files.outro, spans.outroFrom, spans.outro, false);
    const out = layers.length === 1 ? '[set]' : `[l${k}]`;
    chains.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0${out}`);
    stitched.push(out);
  });
  if (layers.length > 1) {
    // Each layer over the ones below it; the alpha of both is kept, so a set stays transparent.
    let below = stitched[0]!;
    stitched.slice(1).forEach((above, i) => {
      const out = i === stitched.length - 2 ? '[set]' : `[o${i}]`;
      chains.push(`${below}${above}overlay=format=rgb:eof_action=pass,format=rgba${out}`);
      below = out;
    });
  }
  const graph = chains.join(';');
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
  return clipSetLayersFramesArgs([{ files: paths, timing }], own, window, filters);
}

/**
 * The same for a layered set (milestone 32): the layers composited at the set's own length — the
 * longest layer's parts once, the others' loops repeating to meet it — and the window cut from that.
 */
export function clipSetLayersFramesArgs(
  layers: readonly StitchLayer[],
  own: { fps: number; width: number; height: number },
  window: { first: number; frames: number },
  filters: string,
): string[] {
  const all = clipSetLayersStitchArgs(layers, clipSetLayersNaturalSeconds(layers.map((l) => l.timing)), own);
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
