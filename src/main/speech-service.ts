/**
 * Transcription on this machine (milestone 50): the speech model fetched on
 * first use **after the person has said yes**, checked against its checksum
 * and kept beside the settings, and run over the sound of the project to give
 * back the words with the moment each was said.
 *
 * Nothing about the project leaves the machine. The one request Pulp ever
 * makes is for the model file itself, from the publisher named in
 * src/core/speech.ts (decision record 0021), and the window has to ask for it
 * first: `speechStatus` says what is missing, the dialog says what it would
 * fetch and how big it is, and only `fetchSpeechModel` downloads.
 *
 * The sound is resolved here from library ids, never from paths the window
 * sends (ADR 0013): ffmpeg lays the chosen stretches out on the project's own
 * clock at the rate the model listens at, and the model's answer comes back
 * as words already timed against that clock.
 */

import { createHash } from 'node:crypto';
import { app, net, type BrowserWindow } from 'electron';
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { detectFfmpeg, nodeRunner, type ProcessRunner } from '../core/ffmpeg';
import { ffprobePathFor } from '../core/media-probe';
import type { CaptionWord } from '../core/captions';
import {
  DEFAULT_SPEECH_MODEL, speechMixFilter, speechModel, speechRunnerPaths, SPEECH_LANGUAGE_AUTO,
  SPEECH_MODEL_LICENSE, SPEECH_RUNNER_MISSING_MESSAGE, SPEECH_SAMPLE_RATE, whisperArgs, whisperProgress, wordsFromWhisperJson,
  type SpeechSegment,
} from '../core/speech';
import { resolveClipAudio } from './clip-grant';
import { resolveSoundSource } from './sound-grant';

/** Speech is slow: a minute of sound is tens of seconds of listening, so the bound is generous. */
const TRANSCRIBE_TIMEOUT_MS = 20 * 60_000;

/** A model is a hundred megabytes or more over whatever connection there is. */
const FETCH_TIMEOUT_MS = 30 * 60_000;

/** Where the models are kept: beside the settings, in the app's own user data. */
export function speechModelDir(): string {
  return join(app.getPath('userData'), 'speech-models');
}

export interface SpeechStatus {
  /** The program that runs the model, found on PATH; a message when it is not there. */
  runner: { ok: boolean; path?: string; message?: string };
  /** The model this project would use: which, how big, and whether it is already here. */
  model: { id: string; label: string; bytes: number; license: string; note: string; installed: boolean };
  /** ffmpeg reads the sound, so transcription needs it as a render does. */
  ffmpeg: boolean;
}

/** The window hears how a long job is going through this; the main window is the only listener. */
let progressTo: BrowserWindow | null = null;

export function setSpeechProgressWindow(window: BrowserWindow | null): void {
  progressTo = window;
}

function report(note: string, fraction: number | null): void {
  if (progressTo && !progressTo.isDestroyed()) progressTo.webContents.send('speech:progress', { note, fraction });
}

/** The runner on this machine, or why there is none. Cheap enough to ask on every dialog open. */
async function detectRunner(run: ProcessRunner = nodeRunner): Promise<{ ok: boolean; path?: string; message?: string }> {
  for (const candidate of speechRunnerPaths(process.env)) {
    try {
      // Every build answers --help with zero; a path that is not there throws ENOENT.
      const result = await run(candidate, ['--help']);
      if (result.code === 0) return { ok: true, path: candidate };
    } catch {
      continue;
    }
  }
  return { ok: false, message: SPEECH_RUNNER_MISSING_MESSAGE };
}

async function modelFile(id: string): Promise<{ path: string; installed: boolean }> {
  const model = speechModel(id);
  const path = join(speechModelDir(), model.file);
  try {
    const info = await stat(path);
    return { path, installed: info.size === model.bytes };
  } catch {
    return { path, installed: false };
  }
}

export async function speechStatus(raw: unknown): Promise<SpeechStatus> {
  const id = typeof (raw as { model?: unknown })?.model === 'string' ? (raw as { model: string }).model : DEFAULT_SPEECH_MODEL;
  const model = speechModel(id);
  const [runner, file, ffmpeg] = await Promise.all([detectRunner(), modelFile(model.id), detectFfmpeg()]);
  return {
    runner,
    model: {
      id: model.id,
      label: model.label,
      bytes: model.bytes,
      license: SPEECH_MODEL_LICENSE,
      note: model.note,
      installed: file.installed,
    },
    ffmpeg: ffmpeg.ok,
  };
}

/**
 * Fetch the model, once the person has said yes. It is written to a temporary
 * name beside its place, hashed as it arrives, and only moved into place when
 * the hash is the published one — so a proxy, a mirror or a transfer that
 * stopped half way leaves nothing behind that could be run.
 */
export async function fetchSpeechModel(raw: unknown): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const model = speechModel(typeof (raw as { model?: unknown })?.model === 'string' ? (raw as { model: string }).model : DEFAULT_SPEECH_MODEL);
  const dir = speechModelDir();
  const target = join(dir, model.file);
  const existing = await modelFile(model.id);
  if (existing.installed) return { ok: true, path: target };
  await mkdir(dir, { recursive: true });
  const partial = `${target}.part`;
  const hash = createHash('sha256');
  let received = 0;
  try {
    // Electron's own fetch rather than Node's: it goes through the session, so a proxy, a
    // corporate certificate store and the app's network settings all hold for this one request.
    const response = await net.fetch(model.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!response.ok || !response.body) {
      return { ok: false, message: `The model could not be fetched: the server answered ${response.status}.` };
    }
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      report(`Fetching ${model.label}…`, Math.min(1, received / model.bytes));
    });
    await pipeline(body, createWriteStream(partial));
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    return { ok: false, message: `The model could not be fetched: ${(error as Error).message}` };
  }
  const digest = hash.digest('hex');
  if (received !== model.bytes || digest !== model.sha256) {
    await rm(partial, { force: true }).catch(() => undefined);
    return {
      ok: false,
      message: 'What arrived is not the model Pulp expects: its checksum does not match the published one, so it was thrown away.',
    };
  }
  await rename(partial, target);
  report(`${model.label} is ready.`, 1);
  return { ok: true, path: target };
}

export interface TranscribeRequest {
  segments: SpeechSegment[];
  model?: string;
  language?: string;
}

export type TranscribeResult = { ok: true; words: CaptionWord[]; language: string } | { ok: false; message: string };

/** One ask at a time: a second run would fight the first for the machine's cores. */
let running: Promise<TranscribeResult> | null = null;

export async function transcribe(raw: unknown): Promise<TranscribeResult> {
  if (running) return { ok: false, message: 'A transcription is already running.' };
  const work = run(raw).catch((error: Error): TranscribeResult => ({ ok: false, message: error.message }));
  running = work;
  return work.finally(() => {
    running = null;
  });
}

/** The segments the window asked for, as files on disk with their place on the timeline. */
async function resolveSegments(ffprobePath: string, segments: readonly SpeechSegment[]): Promise<{ path: string; segment: SpeechSegment }[]> {
  const out: { path: string; segment: SpeechSegment }[] = [];
  for (const segment of segments) {
    if (segment.to - segment.from <= 0.01) continue;
    const found = segment.kind === 'sound'
      ? await resolveSoundSource(ffprobePath, segment.id)
      : await resolveClipAudio(ffprobePath, segment.id).then((audio) => (audio?.hasAudio ? audio : null));
    if (!found) continue;
    out.push({ path: found.path, segment });
  }
  return out;
}

async function run(raw: unknown): Promise<TranscribeResult> {
  const request = raw as Partial<TranscribeRequest>;
  const asked = Array.isArray(request?.segments) ? (request.segments as SpeechSegment[]) : [];
  const language = typeof request?.language === 'string' && request.language.trim() !== '' ? request.language.trim() : SPEECH_LANGUAGE_AUTO;
  const model = speechModel(request?.model);
  const [runner, file, ffmpeg] = await Promise.all([detectRunner(), modelFile(model.id), detectFfmpeg()]);
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };
  if (!runner.ok || !runner.path) return { ok: false, message: runner.message ?? SPEECH_RUNNER_MISSING_MESSAGE };
  if (!file.installed) return { ok: false, message: `${model.label} is not on this machine yet.` };
  const resolved = await resolveSegments(ffprobePathFor(ffmpeg.path), asked);
  if (resolved.length === 0) return { ok: false, message: 'There is no sound in this project to transcribe.' };

  const work = await mkdtemp(join(tmpdir(), 'pulp-speech-'));
  try {
    report('Reading the sound…', null);
    const wav = join(work, 'speech.wav');
    const inputs = resolved.flatMap(({ path, segment }) => [
      '-ss', String(Math.max(0, segment.from)),
      '-t', String(Math.max(0.01, segment.to - segment.from)),
      '-i', path,
    ]);
    const extract = await runProcess(ffmpeg.path, [
      '-v', 'error', '-y', ...inputs,
      '-filter_complex', speechMixFilter(resolved.map(({ segment }) => segment)),
      '-map', '[speech]', '-ac', '1', '-ar', String(SPEECH_SAMPLE_RATE), '-c:a', 'pcm_s16le', wav,
    ], TRANSCRIBE_TIMEOUT_MS);
    if (extract.code !== 0) return { ok: false, message: 'The project\'s sound could not be read for transcription.' };

    report('Listening…', 0);
    const outBase = join(work, 'speech');
    const listen = await runProcess(runner.path, whisperArgs({
      modelPath: file.path, wavPath: wav, outBase, language,
    }), TRANSCRIBE_TIMEOUT_MS, (line) => {
      const fraction = whisperProgress(line);
      if (fraction !== null) report('Listening…', fraction);
    });
    if (listen.code !== 0) {
      return { ok: false, message: `The speech model could not finish: ${listen.stderr.split('\n').filter(Boolean).slice(-1)[0] ?? `exit ${listen.code}`}` };
    }
    const words = wordsFromWhisperJson(await readFile(`${outBase}.json`, 'utf8'));
    report('', null);
    if (words.length === 0) return { ok: false, message: 'Nothing was heard in this project\'s sound.' };
    return { ok: true, words, language };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Run a program to completion, with a bound and a look at each line of its output as it comes. */
function runProcess(command: string, args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    let rest = '';
    const read = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      stderr = (stderr + text).slice(-8000);
      if (!onLine) return;
      rest += text;
      const lines = rest.split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const line of lines) onLine(line);
    };
    child.stderr?.on('data', read);
    child.stdout?.on('data', read);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Transcription took too long and was stopped.'));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}
