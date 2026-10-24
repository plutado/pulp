import { describe, expect, it } from 'vitest';
import {
  decodePeaks,
  encodePeaks,
  peaksFromPcm,
  wantsWaveform,
  WAVEFORM_BUCKETS,
  WAVEFORM_RATE,
  waveformArgs,
  waveformPath,
} from '../src/core/waveform';
import type { MediaEntry, TemplateEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';

function media(over: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key: 'k', id: 'id', path: '/lib/song.wav', root: '/lib', name: 'song', mediaKind: 'audio', ext: '.wav', size: 1, mtimeMs: 0, tags: [], ...over };
}

/** Mono 16-bit samples, little-endian, as ffmpeg hands them over. */
function pcm(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, i) => view.setInt16(i * 2, value, true));
  return bytes;
}

describe('what gets a waveform', () => {
  it('is audio that is reachable', () => {
    expect(wantsWaveform(media())).toBe(true);
    expect(wantsWaveform(media({ mediaKind: 'video' }))).toBe(false);
    expect(wantsWaveform(media({ offline: true }))).toBe(false);
    const template: TemplateEntry = { kind: 'template', key: 't', id: 'idt', dir: '/lib/t', root: '/lib', manifest: validManifest(), tags: [], warnings: [] };
    expect(wantsWaveform(template)).toBe(false);
  });

  it('decodes to mono samples at a low rate, with no video in the way', () => {
    const args = waveformArgs('/lib/song.wav');
    expect(args[args.indexOf('-i') + 1]).toBe('/lib/song.wav');
    expect(args).toContain('-vn');
    expect(args[args.indexOf('-ac') + 1]).toBe('1');
    expect(args[args.indexOf('-ar') + 1]).toBe(String(WAVEFORM_RATE));
    expect(args.slice(-3)).toEqual(['-f', 's16le', '-']);
  });
});

describe('peaks', () => {
  it('takes the loudest sample of each slice, as a byte', () => {
    // Four samples into two buckets: the loudest of each pair.
    expect([...peaksFromPcm(pcm([0, 32767, -16384, 100]), 2)]).toEqual([255, 128]);
    // Sign does not matter, only how far from silence.
    expect([...peaksFromPcm(pcm([-32768, 0]), 1)]).toEqual([255]);
  });

  it('leaves the tail at silence for a file shorter than the buckets', () => {
    const peaks = peaksFromPcm(pcm([32767, 32767]), 8);
    expect(peaks).toHaveLength(8);
    expect([...peaks]).toEqual([255, 255, 0, 0, 0, 0, 0, 0]);
    expect([...peaksFromPcm(new Uint8Array(), 4)]).toEqual([0, 0, 0, 0]);
  });

  it('defaults to one bucket per slice of the whole file', () => {
    expect(peaksFromPcm(pcm(Array.from({ length: 10_000 }, () => 1000)))).toHaveLength(WAVEFORM_BUCKETS);
  });

  it('survives a round trip through the database as text', () => {
    const peaks = peaksFromPcm(pcm([0, 32767, -16384, 100]), 4);
    const text = encodePeaks(peaks);
    expect(text).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect([...decodePeaks(text)]).toEqual([...peaks]);
    // Damaged text reads as no peaks rather than throwing in the renderer.
    expect(decodePeaks('not base64 !!')).toHaveLength(0);
  });
});

describe('the drawing', () => {
  it('is one stroke per column, about the middle of the box', () => {
    const path = waveformPath([255, 0], 100, 20);
    // Full scale reaches both edges; silence still draws a hairline.
    expect(path).toBe('M25 0V20M75 9.5V10.5');
  });

  it('averages peaks down when there are more of them than columns', () => {
    const path = waveformPath([0, 255, 0, 0], 100, 20, 2);
    // The loud peak in the first half makes that column full height.
    expect(path.startsWith('M25 0V20')).toBe(true);
    expect(path.split('M')).toHaveLength(3);
  });

  it('draws nothing without peaks or without a box', () => {
    expect(waveformPath([], 100, 20)).toBe('');
    expect(waveformPath([255], 0, 20)).toBe('');
    expect(waveformPath([255], 100, 0)).toBe('');
  });
});
