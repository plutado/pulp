/**
 * An SVG as layers (milestone 33): the pure half — top-level groups found and
 * named, Inkscape and Illustrator conventions read, the document rebuilt for a
 * set of shown layers or one alone, linked pictures listed and inlined, and
 * limits named. Rasterizing is the main process's, covered end to end.
 */

import { describe, expect, it } from 'vitest';
import { inlineSvgImages, parseSvgLayers, shownOpeningTag, svgImageHrefs, svgOutline, svgWithLayers } from '../src/core/svg-layers';
import { fileHiddenLayers, layersTopFirst, placeableLayers } from '../src/core/psd';

const SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="200" height="100" viewBox="0 0 200 100">
  <defs><linearGradient id="fade"/></defs>
  <g id="backdrop"><rect width="200" height="100" fill="url(#fade)"/></g>
  <g inkscape:label="Marks" inkscape:groupmode="layer" style="fill:red;display:none"><circle cx="50" cy="50" r="20"/></g>
  <g aria-label="Words" display="none"><text x="10" y="20">Hi</text></g>
  <rect id="loose" width="10" height="10"/>
</svg>`;

describe('an SVG as layers (milestone 33)', () => {
  it('reads the size and the top-level groups: Illustrator names, Inkscape labels, hidden styles', () => {
    const doc = parseSvgLayers(SOURCE);
    expect([doc.width, doc.height]).toEqual([200, 100]);
    expect(doc.layers.map((l) => [l.id, l.name, l.visible])).toEqual([
      ['L0', 'backdrop', true],
      ['L1', 'Marks', false],
      ['L2', 'Words', false],
    ]);
    // The first group in the file paints first, so it is the bottom layer; a panel reads top first.
    const outline = svgOutline(doc);
    expect(layersTopFirst(outline.layers).map((l) => l.name)).toEqual(['Words', 'Marks', 'backdrop']);
    expect(fileHiddenLayers(outline.layers)).toEqual(['L1', 'L2']);
    expect(placeableLayers(outline, new Set()).map((l) => l.id)).toEqual(['L0', 'L1', 'L2']);
  });

  it('sizes from width and height with units, or the viewBox, and refuses a file with neither', () => {
    expect(parseSvgLayers('<svg viewBox="0 0 32 8"><g/></svg>').width).toBe(32);
    const points = parseSvgLayers('<svg width="72pt" height="36pt"><g/></svg>');
    expect([points.width, points.height]).toEqual([96, 48]);
    // One given side keeps the viewBox's shape.
    const half = parseSvgLayers('<svg width="100" viewBox="0 0 200 100"><g/></svg>');
    expect([half.width, half.height]).toEqual([100, 50]);
    expect(() => parseSvgLayers('<svg><g/></svg>')).toThrow(/no size and no viewBox/);
    expect(() => parseSvgLayers('<html/>')).toThrow(/not an SVG/);
  });

  it('is one layer when there are no top-level groups', () => {
    const doc = parseSvgLayers('<svg width="4" height="4"><rect width="4" height="4"/></svg>');
    expect(doc.layers).toEqual([]);
    expect(svgOutline(doc).layers).toEqual([]);
    expect(svgWithLayers(doc, new Set())).toContain('<rect');
  });

  it('rebuilds the document for a set of shown layers: hidden groups spliced out, shown ones really showing', () => {
    const doc = parseSvgLayers(SOURCE);
    // Only the Marks layer shown: the backdrop and Words go; the hiding style on Marks is cleared.
    const marks = svgWithLayers(doc, new Set(['L1']));
    expect(marks).toContain('<circle');
    expect(marks).not.toContain('backdrop');
    expect(marks).not.toContain('<text');
    expect(marks).not.toContain('display:none');
    expect(marks).toContain('fill:red');
    // What is not a top-level group stays: defs, gradients, loose elements.
    expect(marks).toContain('<linearGradient');
    expect(marks).toContain('id="loose"');
    // Attribute-hidden groups show the same way.
    const words = svgWithLayers(doc, new Set(['L2']));
    expect(words).toContain('<text');
    expect(words).not.toMatch(/<g aria-label="Words"[^>]*display\s*=/);
    // Isolation keeps exactly one group, for a layer placed on its own.
    const alone = svgWithLayers(doc, new Set(['L0', 'L1', 'L2']), 'L1');
    expect(alone).toContain('<circle');
    expect(alone).not.toContain('backdrop');
    expect(alone).not.toContain('<text');
    expect(shownOpeningTag(`<g display="none" style='visibility:hidden;fill:red'>`)).toBe(`<g style=';;fill:red'>`);
  });

  it('lists the pictures the file links, inlines what resolves, and names what does not', () => {
    const svg = `<svg width="4" height="4"><image xlink:href="logo.png" width="4" height="4"/><image href='data:image/png;base64,AA'/><image href="https://x/y.png"/></svg>`;
    expect(svgImageHrefs(svg)).toEqual(['logo.png']);
    const inlined = inlineSvgImages(svg, (href) => (href === 'logo.png' ? 'data:image/png;base64,BB' : null));
    expect(inlined.source).toContain('href="data:image/png;base64,BB"');
    expect(inlined.missing).toEqual([]);
    const lost = inlineSvgImages(svg, () => null);
    expect(lost.missing).toEqual(['logo.png']);
  });

  it('names scripts, foreignObject and fonts rather than dropping them silently', () => {
    const doc = parseSvgLayers('<svg width="4" height="4"><style>@font-face{font-family:X;src:url(x.woff)}</style><script>alert(1)</script><foreignObject/><g/></svg>');
    expect(doc.limits.some((l) => l.includes('scripts'))).toBe(true);
    expect(doc.limits.some((l) => l.includes('foreignObject'))).toBe(true);
    expect(doc.limits.some((l) => l.includes('default face'))).toBe(true);
  });
});
