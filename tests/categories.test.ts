/**
 * The browse panel's categories (milestone 34): every taxonomy type has one
 * home, every category has a description and an icon the window knows, the
 * scopes read as the search does, and the cards and chips count what is there.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BROWSE_CATEGORIES, categoryCards, categoryOfType, categoryScope, forOptions, lookOptions, scopeCategory, typeScope, uncategorizedTypes,
} from '../src/core/categories';
import { searchLibrary } from '../src/core/search';
import { TYPES } from '../src/core/taxonomy';
import type { LibraryIndex, MediaEntry, TemplateEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';

const ROOT = join(__dirname, '..');

function template(key: string, over: Record<string, unknown> = {}, entry: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = validManifest({ id: `test.${key}`, name: key, ...over });
  const made: TemplateEntry = { kind: 'template', key, id: `id-${key}`, dir: `/lib/${key}`, root: '/lib', manifest, tags: [...manifest.tags], warnings: [], ...entry };
  if (manifest.themes) made.themes = [...manifest.themes];
  return made;
}
function media(key: string, over: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key, id: `id-${key}`, path: `/media/${key}.mov`, root: '/media', name: key, mediaKind: 'video', ext: '.mov', size: 1, mtimeMs: 0, tags: [], ...over };
}

describe('the categories', () => {
  it('read in the order a stock library leads with, Lower thirds first', () => {
    expect(BROWSE_CATEGORIES.map((c) => c.label)).toEqual([
      'Lower thirds', 'Titles and openers', 'End cards', 'Matching sets', 'Animated backgrounds', 'Still backgrounds', 'Overlays and frames',
      'Transitions and wipes', 'Design elements', 'Effects', 'Objects', 'Stock video', 'Photos and stills', 'Music', 'Sound effects',
    ]);
  });

  it('give every taxonomy type exactly one home, and gather no type twice', () => {
    expect(uncategorizedTypes()).toEqual([]);
    const seen = new Map<string, string>();
    for (const c of BROWSE_CATEGORIES) {
      for (const t of c.types) {
        expect(seen.has(t), `${t} in ${c.id} and ${seen.get(t)}`).toBe(false);
        seen.set(t, c.id);
        expect(TYPES.some((x) => x.id === t), `${c.id} names a type the taxonomy has: ${t}`).toBe(true);
      }
    }
    expect(seen.size).toBe(TYPES.length);
  });

  it('each have a one-line description and an icon the window ships', async () => {
    const icons = await readFile(join(ROOT, 'src', 'renderer', 'icons.tsx'), 'utf8');
    for (const c of BROWSE_CATEGORIES) {
      expect(c.description.length, c.id).toBeGreaterThan(12);
      expect(c.description.endsWith('.'), `${c.id}: one sentence`).toBe(true);
      expect(c.description.split(/[.!?]\s/).length, `${c.id}: one line`).toBe(1);
      const shipped = existsSync(join(ROOT, 'node_modules', '@phosphor-icons', 'core', 'assets', 'regular', `${c.icon}.svg`));
      expect(shipped, `${c.id}: ${c.icon} is a Phosphor icon`).toBe(true);
      expect(icons.includes(`'${c.icon}'`) || icons.includes(`  ${c.icon},`) || icons.includes(`  ${c.icon}:`), `${c.id}: ${c.icon} is in the icon map`).toBe(true);
    }
  });

  it('scope as the search reads: one type, or several as alternatives', () => {
    const lower = categoryScope(categoryOfType('lower-third')!)!;
    expect(lower).toEqual({ label: 'Lower thirds', filter: 'type:lower-third', kind: 'category', group: 'lower-thirds' });
    const transitions = categoryScope(categoryOfType('wipe')!)!;
    expect(transitions.filter).toBe('type:wipe type:reveal type:flash type:glitch');
    const index: LibraryIndex = {
      roots: ['/lib'], templates: [template('w', { type: 'wipe', category: 'transition' }), template('g', { type: 'glitch', category: 'transition' }), template('t', { category: 'title' })],
      media: [], problems: [], builtAt: '2026-10-30T00:00:00Z',
    };
    expect(searchLibrary(index, transitions.filter!).map((h) => h.entry.key).sort()).toEqual(['g', 'w']);
    // Matching sets gathers packs rather than types, so it has no scope of its own.
    expect(categoryScope(BROWSE_CATEGORIES.find((c) => c.id === 'matching-sets')!)).toBeNull();
    // A type's scope carries its category, which is how the icon and the description are found from it.
    expect(typeScope('glitch')).toEqual({ label: 'Glitch', filter: 'type:glitch', kind: 'type', group: 'transitions-wipes' });
    expect(scopeCategory(typeScope('glitch'))?.label).toBe('Transitions and wipes');
    expect(scopeCategory({ label: 'Favorites', filter: 'favorite:yes', kind: 'favorites' })).toBeUndefined();
  });

  it('make cards for what is there, with a picture from the set and a count', () => {
    const entries = [
      template('a', { category: 'lower-third' }, { thumbnail: 'pulp-thumb://a/' }),
      template('b', { category: 'title' }),
      template('c', { type: 'opener', category: 'title' }, { thumbnail: 'pulp-thumb://c/' }),
      media('clip', { type: 'opener', thumbnail: 'pulp-thumb://clip/' }),
    ];
    const top = categoryCards(entries, null)!;
    expect(top.map((c) => [c.id, c.count])).toEqual([['category:lower-thirds', 1], ['category:titles-openers', 3]]);
    expect(top[0]!.sample?.key).toBe('a');
    expect(top[0]!.description).toMatch(/bottom of the frame/);
    // Inside a category of several types: its types, a template's picture preferred to a clip's.
    const inside = categoryCards(entries, categoryScope(categoryOfType('title')!))!;
    expect(inside.map((c) => [c.id, c.count, c.sample?.key ?? null])).toEqual([['type:title', 1, null], ['type:opener', 2, 'c']]);
    expect(inside[1]!.scope).toEqual(typeScope('opener'));
    // A category of one type, a type, a folder: nowhere cards apply.
    expect(categoryCards(entries, categoryScope(categoryOfType('lower-third')!))).toBeNull();
    expect(categoryCards(entries, typeScope('opener'))).toBeNull();
    expect(categoryCards(entries, { label: 'Lib', root: '/lib', kind: 'folder' })).toBeNull();
  });

  it('offer For… themes in their groups with counts, custom ones last, and the chosen one always', () => {
    const entries = [
      template('a', { themes: ['wedding', 'my-show'] }),
      template('b', { themes: ['wedding', 'sports'] }),
      media('c', { themes: ['football'] }),
    ];
    const groups = forOptions(entries);
    expect(groups.map((g) => g.label)).toEqual(['Sports', 'Life events', 'Custom']);
    expect(groups[0]!.options.map((o) => [o.id, o.count])).toEqual([['sports', 1], ['football', 1]]);
    expect(groups[1]!.options).toEqual([{ id: 'wedding', label: 'Wedding', count: 2 }]);
    expect(groups[2]!.options).toEqual([{ id: 'my-show', label: 'My show', count: 1 }]);
    // A chosen theme that the narrowed entries no longer carry stays listed, at zero, so it can be cleared.
    expect(forOptions([], 'news')).toEqual([{ label: 'Media', options: [{ id: 'news', label: 'News / broadcast', count: 0 }] }]);
    expect(forOptions([], 'odd-one')).toEqual([{ label: 'Custom', options: [{ id: 'odd-one', label: 'Odd one', count: 0 }] }]);
  });

  it('offer Look styles with counts, templates only', () => {
    const entries = [template('a', { styles: ['elegant', 'clean'] }), template('b', { styles: ['elegant'] }), media('c')];
    expect(lookOptions(entries)).toEqual([{ id: 'clean', label: 'Clean / minimal', count: 1 }, { id: 'elegant', label: 'Elegant', count: 2 }]);
    expect(lookOptions([], 'retro')).toEqual([{ id: 'retro', label: 'Retro / vintage', count: 0 }]);
  });

  it('every bundled template lands in a category', async () => {
    const { scanLibrary } = await import('../src/core/library');
    const index = await scanLibrary([join(ROOT, 'templates')]);
    const homeless = index.templates.filter((t) => {
      const type = t.manifest.type ?? ({ 'lower-third': 'lower-third', title: 'title', transition: 'wipe', overlay: 'overlay', background: 'animated-loop' } as Record<string, string>)[t.manifest.category];
      return type !== undefined && categoryOfType(type) === undefined;
    });
    expect(homeless.map((t) => t.manifest.id)).toEqual([]);
  });
});
