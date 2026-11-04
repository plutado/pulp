/**
 * The polished set's place in the window (milestone 61): its posters' one
 * framing, and the lead it takes within Objects and Design elements under the
 * default order — held against the real bundled library.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { deriveResults, initialAppState, setScope, setSort, type AppState } from '../src/core/app-state';
import { BROWSE_CATEGORIES, categoryInfo, categoryOfEntry, categoryScope } from '../src/core/categories';
import { isPolished, polishedFirst, studioCrop } from '../src/core/polished';

const index = await scanLibrary([join(__dirname, '..', 'templates')]);
const base: AppState = { ...initialAppState, index };
const scoped = (category: string, over: Partial<AppState> = {}) => ({ ...setScope(base, categoryScope(categoryInfo(category)!)), ...over });

describe('the polished posters share one framing (milestone 61)', () => {
  it('crops the middle of the frame, half its short side tall, at the cards\' 16:9, with even sides', () => {
    expect(studioCrop({ width: 1920, height: 1080 })).toEqual({ x: 480, y: 270, width: 960, height: 540 });
    // A square or tall frame keeps the same rule: half the short side, as wide as the frame allows.
    expect(studioCrop({ width: 1080, height: 1080 })).toEqual({ x: 60, y: 270, width: 960, height: 540 });
    expect(studioCrop({ width: 1080, height: 1920 })).toEqual({ x: 60, y: 690, width: 960, height: 540 });
    for (const c of [studioCrop({ width: 1281, height: 721 }), studioCrop({ width: 999, height: 333 })]) {
      for (const n of [c.x, c.y, c.width, c.height]) expect(n % 2).toBe(0);
    }
  });

  it('is what every polished piece can take: one poster moment and a drawing in the shared box', () => {
    const polished = index.templates.filter(isPolished);
    expect(polished.length).toBeGreaterThanOrEqual(32);
    for (const t of polished) {
      expect(t.manifest.posterAt, `${t.manifest.id} names the set's poster moment`).toBe(2.5);
      expect(t.manifest.alpha, t.manifest.id).toBe(true);
      expect(t.manifest.aspects[0], `${t.manifest.id} is framed from 16:9`).toBe('16:9');
    }
  });
});

describe('the polished set leads within Objects and Design elements (milestone 61)', () => {
  for (const category of ['objects', 'design-elements']) {
    it(`puts every polished piece first in ${category} under the default order, each group in its own order`, () => {
      const entries = deriveResults(scoped(category)).entries;
      const polished = entries.filter(isPolished);
      expect(polished.length, 'polished pieces in the category').toBeGreaterThanOrEqual(category === 'objects' ? 24 : 7);
      expect(entries.slice(0, polished.length).every(isPolished), 'the polished pieces lead').toBe(true);
      // Nothing is lost or added, and the rest keep the order they had.
      const unled = deriveResults(scoped(category, { sort: 'name' })).entries;
      expect(entries.length).toBe(unled.length);
      const plainBefore = polishedFirst(entries, { scopeGroup: undefined, sort: 'relevance', freeText: '' }).filter((e) => !isPolished(e));
      expect(entries.filter((e) => !isPolished(e)).map((e) => e.id)).toEqual(plainBefore.map((e) => e.id));
    });
  }

  it('leads in a type inside those categories too — a type node scopes with its category\'s id', () => {
    const type = categoryInfo('objects')!.types.find((t) => index.templates.some((e) => isPolished(e) && e.manifest.type === t))!;
    const scope = { label: type, filter: `type:${type}`, kind: 'type' as const, group: 'objects' };
    const entries = deriveResults({ ...base, scope }).entries;
    const n = entries.filter(isPolished).length;
    expect(n).toBeGreaterThan(0);
    expect(entries.slice(0, n).every(isPolished)).toBe(true);
  });

  it('leaves every other order, a typed search and the rest of the library as they were', () => {
    // Another order is that order: by name, the polished pieces sit among the others.
    const byName = deriveResults(setSort(scoped('objects'), 'name')).entries;
    const names = byName.map((e) => (e.kind === 'template' ? e.manifest.name.toLowerCase() : ''));
    expect(names).toEqual([...names].sort());
    // Words typed rank the results; the lead does not override them.
    const searched = polishedFirst(deriveResults(scoped('objects')).entries.slice().reverse(), { scopeGroup: 'objects', sort: 'relevance', freeText: 'trophy' });
    expect(searched[0]!.id).toBe(deriveResults(scoped('objects')).entries.slice().reverse()[0]!.id);
    // Outside the two categories nothing moves: the whole library keeps the search's own order.
    const all = deriveResults(base).entries;
    expect(polishedFirst(all, { scopeGroup: undefined, sort: 'relevance', freeText: '' }).map((e) => e.id)).toEqual(all.map((e) => e.id));
    for (const other of BROWSE_CATEGORIES.filter((c) => c.id !== 'objects' && c.id !== 'design-elements')) {
      const list = deriveResults(base).entries.filter((e) => categoryOfEntry(e)?.id === other.id);
      expect(polishedFirst(list, { scopeGroup: other.id, sort: 'relevance', freeText: '' }).map((e) => e.id), other.id).toEqual(list.map((e) => e.id));
    }
  });
});
