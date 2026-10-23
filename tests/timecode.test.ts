import { describe, expect, it } from 'vitest';
import {
  formatTimecode,
  fpsToRational,
  isStandardFrameRate,
  nominalRate,
  parseTimecode,
  STANDARD_FRAME_RATES,
  standardFrameRate,
  TimecodeError,
  timecodePattern,
} from '../src/core/timecode';

describe('standard frame rates', () => {
  it('covers film, PAL/SECAM, NTSC and their high-frame-rate multiples', () => {
    expect(STANDARD_FRAME_RATES.map((r) => r.fps)).toEqual([23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120]);
    expect(STANDARD_FRAME_RATES.map((r) => r.fps)).toEqual([...STANDARD_FRAME_RATES.map((r) => r.fps)].sort((a, b) => a - b));
  });

  it('matches to three decimals and rejects anything else', () => {
    expect(standardFrameRate(29.97)?.rational).toBe('30000/1001');
    expect(standardFrameRate(29.9700004)?.fps).toBe(29.97);
    expect(isStandardFrameRate(31)).toBe(false);
    expect(isStandardFrameRate(12.5)).toBe(false);
  });

  it('gives exact rationals for NTSC rates and plain numbers otherwise', () => {
    expect(fpsToRational(23.976)).toBe('24000/1001');
    expect(fpsToRational(47.952)).toBe('48000/1001');
    expect(fpsToRational(59.94)).toBe('60000/1001');
    expect(fpsToRational(119.88)).toBe('120000/1001');
    expect(fpsToRational(25)).toBe('25');
    expect(fpsToRational(12.5)).toBe('12.5');
  });

  it('counts timecode frames to the nominal integer rate', () => {
    expect(nominalRate(29.97)).toBe(30);
    expect(nominalRate(119.88)).toBe(120);
    expect(nominalRate(12.5)).toBe(13);
    expect(timecodePattern(30)).toBe('HH:MM:SS:FF');
    expect(timecodePattern(120)).toBe('HH:MM:SS:FFF');
  });
});

describe('parseTimecode', () => {
  it('reads frame numbers, seconds and timecode', () => {
    expect(parseTimecode('90', 30)).toBe(90);
    expect(parseTimecode('2.5s', 30)).toBe(75);
    expect(parseTimecode('00:00:03:00', 30)).toBe(90);
    expect(parseTimecode('1:02:03:04', 25)).toBe(((1 * 60 + 2) * 60 + 3) * 25 + 4);
    expect(parseTimecode('03:00', 30)).toBe(90);
    expect(parseTimecode('1:00:00', 24)).toBe(60 * 24);
  });

  it('uses a three-digit frames field above 99 fps', () => {
    expect(parseTimecode('00:00:01:119', 120)).toBe(239);
    expect(parseTimecode('00:00:01:119', 119.88)).toBe(239);
    expect(() => parseTimecode('00:00:00:120', 120)).toThrow(/frames field must be below 120 at 120 fps/);
  });

  it('converts drop-frame timecode for the NTSC rates', () => {
    // One minute of 29.97 drop-frame: numbers 0 and 1 are skipped, so 00:01:00;02 is frame 1800.
    expect(parseTimecode('00:01:00;02', 29.97)).toBe(1800);
    expect(parseTimecode('00:10:00;00', 29.97)).toBe(17982);
    expect(parseTimecode('00:01:00;04', 59.94)).toBe(3600);
    expect(parseTimecode('00:01:00;08', 119.88)).toBe(7200);
    expect(() => parseTimecode('00:01:00;00', 29.97)).toThrow(/does not exist in drop-frame timecode/);
    expect(() => parseTimecode('00:01:00;00', 25)).toThrow(/only defined for 29.97, 59.94 and 119.88/);
  });

  it('rejects malformed input with a message naming the accepted forms', () => {
    expect(() => parseTimecode('soon', 30)).toThrow(TimecodeError);
    expect(() => parseTimecode('soon', 30)).toThrow(/not a frame number, seconds \("2.5s"\) or timecode \(HH:MM:SS:FF\)/);
    expect(() => parseTimecode('00:61:00:00', 30)).toThrow(/below 60/);
    expect(() => parseTimecode('00:00:00:30', 30)).toThrow(/below 30 at 30 fps/);
    expect(() => parseTimecode('1:2:3:4:5', 30)).toThrow(TimecodeError);
  });
});

describe('formatTimecode', () => {
  it('formats non-drop timecode and round-trips with parseTimecode', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
    expect(formatTimecode(90, 30)).toBe('00:00:03:00');
    expect(formatTimecode(89, 30)).toBe('00:00:02:29');
    expect(formatTimecode(239, 120)).toBe('00:00:01:119');
    for (const [frames, fps] of [[0, 25], [12345, 25], [100000, 23.976], [999, 60], [54321, 120]] as const) {
      expect(parseTimecode(formatTimecode(frames, fps), fps)).toBe(frames);
    }
  });

  it('formats drop-frame timecode and round-trips with parseTimecode', () => {
    expect(formatTimecode(1800, 29.97, true)).toBe('00:01:00;02');
    expect(formatTimecode(17982, 29.97, true)).toBe('00:10:00;00');
    expect(formatTimecode(3600, 59.94, true)).toBe('00:01:00;04');
    for (const frames of [0, 1, 1799, 1800, 1801, 17981, 17982, 107892, 215784]) {
      expect(parseTimecode(formatTimecode(frames, 29.97, true), 29.97)).toBe(frames);
    }
    for (const frames of [0, 3599, 3600, 35964, 100000]) {
      expect(parseTimecode(formatTimecode(frames, 59.94, true), 59.94)).toBe(frames);
    }
    // Drop-frame asked for at a rate without it falls back to non-drop.
    expect(formatTimecode(1800, 25, true)).toBe('00:01:12:00');
  });
});
