/**
 * Platform presets (milestone 20): the list is data that ages, so what holds
 * it together is checked here rather than trusted — every resolution really
 * is its aspect, every rate is one the renderer accepts, every encoder is a
 * real output preset — and the length and file-size warnings are held to
 * their wording, since they are the whole point of carrying the limits.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aspectById } from '../src/core/aspect';
import { OUTPUT_PRESETS } from '../src/core/render-plan';
import { isStandardFrameRate } from '../src/core/timecode';
import {
  expectedBytes, limitsCheckedLabel, maxFileBytes, PLATFORM_IDS, PLATFORM_LIMITS_CHECKED, PLATFORM_LIST_VERSION,
  PLATFORM_PRESETS, platformLimitsLabel, platformPreset, platformPresetProblems, platformSummary,
  platformWarningsAfter, platformWarningsBefore, type PlatformPreset,
} from '../src/core/platform-presets';
import { finishedFileWarnings } from '../src/main/platform-check';

const tiktok = platformPreset('tiktok')!;

describe('the built-in list', () => {
  it('parses: nothing in it is malformed', () => {
    expect(platformPresetProblems()).toEqual([]);
    expect(PLATFORM_PRESETS.length).toBeGreaterThan(4);
    expect(PLATFORM_LIST_VERSION).toBeGreaterThan(0);
  });

  it('gives every preset a resolution that really is its aspect', () => {
    for (const p of PLATFORM_PRESETS) {
      const aspect = aspectById(p.aspect);
      expect(aspect, `${p.id}: ${p.aspect}`).toBeDefined();
      expect(p.width / p.height, `${p.id}`).toBeCloseTo(aspect!.w / aspect!.h, 6);
      // H.264 subsamples chroma, so an odd side cannot be encoded at all.
      expect(p.width % 2, p.id).toBe(0);
      expect(p.height % 2, p.id).toBe(0);
    }
  });

  it('names a frame rate the renderer accepts and an encoder that writes one video file', () => {
    for (const p of PLATFORM_PRESETS) {
      expect(isStandardFrameRate(p.fps), `${p.id}: ${p.fps}`).toBe(true);
      const preset = OUTPUT_PRESETS[p.presetId];
      expect(preset, p.id).toBeDefined();
      expect(preset.sequence, p.id).toBe(false);
      expect(preset.still ?? false, p.id).toBe(false);
      expect(p.audioCodec, p.id).toBe('aac');
    }
  });

  it('keeps its ids unique, and finds a preset by one', () => {
    expect(new Set(PLATFORM_IDS).size).toBe(PLATFORM_IDS.length);
    expect(platformPreset('tiktok')?.label).toBe('TikTok');
    expect(platformPreset('not-a-platform')).toBeUndefined();
    expect(platformPreset(undefined)).toBeUndefined();
  });

  it('names an https upload page for every platform, for the hand-off (ADR 0020)', () => {
    for (const p of PLATFORM_PRESETS) expect(p.uploadUrl, p.id).toMatch(/^https:\/\//);
  });

  it('sets the loudness a render aimed there is leveled to (milestone 52)', () => {
    for (const p of PLATFORM_PRESETS) {
      expect(p.loudnessLufs, p.id).toBeLessThanOrEqual(-6);
      expect(p.loudnessLufs, p.id).toBeGreaterThanOrEqual(-36);
      expect(p.truePeakDb, p.id).toBeLessThanOrEqual(0);
    }
    expect(platformPresetProblems([{ ...PLATFORM_PRESETS[0]!, id: 'sample', loudnessLufs: -2 }])).toContain('sample: the loudness target must be between -36 and -6 LUFS');
    expect(platformPresetProblems([{ ...PLATFORM_PRESETS[0]!, id: 'sample', truePeakDb: 1 }])).toContain('sample: the true-peak ceiling must be between -9 and 0 dBTP');
  });

  it('carries the date its limits were checked, and says it in words', () => {
    expect(PLATFORM_LIMITS_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(limitsCheckedLabel('2026-11-01')).toBe('checked November 1, 2026');
    expect(limitsCheckedLabel('2026-03-14')).toBe('checked March 14, 2026');
    // A date that is not a date is still said rather than swallowed.
    expect(limitsCheckedLabel('soon')).toBe('checked soon');
  });
});

describe('the check on the list', () => {
  const sound: PlatformPreset = {
    id: 'sample', label: 'Sample', hint: 'A hint', aspect: '9:16', width: 1080, height: 1920, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 10, maxSeconds: 60, maxFileMB: 100, uploadUrl: 'https://example.com/upload', loudnessLufs: -14, truePeakDb: -1,
  };

  it('passes a sound entry', () => {
    expect(platformPresetProblems([sound])).toEqual([]);
  });

  it('catches a resolution that is not its aspect', () => {
    expect(platformPresetProblems([{ ...sound, width: 1920, height: 1080 }])).toEqual(['sample: 1920 × 1080 is not 9:16']);
  });

  it('catches an unknown aspect, a non-standard rate, an encoder that is not an output preset, and a sequence', () => {
    expect(platformPresetProblems([{ ...sound, aspect: '21:9' }])).toContain('sample: 21:9 is not one of the built-in aspects');
    expect(platformPresetProblems([{ ...sound, fps: 31 }])).toContain('sample: 31 is not one of the standard frame rates');
    expect(platformPresetProblems([{ ...sound, presetId: 'nope' as never }])).toContain('sample: "nope" is not an output preset');
    expect(platformPresetProblems([{ ...sound, presetId: 'png-sequence' }])).toContain('sample: a platform takes one video file, not PNG sequence (alpha)');
  });

  it('catches a repeated id, an empty list, a limit of zero and a bad checked date', () => {
    expect(platformPresetProblems([sound, sound])).toContain('sample: the id is used twice');
    expect(platformPresetProblems([])).toContain('the list is empty');
    expect(platformPresetProblems([{ ...sound, maxFileMB: 0 }])).toContain('sample: the file-size limit must be more than 0');
    expect(platformPresetProblems([{ ...sound, uploadUrl: 'http://example.com/up' }])).toContain('sample: the upload page must be an https URL');
    expect(platformPresetProblems([sound], '1 November')).toContain('the checked date "1 November" is not YYYY-MM-DD');
  });
});

describe('what a preset says in the window', () => {
  it('sums up what it sets, the leveling included', () => {
    expect(platformSummary(tiktok)).toBe('9:16 · 1080 × 1920 · 30 fps · H.264 MP4 · leveled to -14 LUFS');
  });

  it('says what the platform takes, with the date it was read', () => {
    expect(platformLimitsLabel(tiktok, '2026-11-01')).toBe('up to 10:00 and 287 MB (limits checked November 1, 2026)');
  });
});

describe('length and file-size warnings', () => {
  it('estimates the file from the bitrate target, in bytes', () => {
    // 10 Mb/s for 8 s is 10 MB of bits, which is 10,000,000 bytes.
    expect(expectedBytes(tiktok, 8)).toBe(10_000_000);
    expect(expectedBytes(tiktok, 0)).toBe(0);
    expect(expectedBytes(tiktok, Number.NaN)).toBe(0);
    expect(maxFileBytes(tiktok)).toBe(287 * 1024 ** 2);
  });

  it('says nothing about a render that is within the limits', () => {
    expect(platformWarningsBefore(tiktok, 10)).toEqual([]);
    expect(platformWarningsAfter(tiktok, 10, 4 * 1024 ** 2)).toEqual([]);
  });

  it('warns before a render that runs past the length limit', () => {
    // Shorts takes 3 minutes and 256 GB, so a long render is past the one limit and not the other.
    expect(platformWarningsBefore(platformPreset('youtube-shorts')!, 200, '2026-11-01')).toEqual([
      'Longer than YouTube Shorts takes: 3:20, against 3:00 (limits checked November 1, 2026).',
    ]);
  });

  it('warns before a render the bitrate target would make too large, saying it is an estimate', () => {
    // Inside TikTok's 10 minutes, but 400 s at 10 Mb/s is well past the 287 MB it takes.
    expect(platformWarningsBefore(tiktok, 400, '2026-11-01')).toEqual([
      'Likely larger than TikTok takes: about 476.8 MB at 10 Mb/s, against 287 MB (limits checked November 1, 2026).',
    ]);
  });

  it('warns about both at once before a render past both limits', () => {
    expect(platformWarningsBefore(tiktok, 750)).toHaveLength(2);
  });

  it('warns about the file that was written, from its real size', () => {
    expect(platformWarningsAfter(tiktok, 60, 300 * 1024 ** 2, '2026-11-01')).toEqual([
      'Larger than TikTok takes: 300 MB, against 287 MB (limits checked November 1, 2026).',
    ]);
  });

  it('warns about both at once when both are past', () => {
    expect(platformWarningsAfter(tiktok, 900, 400 * 1024 ** 2)).toHaveLength(2);
  });
});

describe('the finished file (milestone 20)', () => {
  let dir = '';
  let file = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-platform-'));
    file = join(dir, 'render.mp4');
    await writeFile(file, Buffer.alloc(1024));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('measures the file against the platform it was aimed at', async () => {
    // A kilobyte is within every limit; the length is not.
    expect(await finishedFileWarnings({ platform: 'tiktok', output: file, seconds: 4, sequence: false })).toEqual([]);
    const warnings = await finishedFileWarnings({ platform: 'x', output: file, seconds: 200, sequence: false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Longer than X takes: 3:20, against 2:20');
  });

  it('says nothing without a platform, for an id it does not know, for a sequence, or for a file it cannot read', async () => {
    expect(await finishedFileWarnings({ platform: undefined, output: file, seconds: 9999, sequence: false })).toEqual([]);
    expect(await finishedFileWarnings({ platform: 'myspace', output: file, seconds: 9999, sequence: false })).toEqual([]);
    expect(await finishedFileWarnings({ platform: 'x', output: file, seconds: 9999, sequence: true })).toEqual([]);
    expect(await finishedFileWarnings({ platform: 'x', output: join(dir, 'gone.mp4'), seconds: 9999, sequence: false })).toEqual([]);
  });
});
