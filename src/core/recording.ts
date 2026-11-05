/**
 * Recording a voice (milestone 63), the shareable part: how a take is named,
 * how its samples become a WAV file, and how that file is written into the
 * managed Recordings folder. A camera's take (milestone 64) is named and
 * placed by the same rules; what is its own is in src/core/video-take.ts. The renderer captures the microphone (it is the
 * process with `getUserMedia`) and encodes here; the main process owns the
 * folder and the library. Everything here is testable without a microphone.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** The managed folder recordings land in, under the app's own data, beside the managed fonts. */
export const RECORDINGS_FOLDER_NAME = 'Recordings';

/** The one sample rate takes are captured and saved at: what every editor and ffmpeg expect of voice. */
export const RECORDING_SAMPLE_RATE = 48_000;

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * A take is named by when it was made — "Recording 2026-11-04 14-30-05.wav" —
 * so a folder of them sorts into the order they were spoken. Dashes in the
 * time, not colons, which Windows forbids in a file name; local time, since
 * "the take from half past two" is how a person remembers it. A camera's take
 * is named the same way with its own extension, so voices and pictures made
 * in one session sort together.
 */
export function recordingFileName(at: Date, extension = 'wav'): string {
  const date = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  const time = `${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;
  return `Recording ${date} ${time}.${extension}`;
}

/**
 * Where a take made at this moment goes in the folder: its name, or — a second
 * take within the same second — the name with " (2)", " (3)" and so on, so no
 * take is ever written over another.
 */
export function freeRecordingPath(folder: string, at: Date, extension = 'wav'): string {
  const stem = recordingFileName(at, extension).slice(0, -(extension.length + 1));
  let path = join(folder, `${stem}.${extension}`);
  for (let n = 2; existsSync(path); n++) path = join(folder, `${stem} (${n}).${extension}`);
  return path;
}

/**
 * Mono float samples as a 16-bit PCM WAV, the plainest file there is: every
 * editor reads it, ffmpeg mixes it, and nothing is lost to a lossy codec
 * between the microphone and the library. Samples beyond ±1 clip rather than
 * wrap, as a hot microphone should.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // the PCM chunk is 16 bytes
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff), true);
  }
  return bytes;
}

/** How long a WAV made by encodeWav runs, read back from its own header; what the tests check a take by. */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rate = view.getUint32(24, true);
  const bytesPerFrame = view.getUint16(32, true);
  const dataBytes = view.getUint32(40, true);
  if (rate === 0 || bytesPerFrame === 0) return null;
  return dataBytes / bytesPerFrame / rate;
}

/**
 * Write a take into the folder, named by its moment; a second take within the
 * same second keeps both, as " (2)". Resolves to the file's path.
 *
 * The bytes go to a hidden partial file first and are renamed into place once
 * whole, so the folder never holds a take that is still being written: on
 * Windows a file written in place is listed before its bytes are, and the
 * library's watcher (or a test) could read a header that is not there yet.
 */
export async function writeRecordingFile(folder: string, wav: Uint8Array, at: Date): Promise<string> {
  await mkdir(folder, { recursive: true });
  const path = freeRecordingPath(folder, at);
  const partial = join(dirname(path), `.${basename(path)}.part`);
  await writeFile(partial, wav);
  await rename(partial, path);
  return path;
}
