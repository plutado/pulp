/**
 * Milestone 24's rule: every type, theme and style in the browse tree has at
 * least **six** examples across the bundled templates and the sample-media
 * catalogue, and no upper limit — a category people reach for may go as deep
 * as it likes. (Milestone 21's band was three to five; the upper bound was
 * never the point, and this milestone removed it and raised the floor.)
 * Milestone 36 raised the floor for **types** to **ten**: a type with six
 * things in it reads as empty. Themes keep six here (six of the sports and
 * holiday themes sit at nine) and have their own rule for assets below.
 *
 * The still-open lists below are empty since the milestone landed: a new
 * type, theme or style goes on its list until its examples do, and comes off
 * the moment it reaches its floor.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { SAMPLE_MEDIA } from '../src/core/sample-media';
import { normalizeTag } from '../src/core/tags';
import { BROWSE_CATEGORIES, categoryInfo, categoryOfEntry } from '../src/core/categories';
import { placeableTemplate } from '../src/core/search';
import { entryType, inferThemes, STYLES, THEME_GROUPS, TYPE_GROUPS, TYPES, typeInfo } from '../src/core/taxonomy';

const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/** What every theme and style is worked towards (milestone 24). */
export const MINIMUM = 6;
/** What every type is worked towards (milestone 36): nothing in single digits. */
export const TYPE_MINIMUM = 10;

/** Types not yet six deep (ROADMAP.md, milestone 24). Only shrinks. */
const TYPES_STILL_OPEN = new Set<string>([]);

/**
 * Milestone 36's floors for the browse panel's top categories that read as empty at six: the
 * most used first. Keyed by the category (src/core/categories.ts), since a category may gather
 * several types — Still backgrounds holds the still backgrounds and the textures — and counted
 * the same way as everything here, over the templates and the catalogue together. These only
 * rise, and a category checked here never slips back under its floor. The two background
 * categories reached the decided 32 first (generated loops, stills and textures); the three
 * template categories' floors rise with their batches.
 */
export const CATEGORY_FLOORS: Record<string, number> = {
  'lower-thirds': 32,
  'end-cards': 32,
  'animated-backgrounds': 32,
  'still-backgrounds': 32,
  'overlays-frames': 32,
  // Raised past its first floor of twelve by the eight footage scenes with subjects of their own.
  'stock-video': 20,
};

/**
 * Milestone 44: Still backgrounds is at least this deep out of the box — bundled templates alone,
 * with no sample media made — so the one large category that was in single digits at first launch
 * is not. Counted over the templates only; the category floor above counts the catalogue too.
 */
export const BUNDLED_CATEGORY_FLOORS: Record<string, number> = {
  'still-backgrounds': 32,
  // Milestone 45: Effects opened on nothing but three Lottie animations out of the box.
  effects: 32,
  // Milestone 46: Objects opened on nothing at all.
  objects: 32,
};

/**
 * Milestone 45: every kind of effect has at least this many bundled templates, so no subtype of
 * the category opens empty — the thing milestone 36's type floors missed, since they counted the
 * sample media too and these asset types are drawn rather than generated.
 */
export const BUNDLED_SUBTYPE_FLOORS: Record<string, number> = {
  fire: 3, smoke: 3, sparks: 3, 'explosion-asset': 3, energy: 3,
  'light-asset': 3, 'weather-asset': 3, liquid: 3, confetti: 3, brush: 3,
  // Milestone 46: every kind of object as well.
  'sports-objects': 3, 'celebration-objects': 3, 'holiday-objects': 3, 'business-objects': 3, 'science-objects': 3,
  'media-objects': 3, 'nature-objects': 3, 'travel-objects': 3, 'home-objects': 3, 'community-objects': 3,
};

/**
 * Milestone 36's second batch: every generated type — the stills, music, sound effects, clips
 * and assets the catalogue draws and synthesizes, and the two background types it shares with
 * the bundled templates — is at least ten deep, counted as everything here is. The floor is the
 * groups', so a type added to one of these groups starts at ten rather than six.
 */
export const GENERATED_MINIMUM = 10;
const GENERATED_GROUPS = new Set(['video', 'stills', 'music', 'sfx', 'assets']);
const GENERATED_EXTRA_TYPES = ['still-background', 'texture'];

/**
 * Milestone 26's rule for the Assets group: every theme in the taxonomy has at least this many
 * assets tagged with it, so that a theme's node has props and effects to drop on a frame and
 * not only templates. Assets are generated media, so their themes come from their folders.
 */
export const ASSETS_PER_THEME = 3;

/** Themes not yet six deep. Only shrinks. */
const THEMES_STILL_OPEN = new Set<string>([]);

/** Styles not yet six deep. Only shrinks. */
const STYLES_STILL_OPEN = new Set<string>([]);

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
  for (const item of SAMPLE_MEDIA) {
    bump(types, item.type);
    // A generated file's themes come from its folders, exactly as the scan would read them.
    for (const theme of new Set(inferThemes(item.folder.map(normalizeTag)))) bump(themes, theme);
  }
  return { types, themes, styles };
}

const counts = tally();
const ALL_THEMES = THEME_GROUPS.flatMap((g) => g.themes);

describe('every category is at least its floor deep', () => {
  const cases: [axis: string, floor: number, ids: { id: string; label: string }[], counted: Map<string, number>, open: Set<string>][] = [
    ['type', TYPE_MINIMUM, TYPES.map((t) => ({ id: t.id, label: t.label })), counts.types, TYPES_STILL_OPEN],
    ['theme', MINIMUM, ALL_THEMES.map((t) => ({ id: t.id, label: t.label })), counts.themes, THEMES_STILL_OPEN],
    ['style', MINIMUM, STYLES.map((s) => ({ id: s.id, label: s.label })), counts.styles, STYLES_STILL_OPEN],
  ];

  for (const [axis, floor, ids, counted, open] of cases) {
    const ready = ids.filter((i) => !open.has(i.id));
    it.each(ready.map((i) => [i.id, i.label] as const))(`${axis} %s has ${floor} or more`, (id, label) => {
      expect(counted.get(id) ?? 0, `${label}: a category worth browsing is at least ${floor} deep`).toBeGreaterThanOrEqual(floor);
    });

    it(`names only ${axis}s that are really still short, and none outside the taxonomy`, () => {
      const known = new Set(ids.map((i) => i.id));
      for (const id of open) {
        expect(known.has(id), `${id} is not a ${axis} in the taxonomy`).toBe(true);
        expect(counted.get(id) ?? 0, `${id} has reached ${floor}: take it off the still-open list`).toBeLessThan(floor);
      }
    });
  }

  it.each(Object.entries(BUNDLED_CATEGORY_FLOORS))('the top category %s is at least %i deep with bundled templates alone (milestones 44 and 45)', (id, floor) => {
    const category = categoryInfo(id)!;
    const bundled = index.templates.filter((t) => categoryOfEntry(t)?.id === category.id);
    expect(bundled.length, `${category.label}: ${bundled.length} bundled templates`).toBeGreaterThanOrEqual(floor);
  });

  it.each(Object.entries(BUNDLED_SUBTYPE_FLOORS))('the asset kind %s has %i or more bundled templates (milestones 45 and 46)', (id, floor) => {
    const bundled = index.templates.filter((t) => entryType(t) === id);
    expect(bundled.length, `${typeInfo(id)?.label ?? id}: ${bundled.length} bundled templates`).toBeGreaterThanOrEqual(floor);
  });

  it('gives every bundled object its colours and a light entrance, draws it on transparency, and lets it be placed as a layer (milestone 46)', () => {
    const objects = index.templates.filter((t) => categoryInfo('objects')!.types.includes(entryType(t) ?? ''));
    expect(objects.length).toBeGreaterThanOrEqual(32);
    for (const t of objects) {
      const params = t.manifest.parameters;
      expect(params.filter((p) => p.type === 'color').length, `${t.manifest.id} has a colour to change`).toBeGreaterThanOrEqual(1);
      const entrance = params.find((p) => p.id === 'entrance');
      expect(entrance?.type, `${t.manifest.id} has an entrance`).toBe('select');
      const choices = (entrance as { options?: { value: string }[] } | undefined)?.options?.map((o) => o.value) ?? [];
      expect(choices, t.manifest.id).toEqual(expect.arrayContaining(['pop', 'drop', 'draw']));
      // It comes in, holds, and goes: a hold structure, so its length is the control.
      expect(t.manifest.structure && 'holdFrom' in t.manifest.structure, `${t.manifest.id} declares a hold`).toBe(true);
      expect(t.manifest.alpha, `${t.manifest.id} draws on transparency`).toBe(true);
      expect(placeableTemplate(t), `${t.manifest.id} can be placed as a layer`).toBe(true);
    }
  });

  it('gives every bundled effect its colour, speed, density and size, and alpha to lay it over anything (milestone 45)', () => {
    const effects = index.templates.filter((t) => categoryInfo('effects')!.types.includes(entryType(t) ?? ''));
    expect(effects.length).toBeGreaterThanOrEqual(32);
    for (const t of effects) {
      const ids = t.manifest.parameters.map((p) => p.id);
      // A Lottie's parameters are whatever its file exposes; a written effect declares the four.
      if (t.lottie !== undefined) continue;
      expect(ids, t.manifest.id).toEqual(expect.arrayContaining(['color', 'speed', 'density', 'size']));
      expect(t.manifest.alpha, `${t.manifest.id} draws on transparency`).toBe(true);
      // Every one can be laid on the stage as a layer: that is what an effect is for.
      expect(placeableTemplate(t), `${t.manifest.id} can be placed as a layer`).toBe(true);
    }
  });

  it.each(Object.entries(CATEGORY_FLOORS))('the top category %s is at least %i deep (milestone 36)', (id, floor) => {
    const category = BROWSE_CATEGORIES.find((c) => c.id === id);
    expect(category, `${id} is not a browse category`).toBeDefined();
    const total = category!.types.reduce((sum, type) => sum + (counts.types.get(type) ?? 0), 0);
    expect(total, `${category!.label}: a top category that reads as empty at six`).toBeGreaterThanOrEqual(floor);
  });

  const generated = [...TYPES.filter((t) => GENERATED_GROUPS.has(t.group)).map((t) => t.id), ...GENERATED_EXTRA_TYPES];
  it.each(generated)(`the generated type %s is at least ${GENERATED_MINIMUM} deep (milestone 36)`, (type) => {
    expect(typeInfo(type), type).toBeDefined();
    expect(counts.types.get(type) ?? 0, `${typeInfo(type)?.label}: a generated type the catalogue can always deepen`).toBeGreaterThanOrEqual(GENERATED_MINIMUM);
  });

  it('has no upper limit: a category may run as deep as it likes', () => {
    // Milestone 21 capped a type at five, which asked for a category to be split or trimmed just as
    // it became useful. Nothing here fails for being deep; the largest is simply reported.
    const deepest = [...counts.types.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(deepest?.[1] ?? 0).toBeGreaterThanOrEqual(TYPE_MINIMUM);
  });

  it('leaves no type group empty, once a group has any type that is not still open', () => {
    for (const group of TYPE_GROUPS) {
      const types = TYPES.filter((t) => t.group === group.id);
      if (types.every((t) => TYPES_STILL_OPEN.has(t.id))) continue;
      const filled = types.filter((t) => (counts.types.get(t.id) ?? 0) >= TYPE_MINIMUM);
      expect(filled.length, group.label).toBeGreaterThan(0);
    }
  });

  it(`gives every theme ${ASSETS_PER_THEME} or more assets`, () => {
    const perTheme = new Map<string, number>();
    for (const item of SAMPLE_MEDIA) {
      if (typeInfo(item.type)?.group !== 'assets') continue;
      for (const theme of new Set(inferThemes(item.folder.map(normalizeTag)))) perTheme.set(theme, (perTheme.get(theme) ?? 0) + 1);
    }
    for (const theme of ALL_THEMES) {
      expect(perTheme.get(theme.id) ?? 0, `${theme.label}: an asset or two of its own to place on a frame`).toBeGreaterThanOrEqual(ASSETS_PER_THEME);
    }
  });

  it('counts nothing outside the taxonomy', () => {
    for (const type of counts.types.keys()) expect(typeInfo(type), type).toBeDefined();
  });
});
