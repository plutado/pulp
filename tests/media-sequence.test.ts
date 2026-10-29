/**
 * Frame sequences (milestone 26): a run of numbered frames read as one clip.
 * The grouping decides what a person sees in the results, so the cases that
 * matter are the ones where it must *not* group: variants, photographs, and a
 * run with a frame missing.
 */

import { describe, expect, it } from 'vitest';
import {
  groupSequences,
  sequenceDuration,
  sequenceFrameName,
  sequencePatternName,
  sequencePosterFrame,
  sequenceStripFrames,
  SEQUENCE_FPS,
  SEQUENCE_MIN_FRAMES,
} from '../src/core/media-sequence';

const frames = (stem: string, from: number, to: number, digits = 4, ext = '.png'): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${stem}${String(from + i).padStart(digits, '0')}${ext}`);

describe('grouping a folder into sequences', () => {
  it('reads a numbered run as one clip, whatever it starts at', () => {
    const { sequences, singles } = groupSequences('/a', frames('fire_', 1, 120));
    expect(singles).toEqual([]);
    expect(sequences).toEqual([{ dir: '/a', stem: 'fire_', ext: '.png', digits: 4, start: 1, count: 120 }]);
    // Stock often starts at 0, and a trimmed export at wherever it was trimmed.
    expect(groupSequences('/a', frames('s', 0, 23)).sequences[0]).toMatchObject({ start: 0, count: 24 });
    expect(groupSequences('/a', frames('s', 517, 540)).sequences[0]).toMatchObject({ start: 517, count: 24 });
  });

  it('leaves a short run alone, so variants stay separate pictures', () => {
    // Someone's logo-1.png … logo-3.png are three pictures, not a three-frame clip.
    const variants = ['logo-1.png', 'logo-2.png', 'logo-3.png'];
    const { sequences, singles } = groupSequences('/a', variants);
    expect(sequences).toEqual([]);
    expect(singles).toEqual(variants);
    // The floor is where it says it is.
    expect(groupSequences('/a', frames('f', 1, SEQUENCE_MIN_FRAMES - 1)).sequences).toEqual([]);
    expect(groupSequences('/a', frames('f', 1, SEQUENCE_MIN_FRAMES)).sequences).toHaveLength(1);
  });

  it('breaks a run at a missing frame rather than hiding the gap', () => {
    const withHole = [...frames('f', 1, 10), ...frames('f', 12, 30)];
    const { sequences, singles } = groupSequences('/a', withHole);
    // Two runs, each long enough; nothing silently skipped.
    expect(sequences.map((s) => [s.start, s.count])).toEqual([[1, 10], [12, 19]]);
    expect(singles).toEqual([]);
    // When one side of the gap is too short, those frames stay as files.
    const lopsided = [...frames('g', 1, 3), ...frames('g', 20, 40)];
    const split = groupSequences('/a', lopsided);
    expect(split.sequences.map((s) => [s.start, s.count])).toEqual([[20, 21]]);
    expect(split.singles).toEqual(frames('g', 1, 3));
  });

  it('keeps separate runs, digit widths and extensions apart', () => {
    const mixed = [
      ...frames('smoke_', 1, 12),
      ...frames('sparks_', 1, 9),
      ...frames('smoke_', 1, 10, 2), // same stem, two digits: a different run, as ffmpeg reads it
      ...frames('smoke_', 1, 10, 4, '.exr'),
      'poster.png',
      'notes.txt',
    ];
    const { sequences, singles } = groupSequences('/a', mixed);
    expect(sequences).toHaveLength(4);
    expect(sequences.filter((s) => s.stem === 'smoke_' && s.ext === '.png').map((s) => s.digits).sort()).toEqual([2, 4]);
    expect(sequences.some((s) => s.ext === '.exr')).toBe(true);
    expect(singles).toEqual(['notes.txt', 'poster.png']);
  });

  it('groups only the formats frames come in, and never a folder of photographs', () => {
    // JPEG is left out on purpose: numbered JPEGs are usually photos.
    expect(groupSequences('/a', frames('DSC', 1, 40, 4, '.jpg')).sequences).toEqual([]);
    expect(groupSequences('/a', frames('DSC', 1, 40, 4, '.jpg')).singles).toHaveLength(40);
    for (const ext of ['.png', '.tif', '.tiff', '.exr', '.dpx']) {
      expect(groupSequences('/a', frames('f', 1, 10, 4, ext)).sequences, ext).toHaveLength(1);
    }
    // A name with no trailing number is never part of a run.
    expect(groupSequences('/a', ['backdrop.png']).singles).toEqual(['backdrop.png']);
  });

  it('is not fooled by a date stamp or an id in the name', () => {
    // A 12-digit number is not a frame count; these stay separate files.
    const stamps = Array.from({ length: 10 }, (_, i) => `shot_20261029${String(100 + i).padStart(4, '0')}.png`);
    const { sequences, singles } = groupSequences('/a', stamps);
    expect(sequences).toEqual([]);
    expect(singles).toHaveLength(10);
  });
});

describe('what a sequence is read as', () => {
  const seq = { dir: '/a', stem: 'fire_', ext: '.png', digits: 4, start: 1, count: 120 };

  it('names its frames and the pattern ffmpeg takes', () => {
    expect(sequenceFrameName(seq, 0)).toBe('fire_0001.png');
    expect(sequenceFrameName(seq, 6)).toBe('fire_0007.png');
    // Out of range clamps rather than naming a file that is not there.
    expect(sequenceFrameName(seq, -5)).toBe('fire_0001.png');
    expect(sequenceFrameName(seq, 999)).toBe('fire_0120.png');
    expect(sequencePatternName(seq)).toBe('fire_%04d.png');
    expect(sequencePatternName({ ...seq, digits: 2, stem: 'f' })).toBe('f%02d.png');
  });

  it('runs for its frame count at the stated rate', () => {
    expect(sequenceDuration(120)).toBe(120 / SEQUENCE_FPS);
    expect(sequenceDuration(0)).toBe(0);
    expect(sequenceDuration(90, 24)).toBe(3.75);
  });

  it('posters a tenth in, and spreads a strip end to end', () => {
    expect(sequencePosterFrame(120)).toBe(12);
    expect(sequencePosterFrame(1)).toBe(0);
    expect(sequenceStripFrames(120, 8)).toEqual([0, 17, 34, 51, 68, 85, 102, 119]);
    // Fewer frames than the strip holds: some repeat, and the last frame is still the last.
    expect(sequenceStripFrames(3, 8).at(-1)).toBe(2);
    expect(sequenceStripFrames(8, 1)).toEqual([3]);
  });
});
