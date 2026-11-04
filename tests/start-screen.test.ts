import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASPECT_IDS } from '../src/core/aspect';
import { THEME_GROUPS } from '../src/core/taxonomy';
import { categoryInfo, categoryScope } from '../src/core/categories';
import type { LibraryEntry, LibraryIndex, TemplateEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';
import {
  hasSampleMedia, lastOpenedLabel, MAKING_CHOICES, makingChoiceLanding, orderRecents, PROJECT_SHAPES, projectFileName,
  setupChecklist, TOUR_STEPS, type RecentProjectRow,
  startArrangement,
  checklistProgress,
  ideaPicture,
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
    // No build to fetch for this machine, so the undone FFmpeg item offers no button:
    // one that cannot act is worse than none.
    expect(fresh[0]!.action).toBe('');
    expect(fresh[1]!.action).not.toBe('');
    // With one to fetch (milestone 17), it is a press away, through Settings, which is
    // where what would be fetched is said.
    const offered = setupChecklist({ ffmpegOk: false, ffmpegDownloadable: true, roots: [] });
    expect(offered[0]!.action).toBe('Get FFmpeg…');
    // And nothing is offered where ffmpeg is already there, fetched or installed.
    expect(setupChecklist({ ffmpegOk: true, ffmpegDownloadable: true, roots: [] })[0]!.action).toBe('');
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

describe('the redesigned screen (milestone 60)', () => {
  const items = (done: boolean[]) => done.map((d, i) => ({ id: (['ffmpeg', 'folder', 'samples'] as const)[i]!, label: '', done: d, action: '' }));

  it('arranges a first run and a returning user differently, and says the progress', () => {
    const firstRun = startArrangement(items([true, false, false]), 2);
    expect(firstRun).toEqual({ firstRun: true, showContinue: false, showChecklist: true, progress: '1 of 3 done' });
    const returning = startArrangement(items([true, true, true]), 2);
    expect(returning).toEqual({ firstRun: false, showContinue: true, showChecklist: false, progress: '3 of 3 done' });
    // Set up but nothing opened yet: no Continue, and no checklist either — the invitation carries it.
    expect(startArrangement(items([true, true, true]), 0)).toMatchObject({ firstRun: false, showContinue: false, showChecklist: false });
    // Help → Set-up Checklist brings the card back once it has left.
    expect(startArrangement(items([true, true, true]), 2, true)).toMatchObject({ showChecklist: true });
    expect(checklistProgress(items([true, false, true]))).toBe('2 of 3 done');
  });

  it('gives an idea card a real picture: a template from its category, the theme preferred, a thumbnail preferred', () => {
    const lower = (id: string, over: Partial<TemplateEntry> = {}): TemplateEntry => ({
      kind: 'template', key: id, id: `lib-${id}`, dir: `/t/${id}`, root: '/t', tags: [], warnings: [],
      manifest: validManifest({ id: `test.${id}`, name: id, category: 'lower-third' }), ...over,
    });
    const index = (templates: TemplateEntry[]): LibraryIndex => ({ roots: ['/t'], templates, media: [], problems: [], builtAt: '' });
    const interview = MAKING_CHOICES.find((c) => c.id === 'interview')!;
    const plain = lower('plain');
    const themed = lower('themed', { themes: ['podcast'] });
    const themedWithThumb = lower('pictured', { themes: ['podcast'], thumbnail: 'pulp-thumb://lib-pictured/' });
    expect(ideaPicture(interview, index([plain, themed, themedWithThumb]))?.id).toBe('lib-pictured');
    expect(ideaPicture(interview, index([plain, themed]))?.id).toBe('lib-themed');
    expect(ideaPicture(interview, index([plain]))?.id).toBe('lib-plain');
    expect(ideaPicture(interview, index([]))).toBeUndefined();
    expect(ideaPicture(interview, null)).toBeUndefined();
  });
});

describe('the screen as the markup holds it (milestone 60)', () => {
  const html = readFileSync(join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const screen = /<section id="start-screen"[\s\S]*?<\/section>\n(?= {2}<div id="tour-overlay")/.exec(html)?.[0] ?? '';

  it('has exactly one primary button, and it is New project', () => {
    expect(screen.length).toBeGreaterThan(0);
    const primaries = [...screen.matchAll(/class="([^"]*\bprimary\b[^"]*)"/g)];
    expect(primaries).toHaveLength(1);
    expect(screen).toContain('id="start-new-blank" type="button" class="primary start-primary"');
    // And one secondary beside it: Open.
    expect(screen).toContain('id="start-open" type="button" class="start-secondary"');
  });

  it('orders the sections as the milestone reads: lead, set up, Continue, ideas, Learn', () => {
    const order = ['start-lead', 'start-setup-card', 'start-continue', 'start-ideas-head', 'start-learn-head', 'start-foot'];
    const at = order.map((id) => screen.indexOf(id));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('both palettes read (milestone 60)', () => {
  const css = readFileSync(join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const screenCss = css.slice(css.indexOf('.start-screen {'), css.indexOf('.start-inner'));
  const darkBlock = screenCss.slice(0, screenCss.indexOf('@media'));
  const lightBlock = screenCss.slice(screenCss.indexOf('@media'));

  function tokens(block: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/(--s-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!.toLowerCase();
    return out;
  }

  /** WCAG relative luminance and contrast ratio, computed rather than trusted. */
  function luminance(hex: string): number {
    const channel = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  }
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  }

  it.each([['dark', darkBlock], ['light', lightBlock]] as const)('%s: text and controls meet WCAG AA on every surface they sit on', (_name, block) => {
    const t = tokens(block);
    for (const key of ['--s-bg', '--s-panel', '--s-panel-2', '--s-text', '--s-text-2', '--s-muted', '--s-accent', '--s-on-accent']) {
      expect(t[key], key).toBeDefined();
    }
    for (const surface of ['--s-bg', '--s-panel', '--s-panel-2']) {
      expect(contrast(t['--s-text']!, t[surface]!), `text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--s-text-2']!, t[surface]!), `secondary text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--s-muted']!, t[surface]!), `muted on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t['--s-on-accent']!, t['--s-accent']!), 'the primary button').toBeGreaterThanOrEqual(4.5);
    // The section icons are drawn in the accent: 3:1 for what is not text (milestone 62).
    expect(contrast(t['--s-accent']!, t['--s-bg']!), 'the section icons').toBeGreaterThanOrEqual(3);
    expect(contrast(t['--s-danger']!, t['--s-panel']!), 'a missing project on its card').toBeGreaterThanOrEqual(4.5);
  });
});
