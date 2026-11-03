/**
 * Parameters by picking (milestone 55's second piece): an exposure is a name
 * bound to one property of one layer — metadata only, never a second copy of
 * the value — riding under `@expose` with the parameters, like the layers do.
 */

import { describe, expect, it } from 'vitest';
import {
  EXPOSE_KEY,
  exposableProps,
  exposedValue,
  exposeId,
  exposeIn,
  MAX_EXPOSED,
  pruneExpose,
  sanitizeExpose,
  suggestedLabel,
  withExpose,
  withExposedValue,
  type ExposedParam,
} from '../src/core/expose';
import { splitLayers } from '../src/core/params';
import { applyPreset, diffFromDefaults } from '../src/core/param-presets';
import { newLayer, DEFAULT_SHAPE_COLOR, DEFAULT_TYPOGRAPHY, type Layer, type LayerValues, type TextLayer } from '../src/core/layers';
import { validManifest } from './fixtures';

const block = { typography: DEFAULT_TYPOGRAPHY, align: 'left' as const };
const line = (): Layer => ({ ...(newLayer('text', block, 'who') as TextLayer), text: 'Ada' });
const shape = (): Layer => newLayer('shape', block, 'bar');
const still = (): Layer => newLayer('image', block, 'logo');
const stacks = (): LayerValues => ({ canvas: [line(), shape(), still()] });

const exposure = (over: Partial<ExposedParam> = {}): ExposedParam =>
  ({ id: 'who_words', label: 'Who it is', block: 'canvas', layer: 'who', prop: 'text', ...over });

describe('what can be picked', () => {
  it('is the words and the colour of a line, the colour of a shape, the picture of a still — and nothing of a sound or a clip', () => {
    expect(exposableProps(line())).toEqual(['text', 'color']);
    expect(exposableProps(shape())).toEqual(['color']);
    expect(exposableProps(still())).toEqual(['image']);
    expect(exposableProps(newLayer('video', block, 'v'))).toEqual([]);
    expect(exposableProps(newLayer('audio', block, 'a'))).toEqual([]);
  });

  it('starts named after the layer, and its id is an identifier made from the name, kept unique', () => {
    expect(suggestedLabel('Line 1', 'text')).toBe('Line 1 words');
    expect(suggestedLabel('Shape 1', 'color')).toBe('Shape 1 colour');
    expect(exposeId('Who it is', new Set())).toBe('who_it_is');
    expect(exposeId('Who it is', new Set(['who_it_is']))).toBe('who_it_is_2');
    expect(exposeId('3rd line', new Set())).toBe('p3rd_line');
    expect(exposeId('   ', new Set())).toBe('parameter');
  });
});

describe('the stored list', () => {
  it('rides under @expose, round-trips, and leaves the bag clean when empty', () => {
    const raw = withExpose({ '@layers': {} }, [exposure()]);
    expect(exposeIn(raw)).toEqual([exposure()]);
    expect(exposeIn(withExpose(raw, []))).toEqual([]);
    expect(EXPOSE_KEY in withExpose(raw, [])).toBe(false);
  });

  it('keeps only whole, well-shaped entries with unique ids, and no more than the ceiling', () => {
    expect(sanitizeExpose('nope')).toEqual([]);
    expect(sanitizeExpose([exposure(), 7, { id: 'x' }, exposure({ label: ' ' }), exposure({ id: '3bad' }), exposure({ prop: 'words' as never })])).toEqual([exposure()]);
    expect(sanitizeExpose([exposure(), exposure({ label: 'Twice' })])).toEqual([exposure()]);
    const many = Array.from({ length: MAX_EXPOSED + 5 }, (_, i) => exposure({ id: `p${i}` }));
    expect(sanitizeExpose(many)).toHaveLength(MAX_EXPOSED);
  });

  it('never reaches parameter resolution: splitLayers strips it with the other riders', () => {
    const { params } = splitLayers(withExpose({ color: '#fff' }, [exposure()]));
    expect(params).toEqual({ color: '#fff' });
  });

  it('rides in a preset and survives applying one, like the layers it names', () => {
    const manifest = validManifest();
    const raw = withExpose({ '@layers': stacks() }, [exposure()]);
    const preset = diffFromDefaults(manifest, raw);
    expect(preset[EXPOSE_KEY]).toEqual([exposure()]);
    expect(applyPreset(manifest, preset)[EXPOSE_KEY]).toEqual([exposure()]);
  });
});

describe('the binding', () => {
  it('reads the value off the bound layer, never a stored copy', () => {
    expect(exposedValue(exposure(), stacks())).toBe('Ada');
    expect(exposedValue(exposure({ layer: 'bar', prop: 'color' }), stacks())).toBe(DEFAULT_SHAPE_COLOR);
    expect(exposedValue(exposure({ layer: 'logo', prop: 'image' }), stacks())).toBeNull();
  });

  it('is pruned from view once its layer has gone or cannot hold the property', () => {
    const list = [exposure(), exposure({ id: 'gone', layer: 'nope' }), exposure({ id: 'wrong', layer: 'bar', prop: 'text' })];
    expect(pruneExpose(list, stacks())).toEqual([exposure()]);
    expect(exposedValue(exposure({ layer: 'bar', prop: 'text' }), stacks())).toBeUndefined();
  });

  it('writes the value onto the bound layer and nothing else', () => {
    const next = withExposedValue(exposure(), stacks(), 'Grace');
    expect(next.canvas![0]).toMatchObject({ id: 'who', text: 'Grace' });
    expect(next.canvas![1]).toEqual(stacks().canvas![1]);
    const coloured = withExposedValue(exposure({ layer: 'bar', prop: 'color' }), stacks(), '#FF0000');
    expect(coloured.canvas![1]).toMatchObject({ color: '#ff0000' });
    const pictured = withExposedValue(exposure({ layer: 'logo', prop: 'image' }), stacks(), { id: 'a'.repeat(24) });
    expect(pictured.canvas![2]).toMatchObject({ image: { id: 'a'.repeat(24) } });
  });

  it('refuses a value the property cannot take, handing the stacks back untouched', () => {
    const before = stacks();
    expect(withExposedValue(exposure(), before, 42)).toBe(before);
    expect(withExposedValue(exposure({ layer: 'bar', prop: 'color' }), before, 'red')).toBe(before);
    expect(withExposedValue(exposure({ layer: 'nope' }), before, 'Grace')).toBe(before);
  });
});
