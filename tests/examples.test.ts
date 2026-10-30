/**
 * The bundled example projects (milestone 31): every file the index lists
 * parses as a project, holds only bundled templates named by manifest id —
 * the one name that travels — and the ids are real.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProject } from '../src/core/project';
import { PRESET_IDS } from '../src/core/render-plan';
import { ASPECT_IDS } from '../src/core/aspect';

const ROOT = join(__dirname, '..');
const EXAMPLES = join(ROOT, 'examples');

async function bundledTemplateIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (entry.name === 'template.json') {
        const manifest = JSON.parse(await readFile(join(dir, entry.name), 'utf8')) as { id?: string };
        if (manifest.id) ids.add(manifest.id);
      }
    }
  };
  await walk(join(ROOT, 'templates'));
  return ids;
}

interface IndexEntry { file: string; name: string; description: string }

describe('the bundled example projects (milestone 31)', () => {
  it('lists a handful, each with a name and a one-line description', async () => {
    const index = JSON.parse(await readFile(join(EXAMPLES, 'index.json'), 'utf8')) as IndexEntry[];
    expect(index.length).toBeGreaterThanOrEqual(4);
    for (const entry of index) {
      expect(entry.name).not.toBe('');
      expect(entry.description).not.toBe('');
      expect(entry.file).toMatch(/\.pulp$/);
    }
    // Every .pulp in the folder is listed: an unlisted example would never be offered.
    const files = (await readdir(EXAMPLES)).filter((f) => f.endsWith('.pulp')).sort();
    expect(index.map((e) => e.file).sort()).toEqual(files);
  });

  it('parses every example as a project of real bundled templates', async () => {
    const ids = await bundledTemplateIds();
    const index = JSON.parse(await readFile(join(EXAMPLES, 'index.json'), 'utf8')) as IndexEntry[];
    for (const entry of index) {
      const parsed = parseProject(await readFile(join(EXAMPLES, entry.file), 'utf8'));
      expect(parsed.ok, entry.file).toBe(true);
      if (!parsed.ok) continue;
      const items = parsed.project.collection.items;
      expect(items.length, entry.file).toBeGreaterThan(0);
      // Nothing machine-bound: an example opens the same anywhere.
      expect(parsed.project.libraryFolders).toEqual([]);
      for (const item of items) {
        expect(item.kind, `${entry.file}: ${item.name}`).toBe('template');
        expect(item.templateId && ids.has(item.templateId), `${entry.file}: ${item.templateId}`).toBe(true);
        expect(item.path, `${entry.file}: ${item.name} carries a path`).toBeUndefined();
        expect(PRESET_IDS.includes(item.presetId as (typeof PRESET_IDS)[number]), `${entry.file}: ${item.presetId}`).toBe(true);
        if (item.options.aspect !== undefined) expect(ASPECT_IDS.includes(item.options.aspect)).toBe(true);
      }
    }
  });
});
