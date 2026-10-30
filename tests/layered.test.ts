/**
 * Layered stills beyond Photoshop (milestone 33), on generated fixtures only:
 * OpenRaster read as layers, Krita read as structure over its merged picture,
 * the PDF sniff that tells a compatible .ai apart, and the formats Pulp does
 * not read named with the export that works.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AI_NO_PDF_MESSAGE, KRA_PIXELS_LIMIT, parseKra, parseOra, sniffPdf, UNREADABLE_DESIGN_FORMATS, unreadableDesignNote } from '../src/core/layered';
import { encodePng } from '../src/core/png';
import { compositePsd, fileHiddenLayers, isLayeredExtension, layersTopFirst, placeableLayers, psdOutline } from '../src/core/psd';
import { writeZip } from '../src/core/zip';
import { solid } from './psd-fixture';

const inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b));
const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b));
const png = (rgba: Uint8Array, w: number, h: number) => Buffer.from(encodePng(rgba, w, h, deflate));
const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];

/** A 4 × 4 OpenRaster: a red backdrop, and a group holding a shown blue mark and a hidden green one. */
function oraFixture(over: { stackXml?: string } = {}): Buffer {
  const stackXml = over.stackXml ?? `<?xml version='1.0' encoding='UTF-8'?>
<image version="0.0.3" w="4" h="4">
  <stack>
    <stack name="Marks">
      <layer name="Green mark" src="data/green.png" visibility="hidden" x="2" y="2"/>
      <layer name="Blue mark" src="data/blue.png" opacity="0.5" composite-op="svg:multiply"/>
    </stack>
    <layer name="Backdrop" src="data/backdrop.png"/>
  </stack>
</image>`;
  return writeZip([
    { name: 'mimetype', data: Buffer.from('image/openraster') },
    { name: 'stack.xml', data: Buffer.from(stackXml) },
    { name: 'data/backdrop.png', data: png(solid(4, 4, RED), 4, 4) },
    { name: 'data/blue.png', data: png(solid(2, 2, BLUE), 2, 2) },
    { name: 'data/green.png', data: png(solid(2, 2, [0, 255, 0, 255]), 2, 2) },
    { name: 'mergedimage.png', data: png(solid(4, 4, RED), 4, 4) },
  ]);
}

const px = (rgba: Uint8Array, width: number, x: number, y: number) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe('OpenRaster (milestone 33)', () => {
  it('reads stack.xml top first into the shared document: names, groups, visibility, opacity, offsets and blends', () => {
    const doc = parseOra(oraFixture(), inflate);
    expect([doc.width, doc.height]).toEqual([4, 4]);
    // Bottom first, as every layered document here: the backdrop, then the group and its children.
    expect(doc.layers.map((l) => [l.id, l.name, l.kind, l.parent])).toEqual([
      ['L0', 'Backdrop', 'layer', null],
      ['L1', 'Blue mark', 'layer', 'L3'],
      ['L2', 'Green mark', 'layer', 'L3'],
      ['L3', 'Marks', 'group', null],
    ]);
    expect(layersTopFirst(doc.layers).map((l) => l.name)).toEqual(['Marks', 'Green mark', 'Blue mark', 'Backdrop']);
    expect(doc.layers[1]).toMatchObject({ opacity: 0.5, blend: 'multiply', width: 2, height: 2, left: 0, top: 0 });
    expect(doc.layers[2]).toMatchObject({ visible: false, left: 2, top: 2 });
    expect(fileHiddenLayers(doc.layers)).toEqual(['L2']);
    expect(doc.composite).not.toBeNull();

    // The same compositor the .psd uses draws it: blue multiplied at half over red.
    const shown = compositePsd(doc);
    expect(px(shown, 4, 0, 0)).toEqual([128, 0, 0, 255]);
    expect(px(shown, 4, 3, 3)).toEqual(RED);
    const other = compositePsd(doc, new Set(['L1']));
    expect(px(other, 4, 3, 3)).toEqual([0, 255, 0, 255]);
    // Placing: the drawn, shown layers, pixels in hand.
    expect(placeableLayers(psdOutline(doc), new Set(fileHiddenLayers(doc.layers))).map((l) => l.id)).toEqual(['L0', 'L1']);
  });

  it('names what it cannot use, and refuses what is not OpenRaster', () => {
    const odd = parseOra(oraFixture({ stackXml: `<image w="4" h="4"><stack><layer name="Plus" src="data/blue.png" composite-op="svg:plus"/><layer name="Lost" src="data/gone.png"/></stack></image>` }), inflate);
    expect(odd.layers.find((l) => l.name === 'Plus')!.limits).toEqual(['blend mode "plus" drawn as normal']);
    expect(odd.layers.find((l) => l.name === 'Lost')!.limits[0]).toContain('missing its picture');
    expect(() => parseOra(writeZip([{ name: 'other.txt', data: Buffer.from('x') }]), inflate)).toThrow(/no stack\.xml/);
  });
});

describe('Krita (milestone 33)', () => {
  const kraFixture = writeZip([
    { name: 'mimetype', data: Buffer.from('application/x-krita') },
    {
      name: 'maindoc.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<DOC xmlns="http://www.calligra.org/DTD/krita" syntaxVersion="2">
  <IMAGE name="art" width="4" height="4" colorspacename="RGBA">
    <layers>
      <layer nodetype="grouplayer" name="Marks" visible="1" opacity="255">
        <layers>
          <layer nodetype="paintlayer" name="Mark" visible="0" opacity="128" x="1" y="1"/>
        </layers>
      </layer>
      <layer nodetype="paintlayer" name="Backdrop" visible="1" opacity="255"/>
    </layers>
  </IMAGE>
</DOC>`),
    },
    { name: 'mergedimage.png', data: png(solid(4, 4, BLUE), 4, 4) },
  ]);

  it('reads the structure over the merged picture, and says the pixels are not read', () => {
    const doc = parseKra(kraFixture, inflate);
    expect([doc.width, doc.height]).toEqual([4, 4]);
    // maindoc.xml lists layers as the docker shows them, top first; the group's child sits under it.
    expect(layersTopFirst(doc.layers).map((l) => [l.name, l.kind, l.visible])).toEqual([
      ['Marks', 'group', true],
      ['Mark', 'layer', false],
      ['Backdrop', 'layer', true],
    ]);
    expect(doc.layers.find((l) => l.name === 'Mark')!.opacity).toBeCloseTo(0.5, 2);
    expect(doc.limits).toEqual([KRA_PIXELS_LIMIT]);
    // No layer pixels: the merged picture stands in whatever is hidden, and nothing is placeable alone.
    expect(px(compositePsd(doc), 4, 0, 0)).toEqual(BLUE);
    expect(px(compositePsd(doc, new Set(['L2'])), 4, 0, 0)).toEqual(BLUE);
    const outline = psdOutline(doc);
    expect(outline.layers.every((l) => l.kind === 'group' || l.hasPixels === false)).toBe(true);
    expect(placeableLayers(outline, new Set())).toEqual([]);
  });

  it('refuses a zip that is not a Krita file', () => {
    expect(() => parseKra(writeZip([{ name: 'x', data: Buffer.from('y') }]), inflate)).toThrow(/no maindoc\.xml/);
  });
});

describe('a PDF, or an .ai that carries one (milestone 33)', () => {
  it('tells a PDF from PostScript from anything else, and says how to re-save an incompatible .ai', () => {
    expect(sniffPdf(new TextEncoder().encode('%PDF-1.6\n…'))).toBe('pdf');
    expect(sniffPdf(new TextEncoder().encode('junk\n%PDF-1.4'))).toBe('pdf');
    expect(sniffPdf(new TextEncoder().encode('%!PS-Adobe-3.0\n'))).toBe('postscript');
    expect(sniffPdf(new TextEncoder().encode('GIF89a'))).toBe('neither');
    expect(AI_NO_PDF_MESSAGE).toContain('Create PDF Compatible File');
  });
});

describe('formats Pulp does not read, named with the export that works (milestone 33)', () => {
  it('covers Affinity, GIMP, Sketch, Procreate and EPS, and stays quiet about everything else', () => {
    expect(Object.keys(UNREADABLE_DESIGN_FORMATS).sort()).toEqual(['.afdesign', '.afphoto', '.eps', '.procreate', '.sketch', '.xcf']);
    const note = unreadableDesignNote('logo.afdesign', '.afdesign')!;
    expect(note).toContain('Affinity Designer');
    expect(note).toContain('export it as PSD, SVG or PDF');
    expect(unreadableDesignNote('art.XCF', '.XCF')).toContain('GIMP');
    expect(unreadableDesignNote('notes.txt', '.txt')).toBeNull();
    for (const [ext, format] of Object.entries(UNREADABLE_DESIGN_FORMATS)) {
      expect(unreadableDesignNote(`x${ext}`, ext)).toContain(format.exportAs.split(' ')[0]!);
      expect(isLayeredExtension(ext), `${ext} is named, not half-read`).toBe(false);
    }
  });
});
