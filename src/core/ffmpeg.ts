/**
 * ffmpeg discovery. The process runner is injected so this module can be
 * tested without ffmpeg installed; `nodeRunner` is the real implementation.
 */

import { execFile, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { tr } from './i18n';
import type { OutputPreset } from './render-plan';
import { featureForEncoder, featureStatus, missingSentence } from './ffmpeg-needs';

export { presetUnavailableReason } from './ffmpeg-presets';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (command: string, args: string[]) => Promise<RunResult>;

export type FfmpegStatus =
  | {
      ok: true;
      path: string;
      version: string;
      encoders: string[];
      /**
       * The filters and decoders it carries (milestone 88), which every feature
       * asks through src/core/ffmpeg-needs.ts; null where the list could not be
       * read, which is held against nothing.
       */
      filters: string[] | null;
      decoders: string[] | null;
      /** True if filter links carry an alpha mode (ffmpeg 8.1 and later): raw input must then be tagged. */
      alphaModeAware: boolean;
    }
  | { ok: false; message: string };

/** What is said when there is no ffmpeg, in the window and on the command line: in the interface's language now. */
export function ffmpegMissingMessage(): string {
  return tr('ffmpeg.missing');
}

/**
 * The build Pulp fetched for this machine, where there is one: the download
 * helper registers it at startup and again the moment a fetch lands
 * (src/main/ffmpeg-service.ts), so nothing has to be restarted.
 *
 * It goes **last** among the candidates below unless it is chosen (ADR 0026):
 * "use your own ffmpeg" stays the default, and the one on your PATH wins over
 * the one Pulp fetched until the person picks the fetched one in Settings —
 * which a fetch does for them, having been asked for.
 */
let managedFfmpeg: string | null = null;

export function setManagedFfmpeg(path: string | null): void {
  managedFfmpeg = path;
}

/**
 * The ffmpeg the person chose in Settings (milestone 88): a file of their
 * own, or the build Pulp fetched. It goes **first** — after the
 * `PULP_FFMPEG_PATH` override, which is for scripts and CI — so a choice is a
 * choice; with none, the order below stands and the fetched build is looked
 * for last, as before. The settings module sets it at startup and on a change.
 */
let chosenFfmpeg: string | null = null;

export function setChosenFfmpeg(path: string | null): void {
  chosenFfmpeg = path;
}

export const nodeRunner: ProcessRunner = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(error);
        return;
      }
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/**
 * Run ffmpeg with the images to work on written to its stdin. Avoids a scratch
 * folder and a numbered input pattern — one less set of paths to get wrong on
 * Windows, and nothing to clean up afterwards (docs/platform-notes.md).
 */
export function runWithInput(command: string, args: string[], input: Buffer): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-8000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    // ffmpeg may stop reading once it has the frames it was asked for; that EPIPE is not a failure.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

/**
 * Run ffmpeg and keep its stdout as bytes. `nodeRunner` decodes stdout as text,
 * which destroys raw samples and pixels (docs/platform-notes.md: PowerShell
 * pipes bit us the same way).
 */
export function runForBuffer(command: string, args: string[]): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks), stderr }));
  });
}

/**
 * Both at once: images in on stdin, bytes out on stdout. The poster probe feeds
 * a captured PNG in and reads a few hundred raw pixels back (src/core/poster.ts).
 */
export function runWithInputForBuffer(command: string, args: string[], input: Buffer): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks), stderr }));
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

/** Extract "8.0" from the first line of `ffmpeg -version`. */
export function parseFfmpegVersion(output: string): string | null {
  const m = /ffmpeg version (\S+)/.exec(output);
  return m?.[1] ?? null;
}

/** Encoder names from `ffmpeg -hide_banner -encoders`. */
export function parseEncoders(output: string): string[] {
  const names: string[] = [];
  let inList = false;
  for (const line of output.split(/\r?\n/)) {
    if (/^\s*-{3,}\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const m = /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

/**
 * Filter names from `ffmpeg -hide_banner -filters`, or null when the output is
 * not that list. Each line is a flag column and the name; the header ends at
 * the legend, which is the lines with " = ".
 */
export function parseFilters(output: string): string[] | null {
  if (!/^Filters:/m.test(output)) return null;
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s[T.|][S.|]?[C.|]?\s+([a-z0-9_]+)\s+\S+->\S+/.exec(line);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

/** Decoder names from `ffmpeg -hide_banner -decoders`, laid out as the encoders are; null when the output is not that list. */
export function parseDecoders(output: string): string[] | null {
  if (!/^Decoders:/m.test(output)) return null;
  return parseEncoders(output);
}

/** True if `ffmpeg -h filter=setparams` lists an alpha_mode option, which arrived with alpha mode negotiation in 8.1. */
export function parseAlphaModeSupport(output: string): boolean {
  return /^\s*alpha_mode\s+<int>/m.test(output);
}

export function candidatePaths(
  env: Record<string, string | undefined>,
  managed: string | null = managedFfmpeg,
  chosen: string | null = chosenFfmpeg,
): string[] {
  const list: string[] = [];
  if (env.PULP_FFMPEG_PATH) list.push(env.PULP_FFMPEG_PATH);
  if (chosen) list.push(chosen);
  list.push('ffmpeg');
  // GUI apps on macOS do not inherit the shell PATH, so check the usual Homebrew locations too.
  list.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  if (managed) list.push(managed);
  return [...new Set(list)];
}

/**
 * What one ffmpeg was found to be, kept for as long as the file is unchanged
 * (milestone 88): the version, the encoders, decoders and filters, and the
 * alpha mode. Five processes, so they are run once per build rather than on
 * every render, every clip read and every dialog that asks — which is also
 * what makes every feature's answer the same one. Kept only for the real
 * runner: a test's runner answers what it is told, every time.
 */
const readBuilds = new Map<string, Promise<FfmpegStatus | null>>();

function fileStamp(command: string): string {
  // A bare name on PATH has no file to stamp; it is read once per run, which is what a PATH lookup is.
  if (!command.includes('/') && !command.includes('\\')) return '';
  try {
    const st = statSync(command);
    return `${st.size}|${st.mtimeMs}`;
  } catch {
    return 'gone';
  }
}

async function readBuild(run: ProcessRunner, candidate: string): Promise<FfmpegStatus | null> {
  let result: RunResult;
  try {
    result = await run(candidate, ['-hide_banner', '-version']);
  } catch {
    return null;
  }
  if (result.code !== 0) return null;
  const version = parseFfmpegVersion(result.stdout) ?? 'unknown';
  /** One listing, read or not: a listing that fails is reported as unknown, never as empty. */
  const list = async <T>(args: string[], parse: (out: string) => T, fallback: T): Promise<T> => {
    try {
      const r = await run(candidate, args);
      return r.code === 0 ? parse(r.stdout) : fallback;
    } catch {
      return fallback;
    }
  };
  // Version worked but a listing did not: report what there is.
  const encoders = await list(['-hide_banner', '-encoders'], parseEncoders, [] as string[]);
  const decoders = await list(['-hide_banner', '-decoders'], parseDecoders, null);
  const filters = await list(['-hide_banner', '-filters'], parseFilters, null);
  // Treated as an older ffmpeg, with no alpha mode tagging, when the help cannot be read.
  const alphaModeAware = await list(['-hide_banner', '-h', 'filter=setparams'], parseAlphaModeSupport, false);
  return { ok: true, path: candidate, version, encoders, filters, decoders, alphaModeAware };
}

export async function detectFfmpeg(
  run: ProcessRunner = nodeRunner,
  env: Record<string, string | undefined> = process.env,
): Promise<FfmpegStatus> {
  for (const candidate of candidatePaths(env)) {
    let found: FfmpegStatus | null;
    if (run === nodeRunner) {
      const key = `${candidate}|${fileStamp(candidate)}`;
      let work = readBuilds.get(key);
      if (!work) {
        work = readBuild(run, candidate);
        readBuilds.set(key, work);
      }
      found = await work;
      // A candidate that is not there now may be there later (a fetch lands, a brew install runs).
      if (!found) readBuilds.delete(key);
    } else {
      found = await readBuild(run, candidate);
    }
    if (found) return found;
  }
  return { ok: false, message: ffmpegMissingMessage() };
}

/** Forget what was read of every build: after a fetch, or a change of the chosen ffmpeg. */
export function forgetFfmpegBuilds(): void {
  readBuilds.clear();
}

/** The status as the feature table reads it (src/core/ffmpeg-needs.ts). */
export function capabilitiesOf(status: FfmpegStatus): { filters: string[] | null; encoders: string[] | null; decoders: string[] | null } {
  if (!status.ok) return { filters: [], encoders: [], decoders: [] };
  // An encoder list that came back empty was not read: say unknown, as before, rather than "nothing".
  return { filters: status.filters, encoders: status.encoders.length > 0 ? status.encoders : null, decoders: status.decoders };
}

/** Returns an error message if the detected ffmpeg cannot encode this preset, otherwise null. */
export function checkPresetSupport(status: FfmpegStatus, preset: OutputPreset): string | null {
  if (!status.ok) return status.message;
  if (status.encoders.length > 0 && !status.encoders.includes(preset.encoder)) {
    // An encoder a library brings is said as the feature table says it (milestone 88): the library,
    // and where the fix is — the same sentence the preset list and Settings use.
    const feature = featureForEncoder(preset.encoder);
    if (feature && !preset.platformNote) return missingSentence(featureStatus(capabilitiesOf(status), feature));
    return tr('ffmpeg.encoder-missing', { path: status.path, version: status.version, encoder: preset.encoder, preset: preset.label });
  }
  return null;
}
