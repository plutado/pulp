import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASPECT_IDS } from '../src/core/aspect';
import { THEME_GROUPS } from '../src/core/taxonomy';
import { categoryInfo, categoryScope } from '../src/core/categories';
import type { LibraryEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';
import {
  hasSampleMedia, lastOpenedLabel, MAKING_CHOICES, makingChoiceLanding, orderRecents, PROJECT_SHAPES, projectFileName,
  setupChecklist, TOUR_STEPS, type RecentProjectRow,
} from '../src/core/start-screen';

const row = (over: Partial<RecentProjectRow>): RecentProjectRow => ({
  path: '/p/a.pulp', name: 'a', pinned: false, lastOpened: '', missing: false, ...over,
});

describe('the start screen (milestone 31)', () => {
  it('offers a new project in every shape the output system knows', () => {
    expect(PROJECT_SHAPES.map((s) => s.id)).toEqual([...ASPECT_IDS]);
    for (const shape of PROJECT_SHAPES) expect(shape.hint).toMatch(/^(Landscape|Vertical|Square)$/);
  });

  it('leads each "what are you making" choice into a browse category that exists, with a real theme for its chip', () => {
    const themeIds = new Set(THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.id)));
    for (const choice of MAKING_CHOICES) {
      const category = categoryInfo(choice.category);
      expect(category, choice.id).toBeDefined();
      expect(category!.types.length, `${choice.id} lands on a category with types to show`).toBeGreaterThan(0);
      expect(themeIds.has(choice.forTheme), `${choice.id}: ${choice.forTheme}`).toBe(true);
    }
  });

  it('sets the For chip only when the category has something carrying the theme', () => {
    const interview = MAKING_CHOICES.find((c) => c.id === 'interview')!;
    const strap = (themes: string[]): LibraryEntry => ({
      kind: 'template', key: 'strap', id: 'id-strap', dir: '/lib/strap', root: '/lib', tags: [], warnings: [], themes,
      manifest: validManifest({ id: 'test.strap', name: 'strap', category: 'lower-third' }),
    });
    expect(makingChoiceLanding(interview, [strap(['podcast'])])).toEqual({ scope: categoryScope(categoryInfo('lower-thirds')!), forTheme: 'podcast' });
    // Nothing in Lower thirds is for an interview here: the category opens, the chip stays clear.
    expect(makingChoiceLanding(interview, [strap(['news'])])?.forTheme).toBeNull();
    expect(makingChoiceLanding(interview, [])?.scope.label).toBe('Lower thirds');
  });

  it('ticks the checklist off from what the session knows', () => {
    const fresh = setupChecklist({ ffmpegOk: false, roots: ['/app/templates'], builtInRoot: '/app/templates' });
    expect(fresh.map((i) => i.done)).toEqual([false, false, false]);
    // FFmpeg cannot be installed from here, so its undone item offers no button.
    expect(fresh[0]!.action).toBe('');
    expect(fresh[1]!.action).not.toBe('');
    const ready = setupChecklist({
      ffmpegOk: true,
      roots: ['/app/templates', '/home/me/clips', '/home/me/clips/Sample media'],
      builtInRoot: '/app/templates',
    });
    expect(ready.every((i) => i.done && i.action === '')).toBe(true);
  });

  it('finds the sample-media folder by its fixed name, on either separator', () => {
    expect(hasSampleMedia(['/a/Sample media'])).toBe(true);
    expect(hasSampleMedia(['C:\\clips\\Sample media'])).toBe(true);
    expect(hasSampleMedia(['/a/Sample media old', '/b'])).toBe(false);
  });

  it('orders recents pinned first, then newest first', () => {
    const rows = [
      row({ path: '/1', lastOpened: '2026-10-01T00:00:00Z' }),
      row({ path: '/2', lastOpened: '2026-10-20T00:00:00Z' }),
      row({ path: '/3', lastOpened: '2026-10-10T00:00:00Z', pinned: true }),
      row({ path: '/4', lastOpened: '' }),
    ];
    expect(orderRecents(rows).map((r) => r.path)).toEqual(['/3', '/2', '/1', '/4']);
  });

  it('says when a project was last opened in words', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    expect(lastOpenedLabel('2026-10-30T09:00:00Z', now)).toBe('Today');
    expect(lastOpenedLabel('2026-10-29T09:00:00Z', now)).toBe('Yesterday');
    expect(lastOpenedLabel('2026-10-20T09:00:00Z', now)).toBe('10 days ago');
    expect(lastOpenedLabel('2026-07-20T09:00:00Z', now)).toBe('3 months ago');
    expect(lastOpenedLabel('', now)).toBe('');
    expect(lastOpenedLabel('not a date', now)).toBe('');
  });

  it('names a project file by its own name, extension dropped', () => {
    expect(projectFileName('/a/b/Show.pulp')).toBe('Show');
    expect(projectFileName('C:\\work\\Show.pulpcollection')).toBe('Show');
  });

  it('points every tour step at an element the window really has', async () => {
    const html = await readFile(join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    for (const step of TOUR_STEPS) {
      expect(html.includes(`id="${step.target}"`), step.target).toBe(true);
      expect(step.title).not.toBe('');
      expect(step.body).not.toBe('');
    }
  });
});
