/**
 * Milestone 24's rule: every type, theme and style in the browse tree has at
 * least **six** examples across the bundled templates and the sample-media
 * catalogue, and no upper limit — a category people reach for may go as deep
 * as it likes. (Milestone 21's rule was three to five, which capped a category
 * just as it became useful; the cap is gone and the floor has risen.)
 *
 * While the milestone is open, the categories still to be filled are named
 * below. Those lists only shrink: a category that reaches six has to come off
 * its list, and the last test here fails if one is left on it.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { SAMPLE_MEDIA } from '../src/core/sample-media';
import { entryType, STYLES, THEME_GROUPS, TYPE_GROUPS, TYPES, typeInfo } from '../src/core/taxonomy';

const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/** What every category is worked towards (milestone 24). */
export const MINIMUM = 6;

/** Types not yet six deep (ROADMAP.md, milestone 24). Only shrinks. */
const TYPES_STILL_OPEN = new Set<string>([
  'opener', 'end-card', 'callout', 'social', 'lower-third', 'title',
  'still-background', 'texture', 'animated-loop',
  'reveal', 'flash', 'glitch', 'wipe',
  'frame', 'light-particles', 'film-grunge', 'logo-bug', 'vignette', 'overlay',
  'shapes', 'icons', 'arrows', 'infographic', 'counter', 'countdown',
  'stock-footage',
  'photo', 'illustration', 'layered-graphic',
  'full-mix', 'stems', 'sting',
  'ambience', 'impact', 'alarm', 'nature-weather', 'animals', 'vehicles', 'crowd',
  'foley', 'explosion', 'sci-fi', 'musical-phrase', 'whoosh', 'ui-tech',
]);

/** Themes not yet six deep. Only shrinks. */
const THEMES_STILL_OPEN = new Set<string>([
  'medical', 'legal', 'baseball', 'hockey', 'golf', 'tennis', 'motorsport', 'fitness',
  'easter', 'halloween', 'thanksgiving', 'patriotic', 'faith', 'ocean', 'weather', 'city', 'food',
  'social-media', 'memorial', 'nonprofit', 'civic', 'space',
  'science', 'education', 'kids', 'fashion',
  'gaming', 'family', 'nature',
  'summer', 'travel',
]);

/** Styles not yet six deep. Only shrinks. */
const STYLES_STILL_OPEN = new Set<string>(['corporate', 'elegant', 'hand-drawn', 'grunge', 'tech', 'organic', 'retro']);

const index = await scanLibrary([TEMPLATES_DIR]);

/** How many samples carry each type, theme and style: the templates and the catalogue together. */
function tally(): { types: Map<string, number>; themes: Map<string, number>; styles: Map<string, number> } {
  const types = new Map<string, number>();
  const themes = new Map<string, number>();
  const styles = new Map<string, number>();
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  for (const entry of [...index.templates, ...index.media]) {
    const type = entryType(entry);
    if (type) bump(types, type);
    // Each theme and style counts once per sample, however often the sample names it.
    for (const theme of new Set(entry.kind === 'template' ? entry.manifest.themes ?? [] : entry.themes ?? [])) bump(themes, theme);
    if (entry.kind === 'template') for (const style of new Set(entry.manifest.styles ?? [])) bump(styles, style);
  }
  for (const item of SAMPLE_MEDIA) bump(types, item.type);
  return { types, themes, styles };
}

const counts = tally();
const ALL_THEMES = THEME_GROUPS.flatMap((g) => g.themes);

describe(`every category is at least ${MINIMUM} deep`, () => {
  const cases: [axis: string, ids: { id: string; label: string }[], counted: Map<string, number>, open: Set<string>][] = [
    ['type', TYPES.map((t) => ({ id: t.id, label: t.label })), counts.types, TYPES_STILL_OPEN],
    ['theme', ALL_THEMES.map((t) => ({ id: t.id, label: t.label })), counts.themes, THEMES_STILL_OPEN],
    ['style', STYLES.map((s) => ({ id: s.id, label: s.label })), counts.styles, STYLES_STILL_OPEN],
  ];

  for (const [axis, ids, counted, open] of cases) {
    const ready = ids.filter((i) => !open.has(i.id));
    it.each(ready.map((i) => [i.id, i.label] as const))(`${axis} %s has ${MINIMUM} or more`, (id, label) => {
      expect(counted.get(id) ?? 0, `${label}: a category worth browsing is at least ${MINIMUM} deep`).toBeGreaterThanOrEqual(MINIMUM);
    });

    it(`names only ${axis}s that are really still short, and none outside the taxonomy`, () => {
      const known = new Set(ids.map((i) => i.id));
      for (const id of open) {
        expect(known.has(id), `${id} is not a ${axis} in the taxonomy`).toBe(true);
        expect(counted.get(id) ?? 0, `${id} has reached ${MINIMUM}: take it off the still-open list`).toBeLessThan(MINIMUM);
      }
    });
  }

  it('has no upper limit: a category may run as deep as it likes', () => {
    // Milestone 21 capped a type at five, which asked for a category to be split or trimmed just as
    // it became useful. Nothing here fails for being deep; the largest is simply reported.
    const deepest = [...counts.types.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(deepest?.[1] ?? 0).toBeGreaterThanOrEqual(MINIMUM);
  });

  it('leaves no type group empty, once a group has any type that is not still open', () => {
    for (const group of TYPE_GROUPS) {
      const types = TYPES.filter((t) => t.group === group.id);
      if (types.every((t) => TYPES_STILL_OPEN.has(t.id))) continue;
      const filled = types.filter((t) => (counts.types.get(t.id) ?? 0) >= MINIMUM);
      expect(filled.length, group.label).toBeGreaterThan(0);
    }
  });

  it('counts nothing outside the taxonomy', () => {
    for (const type of counts.types.keys()) expect(typeInfo(type), type).toBeDefined();
  });
});
