import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { parseManifest } from '../src/core/manifest';
import { parsePackManifest, PACK_FILENAME } from '../src/core/pack';
import { defaultParams } from '../src/core/params';
import { buildRenderPlan, PRESET_IDS } from '../src/core/render-plan';
import { buildBrowseTree } from '../src/core/browse-tree';
import { searchLibrary } from '../src/core/search';

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
    expect(parsed.manifest.themes?.length).toBeGreaterThan(0);
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
    const expected: Record<string, { themes: string[]; styles: string[]; types: string[]; size: number }> = {
      boardroom: { themes: ['corporate', 'finance', 'technology', 'real-estate'], styles: ['clean'], types: ['animated-loop', 'frame', 'lower-third', 'title', 'wipe'], size: 16 },
      newsdesk: { themes: ['news', 'documentary', 'podcast'], styles: ['high-energy'], types: ['animated-loop', 'logo-bug', 'lower-third', 'title', 'wipe'], size: 15 },
      matchday: { themes: ['sports', 'football', 'basketball', 'soccer'], styles: ['high-energy'], types: ['animated-loop', 'logo-bug', 'lower-third', 'title', 'wipe'], size: 14 },
      festival: { themes: ['holiday', 'new-year', 'christmas', 'valentines', 'birthday', 'graduation', 'wedding'], styles: ['playful'], types: ['animated-loop', 'light-particles', 'lower-third', 'title', 'wipe'], size: 15 },
    };
    for (const [slug, want] of Object.entries(expected)) {
      const set = index.templates.filter((t) => t.pack?.slug === slug);
      expect(set, slug).toHaveLength(want.size);
      for (const t of set) {
        expect({ themes: t.manifest.themes, styles: t.manifest.styles }, t.manifest.id).toEqual({ themes: want.themes, styles: want.styles });
        expect(t.manifest.type, t.manifest.id).toBeDefined();
      }
      expect(set.map((t) => t.manifest.type), slug).toEqual(expect.arrayContaining(want.types));
    }
  });

  it('builds a theme tree where every group in use has several children, and none repeats its parent', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    const tree = buildBrowseTree(index.templates, [TEMPLATES_DIR], TEMPLATES_DIR);
    const themes = tree.find((s) => s.id === 'themes');
    expect(themes, 'the samples should fill a Themes section').toBeDefined();
    const groups = themes!.children;
    expect(groups.length, 'groups in use').toBeGreaterThan(0);
    for (const group of groups) {
      // Several, never one: a group that opens onto a single child is not a hierarchy. There is no
      // upper limit — "three to five" was only ever shorthand for that floor, and milestone 24
      // fills every theme, so a group shows as many children as the taxonomy gives it.
      expect(group.children.length, `${group.label} children`).toBeGreaterThanOrEqual(3);
      for (const child of group.children) {
        expect(child.count, `${group.label} › ${child.label}`).toBeGreaterThan(0);
      }
      // Selecting a group covers its own items and everything under it, so it is never smaller than a child.
      for (const child of group.children) {
        expect(group.count, `${group.label} vs ${child.label}`).toBeGreaterThanOrEqual(child.count);
      }
    }
  });
});

describe('the theme vocabulary in the samples', () => {
  it('scopes a group to its own items and all its children', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    const matchday = index.templates.filter((t) => t.pack?.slug === 'matchday');
    const hits = searchLibrary({ ...index, media: [] }, 'theme:sports').map((h) => h.entry.key);
    // Every Matchday template, whether it is the general theme or a specific sport that put it there.
    expect(hits.length, 'theme:sports').toBe(matchday.length);
    // A specific child still means only itself.
    expect(searchLibrary({ ...index, media: [] }, 'theme:football').length).toBe(matchday.length);
    expect(searchLibrary({ ...index, media: [] }, 'theme:hockey').length).toBe(0);
  });
});
