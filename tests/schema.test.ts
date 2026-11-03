/**
 * The JSON Schemas for the template manifest and pack.json (milestone 8),
 * checked against the validators that are the last word on both formats
 * (`src/core/manifest.ts`, `src/core/pack.ts`): the lists the schema spells
 * out are the code's own, every bundled manifest passes both, and what the
 * validator refuses the schema refuses too. The schema is for authors' editors
 * and tools; the validator is what Pulp runs.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020';
import { PARAMETER_TYPES, TEMPLATE_CATEGORIES, validateManifest } from '../src/core/manifest';
import { parsePackManifest } from '../src/core/pack';
import { ASPECT_IDS } from '../src/core/aspect';
import { STYLES, TYPES } from '../src/core/taxonomy';
import { BLOCK_DIRECTIONS, LAYER_ALIGNS, LAYER_TYPES, TEXT_CASES, TEXT_OVERFLOWS, VERTICAL_ALIGNS } from '../src/core/layers';
import { IMAGE_ALIGNS, IMAGE_FITS } from '../src/core/image-slot';
import { LAYER_TRANSITIONS, TRANSITION_DIRECTIONS } from '../src/core/layer-time';
import { BLEND_MODES } from '../src/core/layer-look';
import { KEY_EASINGS } from '../src/core/layer-keys';
import { rawManifest } from './fixtures';

const ROOT = join(__dirname, '..');
const SCHEMA_DIR = join(ROOT, 'docs', 'schema');

type Schema = Record<string, unknown> & { $defs: Record<string, Record<string, unknown>>; properties: Record<string, Record<string, unknown>> };

const templateSchema = JSON.parse(await readFile(join(SCHEMA_DIR, 'template.schema.json'), 'utf8')) as Schema;
const packSchema = JSON.parse(await readFile(join(SCHEMA_DIR, 'pack.schema.json'), 'utf8')) as Schema;

// Strict, but for two lints: the one that wants every `required` name declared beside it (the top-level anyOf
// names fields the properties above it define) and the one that wants a `type` on every subschema of a oneOf.
const ajv = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false, allErrors: true });
ajv.addSchema(templateSchema);
const checkTemplate = ajv.compile(templateSchema);
const checkPack = ajv.compile(packSchema);

const schemaErrors = (ok: boolean, check: { errors?: unknown[] | null }) => (ok ? [] : (check.errors ?? []).map((e) => JSON.stringify(e)));

/** Every template.json under templates/ — the standalone ones and the packs' members — and the test fixtures. */
async function manifestFiles(): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || depth > 2) continue;
      const here = join(dir, d.name);
      const names = await readdir(here);
      if (names.includes('template.json')) files.push(join(here, 'template.json'));
      else await walk(here, depth + 1);
    }
  };
  await walk(join(ROOT, 'templates'), 0);
  await walk(join(ROOT, 'tests', 'e2e', 'templates'), 0);
  return files;
}

describe('the template schema', () => {
  it('compiles, and spells out the lists the validator holds the format to', () => {
    const defs = templateSchema.$defs;
    expect(templateSchema.properties.category!.enum).toEqual([...TEMPLATE_CATEGORIES]);
    expect(defs.typeId!.enum).toEqual(TYPES.map((t) => t.id));
    expect(defs.styleId!.enum).toEqual(STYLES.map((s) => s.id));
    expect(defs.aspectId!.enum).toEqual([...ASPECT_IDS]);
    const layerBase = defs.layerBase!.properties as Record<string, Record<string, unknown>>;
    expect(layerBase.type!.enum).toEqual([...LAYER_TYPES]);
    const parameterTypes = (defs.parameter!.oneOf as { properties: { type: { const: string } } }[]).map((p) => p.properties.type.const);
    expect(parameterTypes).toEqual([...PARAMETER_TYPES]);
    const image = (defs.parameter!.oneOf as { properties: Record<string, Record<string, unknown>> }[]).find((p) => p.properties.type!.const === 'image')!;
    expect(image.properties.fit!.enum).toEqual([...IMAGE_FITS]);
    expect(image.properties.align!.enum).toEqual([...IMAGE_ALIGNS]);
    const typography = defs.typography!.properties as Record<string, Record<string, unknown>>;
    expect(typography.case!.enum).toEqual([...TEXT_CASES]);
    expect(typography.overflow!.enum).toEqual([...TEXT_OVERFLOWS]);
    expect(typography.align!.enum).toEqual([...LAYER_ALIGNS]);
    const transition = defs.transitionEnd!.properties as Record<string, Record<string, unknown>>;
    expect(transition.type!.enum).toEqual([...LAYER_TRANSITIONS]);
    expect(transition.direction!.enum).toEqual([...TRANSITION_DIRECTIONS]);
    expect((layerBase.look!.properties as Record<string, Record<string, unknown>>).blend!.enum).toEqual([...BLEND_MODES]);
    expect(((layerBase.keys!.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>).easing!.enum).toEqual([...KEY_EASINGS]);
    const block = defs.block!.properties as Record<string, Record<string, unknown>>;
    expect(block.direction!.enum).toEqual([...BLOCK_DIRECTIONS]);
    expect(block.verticalAlign!.enum).toEqual([...VERTICAL_ALIGNS]);
  });

  it('accepts every bundled manifest and every fixture the validator accepts', async () => {
    const files = await manifestFiles();
    expect(files.length).toBeGreaterThan(300);
    for (const file of files) {
      const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
      const byValidator = validateManifest(raw);
      const bySchema = checkTemplate(raw);
      expect(bySchema, `${file}: ${schemaErrors(bySchema, checkTemplate).join('; ')}`).toBe(byValidator.ok);
    }
  });

  it('accepts the test manifest, with and without the fields that are optional', () => {
    expect(checkTemplate(rawManifest()), schemaErrors(false, checkTemplate).join('; ')).toBe(true);
    const aspects = rawManifest({ aspects: ['16:9', '9:16'] });
    delete aspects.width;
    delete aspects.height;
    expect(checkTemplate(aspects)).toBe(true);
    expect(validateManifest(aspects).ok).toBe(true);
  });

  // What the validator refuses, the schema refuses: one case per rule the schema carries.
  const refused: [string, Record<string, unknown>][] = [
    ['no id', (() => { const m = rawManifest(); delete m.id; return m; })()],
    ['an id with capitals', rawManifest({ id: 'Studio.Title' })],
    ['a version that is not semver', rawManifest({ version: '1.0' })],
    ['an unknown category', rawManifest({ category: 'banner' })],
    ['a duration of nothing', rawManifest({ duration: 0 })],
    ['a rate past 240', rawManifest({ fps: 500 })],
    ['neither aspects nor a size', (() => { const m = rawManifest(); delete m.width; delete m.height; return m; })()],
    ['a width without a height', (() => { const m = rawManifest(); delete m.height; return m; })()],
    ['an aspect that is not built in', (() => { const m = rawManifest({ aspects: ['3:2'] }); delete m.width; delete m.height; return m; })()],
    ['a caption style that is not transparent', rawManifest({ captions: true, alpha: false })],
    ['a style that is not built in', rawManifest({ styles: ['brutalist'] })],
    ['a type that is not built in', rawManifest({ type: 'banner' })],
    ['an entry outside the folder', rawManifest({ entry: '../index.html' })],
    ['a poster at a negative time', rawManifest({ posterAt: -1 })],
    ['a structure that is both a hold and a loop', rawManifest({ structure: { holdFrom: 0.5, holdTo: 1.5, loop: true } })],
    ['a color default that is not a color', rawManifest({ parameters: [{ id: 'c', type: 'color', label: 'C', default: 'red' }] })],
    ['a select with no options', rawManifest({ parameters: [{ id: 's', type: 'select', label: 'S', default: 'a' }] })],
    ['an image slot with no box', rawManifest({ parameters: [{ id: 'logo', type: 'image', label: 'Logo', fit: 'contain' }] })],
    ['a parameter id starting with a digit', rawManifest({ parameters: [{ id: '1st', type: 'text', label: 'First', default: '' }] })],
    ['a layer of an unknown type', rawManifest({ blocks: [{ id: 'b', label: 'B', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [{ id: 'l', label: 'L', type: 'blob' }] }] })],
    ['a text layer with a weight past 900', rawManifest({ blocks: [{ id: 'b', label: 'B', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [{ id: 'l', label: 'L', type: 'text', text: 'x', weight: 1000 }] }] })],
    ['a block box that is not a box', rawManifest({ blocks: [{ id: 'b', label: 'B', box: { x: 0, y: 0 } }] })],
    ['a block box keyed by something that is not an aspect', rawManifest({ blocks: [{ id: 'b', label: 'B', box: { wide: { x: 0, y: 0, width: 1, height: 1 } } }] })],
  ];
  it.each(refused)('refuses %s, as the validator does', (_name, raw) => {
    expect(validateManifest(raw).ok, 'the validator').toBe(false);
    expect(checkTemplate(raw), 'the schema').toBe(false);
  });
});

describe('the pack schema', () => {
  it('accepts every bundled pack.json the validator accepts', async () => {
    const dirs = (await readdir(join(ROOT, 'templates'), { withFileTypes: true })).filter((d) => d.isDirectory());
    let packs = 0;
    for (const d of dirs) {
      const file = join(ROOT, 'templates', d.name, 'pack.json');
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      packs += 1;
      const parsed = parsePackManifest(text);
      const ok = checkPack(JSON.parse(text));
      expect(ok, `${file}: ${schemaErrors(ok, checkPack).join('; ')}`).toBe(parsed.ok);
    }
    expect(packs).toBe(4);
  });

  const good = { formatVersion: 1, name: 'News', license: 'CC0-1.0', templates: ['strap', 'bug'], type: 'lower-third', styles: ['clean'], themes: ['news'] };
  it('accepts a pack the reader accepts', () => {
    expect(parsePackManifest(JSON.stringify(good)).ok).toBe(true);
    expect(checkPack(good), schemaErrors(false, checkPack).join('; ')).toBe(true);
  });

  const refused: [string, Record<string, unknown>][] = [
    ['another format version', { ...good, formatVersion: 2 }],
    ['no name', (() => { const p: Record<string, unknown> = { ...good }; delete p.name; return p; })()],
    ['no templates', { ...good, templates: [] }],
    ['a template folder with a path in it', { ...good, templates: ['sets/strap'] }],
    ['a parent folder', { ...good, templates: ['..'] }],
    ['a type that is not built in', { ...good, type: 'banner' }],
    ['a style that is not built in', { ...good, styles: ['brutalist'] }],
    ['an author that is not a string', { ...good, author: 7 }],
  ];
  it.each(refused)('refuses %s, as the reader does', (_name, raw) => {
    expect(parsePackManifest(JSON.stringify(raw)).ok, 'the reader').toBe(false);
    expect(checkPack(raw), 'the schema').toBe(false);
  });
});
