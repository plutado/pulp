import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { parseManifest } from '../src/core/manifest';
import { parsePackManifest, PACK_FILENAME } from '../src/core/pack';
import { defaultParams } from '../src/core/params';
import { buildRenderPlan, PRESET_IDS } from '../src/core/render-plan';

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

  it('ships the three originals and four matched sets', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(23);
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
    // A matched set: one of each role.
    expect(folders).toEqual(['background', 'lower-third', 'overlay', 'title', 'transition']);
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

  it('all samples index cleanly, get the pack defaults, and can be planned for every preset', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    expect(index.problems).toEqual([]);
    expect(index.templates).toHaveLength(dirs.length);
    for (const t of index.templates) {
      for (const presetId of PRESET_IDS) {
        expect(() => buildRenderPlan({ manifest: t.manifest, presetId, outputPath: `/tmp/${t.manifest.id}` })).not.toThrow();
      }
    }
    // Pack defaults reach the templates: one theme and one style per set, inherited by all five.
    const expected: Record<string, { themes: string[]; styles: string[]; types: string[] }> = {
      boardroom: { themes: ['corporate'], styles: ['clean'], types: ['animated-loop', 'frame', 'lower-third', 'title', 'wipe'] },
      newsdesk: { themes: ['news'], styles: ['high-energy'], types: ['animated-loop', 'logo-bug', 'lower-third', 'title', 'wipe'] },
      matchday: { themes: ['sports'], styles: ['high-energy'], types: ['animated-loop', 'logo-bug', 'lower-third', 'title', 'wipe'] },
      festival: { themes: ['holiday'], styles: ['playful'], types: ['animated-loop', 'light-particles', 'lower-third', 'title', 'wipe'] },
    };
    for (const [slug, want] of Object.entries(expected)) {
      const set = index.templates.filter((t) => t.pack?.slug === slug);
      expect(set, slug).toHaveLength(5);
      for (const t of set) expect({ themes: t.manifest.themes, styles: t.manifest.styles }, t.manifest.id).toEqual({ themes: want.themes, styles: want.styles });
      expect(set.map((t) => t.manifest.type).sort(), slug).toEqual(want.types);
    }
  });
});
