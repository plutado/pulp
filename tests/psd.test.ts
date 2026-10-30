/**
 * Layered Photoshop files (milestone 33), on generated fixtures only: the
 * reader sees names, order, groups, visibility, opacity and blend modes; the
 * compositor draws what is shown; a single layer stands alone; and what Pulp
 * cannot reproduce is named rather than dropped.
 */

import { inflateSync, deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';
import { encodePng } from '../src/core/png';
import {
  blendPixel, compositePsd, fileHiddenLayers, layerCanvasBox, layerOnCanvas, layersTopFirst, layerShown, parsePsd, placeableLayers, psdLimitSummary, psdOutline, undoPrediction, unpackBits,
} from '../src/core/psd';
import { applyPrediction, solid, writePsd, type FixtureOptions } from './psd-fixture';

const inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b));
const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b));

const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const GREEN: [number, number, number, number] = [0, 255, 0, 255];

/** A 4 × 4 canvas: a red square over everything, a blue one in the top-left, a hidden green one, in a group. */
function fixture(over: Partial<FixtureOptions> = {}): Uint8Array {
  return writePsd({
    width: 4,
    height: 4,
    layers: [
      { name: 'Backdrop', left: 0, top: 0, width: 4, height: 4, rgba: solid(4, 4, RED) },
      {
        group: 'Marks',
        layers: [
          { name: 'Blue mark', left: 0, top: 0, width: 2, height: 2, rgba: solid(2, 2, BLUE), opacity: 0.5 },
          { name: 'Green mark', left: 2, top: 2, width: 2, height: 2, rgba: solid(2, 2, GREEN), visible: false },
        ],
      },
    ],
    composite: solid(4, 4, RED),
    ...over,
  });
}

const px = (rgba: Uint8Array, width: number, x: number, y: number) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

function parsed(bytes: Uint8Array) {
  const result = parsePsd(bytes, { inflate });
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

describe('reading a .psd', () => {
  it('reads the header, the layers in file order and their groups, names, visibility, opacity and blend', () => {
    const doc = parsed(fixture());
    expect([doc.width, doc.height, doc.depth, doc.mode]).toEqual([4, 4, 8, 'rgb']);
    // Bottom first, as the file has it: the backdrop, the group (its divider stands for it), its two children.
    expect(doc.layers.map((l) => [l.id, l.name, l.kind, l.parent, l.depth])).toEqual([
      ['L0', 'Backdrop', 'layer', null, 0],
      ['L1', 'Marks', 'group', null, 0],
      ['L2', 'Blue mark', 'layer', 'L1', 1],
      ['L3', 'Green mark', 'layer', 'L1', 1],
    ]);
    expect(doc.layers[2]).toMatchObject({ visible: true, blend: 'normal', left: 0, top: 0, width: 2, height: 2 });
    expect(doc.layers[2]!.opacity).toBeCloseTo(0.5, 2); // a byte of 128
    expect(doc.layers[3]).toMatchObject({ visible: false, left: 2, top: 2 });
    // A group's bounds are its children's.
    expect(doc.layers[1]).toMatchObject({ left: 0, top: 0, width: 4, height: 4 });
    expect(fileHiddenLayers(doc.layers)).toEqual(['L3']);
    expect(layersTopFirst(doc.layers).map((l) => l.id)).toEqual(['L3', 'L2', 'L1', 'L0']);
    expect(doc.composite).not.toBeNull();
    expect(px(doc.composite!, 4, 3, 3)).toEqual(RED);
  });

  it('reads RLE and 16-bit files the same as raw 8-bit ones, and grayscale replicated', () => {
    const raw = parsed(fixture());
    const rle = parsed(fixture({ rle: true }));
    expect(rle.layers.map((l) => l.name)).toEqual(raw.layers.map((l) => l.name));
    expect(rle.layers[2]!.pixels).toEqual(raw.layers[2]!.pixels);
    expect(rle.composite).toEqual(raw.composite);
    const deep = parsed(fixture({ depth: 16 }));
    expect(deep.layers[2]!.pixels).toEqual(raw.layers[2]!.pixels);
    expect(deep.limits.some((l) => l.includes('16-bit'))).toBe(true);
    const gray = parsed(writePsd({ width: 2, height: 1, grayscale: true, layers: [{ name: 'G', left: 0, top: 0, width: 2, height: 1, rgba: new Uint8Array([200, 200, 200, 255, 10, 10, 10, 128]) }] }));
    expect(gray.mode).toBe('grayscale');
    expect([...gray.layers[0]!.pixels!]).toEqual([200, 200, 200, 255, 10, 10, 10, 128]);
  });

  it('reads zip-compressed layer data, plain and with prediction, at 8 and 16 bits', () => {
    const raw = parsed(fixture());
    for (const compression of ['zip', 'zip-prediction'] as const) {
      for (const depth of [8, 16] as const) {
        const doc = parsed(fixture({ compression, depth, deflate }));
        expect(doc.layers[2]!.pixels, `${compression} at ${depth}`).toEqual(raw.layers[2]!.pixels);
        expect(doc.layers[0]!.pixels, `${compression} at ${depth}`).toEqual(raw.layers[0]!.pixels);
      }
    }
    // A varied row, so the prediction really has deltas to carry: a gradient survives the round trip.
    const gradient = new Uint8Array(16 * 4);
    for (let x = 0; x < 16; x += 1) gradient.set([x * 16, 255 - x * 16, (x * 37) % 256, 255], x * 4);
    const wavy = parsed(writePsd({ width: 16, height: 1, compression: 'zip-prediction', depth: 16, deflate, layers: [{ name: 'G', left: 0, top: 0, width: 16, height: 1, rgba: gradient }] }));
    expect([...wavy.layers[0]!.pixels!]).toEqual([...gradient]);
    // Prediction decode is the encode undone, at both depths.
    const row = new Uint8Array([5, 250, 7, 0, 130, 129]);
    expect(undoPrediction(applyPrediction(row, 3, 1, 8), 3, 1, 8)).toEqual(row);
    expect(undoPrediction(applyPrediction(row, 3, 1, 16), 3, 1, 16)).toEqual(row);
    // Without an inflate, zip data is refused by name rather than half-read.
    expect(parsePsd(fixture({ compression: 'zip', deflate }))).toMatchObject({ ok: false, message: expect.stringContaining('inflate') });
  });

  it('refuses what it cannot read, by name', () => {
    expect(parsePsd(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false, message: expect.stringContaining('8BPS') });
    expect(parsePsd(fixture({ version: 2 }))).toMatchObject({ ok: false, message: expect.stringContaining('.psb') });
    const truncated = fixture().subarray(0, 60);
    expect(parsePsd(truncated).ok).toBe(false);
  });

  it('unpacks PackBits runs: literals, repeats and the no-op byte', () => {
    expect([...unpackBits(new Uint8Array([2, 9, 8, 7, 254, 1, 128]), 6)]).toEqual([9, 8, 7, 1, 1, 1]);
  });
});

describe('compositing', () => {
  it('draws the shown layers bottom to top with their opacity, and leaves hidden ones out', () => {
    const doc = parsed(fixture());
    const shown = compositePsd(doc);
    // Blue at half opacity (a byte of 128) over red: a purple; red where only the backdrop is; the hidden green is not drawn.
    expect(px(shown, 4, 0, 0)).toEqual([127, 0, 128, 255]);
    expect(px(shown, 4, 3, 0)).toEqual(RED);
    expect(px(shown, 4, 3, 3)).toEqual(RED);
    // Showing the green and hiding the blue.
    const other = compositePsd(doc, new Set(['L2']));
    expect(px(other, 4, 0, 0)).toEqual(RED);
    expect(px(other, 4, 3, 3)).toEqual(GREEN);
    // Hiding the group hides everything in it.
    const noGroup = compositePsd(doc, new Set(['L1']));
    expect(px(noGroup, 4, 0, 0)).toEqual(RED);
    expect(layerShown(doc.layers, 'L2', new Set(['L1']))).toBe(false);
    expect(layerShown(doc.layers, 'L0', new Set(['L1']))).toBe(true);
    // Everything hidden: transparent.
    expect(px(compositePsd(doc, new Set(['L0', 'L1'])), 4, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('applies the blend modes it draws and a group\'s opacity, and names the ones it does not', () => {
    const bytes = writePsd({
      width: 1, height: 1,
      layers: [
        { name: 'Base', left: 0, top: 0, width: 1, height: 1, rgba: new Uint8Array([128, 128, 128, 255]) },
        { name: 'Mult', left: 0, top: 0, width: 1, height: 1, rgba: new Uint8Array([128, 255, 0, 255]), blendKey: 'mul ' },
        { name: 'Odd', left: 0, top: 0, width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]), blendKey: 'lLit' },
        { group: 'Faint', opacity: 0.5, layers: [{ name: 'White', left: 0, top: 0, width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]), blendKey: 'scrn' }] },
      ],
    });
    const doc = parsed(bytes);
    expect(doc.layers[1]!.blend).toBe('multiply');
    expect(doc.layers[2]!.blend).toBe('normal');
    expect(doc.layers[2]!.limits).toEqual(['blend mode "linear light" drawn as normal']);
    // Multiply: 128*128/255 ≈ 64, 128*255/255 = 128, 0; then white screened at half the group's opacity brightens each halfway to 255.
    const out = compositePsd(doc, new Set(['L3', 'L5']));
    expect(px(out, 1, 0, 0)).toEqual([64, 128, 0, 255]);
    const withScreen = compositePsd(doc, new Set());
    expect(px(withScreen, 1, 0, 0)).toEqual([160, 192, 128, 255]);
  });

  it('falls back to the stored composite for a file with no layers', () => {
    const flat = parsed(writePsd({ width: 2, height: 2, layers: [], composite: solid(2, 2, BLUE) }));
    expect(flat.layers).toEqual([]);
    expect(flat.limits.some((l) => l.includes('no layers'))).toBe(true);
    expect(px(compositePsd(flat), 2, 1, 1)).toEqual(BLUE);
  });
});

describe('the canvas blend set', () => {
  const grey: [number, number, number] = [0.5, 0.25, 0.75];

  it('maps every key a canvas draws natively, and computes with the same formulas', () => {
    const keyed = (key: string) => parsed(writePsd({ width: 1, height: 1, layers: [{ name: 'x', left: 0, top: 0, width: 1, height: 1, rgba: solid(1, 1, [0, 0, 0, 255]), blendKey: key }] })).layers[0]!;
    const mapped: Record<string, string> = {
      'mul ': 'multiply', scrn: 'screen', over: 'overlay', dark: 'darken', lite: 'lighten', 'div ': 'color-dodge', idiv: 'color-burn',
      hLit: 'hard-light', sLit: 'soft-light', diff: 'difference', smud: 'exclusion', 'hue ': 'hue', 'sat ': 'saturation', colr: 'color', 'lum ': 'luminosity',
    };
    for (const [key, blend] of Object.entries(mapped)) {
      const layer = keyed(key);
      expect(layer.blend, key).toBe(blend);
      expect(layer.limits, key).toEqual([]);
    }
    // Photoshop's own modes with no canvas name stay named.
    expect(keyed('vLit').limits).toEqual(['blend mode "vivid light" drawn as normal']);

    // The separable formulas, spot-checked against the W3C definitions.
    expect(blendPixel('color-dodge', grey, [0.5, 0.5, 0.5])).toEqual([1, 0.5, 1]);
    expect(blendPixel('color-burn', grey, [0.5, 0.5, 0.5])[0]).toBeCloseTo(0, 5);
    expect(blendPixel('hard-light', [0.5, 0.5, 0.5], [0.25, 0.75, 0.5])).toEqual([0.25, 0.75, 0.5]);
    expect(blendPixel('soft-light', [0.25, 0.25, 0.25], [0.75, 0.75, 0.75])[0]).toBeCloseTo(0.25 + 0.5 * (((16 * 0.25 - 12) * 0.25 + 4) * 0.25 - 0.25), 5);
    expect(blendPixel('exclusion', [0.5, 0, 1], [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]);
    // Overlay is hard-light with the two swapped.
    expect(blendPixel('overlay', [0.25, 0.75, 0.5], [0.5, 0.5, 0.5])).toEqual([0.25, 0.75, 0.5]);
  });

  it('computes the non-separable modes on the whole colour', () => {
    const red: [number, number, number] = [1, 0, 0];
    const grn: [number, number, number] = [0, 1, 0];
    // Luminosity: the backdrop's colour at the source's brightness — grey over red is still red, brighter.
    const lum = blendPixel('luminosity', red, [0.5, 0.5, 0.5]);
    expect(0.3 * lum[0]! + 0.59 * lum[1]! + 0.11 * lum[2]!).toBeCloseTo(0.5, 2);
    expect(lum[0]).toBeGreaterThan(lum[1]);
    expect(lum[1]).toBeCloseTo(lum[2], 5);
    // Colour: the source's hue and saturation at the backdrop's luminosity — red over green stays as bright as green.
    const col = blendPixel('color', grn, red);
    expect(col[0]).toBeGreaterThan(col[1]);
    expect(0.3 * col[0]! + 0.59 * col[1]! + 0.11 * col[2]!).toBeCloseTo(0.59, 2);
    // Hue keeps the backdrop's saturation and luminosity; saturation the backdrop's hue and luminosity.
    const hue = blendPixel('hue', grn, red);
    expect(0.3 * hue[0]! + 0.59 * hue[1]! + 0.11 * hue[2]!).toBeCloseTo(0.59, 2);
    const sat = blendPixel('saturation', red, [0.5, 0.5, 0.5]);
    expect(Math.max(...sat) - Math.min(...sat)).toBeCloseTo(0, 5);
    // A grey backdrop has no hue to keep: everything clips back to its luminosity.
    expect(blendPixel('saturation', [0.5, 0.5, 0.5], red).every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('draws a mapped mode through the compositor', () => {
    const doc = parsed(writePsd({
      width: 1, height: 1,
      layers: [
        { name: 'Base', left: 0, top: 0, width: 1, height: 1, rgba: new Uint8Array([64, 64, 64, 255]) },
        { name: 'Dodge', left: 0, top: 0, width: 1, height: 1, rgba: new Uint8Array([128, 128, 128, 255]), blendKey: 'div ' },
      ],
    }));
    const out = compositePsd(doc);
    // color-dodge: 0.25 / (1 - 0.5) = 0.5 of full.
    expect([...out.subarray(0, 4)].map((v) => Math.round(v / 10))).toEqual([13, 13, 13, 26]);
  });
});

describe('placing', () => {
  it('hands one layer alone, its opacity baked in, and says where it sits in the canvas', () => {
    const doc = parsed(fixture());
    const blue = layerOnCanvas(doc, 'L2')!;
    expect([blue.left, blue.top, blue.width, blue.height]).toEqual([0, 0, 2, 2]);
    expect([...blue.pixels.subarray(0, 4)]).toEqual([0, 0, 255, 128]);
    expect(layerOnCanvas(doc, 'L1'), 'a group is not a picture').toBeNull();
    expect(layerCanvasBox(doc, doc.layers[3]!)).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    // What a split places: drawn, shown, non-group layers, as the hidden list has it.
    const outline = psdOutline(doc);
    expect(placeableLayers(outline, new Set(fileHiddenLayers(doc.layers))).map((l) => l.id)).toEqual(['L0', 'L2']);
    expect(placeableLayers(outline, new Set()).map((l) => l.id)).toEqual(['L0', 'L2', 'L3']);
  });
});

describe('limits, said plainly', () => {
  it('names effects, smart objects, adjustment layers, masks and clipping on the layer that has them', () => {
    const doc = parsed(writePsd({
      width: 1, height: 1,
      layers: [
        { name: 'Styled', left: 0, top: 0, width: 1, height: 1, rgba: solid(1, 1, RED), extraKeys: ['lfx2'] },
        { name: 'Smart', left: 0, top: 0, width: 1, height: 1, rgba: solid(1, 1, RED), extraKeys: ['SoLd'], clipping: true },
        { name: 'Levels', left: 0, top: 0, width: 0, height: 0, rgba: new Uint8Array(0), extraKeys: ['levl'] },
      ],
    }));
    expect(doc.layers[0]!.limits).toEqual(['layer effects']);
    expect(doc.layers[1]!.limits).toEqual(['clipping mask (drawn unclipped)', 'smart object']);
    expect(doc.layers[2]!.limits).toEqual(['adjustment layer (levels)']);
    expect(doc.layers[2]!.pixels).toBeUndefined();
    const summary = psdLimitSummary(psdOutline(doc));
    expect(summary).toContain('layer effects');
    expect(summary).toContain('smart object');
    expect(summary).toContain('adjustment layer');
    expect(summary).toContain('picture Photoshop stored');
    expect(psdLimitSummary({ layers: [], limits: [], hasComposite: true })).toBe('');
  });

  it('the outline carries no pixels', () => {
    const outline = psdOutline(parsed(fixture()));
    expect(outline.layers.every((l) => !('pixels' in l))).toBe(true);
    expect(outline.hasComposite).toBe(true);
    expect([outline.width, outline.height]).toEqual([4, 4]);
  });
});

describe('a PNG from pixels', () => {
  it('writes a file a PNG reader accepts, with the rows filtered and deflated', () => {
    const rgba = solid(3, 2, [10, 20, 30, 40]);
    const png = encodePng(rgba, 3, 2, (b) => new Uint8Array(deflateSync(b)));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([3, 2, 8, 6]);
    // The IDAT inflates back to the rows, each led by a zero filter byte.
    const idatLength = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT');
    const rows = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...rows.subarray(0, 5)]).toEqual([0, 10, 20, 30, 40]);
    expect(rows.length).toBe((3 * 4 + 1) * 2);
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });
});
