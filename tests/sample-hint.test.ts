import { describe, expect, it } from 'vitest';
import { sampleHint, sampleHintOutcome } from '../src/core/sample-hint';
import { BROWSE_CATEGORIES, categoryOfType, categoryScope, scopeTypes, typeScope } from '../src/core/categories';
import { SAMPLE_MEDIA, sampleCountsByType, samplesForTypes, unmadeSampleCounts } from '../src/core/sample-media';
import type { Scope } from '../src/core/app-state';

const category = (id: string) => categoryScope(BROWSE_CATEGORIES.find((c) => c.id === id)!)!;
/** Nothing made at all: every catalogue file is still to make. */
const nothingMade = sampleCountsByType();

describe('scopeTypes', () => {
  it('gives a category its own types and a type node the one it is', () => {
    expect(scopeTypes(category('music'))).toEqual(['full-mix', 'stems', 'sting']);
    expect(scopeTypes(typeScope('whoosh'))).toEqual(['whoosh']);
    // Nowhere in the taxonomy: a folder, Favorites, Matching sets (which gathers packs).
    expect(scopeTypes(null)).toEqual([]);
    expect(scopeTypes({ label: 'Favorites', filter: 'favorite:yes', kind: 'favorites' })).toEqual([]);
    expect(scopeTypes(category('matching-sets'))).toEqual([]);
  });
});

describe('the sample-media catalogue by category', () => {
  it('puts every file in a category the browse tree shows', () => {
    for (const item of SAMPLE_MEDIA) expect(categoryOfType(item.type), `${item.type} (${item.file})`).toBeDefined();
  });

  it('counts a category as the sum of its types, and the whole catalogue over all of them', () => {
    const sfx = samplesForTypes(scopeTypes(category('sound-effects')));
    expect(sfx.length).toBeGreaterThan(0);
    expect(sfx.every((i) => scopeTypes(category('sound-effects')).includes(i.type))).toBe(true);
    const everyCategory = BROWSE_CATEGORIES.flatMap((c) => samplesForTypes(c.types));
    expect(everyCategory).toHaveLength(SAMPLE_MEDIA.length);
    // Asked for nothing, it offers nothing — never the whole catalogue by accident.
    expect(samplesForTypes([])).toEqual([]);
  });
});

describe('sampleHint', () => {
  it('says how many are left for the category being browsed, and what the button would make', () => {
    const music = category('music');
    const hint = sampleHint(music, nothingMade)!;
    const total = samplesForTypes(scopeTypes(music)).length;
    expect(hint.count).toBe(total);
    expect(hint.label).toBe(`${total} more with sample media`);
    expect(hint.action).toBe('Make them');
    // Just this category, never the catalogue.
    expect(hint.types).toEqual(['full-mix', 'stems', 'sting']);
    expect(hint.tip).toContain('Music');
    expect(hint.tip).toContain('not the whole catalogue');
  });

  it('counts only what is left, and goes once nothing is', () => {
    const music = category('music');
    const left = { ...nothingMade, 'full-mix': 2, stems: 0 };
    delete (left as Record<string, number>).sting;
    expect(sampleHint(music, left)!.count).toBe(2);
    expect(sampleHint(music, left)!.label).toBe('2 more with sample media');
    // All made: no line and no button, so nobody is offered more than there is.
    expect(sampleHint(music, {})).toBeNull();
    expect(sampleHint(music, { 'full-mix': 0, stems: 0, sting: 0 })).toBeNull();
  });

  it('counts a type node as that type alone', () => {
    const hint = sampleHint(typeScope('whoosh'), nothingMade)!;
    expect(hint.count).toBe(samplesForTypes(['whoosh']).length);
    expect(hint.types).toEqual(['whoosh']);
  });

  it('says nothing where sample media has nothing to add', () => {
    // The template-only categories: the catalogue holds no files for them, so the line never shows.
    for (const id of ['lower-thirds', 'titles-openers', 'end-cards', 'transitions-wipes']) {
      expect(sampleHint(category(id), nothingMade), id).toBeNull();
    }
    // And nowhere that is not a place in the taxonomy.
    expect(sampleHint(null, nothingMade)).toBeNull();
    const folder: Scope = { label: 'My clips', root: '/clips', kind: 'folder' };
    expect(sampleHint(folder, nothingMade)).toBeNull();
  });

  it('names one file in the singular', () => {
    expect(sampleHint(typeScope('whoosh'), { whoosh: 1 })!.label).toBe('1 more with sample media');
    expect(sampleHint(typeScope('whoosh'), { whoosh: 1 })!.tip).toContain('1 original CC0 file ');
  });
});

describe('sampleHintOutcome', () => {
  it('says what a run wrote, and what it could not', () => {
    expect(sampleHintOutcome(20, 0)).toBe('Made 20 files.');
    expect(sampleHintOutcome(1, 0)).toBe('Made 1 file.');
    expect(sampleHintOutcome(18, 2)).toBe('Made 18 files. 2 could not be made.');
    // Nothing written and nothing failed: the files were already there.
    expect(sampleHintOutcome(0, 0)).toBe('Nothing left to make.');
  });
});

describe('unmadeSampleCounts', () => {
  it('counts what is not there, and leaves a finished type out', () => {
    // Nothing made: every type the catalogue fills is counted, at its full depth.
    expect(unmadeSampleCounts(() => false)).toEqual(sampleCountsByType());
    // Everything made: no keys at all, which the hint reads as nothing to offer.
    expect(unmadeSampleCounts(() => true)).toEqual({});
    // Partly made: a type whose files are all there is absent rather than zero.
    const whooshes = samplesForTypes(['whoosh']);
    const counts = unmadeSampleCounts((item) => item.type === 'whoosh' || item === samplesForTypes(['impact'])[0]);
    expect(counts.whoosh).toBeUndefined();
    expect(counts.impact).toBe(samplesForTypes(['impact']).length - 1);
    expect(whooshes.length).toBeGreaterThan(0);
  });
});
