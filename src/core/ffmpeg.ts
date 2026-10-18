/**
 * ffmpeg discovery. The process runner is injected so this module can be
 * tested without ffmpeg installed; `nodeRunner` is the real implementation.
 */

import { execFile } from 'node:child_process';
import type { OutputPreset } from './render-plan';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (command: string, args: string[]) => Promise<RunResult>;

export type FfmpegStatus =
  | { ok: true; path: string; version: string; encoders: string[] }
  | { ok: false; message: string };

export const FFMPEG_MISSING_MESSAGE =
  'ffmpeg was not found. Pulp needs ffmpeg to encode renders. ' +
  'Install it (macOS: "brew install ffmpeg"; Windows: "winget install Gyan.FFmpeg"; Linux: your package manager), ' +
  'or set PULP_FFMPEG_PATH to the full path of the ffmpeg executable, then restart Pulp.';

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

export function candidatePaths(env: Record<string, string | undefined>): string[] {
  const list: string[] = [];
  if (env.PULP_FFMPEG_PATH) list.push(env.PULP_FFMPEG_PATH);
  list.push('ffmpeg');
  // GUI apps on macOS do not inherit the shell PATH, so check the usual Homebrew locations too.
  list.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  return [...new Set(list)];
}

export async function detectFfmpeg(
  run: ProcessRunner = nodeRunner,
  env: Record<string, string | undefined> = process.env,
): Promise<FfmpegStatus> {
  for (const candidate of candidatePaths(env)) {
    let result: RunResult;
    try {
      result = await run(candidate, ['-hide_banner', '-version']);
    } catch {
      continue;
    }
    if (result.code !== 0) continue;
    const version = parseFfmpegVersion(result.stdout) ?? 'unknown';
    let encoders: string[] = [];
    try {
      const enc = await run(candidate, ['-hide_banner', '-encoders']);
      if (enc.code === 0) encoders = parseEncoders(enc.stdout);
    } catch {
      // Version worked but encoder listing did not; report what we have.
    }
    return { ok: true, path: candidate, version, encoders };
  }
  return { ok: false, message: FFMPEG_MISSING_MESSAGE };
}

/** Returns an error message if the detected ffmpeg cannot encode this preset, otherwise null. */
export function checkPresetSupport(status: FfmpegStatus, preset: OutputPreset): string | null {
  if (!status.ok) return status.message;
  if (status.encoders.length > 0 && !status.encoders.includes(preset.encoder)) {
    return `The installed ffmpeg (${status.path}, version ${status.version}) has no "${preset.encoder}" encoder, which ${preset.label} needs. Install a full ffmpeg build or choose another preset.`;
  }
  return null;
}
