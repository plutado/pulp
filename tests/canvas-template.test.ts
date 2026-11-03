/**
 * The canvas saved as a template folder (milestone 55's fifth piece): the
 * generated files pass the validator and the JSON Schema, carry the
 * composition whole — layers, motions, layouts per aspect, picked parameters —
 * refuse to ship a library id, and stay editable by hand.
 */

import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canvasTemplateFiles, type CanvasSaveInput } from '../src/core/canvas-template';
import { exposeId, suggestedLabel, type ExposedParam } from '../src/core/expose';
import { applyMotionPreset } from '../src/core/motion-presets';
import { newLayer, resolveLayers, type Layer, type LayerValues, type ShapeLayer, type TextLayer } from '../src/core/layers';
import { parseManifest, validateManifest, type TemplateManifest } from '../src/core/manifest';
import { defaultParams, resolveParams } from '../src/core/params';

const schema = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'schema', 'template.schema.json'), 'utf8')) as object;
const canvasManifest = (): TemplateManifest => {
  const raw = JSON.parse(readFileSync(join(__dirname, '..', 'templates', 'blank-canvas', 'template.json'), 'utf8')) as object;
  const r = validateManifest(raw);
  if (!r.ok) throw new Error('the blank canvas no longer validates');
  return r.manifest;
};

function composition(): { layers: LayerValues; expose: ExposedParam[] } {
  const canvas = canvasManifest();
  const block = canvas.blocks[0]!;
  const line: TextLayer = { ...(newLayer('text', block, 'text_1', 'Line 1') as TextLayer), text: 'Hello', placement: { '16:9': { dx: 0.1, dy: 0, scale: 1.2, rotate: 0 }, default: { dx: 0.05, dy: 0, scale: 1, rotate: 0 } } };
  const bar = applyMotionPreset({ ...(newLayer('shape', block, 'shape_1', 'Shape 1') as ShapeLayer), ratio: 2.5 }, 'drift', { start: 0, end: 6 }) as ShapeLayer;
  const still: Layer = { ...newLayer('image', block, 'image_1', 'Image 1'), image: { id: 'a'.repeat(24), treatment: 'original', tint: '#ffffff', effect: 'none', hidden: false } } as Layer;
  const expose: ExposedParam[] = [
    { id: exposeId(suggestedLabel('Line 1', 'text'), new Set()), label: 'Who it is', block: block.id, layer: 'text_1', prop: 'text' },
    { id: 'accent', label: 'Accent', block: block.id, layer: 'shape_1', prop: 'color' },
    { id: 'logo', label: 'Logo', block: block.id, layer: 'image_1', prop: 'image' },
  ];
  return { layers: { [block.id]: [line, bar, still] }, expose };
}

const save = (over: Partial<CanvasSaveInput> = {}) => {
  const { layers, expose } = composition();
  return canvasTemplateFiles({ name: 'Birthday Opener', layers, expose, length: 8, canvas: canvasManifest(), ...over });
};

describe('the generated folder', () => {
  it('passes the validator and the JSON Schema, named and identified from the folder name', () => {
    const made = save();
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.files.folder).toBe('birthday-opener');
    expect(made.files.templateId).toBe('custom.birthday-opener');
    const parsed = parseManifest(made.files.manifest);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    const ajv = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false });
    const valid = ajv.validate(schema, JSON.parse(made.files.manifest));
    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(parsed.manifest.name).toBe('Birthday Opener');
    expect(parsed.manifest.duration).toBe(8);
    expect(parsed.manifest.structure).toMatchObject({ kind: 'loop' });
    expect(parsed.manifest.aspects).toEqual(canvasManifest().aspects);
  });

  it('carries the composition whole: layers with motions, keys and layouts per aspect, under the canvas block', () => {
    const made = save();
    if (!made.ok) throw new Error(made.message);
    const parsed = parseManifest(made.files.manifest);
    if (!parsed.ok) throw new Error('did not parse');
    const block = parsed.manifest.blocks[0]!;
    expect(block.transition, 'the block hands fresh layers the canvas fade').toBeDefined();
    const [line, bar] = block.layers as [TextLayer, ShapeLayer];
    expect(line).toMatchObject({ type: 'text', text: 'Hello' });
    expect(line.placement!['16:9']).toMatchObject({ dx: 0.1, scale: 1.2 });
    expect(line.placement!.default).toMatchObject({ dx: 0.05 });
    expect(bar).toMatchObject({ type: 'shape', ratio: 2.5 });
    expect(bar.transition!.in.type).toBe('fade');
    expect(bar.keys!.length).toBe(2);
    // Reopened for editing: the same stacks resolve against the saved template with nothing reported.
    const reopened = resolveLayers(parsed.manifest, { [block.id]: block.layers });
    expect(reopened.issues).toEqual([]);
  });

  it('turns the picked words and color into parameters wired in the page, and says a picture cannot travel yet', () => {
    const made = save();
    if (!made.ok) throw new Error(made.message);
    const parsed = parseManifest(made.files.manifest);
    if (!parsed.ok) throw new Error('did not parse');
    expect(parsed.manifest.parameters.map((p) => ({ id: p.id, type: p.type }))).toEqual([
      { id: 'line_1_words', type: 'text' },
      { id: 'accent', type: 'color' },
    ]);
    expect(parsed.manifest.parameters[0]).toMatchObject({ label: 'Who it is', default: 'Hello', element: 'Line 1' });
    expect(Object.keys(defaultParams(parsed.manifest))).toEqual(['line_1_words', 'accent']);
    expect(resolveParams(parsed.manifest, { line_1_words: 'Ada', accent: '#2266ff' }).issues).toEqual([]);
    for (const pick of [
      { layer: 'text_1', field: 'text', param: 'line_1_words' },
      { layer: 'shape_1', field: 'color', param: 'accent' },
    ]) expect(made.files.page).toContain(JSON.stringify(pick).slice(1, -1));
    expect(made.files.notes.some((n) => n.startsWith('Logo:'))).toBe(true);
  });

  it('never ships a library id: the picture is left behind and said, the layer saved empty', () => {
    const made = save();
    if (!made.ok) throw new Error(made.message);
    expect(made.files.manifest).not.toContain('a'.repeat(24));
    const parsed = parseManifest(made.files.manifest);
    if (!parsed.ok) throw new Error('did not parse');
    const image = parsed.manifest.blocks[0]!.layers[2]!;
    expect(image).toMatchObject({ type: 'image', image: null });
    expect(made.files.notes.some((n) => n.includes('picture stays behind'))).toBe(true);
  });

  it('is editable by hand afterwards: a tweaked manifest still validates', () => {
    const made = save();
    if (!made.ok) throw new Error(made.message);
    const edited = JSON.parse(made.files.manifest) as { blocks: { layers: { color?: string }[] }[]; license: string };
    edited.blocks[0]!.layers[1]!.color = '#123456';
    edited.license = 'MIT';
    const again = validateManifest(edited);
    expect(again.ok).toBe(true);
  });

  it('refuses an empty canvas and an empty name, saying why', () => {
    expect(save({ layers: { canvas: [] } })).toMatchObject({ ok: false, message: expect.stringContaining('Nothing is on the canvas') });
    expect(save({ name: '  ' })).toMatchObject({ ok: false, message: expect.stringContaining('needs a name') });
  });

  it('writes a page that avoids wall-clock time and draws from the size it is given', () => {
    const made = save();
    if (!made.ok) throw new Error(made.message);
    expect(made.files.page).toContain('window.pulpRender');
    expect(made.files.page).toContain('state.width');
    expect(made.files.page).toContain('state.height');
    expect(made.files.page).not.toMatch(/Date\.now|performance\.now|requestAnimationFrame|Math\.random|setTimeout|setInterval/);
    expect(made.files.page).not.toMatch(/https?:\/\//);
  });
});
