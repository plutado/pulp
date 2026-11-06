/**
 * British spelling (milestone 59, src/core/spelling.ts): the rules the British
 * catalog is held to and the British user guide is made with. What a person
 * reads changes; what a person types or a file is called does not.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { britishSpelling, usSpellingsIn } from '../src/core/spelling';

describe('British spelling', () => {
  it('changes the words that differ, keeping their capitals', () => {
    expect(britishSpelling('Color')).toBe('Colour');
    expect(britishSpelling('COLOR')).toBe('COLOUR');
    expect(britishSpelling('the gray background, centered')).toBe('the grey background, centred');
    expect(britishSpelling('Favorites only')).toBe('Favourites only');
    expect(britishSpelling('Theater: the stage takes the window')).toBe('Theatre: the stage takes the window');
    expect(britishSpelling('Mid-gray: the neutral')).toBe('Mid-grey: the neutral');
    expect(britishSpelling('dark-gray and color-coded (colors).')).toBe('dark-grey and colour-coded (colours).');
  });

  it('leaves the words Britain spells the same: the verb license, a meter, a program', () => {
    expect(britishSpelling('licensed under the license')).toBe('licensed under the licence');
    expect(britishSpelling('a level meter in a program')).toBe('a level meter in a program');
  });

  it('leaves what is typed or named: inline code, a filter, a file, a path, a flag, a longer word', () => {
    expect(britishSpelling('Pack license: {license}, {favorites} favorites')).toBe('Pack licence: {license}, {favorites} favourites');
    for (const typed of ['a `favorite:` filter', 'favorite:yes', 'color-wash.png', 'docs/color.md', '--color red', 'colorspace', 'snake_color']) {
      expect(britishSpelling(typed), typed).toBe(typed);
    }
  });

  it('finds the US spellings left in prose, and none in text already British', () => {
    expect(usSpellingsIn('A gray `color` and favorite:yes, colored')).toEqual(['gray', 'colored']);
    expect(usSpellingsIn(britishSpelling('A gray color, centered on the favorites.'))).toEqual([]);
  });
});

describe('the user guide in British English', () => {
  const guide = readFileSync(join(__dirname, '..', 'docs', 'user-guide.md'), 'utf8');

  it('is the source guide with every US spelling in its prose changed, and nothing else', () => {
    const british = britishSpelling(guide);
    expect(usSpellingsIn(british)).toEqual([]);
    expect(british).not.toBe(guide);
    // Only words change: the same lines, the same code, the same filters and file names.
    expect(british.split('\n').length).toBe(guide.split('\n').length);
    const code = (text: string) => [...text.matchAll(/`[^`]*`/g)].map((m) => m[0]);
    expect(code(british)).toEqual(code(guide));
  });
});
