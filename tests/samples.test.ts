import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { parseManifest } from '../src/core/manifest';
import { parsePackManifest, PACK_FILENAME } from '../src/core/pack';
import { defaultParams } from '../src/core/params';
import { buildRenderPlan, PRESET_IDS } from '../src/core/render-plan';
import { forOptions } from '../src/core/categories';
import { searchLibrary } from '../src/core/search';
import { THEME_GROUPS } from '../src/core/taxonomy';

const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/** Top-level template folders, plus the templates inside bundled packs (folders with a pack.json). */
async function collect(): Promise<{ templates: string[]; packs: string[] }> {
  const templates: string[] = [];
  const packs: string[] = [];
  for (const d of await readdir(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const names = await readdir(join(TEMPLATES_DIR, d.name));
    if (names.includes(PACK_FILENAME)) {
      packs.push(d.name);
      for (const sub of await readdir(join(TEMPLATES_DIR, d.name), { withFileTypes: true })) {
        if (sub.isDirectory()) templates.push(join(d.name, sub.name));
      }
    } else {
      templates.push(d.name);
    }
  }
  return { templates, packs };
}

describe('bundled sample templates', async () => {
  const { templates: dirs, packs } = await collect();

  it('ships the originals, the standalone pieces and four matched sets', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(90);
    expect(packs).toEqual(['boardroom', 'festival', 'matchday', 'newsdesk']);
  });

  it.each(packs)('%s has a valid CC0 pack.json whose listed folders exist', async (pack) => {
    const parsed = parsePackManifest(await readFile(join(TEMPLATES_DIR, pack, PACK_FILENAME), 'utf8'));
    expect(parsed.ok ? [] : parsed.problems).toEqual([]);
    if (!parsed.ok) return;
    expect(parsed.manifest.license).toBe('CC0-1.0');
    // A pack may hand its templates a theme, but it does not have to: a set whose pieces each
    // fit a different occasion says so on the pieces, since a pack's themes are added to every
    // one of them and a child theme must never sit beside its parent (ADR 0010).
    expect(parsed.manifest.styles?.length).toBeGreaterThan(0);
    const folders = (await readdir(join(TEMPLATES_DIR, pack), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect([...parsed.manifest.templates].sort()).toEqual(folders);
    // A matched set: the five core roles, plus whatever milestone 21 added in the same look.
    expect(folders).toEqual(expect.arrayContaining(['background', 'lower-third', 'overlay', 'title', 'transition']));
  });

  it.each(dirs)('%s has a valid manifest with no warnings and an open license', async (dir) => {
    const result = parseManifest(await readFile(join(TEMPLATES_DIR, dir, 'template.json'), 'utf8'));
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    if (!result.ok) return;
    expect(['CC0-1.0', 'MIT']).toContain(result.manifest.license);
    expect(Object.keys(defaultParams(result.manifest))).toHaveLength(result.manifest.parameters.length);
  });

  it.each(dirs)('%s names the part of the graphic every setting belongs to', async (dir) => {
    const result = parseManifest(await readFile(join(TEMPLATES_DIR, dir, 'template.json'), 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const p of result.manifest.parameters) {
      // A flat group named after a kind of setting says nothing about what it affects
      // (docs/ui-style.md, "Settings by element, not by kind"), so every parameter names its part.
      expect(p.element, `${dir}: ${p.id} has no element`).toBeTruthy();
      expect(p.group, `${dir}: ${p.id} still carries a group`).toBeUndefined();
    }
  });

  // Milestone 30: what each template says may stretch. Where a hold sits is measured by
  // rendering it (docs/template-format.md, "Choosing holdFrom and holdTo"), which is too slow
  // for a unit test; what is checked here is the shape of the answer across the whole library.
  it('says what may stretch, each in the way its kind of graphic stretches', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    const kinds: Record<string, string[]> = { hold: [], loop: [], scale: [], none: [] };
    for (const t of index.templates) kinds[t.manifest.structure?.kind ?? 'none']!.push(t.manifest.id);
    // A loop is what a background or an overlay does, a scale what a transition does, and a hold
    // belongs to a graphic that says something and waits — never to a transition.
    for (const t of index.templates) {
      const { structure, category, id } = t.manifest;
      if (structure?.kind === 'loop') expect(['background', 'overlay'], id).toContain(category);
      if (structure?.kind === 'scale') expect(category, id).toBe('transition');
      if (structure?.kind === 'hold') expect(category, id).not.toBe('transition');
      // The length is the control for a graphic that declares a hold, so it must not also offer
      // one: two ways to set the same thing would fight (docs/template-format.md).
      if (structure?.kind === 'hold') {
        for (const p of t.manifest.parameters) expect(p.label, `${id}: ${p.id}`).not.toMatch(/^Hold\b/i);
      }
    }
    // Every template is accounted for, and the counts are a tripwire: a structure added without
    // measuring where the graphic settles, or one dropped, shows up here first.
    // Milestone 36's first batch: ten lower thirds and three end cards hold; six backgrounds loop; the
    // four lower thirds and three end cards with ambient motion (a jitter, a sweep, a pulse, a trace,
    // breathing bars, a roll, a blinking cursor) keep a fixed length.
    expect(kinds.hold).toHaveLength(51);
    expect(kinds.loop).toHaveLength(29);
    expect(kinds.scale).toHaveLength(24);
    expect(kinds.none).toHaveLength(46);
  });

  it.each(dirs)('%s defines window.pulpRender and avoids wall-clock time', async (dir) => {
    const html = await readFile(join(TEMPLATES_DIR, dir, 'index.html'), 'utf8');
    expect(html).toContain('window.pulpRender');
    expect(html).not.toMatch(/Date\.now|performance\.now|requestAnimationFrame|Math\.random|setTimeout|setInterval/);
    expect(html).not.toMatch(/https?:\/\//);
  });

  // Milestone 22: image slots in the sets. Every slot declares a box and a fit, and a slot on a
  // piece that carries text falls back to that text, so a template with no logo renders as it did.
  it('image slots declare a box and a fit, and fall back to text where there is text to fall back to', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    const slots: string[] = [];
    for (const t of index.templates) {
      for (const p of t.manifest.parameters) {
        if (p.type !== 'image') continue;
        slots.push(t.manifest.id);
        expect(p.box, t.manifest.id).toBeDefined();
        expect(['contain', 'cover'], t.manifest.id).toContain(p.fit);
        const type = t.manifest.type ?? '';
        if (['lower-third', 'title', 'end-card', 'logo-bug', 'opener', 'logo-reveal'].includes(type)) {
          expect(p.fallbackText, `${t.manifest.id} should fall back to its text`).toBeDefined();
          expect(t.manifest.parameters.find((q) => q.id === p.fallbackText)?.type, t.manifest.id).toBe('text');
        }
      }
    }
    // The four sets and the two standalone originals: at least a lower third, a title, a bug, a transition, an end card and a background each.
    expect(slots.length).toBeGreaterThanOrEqual(26);
    for (const set of ['boardroom', 'newsdesk', 'matchday', 'festival']) {
      expect(slots.filter((id) => id.startsWith(`pulp.samples.${set}.`)).length, set).toBeGreaterThanOrEqual(6);
    }
  });

  // Milestone 19: a template is a shape, not a pixel size. Every bundled template
  // declares the aspects it draws for and lays out from the canvas it is handed.
  it.each(dirs)('%s declares its aspects and draws from the size it is given', async (dir) => {
    const result = parseManifest(await readFile(join(TEMPLATES_DIR, dir, 'template.json'), 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.aspects.length, 'declared aspects').toBeGreaterThanOrEqual(1);
    expect(result.manifest.size, 'no pixel size: the resolution is chosen at render time').toBeUndefined();
    const html = await readFile(join(TEMPLATES_DIR, dir, 'index.html'), 'utf8');
    expect(html).toContain('state.width');
    expect(html).toContain('state.height');
    // No fixed canvas, and no scale taken from one side alone: a tall frame would blow the layout up.
    expect(html).not.toMatch(/<canvas[^>]*\s(width|height)=/);
    expect(html).not.toMatch(/\bH\s*\/\s*1080\b|\bW\s*\/\s*1920\b/);
  });

  it('all samples index cleanly, get the pack defaults, and can be planned for every preset', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    expect(index.problems).toEqual([]);
    expect(index.templates).toHaveLength(dirs.length);
    for (const t of index.templates) {
      for (const presetId of PRESET_IDS) {
        expect(() => buildRenderPlan({ manifest: t.manifest, presetId, outputPath: `/tmp/${t.manifest.id}` })).not.toThrow();
      }
    }
    // Pack defaults reach the templates: the set's themes and its one style, inherited by every member;
    // the five core roles are always there, and every member declares a type.
    const expected: Record<string, { themes: string[]; styles: string[]; types: string[]; size: number; perPiece?: boolean }> = {
      boardroom: { themes: ['corporate', 'finance', 'technology', 'real-estate'], styles: ['clean'], types: ['animated-loop', 'frame', 'lower-third', 'title', 'wipe'], size: 16 },
      newsdesk: { themes: ['news', 'documentary', 'podcast'], styles: ['high-energy'], types: ['animated-loop', 'logo-bug', 'lower-third', 'title', 'wipe'], size: 15 },
      matchday: { themes: ['sports', 'football', 'basketball', 'soccer'], styles: ['high-energy'], types: ['animated-loop', 'logo-bug', 'lower-third', 'title', 'wipe'], size: 14 },
      // Festival is a general celebration look, so the set's pieces are not all of every occasion:
      // each says the one it fits, and the pack imposes nothing (ADR 0010 — a child theme never
      // repeats its parent, so a piece is "christmas" or "holiday", never both).
      festival: { themes: ['holiday', 'new-year', 'christmas', 'valentines', 'birthday', 'graduation', 'wedding'], perPiece: true, styles: ['playful'], types: ['animated-loop', 'light-particles', 'lower-third', 'title', 'wipe'], size: 15 },
    };
    for (const [slug, want] of Object.entries(expected)) {
      const set = index.templates.filter((t) => t.pack?.slug === slug);
      expect(set, slug).toHaveLength(want.size);
      for (const t of set) {
        if (want.perPiece) {
          // One theme each, drawn from the set's own vocabulary, and never a child beside its parent.
          expect(t.manifest.themes, t.manifest.id).toHaveLength(1);
          expect(want.themes, t.manifest.id).toContain(t.manifest.themes![0]);
          expect({ styles: t.manifest.styles }, t.manifest.id).toEqual({ styles: want.styles });
        } else {
          expect({ themes: t.manifest.themes, styles: t.manifest.styles }, t.manifest.id).toEqual({ themes: want.themes, styles: want.styles });
        }
        expect(t.manifest.type, t.manifest.id).toBeDefined();
      }
      // Every occasion the set names is really used by one of its pieces.
      if (want.perPiece) {
        const used = new Set(set.flatMap((t) => t.manifest.themes ?? []));
        for (const theme of want.themes) expect([...used], `${slug} uses ${theme}`).toContain(theme);
      }
      expect(set.map((t) => t.manifest.type), slug).toEqual(expect.arrayContaining(want.types));
    }
  });

  it('fills the For… chip with groups of several themes each, and a group covers its children (milestone 34)', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    // Themes are the For… chip now rather than a tree: the samples should fill it, group by group.
    const groups = forOptions(index.templates);
    expect(groups.length, 'groups in use').toBeGreaterThan(0);
    for (const group of groups) {
      // Several, never one: a group that opens onto a single choice is not a grouping. There is no
      // upper limit — milestone 24 fills every theme, so a group offers as many as the taxonomy gives it.
      expect(group.options.length, `${group.label} options`).toBeGreaterThanOrEqual(3);
      for (const option of group.options) expect(option.count, `${group.label} › ${option.label}`).toBeGreaterThan(0);
      // Searching the group itself covers its own items and everything under it, so it is never smaller than a child.
      const built = THEME_GROUPS.find((g) => g.label === group.label);
      if (!built) continue;
      const whole = searchLibrary(index, `theme:${built.id}`).length;
      for (const option of group.options) expect(whole, `${group.label} vs ${option.label}`).toBeGreaterThanOrEqual(option.count);
    }
  });
});

describe('the theme vocabulary in the samples', () => {
  it('scopes a group to its own items and all its children', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    const matchday = index.templates.filter((t) => t.pack?.slug === 'matchday');
    const hits = new Set(searchLibrary({ ...index, media: [] }, 'theme:sports').map((h) => h.entry.key));
    // Every Matchday template answers, whether the general theme or a specific sport put it there —
    // and anything else that answers carries a sports theme of its own (a fitness counter counts).
    for (const t of matchday) expect(hits.has(t.key), `${t.key} under theme:sports`).toBe(true);
    const sportsGroup = new Set(THEME_GROUPS.find((g) => g.id === 'sports')!.themes.map((th) => th.id));
    for (const hit of searchLibrary({ ...index, media: [] }, 'theme:sports')) {
      const entry = hit.entry;
      const themes = entry.kind === 'template' ? entry.manifest.themes ?? [] : [];
      expect(themes.some((th) => sportsGroup.has(th)), `${entry.key} answers theme:sports`).toBe(true);
    }
    // A specific child still means only itself: every hit carries football, and every Matchday piece is one.
    const football = searchLibrary({ ...index, media: [] }, 'theme:football').map((h) => h.entry);
    expect(football.length).toBeGreaterThanOrEqual(matchday.length);
    for (const entry of football) expect(entry.kind === 'template' && entry.manifest.themes?.includes('football'), `${entry.key} answers theme:football`).toBe(true);
    for (const t of matchday) expect(football.some((e) => e.key === t.key), `${t.key} under theme:football`).toBe(true);
  });
});
