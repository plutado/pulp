import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_LAYER_SIZE,
  DEFAULT_MOTION,
  DEFAULT_TYPOGRAPHY,
  defaultLayers,
  hasBlocks,
  newLayer,
  resolveLayers,
  validateBlock,
  validateLayer,
  parseLayersArgument,
  type Block,
  type ImageLayer,
  type TextLayer,
} from '../src/core/layers';
import { validateManifest, type ValidationIssue } from '../src/core/manifest';
import { rawManifest } from './fixtures';

/** A lower third's block: a name over a title, the name required, room for one more line. */
function rawBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'strap',
    label: 'Strap',
    box: { '16:9': { x: 0.08, y: 0.72, width: 0.6, height: 0.2 }, default: { x: 0.08, y: 0.6, width: 0.84, height: 0.2 } },
    gap: 0.01,
    align: 'left',
    typography: { family: 'Oswald', size: 0.07, weight: 600, color: '#FFFFFF' },
    layers: [
      { id: 'name', type: 'text', label: 'Name', text: 'Jane Doe', required: true, case: 'upper' },
      { id: 'title', type: 'text', label: 'Title', text: 'Reporter', size: 0.045, weight: 400, color: '#cfd8e3' },
      { id: 'mark', type: 'image', label: 'Mark', hidden: true, size: 0.08, align: 'right' },
    ],
    ...overrides,
  };
}

function block(overrides: Record<string, unknown> = {}): Block {
  const errors: ValidationIssue[] = [];
  const b = validateBlock(rawBlock(overrides), 'blocks[0]', errors);
  if (!b) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  return b;
}

function errorPaths(raw: unknown): string[] {
  const errors: ValidationIssue[] = [];
  validateBlock(raw, 'blocks[0]', errors);
  return errors.map((e) => e.path);
}

describe('validateBlock', () => {
  it('accepts a block and fills every default', () => {
    const b = block();
    expect(b).toMatchObject({ id: 'strap', label: 'Strap', direction: 'column', gap: 0.01, align: 'left', verticalAlign: 'top', open: true });
    // The block's typography starts from the defaults, takes the block's alignment, and what it names.
    expect(b.typography).toEqual({ ...DEFAULT_TYPOGRAPHY, family: 'Oswald', size: 0.07, weight: 600, color: '#ffffff', align: 'left' });
    expect(b.layers.map((l) => l.id)).toEqual(['name', 'title', 'mark']);
  });

  it('takes any integer weight from 100 to 900, since variable fonts have them all', () => {
    expect(block({ typography: { weight: 450 } }).typography.weight).toBe(450);
    expect(errorPaths(rawBlock({ typography: { weight: 950 } }))).toEqual(['blocks[0].typography.weight']);
  });

  it('a text layer starts from the block typography and overrides what it names', () => {
    const [name, title] = block().layers as TextLayer[];
    expect(name).toMatchObject({ type: 'text', text: 'Jane Doe', required: true, hidden: false, spaceBefore: 0, family: 'Oswald', size: 0.07, weight: 600, case: 'upper', color: '#ffffff', align: 'left', overflow: 'wrap' });
    expect(title).toMatchObject({ required: false, family: 'Oswald', size: 0.045, weight: 400, color: '#cfd8e3', case: 'none' });
  });

  it('an image layer carries no image, a size and an alignment, and may start hidden', () => {
    const mark = block().layers[2] as ImageLayer;
    expect(mark).toEqual({ id: 'mark', type: 'image', label: 'Mark', required: false, hidden: true, spaceBefore: 0, motion: DEFAULT_MOTION, image: null, size: 0.08, align: 'right' });
    expect((block({ layers: [{ id: 'logo', type: 'image', label: 'Logo' }] }).layers[0] as ImageLayer)).toMatchObject({ size: DEFAULT_IMAGE_LAYER_SIZE, align: 'left' });
    expect(errorPaths(rawBlock({ layers: [{ id: 'logo', type: 'image', label: 'Logo', image: 'abc' }] }))).toEqual(['blocks[0].layers[0].image']);
  });

  it('a centered block centers its layers unless the typography says otherwise', () => {
    expect(block({ align: 'center' }).typography.align).toBe('center');
    expect((block({ align: 'center', layers: [{ id: 'logo', type: 'image', label: 'Logo' }] }).layers[0] as ImageLayer).align).toBe('center');
    expect(block({ align: 'center', typography: { align: 'right' } }).typography.align).toBe('right');
  });

  it('reports every wrong field by path', () => {
    const paths = errorPaths(
      rawBlock({
        id: '1st',
        label: '',
        box: { x: 0.5, y: 0.5, width: 0.6, height: 0.6 },
        direction: 'stack',
        gap: 2,
        align: 'middle',
        verticalAlign: 'left',
        open: 'yes',
        typography: { family: '', size: 0, weight: 50, italic: 'no', case: 'caps', letterSpacing: 5, kerning: 1, lineHeight: 0, color: 'white', align: 'justify', overflow: 'ellipsis' },
        layers: [
          { id: 'a', type: 'text', label: 'A', text: 1, spaceBefore: -1, hidden: 'no', required: 'yes' },
          { id: 'b', type: 'video', label: 'B' },
          { id: 'c c', type: 'image', label: 'C', size: 3, align: 'top' },
          'not a layer',
        ],
      }),
    );
    expect(paths).toEqual([
      'blocks[0].id',
      'blocks[0].label',
      'blocks[0].box',
      'blocks[0].direction',
      'blocks[0].gap',
      'blocks[0].align',
      'blocks[0].verticalAlign',
      'blocks[0].open',
      ...['family', 'size', 'weight', 'italic', 'kerning', 'case', 'letterSpacing', 'lineHeight', 'color', 'align', 'overflow'].map((f) => `blocks[0].typography.${f}`),
      'blocks[0].layers[0].required',
      'blocks[0].layers[0].hidden',
      'blocks[0].layers[0].spaceBefore',
      'blocks[0].layers[0].text',
      'blocks[0].layers[1].type',
      'blocks[0].layers[2].id',
      'blocks[0].layers[2].size',
      'blocks[0].layers[2].align',
      'blocks[0].layers[3]',
    ]);
  });

  it('rejects duplicate layer ids and a box per aspect with a bad key', () => {
    expect(errorPaths(rawBlock({ layers: [{ id: 'a', type: 'text', label: 'A', text: '' }, { id: 'a', type: 'text', label: 'A', text: '' }] }))).toEqual(['blocks[0].layers[1].id']);
    expect(errorPaths(rawBlock({ box: { wide: { x: 0, y: 0, width: 1, height: 1 } } }))).toEqual(['blocks[0].box.wide']);
  });

  it('accepts a block with no layers of its own: a place for the user to add to', () => {
    const b = block({ layers: undefined });
    expect(b.layers).toEqual([]);
    expect(b.open).toBe(true);
  });

  it('validateLayer alone refuses a non-object', () => {
    const errors: ValidationIssue[] = [];
    expect(validateLayer(null, 'x', block(), errors)).toBeNull();
    expect(errors).toEqual([{ path: 'x', message: 'must be an object' }]);
  });
});

describe('manifest blocks', () => {
  it('a manifest without blocks declares none', () => {
    const result = validateManifest(rawManifest());
    expect(result.ok && result.manifest.blocks).toEqual([]);
    expect(result.ok && hasBlocks(result.manifest)).toBe(false);
  });

  it('validates blocks and keeps them in the manifest', () => {
    const result = validateManifest(rawManifest({ blocks: [rawBlock(), rawBlock({ id: 'corner', layers: [] })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.blocks.map((b) => b.id)).toEqual(['strap', 'corner']);
    expect(hasBlocks(result.manifest)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('rejects blocks that are not an array, duplicate block ids and bad blocks by path', () => {
    const paths = (raw: unknown) => {
      const r = validateManifest(rawManifest({ blocks: raw }));
      return r.ok ? [] : r.errors.map((e) => e.path);
    };
    expect(paths({})).toEqual(['blocks']);
    expect(paths([rawBlock(), rawBlock()])).toEqual(['blocks[1].id']);
    expect(paths([rawBlock({ box: undefined })])).toEqual(['blocks[0].box']);
  });
});

describe('parseLayersArgument', () => {
  const m = () => {
    const r = validateManifest(rawManifest({ blocks: [rawBlock(), rawBlock({ id: 'corner', open: false, layers: [{ id: 'bug', type: 'image', label: 'Bug' }] })] }));
    if (!r.ok) throw new Error('fixture');
    return r.manifest;
  };

  it('patches the template\'s layers: what it names changes, the rest stay as the template has them', () => {
    const out = parseLayersArgument('{"strap":[{"id":"title","text":"Reporter at large"}]}', m());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.layers.strap!.map((l) => l.id)).toEqual(['name', 'title', 'mark']);
    expect((out.layers.strap![0] as TextLayer).text).toBe('Jane Doe'); // untouched
    expect((out.layers.strap![1] as TextLayer).text).toBe('Reporter at large');
    // A block not mentioned keeps its own layers too.
    expect(out.layers.corner!.map((l) => l.id)).toEqual(['bug']);
  });

  it('hides a line rather than dropping it, which is how a render leaves one out', () => {
    const out = parseLayersArgument('{"strap":[{"id":"title","hidden":true}]}', m());
    // The mark starts hidden in this template, and stays so; the title is the one that changed.
    expect(out.ok && out.layers.strap!.map((l) => `${l.id}${l.hidden ? ':hidden' : ''}`)).toEqual(['name', 'title:hidden', 'mark:hidden']);
  });

  it('says what is wrong with the JSON rather than falling back silently', () => {
    expect(parseLayersArgument('{"strap":', m())).toMatchObject({ ok: false });
    expect((parseLayersArgument('{"strap":', m()) as { message: string }).message).toMatch(/^layers: not valid JSON \(/);
    expect(parseLayersArgument('"strap"', m())).toMatchObject({ ok: false, message: expect.stringContaining('expected an object of layer stacks') });
  });

  it('names an unknown block, an unknown layer and a block that takes no more', () => {
    const message = (text: string) => (parseLayersArgument(text, m()) as { message: string }).message;
    expect(message('{"nope":[]}')).toBe('layers: "nope" is not a block of this template (it has "strap", "corner").');
    expect(message('{"strap":{}}')).toBe('layers: "strap" must be an array of layers.');
    expect(message('{"strap":[{"id":"nmae","text":"x"}]}')).toContain('"strap" has no layer "nmae" (it has "name", "title", "mark"); to add one, give it a type of text or image');
    expect(message('{"strap":[7]}')).toBe('layers: "strap" layer 0 must be an object.');
    expect(message('{"strap":[{"text":"x"}]}')).toContain('needs an id of one of its layers, or a type of text or image to add one');
    expect(message('{"corner":[{"type":"text","text":"x"}]}')).toBe('layers: "corner" takes no more layers.');
  });

  it('adds a layer that carries a type, at the end of the stack', () => {
    const out = parseLayersArgument('{"strap":[{"type":"text","text":"A third line"}]}', m());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.layers.strap!.map((l) => l.id)).toEqual(['name', 'title', 'mark', 'layer_1']);
    expect((out.layers.strap![3] as TextLayer).text).toBe('A third line');
  });

  it('reports every problem at once', () => {
    const message = (parseLayersArgument('{"nope":[],"strap":[{"id":"zzz"}]}', m()) as { message: string }).message;
    expect(message).toContain('"nope" is not a block of this template');
    expect(message).toContain('"strap" has no layer "zzz"');
  });
});

describe('resolveLayers', () => {
  const manifest = () => {
    const r = validateManifest(rawManifest({ blocks: [rawBlock(), rawBlock({ id: 'corner', open: false, layers: [{ id: 'bug', type: 'image', label: 'Bug', required: true }] })] }));
    if (!r.ok) throw new Error('fixture');
    return r.manifest;
  };

  it('carries a layer\'s own motion, from the template and from use-time input alike', () => {
    // A template may declare a layer's motion; anything it leaves out is the default.
    const declared = validateBlock({ id: 'b', label: 'B', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [
      { id: 'a', type: 'text', label: 'A', text: 'x', motion: { type: 'slide', delay: 1.5 } },
      { id: 'b', type: 'text', label: 'B', text: 'y', motion: { type: 'fade' } },
    ] }, 'blocks[0]', []);
    expect(declared!.layers[0]!.motion).toEqual({ type: 'slide', delay: 1.5 });
    expect(declared!.layers[1]!.motion).toEqual({ type: 'fade', delay: 0 });

    // And a person's own, through every route that carries raw values (a preset, a collection, --param).
    const { values, issues } = resolveLayers(manifest(), { strap: [{ id: 'name', motion: { type: 'scale', delay: 2 } }] });
    expect(issues).toEqual([]);
    expect(values.strap![0]!.motion).toEqual({ type: 'scale', delay: 2 });
    // What is left out keeps what the layer had, field by field, as everything else here does.
    expect(resolveLayers(manifest(), { strap: [{ id: 'name', motion: { delay: 1 } }] }).values.strap![0]!.motion).toEqual({ type: 'template', delay: 1 });
  });

  it('reports a motion it cannot use and keeps the layer\'s own', () => {
    const errors: ValidationIssue[] = [];
    validateBlock({ id: 'b', label: 'B', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [
      { id: 'a', type: 'text', label: 'A', text: 'x', motion: { type: 'explode', delay: 99 } },
    ] }, 'blocks[0]', errors);
    expect(errors.map((e) => e.path)).toEqual(['blocks[0].layers[0].motion.type', 'blocks[0].layers[0].motion.delay']);
    const bad = resolveLayers(manifest(), { strap: [{ id: 'name', motion: 'fast' }] });
    expect(bad.issues.map((i) => i.message)).toEqual([expect.stringContaining('motion must be an object')]);
    expect(bad.values.strap![0]!.motion).toEqual({ type: 'template', delay: 0 });
  });

  it('returns the template\'s own stacks, as copies, when nothing is given', () => {
    const m = manifest();
    const { values, issues } = resolveLayers(m, undefined);
    expect(issues).toEqual([]);
    expect(values).toEqual(defaultLayers(m));
    expect(values.strap![0]).not.toBe(m.blocks[0]!.layers[0]);
  });

  it('takes the fields the input changed, keeps the rest, and never lets input change type or required', () => {
    const { values, issues } = resolveLayers(manifest(), {
      strap: [
        { id: 'name', text: 'Ada Lovelace', color: '#ff0000', required: false, type: 'image' },
        { id: 'title', hidden: true, size: 0.05 },
        { id: 'mark', hidden: false, image: { id: 'abcdefabcdefabcdefabcdef', treatment: 'white' }, size: 0.1 },
      ],
    });
    const [name, title, mark] = values.strap! as [TextLayer, TextLayer, ImageLayer];
    expect(name).toMatchObject({ type: 'text', text: 'Ada Lovelace', color: '#ff0000', required: true, family: 'Oswald', case: 'upper' });
    expect(title).toMatchObject({ hidden: true, size: 0.05, text: 'Reporter' });
    expect(mark).toMatchObject({ hidden: false, size: 0.1, image: { id: 'abcdefabcdefabcdefabcdef', treatment: 'white', tint: '#ffffff', effect: 'none' } });
    expect(issues).toEqual([{ block: 'strap', layer: 'name', message: 'is a text layer; its type cannot change' }]);
    // The closed block was not given, so it is the template's.
    expect(values.corner).toEqual(defaultLayers(manifest()).corner);
  });

  it('adds a layer to an open block with the block\'s typography, in the position given, naming it when it has to', () => {
    const { values, issues } = resolveLayers(manifest(), {
      strap: [{ id: 'name' }, { type: 'text', text: 'Live from Paris', weight: 300 }, { id: 'title' }, { id: 'mark' }, { type: 'image', id: 'second logo' }, { type: 'image', id: 'logo2', align: 'center' }],
    });
    expect(values.strap!.map((l) => l.id)).toEqual(['name', 'layer_1', 'title', 'mark', 'layer_2', 'logo2']);
    const added = values.strap![1] as TextLayer;
    expect(added).toMatchObject({ type: 'text', label: 'Text', text: 'Live from Paris', weight: 300, family: 'Oswald', size: 0.07, required: false, hidden: false });
    expect(values.strap![4]).toMatchObject({ type: 'image', image: null, size: DEFAULT_IMAGE_LAYER_SIZE, align: 'left' });
    expect(values.strap![5]).toMatchObject({ type: 'image', align: 'center' });
    expect(issues).toEqual([{ block: 'strap', message: 'layer 4 has an unusable id; renamed' }]);
  });

  it('falls back field by field on wrong values and says so', () => {
    const { values, issues } = resolveLayers(manifest(), {
      strap: [{ id: 'name', text: 7, size: 9, color: 'red', case: 'shout', label: '' }, { id: 'mark', image: 'nope', size: 'big', align: 'up' }],
    });
    expect(values.strap![0]).toMatchObject({ text: 'Jane Doe', size: 0.07, color: '#ffffff', case: 'upper', label: 'Name' });
    expect(values.strap![1]).toMatchObject({ image: null, size: 0.08, align: 'right' });
    expect(issues.map((i) => `${i.layer}: ${i.message}`)).toEqual([
      'name: label must be a non-empty string; kept',
      'name: size must be a fraction of the frame\'s short side, from 0.001 to 1; kept',
      'name: case must be one of: none, upper, lower, title; kept',
      'name: color must be a color in #RRGGBB or #RRGGBBAA form; kept',
      'name: text must be a string; kept',
      'mark: image must be a library id with an optional treatment, or null; kept',
      'mark: size must be a fraction of the frame\'s short side, from 0.001 to 1; kept',
      'mark: align must be one of: left, center, right; kept',
    ]);
    // The title was left out and is not required, so it is gone.
    expect(values.strap!.map((l) => l.id)).toEqual(['name', 'mark']);
  });

  it('puts a required layer back where the template had it, and drops additions to a full block', () => {
    const { values, issues } = resolveLayers(manifest(), {
      strap: [{ id: 'title' }, { id: 'mark' }],
      corner: [{ type: 'text', text: 'Extra' }],
    });
    expect(values.strap!.map((l) => l.id)).toEqual(['name', 'title', 'mark']);
    expect(values.corner!.map((l) => l.id)).toEqual(['bug']);
    expect(issues).toEqual([
      { block: 'strap', layer: 'name', message: 'is required; put back' },
      { block: 'corner', message: 'is full: added text layer dropped' },
      { block: 'corner', layer: 'bug', message: 'is required; put back' },
    ]);
  });

  it('treats unusable input as the template\'s and reports it', () => {
    const m = manifest();
    expect(resolveLayers(m, 'layers')).toEqual({ values: defaultLayers(m), issues: [{ block: '', message: 'layers must be an object of stacks by block id; using the template\'s' }] });
    const r = resolveLayers(m, { strap: 'x', other: [], corner: [{ id: 'bug' }, 42, { id: 'bug' }] });
    expect(r.values.strap).toEqual(defaultLayers(m).strap);
    expect(r.values.corner!.map((l) => l.id)).toEqual(['bug']);
    expect(r.issues).toEqual([
      { block: 'other', message: 'not a block of this template; ignored' },
      { block: 'strap', message: 'must be an array of layers; using the template\'s' },
      { block: 'corner', message: 'layer 1 is not an object; dropped' },
      { block: 'corner', layer: 'bug', message: 'appears twice; the second dropped' },
    ]);
  });

  it('newLayer hands out a layer of either type from a block', () => {
    const b = block({ align: 'center' });
    expect(newLayer('text', b, 'x')).toEqual({ id: 'x', label: 'Text', required: false, hidden: false, spaceBefore: 0, motion: DEFAULT_MOTION, ...b.typography, type: 'text', text: '', maxLines: 3 });
    expect(newLayer('image', b, 'y', 'Logo')).toEqual({ id: 'y', label: 'Logo', required: false, hidden: false, spaceBefore: 0, motion: DEFAULT_MOTION, type: 'image', image: null, size: DEFAULT_IMAGE_LAYER_SIZE, align: 'center' });
  });
});
