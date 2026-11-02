/**
 * The captions layer (milestone 50): the words of what was said, with the
 * moment each was spoken, broken into the lines a viewer reads — and the
 * arithmetic that decides which line is on screen and which word is being
 * spoken at a given moment.
 *
 * **A line is its words.** There is no second copy of the text and no second
 * copy of the timings: a line's start is its first word's, its end is its
 * last word's, and editing the words is editing the line. That is what lets
 * the words be changed — a name misheard, a filler word taken out — with the
 * timings kept, and what lets the spoken word be highlighted at all.
 *
 * Like the cut track, the captions ride in the same bag as the parameters,
 * under `@captions` (src/core/params.ts), so projects, presets and the undo
 * history carry them without a second channel. Times are **seconds of the
 * project** — the graphic as it is watched, the clock a layer's span and the
 * track's cuts are on — rounded to the millisecond.
 *
 * Pure: the dialog, the card and the preview all compute with these and keep
 * no second answer of their own.
 */

/** One spoken word and when it was said, in seconds of the project. */
export interface CaptionWord {
  text: string;
  start: number;
  /** Always at least `start`; a word with no measured length is a moment, not a mistake. */
  end: number;
}

/** One line of caption: the words it is read as, in order. */
export interface CaptionLine {
  words: CaptionWord[];
}

/**
 * A project's captions: the lines, and the caption style that draws them — a
 * template whose manifest says it draws captions (`captions: true`,
 * docs/template-format.md). A null style means the words are kept but nothing
 * is drawn.
 */
export interface CaptionsValue {
  style: string | null;
  lines: CaptionLine[];
}

/** How the words are broken into lines: by length, and by the gap that means a new thought. */
export interface CaptionBreaks {
  /** Characters a line may reach before the next word starts a new one. */
  maxChars: number;
  /** A gap at least this long between two words starts a new line. */
  pauseSeconds: number;
}

/**
 * What a line and a break may be. The length is the readable band for
 * short-form captions: under about twenty characters a line is a stutter of
 * one or two words, over about sixty it runs past the frame at any size a
 * caption is set in.
 */
export const CAPTION_LIMITS = {
  chars: { min: 12, max: 120 },
  pause: { min: 0.05, max: 5 },
  /** Lines in a project. An hour of speech is about a thousand; past this is not a caption track. */
  lines: 2000,
  /** Words in one line, so an edited line cannot grow without end. */
  words: 60,
  /** Characters in one line's text, the same reason. */
  text: 400,
} as const;

/**
 * Two lines a second is the pace of ordinary speech in short video: about
 * forty characters, and a gap of six tenths of a second is a new thought
 * rather than a breath.
 */
export const DEFAULT_BREAKS: CaptionBreaks = { maxChars: 42, pauseSeconds: 0.6 };

const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000;

export function lineText(line: CaptionLine): string {
  return line.words.map((w) => w.text).join(' ');
}

export function lineStart(line: CaptionLine): number {
  return line.words[0]?.start ?? 0;
}

export function lineEnd(line: CaptionLine): number {
  return line.words[line.words.length - 1]?.end ?? 0;
}

/** Where the last word falls silent: how long the captions run for. */
export function captionsDuration(value: CaptionsValue): number {
  return value.lines.reduce((last, line) => Math.max(last, lineEnd(line)), 0);
}

/** Words in every line, which is what the count in the UI says. */
export function captionsWordCount(value: CaptionsValue): number {
  return value.lines.reduce((sum, line) => sum + line.words.length, 0);
}

/**
 * Text spread over a stretch of time, word by word, in proportion to how long
 * each word is to say — which is near enough its length in characters. Used
 * where there are no measured timings to keep: a line re-worded into a
 * different number of words, and a transcript that came back as whole
 * sentences rather than words.
 */
export function spreadWords(text: string, start: number, end: number): CaptionWord[] {
  const words = text.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];
  const from = Math.max(0, Math.min(start, end));
  const span = Math.max(0, end - from);
  const total = words.reduce((sum, w) => sum + w.length, 0) || words.length;
  const out: CaptionWord[] = [];
  let at = from;
  words.forEach((word, i) => {
    const share = (span * word.length) / total;
    const last = i === words.length - 1;
    const stop = last ? from + span : at + share;
    out.push({ text: word, start: ms(at), end: ms(Math.max(at, stop)) });
    at = stop;
  });
  return out;
}

/** Does this word end a sentence? A full stop is a line break a reader expects. */
function endsSentence(text: string): boolean {
  return /[.!?…]["')\]]?$/.test(text);
}

/**
 * The words broken into lines: by length, by a pause, and at the end of a
 * sentence — the three things that make a caption line read as one. A word
 * longer than the whole allowance gets a line to itself rather than being cut.
 */
export function linesFromWords(words: readonly CaptionWord[], breaks: CaptionBreaks = DEFAULT_BREAKS): CaptionLine[] {
  const maxChars = Math.min(CAPTION_LIMITS.chars.max, Math.max(CAPTION_LIMITS.chars.min, Math.round(breaks.maxChars)));
  const pause = Math.min(CAPTION_LIMITS.pause.max, Math.max(CAPTION_LIMITS.pause.min, breaks.pauseSeconds));
  const lines: CaptionLine[] = [];
  let current: CaptionWord[] = [];
  let chars = 0;
  const flush = (): void => {
    if (current.length > 0) lines.push({ words: current });
    current = [];
    chars = 0;
  };
  for (const word of words) {
    const text = word.text.trim();
    if (text === '') continue;
    const previous = current[current.length - 1];
    // A gap since the last word is a new thought; room is the line's own length.
    if (previous && (word.start - previous.end >= pause || chars + 1 + text.length > maxChars)) flush();
    current.push({ text, start: ms(word.start), end: ms(Math.max(word.start, word.end)) });
    chars += (chars === 0 ? 0 : 1) + text.length;
    if (endsSentence(text)) flush();
    if (current.length >= CAPTION_LIMITS.words) flush();
    if (lines.length >= CAPTION_LIMITS.lines) return lines;
  }
  flush();
  return lines;
}

/** The captions a transcript makes: its words in lines, drawn by this style. */
export function captionsFromWords(words: readonly CaptionWord[], style: string | null, breaks: CaptionBreaks = DEFAULT_BREAKS): CaptionsValue {
  return { style, lines: linesFromWords(words, breaks) };
}

/**
 * The line on screen at a moment, or null between lines and past the last.
 * A line holds from its first word to its last; where two lines touch, the
 * later one has it, as a cut boundary belongs to the later cut.
 */
export function captionLineAt(value: CaptionsValue, time: number): number | null {
  if (!Number.isFinite(time)) return null;
  for (let i = value.lines.length - 1; i >= 0; i--) {
    const line = value.lines[i]!;
    if (line.words.length > 0 && time >= lineStart(line) && time < lineEnd(line)) return i;
  }
  return null;
}

/**
 * The word being spoken at a moment, as an index into the line's words: -1
 * before the first word has started, and the last word once it has been
 * reached, so the highlight never falls off the end of a line that is still
 * on screen. In the gap between two words the earlier one keeps it — the
 * highlight should not flicker off in the space between words.
 */
export function spokenWordAt(line: CaptionLine, time: number): number {
  if (!Number.isFinite(time)) return -1;
  let spoken = -1;
  line.words.forEach((word, i) => {
    if (time >= word.start) spoken = i;
  });
  return spoken;
}

/** The same captions with a style, or with none; the same object when nothing changed. */
export function withCaptionStyle(value: CaptionsValue, style: string | null): CaptionsValue {
  const next = style?.trim() ? style.trim() : null;
  return next === value.style ? value : { ...value, style: next };
}

/** Where each word begins in the line's own text, in characters: what a caret is measured against. */
function wordOffsets(line: CaptionLine): number[] {
  let at = 0;
  return line.words.map((word, i) => {
    const start = at + (i === 0 ? 0 : 1);
    at = start + word.text.length;
    return start;
  });
}

/**
 * A line re-worded, with its timings kept (milestone 50). The same number of
 * words keeps every word's own start and end — a misheard name corrected is
 * still said when it was said. A different number cannot: the line's own
 * stretch of time is spread over the new words instead, so the highlight
 * still tracks the voice and the line still begins and ends where it did.
 * Emptying a line removes it, which is how a line is deleted.
 */
export function withLineText(value: CaptionsValue, index: number, text: string): CaptionsValue {
  const line = value.lines[index];
  if (!line) return value;
  const trimmed = text.trim().slice(0, CAPTION_LIMITS.text);
  if (trimmed === lineText(line)) return value;
  const words = trimmed.split(/\s+/).filter((w) => w !== '').slice(0, CAPTION_LIMITS.words);
  const lines = [...value.lines];
  if (words.length === 0) lines.splice(index, 1);
  else if (words.length === line.words.length) lines[index] = { words: line.words.map((w, i) => ({ ...w, text: words[i]! })) };
  else lines[index] = { words: spreadWords(words.join(' '), lineStart(line), lineEnd(line)) };
  return { ...value, lines };
}

/**
 * A line split in two at a caret in its text (milestone 50): it breaks at the
 * word boundary nearest the caret — a caption is split between words, never
 * through one — and both halves keep the timings they had. A line of one word
 * has nothing to split, and the same captions come back, by identity, so no
 * undo step is written for a no-op.
 */
export function withLineSplit(value: CaptionsValue, index: number, atChar: number): CaptionsValue {
  const line = value.lines[index];
  if (!line || line.words.length < 2) return value;
  const offsets = wordOffsets(line);
  let at = 1;
  for (let i = 2; i < line.words.length; i++) {
    if (Math.abs(offsets[i]! - atChar) < Math.abs(offsets[at]! - atChar)) at = i;
  }
  const lines = [...value.lines];
  lines.splice(index, 1, { words: line.words.slice(0, at) }, { words: line.words.slice(at) });
  return { ...value, lines };
}

/**
 * A line joined with the one after it, the words of both kept in order, so
 * the joined line runs from the first word of the one to the last of the
 * other. Nothing to join on the last line, and the same captions come back.
 */
export function withLinesMerged(value: CaptionsValue, index: number): CaptionsValue {
  const line = value.lines[index];
  const next = value.lines[index + 1];
  if (!line || !next) return value;
  const words = [...line.words, ...next.words].slice(0, CAPTION_LIMITS.words);
  const lines = [...value.lines];
  lines.splice(index, 2, { words });
  return { ...value, lines };
}

/**
 * What a caption style's page is handed for one frame (docs/template-format.md,
 * "Caption styles"): the line on screen, which of its words is being spoken,
 * and the band of the frame a caption belongs in at this shape. Null `line`
 * is a moment between lines, which a style draws as nothing.
 */
export interface CaptionFrame {
  time: number;
  line: { text: string; start: number; end: number; words: CaptionWord[] } | null;
  /** Index into the line's words of the word being spoken; -1 before the first. */
  spoken: number;
  /** The caption band in pixels of this frame: x, y, width, height. */
  box: { x: number; y: number; width: number; height: number };
}

/** The state for one frame of a caption style: the line at this moment, in this band. */
export function captionFrame(value: CaptionsValue, time: number, box: CaptionFrame['box']): CaptionFrame {
  const index = captionLineAt(value, time);
  const line = index === null ? null : value.lines[index]!;
  return {
    time: ms(time),
    line: line ? { text: lineText(line), start: lineStart(line), end: lineEnd(line), words: line.words } : null,
    spoken: line ? spokenWordAt(line, time) : -1,
    box,
  };
}

/**
 * Captions with every field in range, from anything at all: a style id and
 * lines of words in order, each word with a start and an end. `null` when the
 * input is not captions or holds no words — captions with nothing said are no
 * captions at all, so a project nobody has captioned serializes as it always
 * did.
 */
export function sanitizeCaptions(input: unknown): CaptionsValue | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as { style?: unknown; lines?: unknown };
  if (!Array.isArray(raw.lines)) return null;
  const style = typeof raw.style === 'string' && raw.style.trim() !== '' ? raw.style.trim() : null;
  const lines: CaptionLine[] = [];
  for (const entry of raw.lines) {
    const rawWords = (entry as { words?: unknown })?.words;
    if (!Array.isArray(rawWords)) continue;
    const words: CaptionWord[] = [];
    for (const w of rawWords) {
      if (typeof w !== 'object' || w === null) continue;
      const r = w as { text?: unknown; start?: unknown; end?: unknown };
      const text = typeof r.text === 'string' ? r.text.trim() : '';
      if (text === '') continue;
      const start = typeof r.start === 'number' && Number.isFinite(r.start) ? Math.max(0, r.start) : null;
      if (start === null) continue;
      const end = typeof r.end === 'number' && Number.isFinite(r.end) ? Math.max(start, r.end) : start;
      words.push({ text: text.slice(0, CAPTION_LIMITS.text), start: ms(start), end: ms(end) });
      if (words.length === CAPTION_LIMITS.words) break;
    }
    if (words.length > 0) lines.push({ words });
    if (lines.length === CAPTION_LIMITS.lines) break;
  }
  return lines.length > 0 ? { style, lines } : null;
}
