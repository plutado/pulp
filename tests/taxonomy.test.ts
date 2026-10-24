import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TO_TYPE,
  groupChildThemes,
  inferMediaType,
  inferThemes,
  isBuiltInStyle,
  isBuiltInTheme,
  isBuiltInType,
  normalizeTheme,
  splitThemes,
  STYLES,
  TAXONOMY_VERSION,
  templateType,
  THEME_GROUPS,
  TYPE_GROUPS,
  TYPES,
  typeInfo,
} from '../src/core/taxonomy';
import { TEMPLATE_CATEGORIES } from '../src/core/manifest';

describe('taxonomy lists', () => {
  it('is versioned', () => {
    expect(TAXONOMY_VERSION).toBe(1);
  });

  it('type ids are unique and every type belongs to a declared group', () => {
    const ids = TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(TYPE_GROUPS.map((g) => g.id));
    for (const t of TYPES) expect(groups.has(t.group), `${t.id} in ${t.group}`).toBe(true);
    expect(new Set(TYPE_GROUPS.map((g) => g.id)).size).toBe(TYPE_GROUPS.length);
  });

  it('theme ids are unique across groups; style ids are unique', () => {
    const themes = THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.id));
    expect(new Set(themes).size).toBe(themes.length);
    const styles = STYLES.map((s) => s.id);
    expect(new Set(styles).size).toBe(styles.length);
  });

  it('every id is already in normalized form', () => {
    for (const id of [...TYPES.map((t) => t.id), ...THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.id)), ...STYLES.map((s) => s.id)]) {
      expect(normalizeTheme(id)).toBe(id);
    }
  });
});

describe('category mapping', () => {
  it('covers every manifest category and maps onto real types', () => {
    for (const category of TEMPLATE_CATEGORIES) {
      expect(category in CATEGORY_TO_TYPE, category).toBe(true);
      const type = CATEGORY_TO_TYPE[category];
      if (type !== undefined) expect(isBuiltInType(type), `${category} -> ${type}`).toBe(true);
    }
    expect(CATEGORY_TO_TYPE.other).toBeUndefined();
  });

  it('templateType prefers the declared type and falls back to the category', () => {
    expect(templateType({ category: 'transition' })).toBe('wipe');
    expect(templateType({ type: 'glitch', category: 'transition' })).toBe('glitch');
    expect(templateType({ category: 'other' })).toBeUndefined();
  });
});

describe('folder inference', () => {
  it('types media from the deepest folder that names a type in the kind\'s groups', () => {
    expect(inferMediaType('audio', ['sfx', 'whoosh'])).toBe('whoosh');
    expect(inferMediaType('audio', ['music', 'stings'])).toBe('sting');
    expect(inferMediaType('audio', ['stems'])).toBe('stems');
    // A folder that names a type of another kind does not type this one.
    expect(inferMediaType('video', ['sfx', 'whoosh'])).toBeUndefined();
    expect(inferMediaType('video', ['stock-footage'])).toBe('stock-footage');
    expect(inferMediaType('image', ['photos'])).toBe('photo');
    expect(inferMediaType('image', ['illustrations', 'icons'])).toBe('icons'); // deepest folder wins
    expect(inferMediaType('image', ['icons', 'illustrations'])).toBe('illustration');
    // No folder, no type: the kind alone does not justify one.
    expect(inferMediaType('video', [])).toBeUndefined();
  });

  it('labels work as folder names too: "Sound effects/Impact / hit"', () => {
    expect(inferMediaType('audio', ['sound-effects', 'impact-hit'])).toBe('impact');
    expect(inferMediaType('audio', ['hits'])).toBe('impact');
    expect(inferMediaType('audio', ['whooshes'])).toBe('whoosh');
    expect(inferMediaType('image', ['icon'])).toBe('icons');
  });

  it('video can be a background, overlay, transition, title or element; images a background, texture, frame or icon', () => {
    expect(inferMediaType('video', ['backgrounds'])).toBe('animated-loop');
    expect(inferMediaType('video', ['backgrounds', 'loops'])).toBe('animated-loop');
    expect(inferMediaType('video', ['overlays', 'light-leaks'])).toBe('light-particles');
    expect(inferMediaType('video', ['overlays'])).toBe('overlay');
    expect(inferMediaType('video', ['transitions'])).toBe('wipe');
    expect(inferMediaType('video', ['transitions', 'glitches'])).toBe('glitch');
    expect(inferMediaType('video', ['lower-thirds'])).toBe('lower-third');
    expect(inferMediaType('video', ['titles-and-text', 'openers'])).toBe('opener');
    expect(inferMediaType('video', ['b-roll'])).toBe('stock-footage');
    expect(inferMediaType('image', ['textures'])).toBe('texture');
    expect(inferMediaType('image', ['backgrounds'])).toBe('still-background');
    expect(inferMediaType('image', ['frames'])).toBe('frame');
    expect(inferMediaType('image', ['overlays', 'borders'])).toBe('frame');
    expect(inferMediaType('image', ['design-elements', 'icons'])).toBe('icons');
    expect(inferMediaType('audio', ['music'])).toBe('full-mix');
    // A whole-group folder with no plain member stays untyped; a stills folder does not type a wav.
    expect(inferMediaType('audio', ['sfx'])).toBeUndefined();
    expect(inferMediaType('audio', ['photos'])).toBeUndefined();
  });

  it('collects built-in themes along the path, in order', () => {
    expect(inferThemes(['sports', 'hockey', 'b-roll'])).toEqual(['sports', 'hockey']);
    expect(inferThemes(['news-broadcast'])).toEqual(['news']);
    expect(inferThemes(['broadcast'])).toEqual(['news']);
    expect(inferThemes(['my-show'])).toEqual([]);
  });
});

describe('membership and custom themes', () => {
  it('answers for all three axes', () => {
    expect(isBuiltInType('lower-third')).toBe(true);
    expect(isBuiltInType('corporate')).toBe(false);
    expect(typeInfo('whoosh')?.group).toBe('sfx');
    expect(isBuiltInTheme('news')).toBe(true);
    expect(isBuiltInTheme('my-show')).toBe(false);
    expect(isBuiltInStyle('grunge')).toBe(true);
    expect(isBuiltInStyle('news')).toBe(false);
  });

  it('normalizes user themes like tags and splits built-in from custom', () => {
    expect(normalizeTheme('  My Show ')).toBe('my-show');
    expect(splitThemes(['news', 'my-show', 'corporate', 'club-23'])).toEqual({
      builtIn: ['news', 'corporate'],
      custom: ['my-show', 'club-23'],
    });
  });
});

describe('theme groups', () => {
  it('never give a group a child that repeats it', () => {
    for (const group of THEME_GROUPS) {
      for (const child of groupChildThemes(group)) {
        expect(child.label, `${group.label} › ${child.label}`).not.toBe(group.label);
        // "Sports (general)" and the like: a child saying it is the group in other words.
        expect(child.label.toLowerCase(), `${group.label} › ${child.label}`).not.toContain(`${group.label.toLowerCase()} (`);
        expect(child.id, `${group.label} › ${child.id}`).not.toBe(group.id);
      }
      // Where the vocabulary has a word for the group itself, it is the group's own.
      if (group.general !== undefined) {
        expect(group.themes.map((t) => t.id)).toContain(group.general);
        expect(groupChildThemes(group).map((t) => t.id)).not.toContain(group.general);
      }
    }
  });
});
