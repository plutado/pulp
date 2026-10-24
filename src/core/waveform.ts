/**
 * Waveforms (docs/ui-layout.md, milestone 12): one peak per slice of an audio
 * file, computed once with ffmpeg and kept in the library database beside the
 * thumbnails, then drawn under the stage's scrub bar and in list rows.
 *
 * The pure half: which items have one, the ffmpeg arguments that decode the
 * audio, the peaks themselves, how they are stored, and the SVG path that draws
 * them. Peaks are bytes, so a track costs a few hundred of them whatever its
 * length and the drawing never has to know the sample rate.
 */

import type { LibraryEntry } from './library-types';

/** Peaks per file. Enough to read a shape at stage width, few enough to store everywhere. */
export const WAVEFORM_BUCKETS = 400;

/**
 * Peaks are taken from audio decoded to mono at this rate. Low on purpose: a
 * peak covers thousands of samples either way, and 8 kHz keeps a long track's
 * decode small.
 */
export const WAVEFORM_RATE = 8_000;

/** Audio files get a waveform; anything with a picture shows the picture instead. */
export function wantsWaveform(entry: LibraryEntry): boolean {
  return entry.kind === 'media' && entry.mediaKind === 'audio' && entry.offline !== true;
}

/** ffmpeg: the whole file as mono 16-bit samples on stdout, for peaks to be taken from. */
export function waveformArgs(input: string): string[] {
  return ['-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', String(WAVEFORM_RATE), '-f', 's16le', '-'];
}

/**
 * The loudest sample in each slice, as a byte. Silence is 0 and a full-scale
 * peak 255, so the drawing needs nothing but the array. A file too short to
 * fill the buckets leaves the rest at zero rather than stretching.
 */
export function peaksFromPcm(pcm: Uint8Array, buckets = WAVEFORM_BUCKETS): Uint8Array {
  const peaks = new Uint8Array(Math.max(0, buckets));
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0 || buckets <= 0) return peaks;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const per = Math.max(1, Math.ceil(samples / buckets));
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = bucket * per;
    if (start >= samples) break;
    const end = Math.min(samples, start + per);
    let loudest = 0;
    for (let i = start; i < end; i++) {
      // -32768 has no positive counterpart; clamping it to 32767 keeps the scale honest.
      const value = Math.min(32767, Math.abs(view.getInt16(i * 2, true)));
      if (value > loudest) loudest = value;
    }
    peaks[bucket] = Math.round((loudest / 32767) * 255);
  }
  return peaks;
}

// Peaks are stored as text, a byte each in base64. btoa and atob rather than
// Buffer, so the renderer can read back what the main process wrote.

export function encodePeaks(peaks: Uint8Array): string {
  let binary = '';
  for (const byte of peaks) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodePeaks(text: string): Uint8Array {
  try {
    const binary = atob(text);
    const peaks = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) peaks[i] = binary.charCodeAt(i);
    return peaks;
  } catch {
    return new Uint8Array();
  }
}

/**
 * An SVG path drawing the peaks as vertical strokes about the middle of a box,
 * one per column. Fewer columns than peaks averages them down, so the same
 * stored peaks draw a list row and a stage-wide waveform.
 *
 * A silent file still draws a hairline, so a row never looks like it failed.
 */
export function waveformPath(peaks: ArrayLike<number>, width: number, height: number, columns = 0): string {
  const count = Math.max(1, Math.floor(columns || peaks.length));
  if (peaks.length === 0 || width <= 0 || height <= 0) return '';
  const middle = height / 2;
  const step = width / count;
  const per = peaks.length / count;
  const parts: string[] = [];
  for (let column = 0; column < count; column++) {
    let loudest = 0;
    for (let i = Math.floor(column * per); i < Math.min(peaks.length, Math.floor((column + 1) * per) + 1); i++) {
      if (peaks[i]! > loudest) loudest = peaks[i]!;
    }
    const half = Math.max(0.5, (loudest / 255) * middle);
    const x = round(column * step + step / 2);
    parts.push(`M${x} ${round(middle - half)}V${round(middle + half)}`);
  }
  return parts.join('');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
