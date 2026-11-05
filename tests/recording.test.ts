/**
 * Recording a voice (milestone 63), the parts with no microphone in them: how
 * a take is named, how its samples become a WAV, and how the file lands in a
 * folder — including a second take within the same second.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  encodeWav, RECORDING_SAMPLE_RATE, RECORDINGS_FOLDER_NAME, recordingFileName, wavDurationSeconds, writeRecordingFile,
} from '../src/core/recording';
import { mediaKindForPath } from '../src/core/library-scan';

const at = new Date(2026, 10, 4, 14, 30, 5); // 4 November 2026, 14:30:05, local time

describe('naming a take', () => {
  it('names by date and time, in local time, sorted by when it was spoken', () => {
    expect(recordingFileName(at)).toBe('Recording 2026-11-04 14-30-05.wav');
  });

  it('pads every part and writes nothing Windows forbids in a file name', () => {
    const early = recordingFileName(new Date(2026, 0, 2, 3, 4, 5));
    expect(early).toBe('Recording 2026-01-02 03-04-05.wav');
    expect(early).not.toMatch(/[:<>"/\\|?*]/);
  });

  it('is a file the library scans as audio, in the folder the service manages', () => {
    expect(mediaKindForPath(recordingFileName(at))).toBe('audio');
    expect(RECORDINGS_FOLDER_NAME).toBe('Recordings');
  });
});

describe('encoding a take as WAV', () => {
  it('writes a 16-bit mono PCM header whose own numbers agree with the samples', () => {
    const wav = encodeWav(new Float32Array(RECORDING_SAMPLE_RATE * 2), RECORDING_SAMPLE_RATE);
    const view = new DataView(wav.buffer);
    const ascii = (from: number, to: number) => String.fromCharCode(...wav.subarray(from, to));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 12)).toBe('WAVE');
    expect(view.getUint32(4, true), 'RIFF size').toBe(wav.length - 8);
    expect(view.getUint16(20, true), 'PCM').toBe(1);
    expect(view.getUint16(22, true), 'mono').toBe(1);
    expect(view.getUint32(24, true)).toBe(RECORDING_SAMPLE_RATE);
    expect(view.getUint32(28, true), 'bytes per second').toBe(RECORDING_SAMPLE_RATE * 2);
    expect(view.getUint16(34, true), '16 bits').toBe(16);
    expect(view.getUint32(40, true), 'data bytes').toBe(RECORDING_SAMPLE_RATE * 2 * 2);
    expect(wavDurationSeconds(wav)).toBe(2);
  });

  it('keeps the samples, full scale to full scale, and clips a hot microphone rather than wrapping', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 1.7, -1.7]), 8000);
    const view = new DataView(wav.buffer);
    const sample = (i: number) => view.getInt16(44 + i * 2, true);
    expect(sample(0)).toBe(0);
    expect(sample(1)).toBe(Math.round(0.5 * 0x7fff));
    expect(sample(2)).toBe(Math.round(-0.5 * 0x8000));
    expect(sample(3)).toBe(0x7fff);
    expect(sample(4)).toBe(-0x8000);
    expect(sample(5), 'clipped, not wrapped').toBe(0x7fff);
    expect(sample(6)).toBe(-0x8000);
  });

  it('reads no duration out of what is not a WAV it wrote', () => {
    expect(wavDurationSeconds(new Uint8Array(10))).toBeNull();
    expect(wavDurationSeconds(new Uint8Array(44))).toBeNull();
  });
});

describe('writing a take into the folder', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it('creates the folder, writes the named file, and keeps a second take in the same second', async () => {
    const base = await mkdtemp(join(tmpdir(), 'pulp-rec-'));
    dirs.push(base);
    const folder = join(base, RECORDINGS_FOLDER_NAME);
    const wav = encodeWav(new Float32Array(800), 8000);
    const first = await writeRecordingFile(folder, wav, at);
    expect(basename(first)).toBe('Recording 2026-11-04 14-30-05.wav');
    expect(wavDurationSeconds(new Uint8Array(await readFile(first)))).toBeCloseTo(0.1, 6);
    // The same second again: both takes stay.
    const second = await writeRecordingFile(folder, wav, at);
    expect(basename(second)).toBe('Recording 2026-11-04 14-30-05 (2).wav');
    const third = await writeRecordingFile(folder, wav, at);
    expect(basename(third)).toBe('Recording 2026-11-04 14-30-05 (3).wav');
    expect((await readdir(folder)).sort()).toHaveLength(3);
  });
});
