import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TO_TYPE,
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
