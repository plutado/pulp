/**
 * The subtitle files beside a render (milestone 50): cues from the caption
 * lines, timed against the rendered stretch, and the two formats' text.
 */

import { describe, expect, it } from 'vitest';
import { captionsFromWords, type CaptionWord } from '../src/core/captions';
import { captionTrackOutputPath, srtText, subtitleCues, subtitleOutputPaths, vttText } from '../src/core/subtitles';

const words = (texts: string[], from: number): CaptionWord[] => texts.map((text, i) => ({ text, start: from + i * 0.5, end: from + i * 0.5 + 0.4 }));
const captions = captionsFromWords([...words(['Hello', 'there.'], 1), ...words(['Second', 'line'], 3)], 'style');

describe('cues from the lines', () => {
  it('starts a cue when the line does, holds it to its last word, and never into the next cue', () => {
    const cues = subtitleCues(captions, { from: 0, to: 10 });
    expect(cues).toEqual([
      { start: 1, end: 1.9, text: 'Hello there.' },
      { start: 3, end: 3.9, text: 'Second line' },
    ]);
  });

  it('holds a one-word line a readable moment, but stops at the line after it', () => {
    const quick = captionsFromWords([{ text: 'Go.', start: 0, end: 0.1 }, { text: 'Now', start: 0.3, end: 0.6 }], null);
    const cues = subtitleCues(quick, { from: 0, to: 5 });
    expect(cues[0]!.end).toBe(0.3);
    const alone = captionsFromWords([{ text: 'Go.', start: 0, end: 0.1 }], null);
    expect(subtitleCues(alone, { from: 0, to: 5 })[0]!.end).toBe(0.5);
  });

  it('shifts the cues by a trimmed render\'s in point and drops what lies outside it', () => {
    const cues = subtitleCues(captions, { from: 2.5, to: 3.5 });
    expect(cues).toEqual([{ start: 0.5, end: 1, text: 'Second line' }]);
    expect(subtitleCues(captions, { from: 5, to: 9 })).toEqual([]);
  });
});

describe('the two formats', () => {
  const cues = subtitleCues(captions, { from: 0, to: 10 });

  it('writes SubRip with numbered cues and a comma before the milliseconds', () => {
    expect(srtText(cues)).toBe('1\n00:00:01,000 --> 00:00:01,900\nHello there.\n\n2\n00:00:03,000 --> 00:00:03,900\nSecond line\n');
  });

  it('writes WebVTT with its header and a full stop before the milliseconds', () => {
    expect(vttText(cues)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:01.900\nHello there.\n\n00:00:03.000 --> 00:00:03.900\nSecond line\n');
    expect(vttText([{ start: 3661.25, end: 3662, text: 'Late' }])).toContain('01:01:01.250 --> 01:01:02.000');
  });

  it('goes beside the render by its own name, a sequence\'s pattern dropped', () => {
    expect(subtitleOutputPaths('/out/piece.mp4')).toEqual({ srt: '/out/piece.srt', vtt: '/out/piece.vtt' });
    expect(subtitleOutputPaths('/out/piece_%05d.png')).toEqual({ srt: '/out/piece.srt', vtt: '/out/piece.vtt' });
    expect(subtitleOutputPaths('C:\\out\\piece.mov').srt).toBe('C:\\out\\piece.srt');
    expect(captionTrackOutputPath('/out/piece.mp4')).toBe('/out/piece-captions.mov');
    expect(captionTrackOutputPath('/out/piece_%05d.png')).toBe('/out/piece-captions.mov');
  });
});
