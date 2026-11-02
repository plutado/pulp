/**
 * The captions layer's arithmetic (milestone 50): how speech becomes lines,
 * which line and which word a moment belongs to, and what the three edits do
 * to the timings — the promise the feature rests on is that editing the words
 * never moves when they were said.
 */

import { describe, expect, it } from 'vitest';
import {
  captionFrame, captionLineAt, captionsDuration, captionsFromWords, captionsWordCount, lineEnd, lineStart, lineText,
  linesFromWords, sanitizeCaptions, spokenWordAt, spreadWords, withCaptionStyle, withLinesMerged, withLineSplit,
  withLineText, type CaptionWord,
} from '../src/core/captions';
import { captionsIn, withCaptions } from '../src/core/params';

/** Words a tenth of a second apart, each a fifth of a second long: ordinary speech. */
function speech(texts: readonly string[], from = 0, gap = 0.1, length = 0.3): CaptionWord[] {
  let at = from;
  return texts.map((text) => {
    const word = { text, start: Math.round(at * 1000) / 1000, end: Math.round((at + length) * 1000) / 1000 };
    at += length + gap;
    return word;
  });
}

describe('breaking speech into lines', () => {
  it('breaks on length, keeping whole words', () => {
    const words = speech(['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
    const lines = linesFromWords(words, { maxChars: 12, pauseSeconds: 5 });
    for (const line of lines) expect(lineText(line).length).toBeLessThanOrEqual(12);
    expect(lines.flatMap((l) => l.words.map((w) => w.text))).toEqual(words.map((w) => w.text));
  });

  it('breaks on a pause, however short the line is', () => {
    const words = [
      ...speech(['right', 'then']),
      ...speech(['next', 'thing'], 4),
    ];
    const lines = linesFromWords(words, { maxChars: 80, pauseSeconds: 0.6 });
    expect(lines.map(lineText)).toEqual(['right then', 'next thing']);
  });

  it('breaks at the end of a sentence', () => {
    const lines = linesFromWords(speech(['Done.', 'Now', 'this']), { maxChars: 80, pauseSeconds: 5 });
    expect(lines.map(lineText)).toEqual(['Done.', 'Now this']);
  });

  it('keeps every word\'s own timing, and a line is its words', () => {
    const words = speech(['a', 'b', 'c']);
    const [line] = linesFromWords(words, { maxChars: 80, pauseSeconds: 5 });
    expect(line!.words).toEqual(words);
    expect(lineStart(line!)).toBe(words[0]!.start);
    expect(lineEnd(line!)).toBe(words[2]!.end);
  });

  it('gives a word longer than the whole allowance a line of its own rather than cutting it', () => {
    const lines = linesFromWords(speech(['supercalifragilistic', 'ok']), { maxChars: 12, pauseSeconds: 5 });
    expect(lines.map(lineText)).toEqual(['supercalifragilistic', 'ok']);
  });
});

describe('which line, and which word', () => {
  const captions = captionsFromWords(speech(['one', 'two', 'three'], 1), 'style', { maxChars: 9, pauseSeconds: 5 });

  it('finds the line a moment is in, and nothing before the first or after the last', () => {
    expect(captionLineAt(captions, 0.5)).toBeNull();
    expect(captionLineAt(captions, 1.1)).toBe(0);
    expect(captionLineAt(captions, captionsDuration(captions) + 0.1)).toBeNull();
  });

  it('highlights the word being spoken, and keeps it through the gap to the next', () => {
    const line = captions.lines[0]!;
    expect(spokenWordAt(line, line.words[0]!.start - 0.01)).toBe(-1);
    expect(spokenWordAt(line, line.words[0]!.start)).toBe(0);
    // Between the first word's end and the second's start the first keeps it: no flicker.
    expect(spokenWordAt(line, line.words[0]!.end + 0.01)).toBe(0);
    expect(spokenWordAt(line, line.words[1]!.start + 0.01)).toBe(1);
  });

  it('hands a frame the line, the spoken word and the band to draw it in', () => {
    const box = { x: 10, y: 20, width: 100, height: 40 };
    const frame = captionFrame(captions, 1.45, box);
    expect(frame.line?.text).toBe(lineText(captions.lines[0]!));
    expect(frame.spoken).toBe(1);
    expect(frame.box).toEqual(box);
    expect(captionFrame(captions, 0.2, box).line).toBeNull();
  });
});

describe('editing the words keeps the timings', () => {
  const captions = captionsFromWords(speech(['teh', 'quick', 'brown', 'fox']), null, { maxChars: 80, pauseSeconds: 5 });

  it('keeps every timing when the words are corrected one for one', () => {
    const fixed = withLineText(captions, 0, 'the quick brown fox');
    expect(fixed.lines[0]!.words.map((w) => w.text)).toEqual(['the', 'quick', 'brown', 'fox']);
    expect(fixed.lines[0]!.words.map((w) => [w.start, w.end])).toEqual(captions.lines[0]!.words.map((w) => [w.start, w.end]));
  });

  it('spreads the line\'s own stretch over the words when the count changes, keeping both ends', () => {
    const edited = withLineText(captions, 0, 'the quick fox');
    const line = edited.lines[0]!;
    expect(line.words.map((w) => w.text)).toEqual(['the', 'quick', 'fox']);
    expect(lineStart(line)).toBe(lineStart(captions.lines[0]!));
    expect(lineEnd(line)).toBe(lineEnd(captions.lines[0]!));
    for (let i = 1; i < line.words.length; i++) expect(line.words[i]!.start).toBeGreaterThanOrEqual(line.words[i - 1]!.start);
  });

  it('emptying a line removes it, which is how a line is deleted', () => {
    expect(withLineText(captions, 0, '   ').lines).toHaveLength(0);
  });

  it('does nothing, by identity, when the words have not changed', () => {
    expect(withLineText(captions, 0, lineText(captions.lines[0]!))).toBe(captions);
    expect(withLineText(captions, 7, 'nowhere')).toBe(captions);
  });

  it('splits at the word boundary nearest the caret, both halves keeping their timings', () => {
    const split = withLineSplit(captions, 0, 'teh quick '.length);
    expect(split.lines.map(lineText)).toEqual(['teh quick', 'brown fox']);
    expect(split.lines[0]!.words).toEqual(captions.lines[0]!.words.slice(0, 2));
    expect(split.lines[1]!.words).toEqual(captions.lines[0]!.words.slice(2));
  });

  it('never splits a line of one word, and says so by identity', () => {
    const one = captionsFromWords(speech(['alone']), null);
    expect(withLineSplit(one, 0, 3)).toBe(one);
  });

  it('merges a line with the one after it, and nothing on the last', () => {
    const two = withLineSplit(captions, 0, 'teh quick '.length);
    const merged = withLinesMerged(two, 0);
    expect(merged.lines.map(lineText)).toEqual([lineText(captions.lines[0]!)]);
    expect(merged.lines[0]!.words).toEqual(captions.lines[0]!.words);
    expect(withLinesMerged(two, 1)).toBe(two);
  });

  it('changes the style on its own, and says when nothing changed', () => {
    expect(withCaptionStyle(captions, 'pulp.samples.caption-pop').style).toBe('pulp.samples.caption-pop');
    expect(withCaptionStyle(captions, null)).toBe(captions);
    expect(withCaptionStyle(captions, '  ')).toBe(captions);
  });
});

describe('spreading text over a stretch of time', () => {
  it('starts at the start, ends at the end, and gives the longer words more of it', () => {
    const words = spreadWords('a longerword', 2, 4);
    expect(words[0]!.start).toBe(2);
    expect(words[1]!.end).toBe(4);
    expect(words[1]!.end - words[1]!.start).toBeGreaterThan(words[0]!.end - words[0]!.start);
  });

  it('has nothing to spread over nothing', () => {
    expect(spreadWords('   ', 0, 1)).toEqual([]);
  });
});

describe('what is stored', () => {
  it('reads back what it wrote, and rides with the parameters under @captions', () => {
    const captions = captionsFromWords(speech(['hello', 'there']), 'pulp.samples.caption-clean');
    const bag = withCaptions({ headline: 'x' }, captions);
    expect(bag['@captions']).toEqual(captions);
    expect(captionsIn(bag)).toEqual(captions);
    expect(captionsIn(withCaptions(bag, null))).toBeNull();
  });

  it('throws nothing away that can be read, and nothing at all that cannot', () => {
    const value = sanitizeCaptions({
      style: ' pulp.samples.caption-pop ',
      lines: [
        { words: [{ text: ' Hello ', start: 1.00049, end: 1.4 }, { text: '', start: 2 }, { text: 'there', start: 'soon' }] },
        { words: [] },
        { words: [{ text: 'again', start: 2, end: 1 }] },
        'not a line',
      ],
    });
    expect(value).toEqual({
      style: 'pulp.samples.caption-pop',
      lines: [{ words: [{ text: 'Hello', start: 1, end: 1.4 }] }, { words: [{ text: 'again', start: 2, end: 2 }] }],
    });
    expect(captionsWordCount(value!)).toBe(2);
  });

  it('is nothing at all when there are no words, or no captions', () => {
    expect(sanitizeCaptions({ style: 'x', lines: [] })).toBeNull();
    expect(sanitizeCaptions({ lines: 'words' })).toBeNull();
    expect(sanitizeCaptions(null)).toBeNull();
    expect(sanitizeCaptions(7)).toBeNull();
  });
});
