import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { parseManifest } from '../src/core/manifest';
import { defaultParams } from '../src/core/params';
import { buildRenderPlan, PRESET_IDS } from '../src/core/render-plan';

const TEMPLATES_DIR = join(__dirname, '..', 'templates');

describe('bundled sample templates', async () => {
  const dirs = (await readdir(TEMPLATES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);

  it('ships at least two samples', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(2);
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

  it('all samples index cleanly and can be planned for every preset', async () => {
    const index = await scanLibrary([TEMPLATES_DIR]);
    expect(index.problems).toEqual([]);
    expect(index.templates).toHaveLength(dirs.length);
    for (const t of index.templates) {
      for (const presetId of PRESET_IDS) {
        expect(() => buildRenderPlan({ manifest: t.manifest, presetId, outputPath: `/tmp/${t.manifest.id}` })).not.toThrow();
      }
    }
  });
});
