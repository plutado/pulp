/**
 * On-device transcription (milestone 50): which speech model Pulp uses, how
 * it is asked to listen, and how its answer is read back as words with the
 * moment each was said.
 *
 * **Nothing leaves the machine.** The model runs locally, on the sound of the
 * project; the one thing that ever travels is the model file itself, fetched
 * from its publisher on first use *after the person has said yes* and checked
 * against the checksum below before it is kept. Which model, how big it is
 * and under what licence is decision record 0021.
 *
 * The model is run by whisper.cpp's own command-line program, found on PATH
 * the way ffmpeg is (src/core/ffmpeg.ts) — Pulp bundles no binaries, and an
 * inference engine is the same kind of dependency as an encoder.
 *
 * Pure: the catalogue, the arguments and the parsing are here and tested; the
 * downloading and the running are src/main/speech-service.ts.
 */

import { spreadWords, type CaptionWord } from './captions';

/**
 * A speech model Pulp can fetch. `bytes` and `sha256` are the published file's
 * own, read from the publisher's index when the entry was written: the
 * download is refused unless it hashes to exactly this, so a mirror, a proxy
 * or a truncated transfer cannot leave something else beside the settings.
 */
export interface SpeechModel {
  id: string;
  label: string;
  /** The file's name, which is also what it is kept as. */
  file: string;
  url: string;
  bytes: number;
  sha256: string;
  /** Every language the model was trained on, or English alone. */
  multilingual: boolean;
  /** What it is for, in the sentence the dialog shows beside its size. */
  note: string;
}

/** Where the models come from: the whisper.cpp project's own converted weights (MIT; ADR 0021). */
const MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

/** The licence every model in the catalogue carries, shown before anything is fetched. */
export const SPEECH_MODEL_LICENSE = 'MIT';

/**
 * Three sizes of one model (ADR 0021). Base is the default: it is the
 * smallest that captions ordinary speech well enough to edit rather than
 * rewrite, and 141 MB is a download a person will wait for once.
 */
export const SPEECH_MODELS: readonly SpeechModel[] = [
  {
    id: 'tiny',
    label: 'Whisper tiny',
    file: 'ggml-tiny.bin',
    url: `${MODEL_BASE}ggml-tiny.bin`,
    bytes: 77_691_713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    multilingual: true,
    note: 'The fastest, and the one that mishears most.',
  },
  {
    id: 'base',
    label: 'Whisper base',
    file: 'ggml-base.bin',
    url: `${MODEL_BASE}ggml-base.bin`,
    bytes: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    multilingual: true,
    note: 'The default: good enough to edit rather than rewrite, on any machine.',
  },
  {
    id: 'small',
    label: 'Whisper small',
    file: 'ggml-small.bin',
    url: `${MODEL_BASE}ggml-small.bin`,
    bytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    multilingual: true,
    note: 'The most accurate of the three, and several times slower.',
  },
] as const;

export const DEFAULT_SPEECH_MODEL = 'base';

export function speechModel(id: string | undefined): SpeechModel {
  return SPEECH_MODELS.find((m) => m.id === id) ?? SPEECH_MODELS.find((m) => m.id === DEFAULT_SPEECH_MODEL)!;
}

/** A file size as the dialog says it: whole megabytes, which is the only precision anyone reads. */
export function modelSizeText(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * The program that runs the model. whisper.cpp's command-line tool is
 * `whisper-cli`; Homebrew's package also installs it as `whisper-cpp`, and
 * builds before mid-2024 called it `main`, which is too general a name to go
 * looking for on PATH. `PULP_WHISPER_PATH` names one directly, as
 * `PULP_FFMPEG_PATH` does.
 */
export function speechRunnerPaths(env: Record<string, string | undefined>): string[] {
  const list: string[] = [];
  if (env.PULP_WHISPER_PATH) list.push(env.PULP_WHISPER_PATH);
  list.push('whisper-cli', 'whisper-cpp');
  // A GUI app on macOS does not inherit the shell PATH, so look where Homebrew puts things too.
  list.push('/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli');
  return [...new Set(list)];
}

export const SPEECH_RUNNER_MISSING_MESSAGE =
  'whisper.cpp was not found. Pulp transcribes with it, on this machine (decision record 0021). ' +
  'Install it (macOS: "brew install whisper-cpp"; elsewhere: build whisper.cpp and put whisper-cli on your PATH), ' +
  'or set PULP_WHISPER_PATH to the full path of whisper-cli, then restart Pulp.';

/** A stretch of a library item's sound, and where it sits on the project's timeline. */
export interface SpeechSegment {
  /** How the host resolves the file: a clip's own track, or a sound file. */
  kind: 'clip' | 'sound';
  id: string;
  /** Seconds into the file. */
  from: number;
  to: number;
  /** Seconds into the project the stretch is heard at, so the words land on the project's clock. */
  at: number;
}

/** What the model listens at: 16 kHz mono is what whisper was trained on and what it resamples to anyway. */
export const SPEECH_SAMPLE_RATE = 16_000;

/** `auto` lets the model decide, which is what a project in an unknown language wants. */
export const SPEECH_LANGUAGE_AUTO = 'auto';

/**
 * The filter that lays the segments out on the project's clock: each input
 * resampled to what the model listens at, delayed to where it is heard, and
 * the lot mixed into one mono track. Built here so the arithmetic that
 * decides where a word lands is tested rather than trusted.
 *
 * One input needs no mix; `normalize=0` keeps a quiet voice quiet rather than
 * letting the mixer pull the level about under it.
 */
export function speechMixFilter(segments: readonly SpeechSegment[]): string {
  if (segments.length === 0) return '';
  const chain = (segment: SpeechSegment, index: number): string =>
    `[${index}:a]aresample=${SPEECH_SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono,` +
    `adelay=${Math.max(0, Math.round(segment.at * 1000))}:all=1`;
  if (segments.length === 1) return `${chain(segments[0]!, 0)}[speech]`;
  const parts = segments.map((segment, i) => `${chain(segment, i)}[s${i}]`);
  const inputs = segments.map((_, i) => `[s${i}]`).join('');
  return `${parts.join(';')};${inputs}amix=inputs=${segments.length}:normalize=0[speech]`;
}

export interface WhisperRun {
  modelPath: string;
  /** The 16 kHz mono WAV to listen to. */
  wavPath: string;
  /** Where the JSON goes, without its extension: whisper writes `<outBase>.json`. */
  outBase: string;
  language?: string;
  threads?: number;
}

/**
 * How whisper.cpp is asked: the full JSON, which is the only output that
 * carries a timestamp per token, and the progress prints the dialog reads to
 * say how far along it is. No file is named but the ones above, and nothing
 * asks it to reach the network.
 */
export function whisperArgs(run: WhisperRun): string[] {
  const language = run.language?.trim() ? run.language.trim() : SPEECH_LANGUAGE_AUTO;
  return [
    '-m', run.modelPath,
    '-f', run.wavPath,
    '-of', run.outBase,
    '-oj', '-ojf',
    '-l', language,
    '-pp',
    ...(run.threads && run.threads > 0 ? ['-t', String(Math.floor(run.threads))] : []),
  ];
}

/** How far along a run is, from one line of whisper.cpp's progress prints; null for any other line. */
export function whisperProgress(line: string): number | null {
  const match = /progress\s*=\s*(\d+)\s*%/.exec(line);
  if (!match) return null;
  return Math.min(1, Math.max(0, Number(match[1]) / 100));
}

/** A token or a segment that is a marker rather than speech: `[_BEG_]`, `[BLANK_AUDIO]`, `(wind blowing)`. */
function isMarker(text: string): boolean {
  return /^[[(][^\]）)]*[\])]$/.test(text.trim());
}

interface WhisperToken {
  text?: unknown;
  offsets?: { from?: unknown; to?: unknown };
}

interface WhisperSegment {
  text?: unknown;
  offsets?: { from?: unknown; to?: unknown };
  tokens?: unknown;
}

const msToSeconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value) / 1000) : null;

/**
 * The words whisper.cpp heard, read from the JSON it wrote (milestone 50).
 *
 * The full JSON gives a timestamp per **token**, and a token is a piece of a
 * word: a leading space is where one word ends and the next begins, which is
 * how the model writes them, so the pieces are joined back up and the word
 * takes the first piece's start and the last piece's end. Punctuation arrives
 * as its own token with no leading space and joins the word before it.
 *
 * A build that wrote no tokens still gives a segment with its own span, so
 * that is spread over the segment's words by length rather than thrown away:
 * the line is right, the highlight is approximate, and nothing is lost.
 *
 * Markers — `[_BEG_]`, `[BLANK_AUDIO]`, `(music)` — are not speech and are
 * dropped. Anything that is not the shape of an answer returns no words
 * rather than throwing: the caller says "nothing was heard".
 */
export function wordsFromWhisperJson(raw: string): CaptionWord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const segments = (parsed as { transcription?: unknown })?.transcription;
  if (!Array.isArray(segments)) return [];
  const words: CaptionWord[] = [];
  for (const entry of segments as WhisperSegment[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const tokens = Array.isArray(entry.tokens) ? (entry.tokens as WhisperToken[]) : [];
    let any = false;
    for (const token of tokens) {
      const text = typeof token?.text === 'string' ? token.text : '';
      if (text.trim() === '' || isMarker(text)) continue;
      const start = msToSeconds(token.offsets?.from);
      const end = msToSeconds(token.offsets?.to);
      if (start === null || end === null) continue;
      const last = words[words.length - 1];
      // A leading space starts a new word; anything else is the rest of the one before it.
      if (!any || /^\s/.test(text) || !last) {
        words.push({ text: text.trim(), start, end: Math.max(start, end) });
      } else {
        last.text += text.trim();
        last.end = Math.max(last.end, end);
      }
      any = true;
    }
    if (any) continue;
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    const start = msToSeconds(entry.offsets?.from);
    const end = msToSeconds(entry.offsets?.to);
    if (text === '' || isMarker(text) || start === null || end === null) continue;
    words.push(...spreadWords(text, start, Math.max(start, end)));
  }
  return words.filter((word) => word.text !== '' && !isMarker(word.text));
}
