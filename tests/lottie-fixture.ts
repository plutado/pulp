/**
 * Lottie fixtures written by the tests (milestone 35), never shipped: a small
 * Bodymovin-shaped document with a square that crosses the frame on linear
 * keyframes, a text layer, a solid, and markers — enough for the reader to
 * find its text and colours and for a render to be checked pixel by pixel.
 */

import { writeZip } from '../src/core/zip';

export interface LottieFixtureOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** Frames the animation runs for (its out point). */
  frames?: number;
  text?: string;
  /** The square's fill, components in 0..1. */
  fill?: [number, number, number];
  /** Add a property with an expression, a layer with an effect, a 3D layer and a web font. */
  withLimits?: boolean;
  /** Add a `slots` block with a colour and a text slot, bound from the square and a second text layer. */
  withSlots?: boolean;
  /** Add a second text layer whose words change over time. */
  withAnimatedText?: boolean;
  /** An image asset the page would ask for beside the file. */
  withImage?: string;
}

/** The square: 200 × 200, its centre moving from x = 100 to x = 900 at y = 540 (in a 1920 × 1080 frame) over the animation. */
export function lottieFixture(options: LottieFixtureOptions = {}): Record<string, unknown> {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fps = options.fps ?? 30;
  const frames = options.frames ?? 60;
  const fill = options.fill ?? [1, 0, 0];
  const text = options.text ?? 'HELLO';
  const linear = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
  const transform = (x: number, y: number) => ({ a: { a: 0, k: [0, 0, 0] }, p: { a: 0, k: [x, y, 0] }, s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } });
  const fillColor = options.withSlots ? { a: 0, k: fill, sid: 'accent' } : { a: 0, k: fill };
  const layers: Record<string, unknown>[] = [
    {
      ddd: 0, ind: 1, ty: 5, nm: 'Headline', sr: 1, ip: 0, op: frames, st: 0, bm: 0,
      ks: transform(200, 200),
      t: {
        d: { k: [{ s: { t: text, f: 'Arial', s: 120, fc: [1, 1, 1], j: 0, tr: 0, lh: 144, ls: 0 }, t: 0 }] },
        p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: [],
      },
    },
    {
      ddd: 0, ind: 2, ty: 4, nm: 'Box', sr: 1, ip: 0, op: frames, st: 0, bm: 0,
      ks: {
        a: { a: 0, k: [0, 0, 0] },
        p: { a: 1, k: [{ t: 0, s: [100, 540, 0], ...linear }, { t: frames, s: [900, 540, 0] }] },
        s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 },
      },
      shapes: [
        {
          ty: 'gr', nm: 'Square',
          it: [
            { ty: 'rc', nm: 'Rectangle Path 1', d: 1, s: { a: 0, k: [200, 200] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } },
            { ty: 'fl', nm: 'Fill 1', c: fillColor, o: { a: 0, k: 100 }, r: 1 },
            { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    },
    {
      ddd: 0, ind: 3, ty: 1, nm: 'Corner', sr: 1, ip: 0, op: frames, st: 0, bm: 0,
      ks: transform(50, height - 50), sw: 100, sh: 100, sc: '#0000ff',
    },
  ];
  if (options.withSlots) {
    layers.push({
      ddd: 0, ind: 4, ty: 5, nm: 'Slotted', sr: 1, ip: 0, op: frames, st: 0, bm: 0,
      ks: transform(200, 400),
      t: { d: { sid: 'headline' }, p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: [] },
    });
  }
  if (options.withAnimatedText) {
    layers.push({
      ddd: 0, ind: 5, ty: 5, nm: 'Ticker', sr: 1, ip: 0, op: frames, st: 0, bm: 0,
      ks: transform(200, 600),
      t: {
        d: { k: [{ s: { t: 'ONE', f: 'Arial', s: 60, fc: [1, 1, 1], j: 0, tr: 0, lh: 72, ls: 0 }, t: 0 }, { s: { t: 'TWO', f: 'Arial', s: 60, fc: [1, 1, 1], j: 0, tr: 0, lh: 72, ls: 0 }, t: Math.floor(frames / 2) }] },
        p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: [],
      },
    });
  }
  if (options.withLimits) {
    (layers[1]!.ks as Record<string, unknown>).r = { a: 0, k: 0, x: 'time * 10' };
    layers[1]!.ef = [{ ty: 29, nm: 'Gaussian Blur', ef: [] }];
    layers.push({ ddd: 1, ind: 6, ty: 3, nm: 'Rig', sr: 1, ip: 0, op: frames, st: 0, bm: 0, ks: transform(0, 0) });
  }
  const assets: Record<string, unknown>[] = [];
  if (options.withImage) {
    assets.push({ id: 'image_0', w: 64, h: 64, u: 'images/', p: options.withImage, e: 0 });
    layers.push({ ddd: 0, ind: 7, ty: 2, nm: 'Picture', refId: 'image_0', sr: 1, ip: 0, op: frames, st: 0, bm: 0, ks: transform(width - 100, 100) });
  }
  const doc: Record<string, unknown> = {
    v: '5.12.2', fr: fps, ip: 0, op: frames, w: width, h: height, nm: 'Comp 1', ddd: 0,
    assets,
    fonts: { list: [{ fName: 'Arial', fFamily: 'Arial', fStyle: 'Regular', ascent: 71, ...(options.withLimits ? { fPath: 'https://fonts.example/arial.css', origin: 1 } : {}) }] },
    layers,
    markers: [{ tm: 0, cm: 'intro', dr: Math.floor(frames / 4) }, { tm: Math.floor(frames / 4), cm: 'loop', dr: Math.floor(frames / 2) }, { tm: frames - 1, cm: 'end', dr: 0 }],
  };
  if (options.withSlots) {
    doc.slots = {
      accent: { p: { a: 0, k: fill } },
      headline: { p: { k: [{ s: { t: 'SLOT TEXT', f: 'Arial', s: 80, fc: [1, 1, 0], j: 0, tr: 0, lh: 96, ls: 0 }, t: 0 }] } },
    };
  }
  return doc;
}

/** A `.lottie` archive holding the fixture (and any more animations), with a manifest and optional images. */
export function dotLottieFixture(animations: Record<string, Record<string, unknown>>, images: Record<string, Buffer> = {}, manifestExtra: Record<string, unknown> = {}): Buffer {
  const ids = Object.keys(animations);
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ version: '1.0', generator: 'pulp tests', animations: ids.map((id) => ({ id })), ...manifestExtra })) },
    ...ids.map((id) => ({ name: `animations/${id}.json`, data: Buffer.from(JSON.stringify(animations[id])) })),
    ...Object.entries(images).map(([name, data]) => ({ name: `images/${name}`, data })),
  ];
  return writeZip(entries);
}
