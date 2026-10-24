import { describe, expect, it } from 'vitest';
import { defaultLayers } from '../src/core/layers';
import { validateManifest, type TemplateManifest } from '../src/core/manifest';
import { hasCards, paramCards, REST_CARD_LABEL } from '../src/core/param-cards';
import { rawManifest } from './fixtures';

const block = (over: Record<string, unknown> = {}) => ({
  id: 'strap',
  label: 'Strap',
  box: { x: 0, y: 0, width: 1, height: 1 },
  layers: [
    { id: 'name', type: 'text', label: 'Name', text: 'Alex', required: true },
    { id: 'title', type: 'text', label: 'Title', text: 'Editor' },
  ],
  ...over,
});

function manifest(over: Record<string, unknown>): TemplateManifest {
  const r = validateManifest(rawManifest(over));
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  return r.manifest;
}

const shape = (m: TemplateManifest, layers = {}) => paramCards(m, layers).map((c) => `${c.kind}:${c.label || '—'}:${c.params.map((p) => p.id).join(',') || '—'}`);

describe('paramCards', () => {
  it('gives a template that names no element and has no layers its plain form', () => {
    const m = manifest({});
    const cards = paramCards(m, {});
    expect(hasCards(cards)).toBe(false);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.kind).toBe('rest');
    expect(cards[0]!.label, 'no heading: there is nothing to tell it apart from').toBe('');
    expect(cards[0]!.params).toHaveLength(m.parameters.length);
  });

  it('puts the layers first, then the elements the parameters name, then what belongs to the whole graphic', () => {
    const m = manifest({
      blocks: [block()],
      parameters: [
        { id: 'panel', type: 'color', label: 'Fill', default: '#000000', element: 'Panel' },
        { id: 'side', type: 'select', label: 'Position', default: 'left', options: [{ value: 'left', label: 'Left' }] },
        { id: 'accent', type: 'color', label: 'Accent bar', default: '#ffffff', element: 'Panel' },
        { id: 'inOut', type: 'number', label: 'Animate in/out', default: 0.6 },
      ],
    });
    expect(shape(m)).toEqual([
      'layer:Name:—',
      'layer:Title:—',
      'element:Panel:panel,accent',
      `rest:${REST_CARD_LABEL}:side,inOut`,
    ]);
    expect(hasCards(paramCards(m, {}))).toBe(true);
  });

  it('leaves out the last card when every parameter belongs to a part', () => {
    const m = manifest({
      blocks: [block()],
      parameters: [{ id: 'panel', type: 'color', label: 'Fill', default: '#000000', element: 'Panel' }],
    });
    expect(shape(m)).toEqual(['layer:Name:—', 'layer:Title:—', 'element:Panel:panel']);
  });

  it('joins a parameter to a layer\'s card when it names that layer', () => {
    const m = manifest({
      blocks: [block()],
      parameters: [{ id: 'logo', type: 'image', label: 'Logo', element: 'Name', box: { x: 0, y: 0, width: 0.2, height: 0.2 } }],
    });
    const cards = paramCards(m, {});
    expect(cards.map((c) => c.label)).toEqual(['Name', 'Title']);
    expect(cards[0]!.params.map((p) => p.id)).toEqual(['logo']);
    expect(cards[0]!.kind).toBe('layer');
  });

  it('matches an element to a layer however it is cased or spaced', () => {
    const m = manifest({
      blocks: [block()],
      parameters: [{ id: 'c', type: 'color', label: 'Colour', default: '#ffffff', element: '  tITLE ' }],
    });
    expect(paramCards(m, {}).map((c) => `${c.label}:${c.params.length}`)).toEqual(['Name:0', 'Title:1']);
  });

  it('gathers a repeated element into one card, in the order it was first declared', () => {
    const m = manifest({
      parameters: [
        { id: 'a', type: 'color', label: 'A', default: '#000000', element: 'Panel' },
        { id: 'b', type: 'color', label: 'B', default: '#000000', element: 'Logo' },
        { id: 'c', type: 'color', label: 'C', default: '#000000', element: 'Panel' },
      ],
    });
    expect(shape(m)).toEqual(['element:Panel:a,c', 'element:Logo:b']);
  });

  it('shows the layers as they stand, added and hidden ones included, each with its place in the stack', () => {
    const m = manifest({ blocks: [block()], parameters: [] });
    const layers = defaultLayers(m);
    layers.strap = [
      ...layers.strap!,
      { id: 'extra', type: 'text', label: 'Line 3', text: 'Added', required: false, hidden: true, spaceBefore: 0, align: 'left', family: 'Inter', size: 0.05, weight: 400, italic: false, case: 'none', letterSpacing: 0, kerning: true, lineHeight: 1.2, color: '#ffffff', overflow: 'wrap', maxLines: 3 },
    ];
    const cards = paramCards(m, layers);
    expect(cards.map((c) => c.label)).toEqual(['Name', 'Title', 'Line 3']);
    expect(cards.map((c) => `${c.layer!.index}/${c.layer!.count}`)).toEqual(['0/3', '1/3', '2/3']);
    expect(cards[2]!.layer!.layer.hidden).toBe(true);
    expect(cards[2]!.id).toBe('layer:strap.extra');
  });

  it('keeps two blocks apart, in the order the template declares them', () => {
    const m = manifest({ blocks: [block(), block({ id: 'corner', label: 'Corner', layers: [{ id: 'bug', type: 'image', label: 'Bug' }] })], parameters: [] });
    const cards = paramCards(m, {});
    expect(cards.map((c) => `${c.layer!.block}.${c.layer!.layer.id}`)).toEqual(['strap.name', 'strap.title', 'corner.bug']);
  });
});

describe('the element field', () => {
  it('is kept on the parameter, and must say something', () => {
    const m = manifest({ parameters: [{ id: 'a', type: 'color', label: 'A', default: '#000000', element: 'Panel' }] });
    expect(m.parameters[0]!.element).toBe('Panel');
    const bad = validateManifest(rawManifest({ parameters: [{ id: 'a', type: 'color', label: 'A', default: '#000000', element: '  ' }] }));
    expect(bad.ok).toBe(false);
    expect(bad.ok ? [] : bad.errors.map((e) => e.path)).toEqual(['parameters[0].element']);
  });
});
