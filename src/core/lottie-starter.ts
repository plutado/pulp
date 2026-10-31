/**
 * The starter set of Lottie animations (milestone 35): about twenty small
 * animated elements made for Pulp, CC0, in the places templates are weakest —
 * animated icons, arrows, checkmarks, likes and bells, confetti and sparkles,
 * underlines.
 *
 * They are **built here and written to `templates/`**, where the library finds
 * them like any other bundled item; a test holds the checked-in files to what
 * this module produces, so the readable thing is the source and the JSON on
 * disk cannot drift from it. Regenerate with `npm run lottie:write`.
 *
 * Every one is drawn from the same few primitives below — a path drawn on by
 * trimming it, a shape scaled in with a little overshoot, a turn that repeats
 * — with **static colours** and meaningfully named groups, because that is
 * what `lottieEditables` turns into the Colours card: recolouring one to match
 * a palette is the first thing anyone does with it.
 *
 * Self-contained on purpose: no imports, so the writer script can run this
 * file through Node's own type stripping without a build step.
 */

/** A Lottie document, loosely: enough shape for the reader and the player. */
export type Json = Record<string, unknown>;

/** Frames a second, and the square every one of them is drawn on. */
export const STARTER_FPS = 30;
export const STARTER_SIZE = 512;

// ---------------------------------------------------------------- the primitives

type Point = [number, number];
/** A vertex with its in and out tangents, both relative to the vertex. */
type Vertex = { v: Point; i?: Point; o?: Point };

const rgba = (hex: string, alpha = 1): number[] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
};

/** A value that never changes. */
const fixed = (k: number | number[]): Json => ({ a: 0, k });

/** Eased keyframes. The last one carries no easing, as Bodymovin writes them. */
function keys(frames: { t: number; s: number[] }[], ease: 'smooth' | 'out' | 'linear' = 'smooth'): Json {
  const dims = frames[0]!.s.length;
  const fill = (v: number) => Array.from({ length: dims }, () => v);
  const io: Record<string, { o: Json; i: Json }> = {
    smooth: { o: { x: fill(0.33), y: fill(0) }, i: { x: fill(0.67), y: fill(1) } },
    out: { o: { x: fill(0.16), y: fill(0) }, i: { x: fill(0.3), y: fill(1) } },
    linear: { o: { x: fill(0), y: fill(0) }, i: { x: fill(1), y: fill(1) } },
  };
  const shape = io[ease]!;
  return {
    a: 1,
    k: frames.map((f, i) => (i === frames.length - 1 ? { t: f.t, s: f.s } : { t: f.t, s: f.s, o: shape.o, i: shape.i })),
  };
}

/** A layer's transform. Anything not given sits still at its default. */
function transform(over: Partial<Record<'a' | 'p' | 's' | 'r' | 'o', Json>> = {}): Json {
  return {
    a: over.a ?? fixed([0, 0, 0]),
    p: over.p ?? fixed([STARTER_SIZE / 2, STARTER_SIZE / 2, 0]),
    s: over.s ?? fixed([100, 100, 100]),
    r: over.r ?? fixed(0),
    o: over.o ?? fixed(100),
  };
}

/** A group's own transform, which is two-dimensional where a layer's is three. */
function groupTransform(over: Partial<Record<'a' | 'p' | 's' | 'r' | 'o', Json>> = {}): Json {
  return {
    ty: 'tr',
    a: over.a ?? fixed([0, 0]),
    p: over.p ?? fixed([0, 0]),
    s: over.s ?? fixed([100, 100]),
    r: over.r ?? fixed(0),
    o: over.o ?? fixed(100),
  };
}

/**
 * A named group. The name is what the Colours card calls the colour inside it,
 * so it is the word a person reads: "Tick", "Ring", "Bell".
 */
function group(name: string, items: Json[], tr: Json = groupTransform()): Json {
  return { ty: 'gr', nm: name, np: items.length + 1, it: [...items, tr] };
}

/** A free path, from vertices with optional tangents. */
function path(vertices: Vertex[], closed = false): Json {
  return {
    ty: 'sh',
    ks: {
      a: 0,
      k: {
        i: vertices.map((p) => p.i ?? [0, 0]),
        o: vertices.map((p) => p.o ?? [0, 0]),
        v: vertices.map((p) => p.v),
        c: closed,
      },
    },
  };
}

const ellipse = (size: Point, position: Point = [0, 0]): Json => ({ ty: 'el', s: fixed(size), p: fixed(position) });
const rect = (size: Point, position: Point = [0, 0], roundness = 0): Json => ({ ty: 'rc', s: fixed(size), p: fixed(position), r: fixed(roundness) });

const fill = (color: string): Json => ({ ty: 'fl', c: fixed(rgba(color)), o: fixed(100), r: 1 });
const stroke = (color: string, width: number): Json => ({ ty: 'st', c: fixed(rgba(color)), o: fixed(100), w: fixed(width), lc: 2, lj: 2, ml: 4 });

/** Draw a stroke on, from nothing to whole, between two frames. */
const drawOn = (from: number, to: number): Json => ({
  ty: 'tm',
  s: fixed(0),
  e: keys([{ t: from, s: [0] }, { t: to, s: [100] }], 'out'),
  o: fixed(0),
  m: 1,
});

/** Take a stroke away again, from whole to nothing, by moving its start up to its end. */
const drawOff = (from: number, to: number): Json => ({
  ty: 'tm',
  s: keys([{ t: from, s: [0] }, { t: to, s: [100] }], 'smooth'),
  e: fixed(100),
  o: fixed(0),
  m: 1,
});

/** Scale in with a little overshoot, and out again at the end: how an element arrives. */
const popScale = (inAt: number, holdAt: number, outAt: number, end: number): Json =>
  keys(
    [
      { t: inAt, s: [0, 0] },
      { t: holdAt, s: [112, 112] },
      { t: holdAt + 5, s: [100, 100] },
      { t: outAt, s: [100, 100] },
      { t: end, s: [0, 0] },
    ],
    'out',
  );

const fadeInOut = (inAt: number, upAt: number, downAt: number, end: number): Json =>
  keys([{ t: inAt, s: [0] }, { t: upAt, s: [100] }, { t: downAt, s: [100] }, { t: end, s: [0] }], 'smooth');

/** A shape layer holding one or more groups. */
function shapeLayer(name: string, shapes: Json[], ks: Json, op: number, index = 1): Json {
  return { ddd: 0, ind: index, ty: 4, nm: name, sr: 1, ks, ao: 0, shapes, ip: 0, op, st: 0, bm: 0 };
}

/** A marker, in frames, as Bodymovin writes one. */
const marker = (name: string, at: number, length = 0): Json => ({ tm: at, cm: name, dr: length });

/**
 * The markers that say an animation holds between an intro and an outro, so it
 * stretches to any length (milestone 30's hold, read by `lottieStructure`).
 */
const holdMarkers = (introEnds: number, outroBegins: number, op: number): Json[] => [
  marker('intro', 0, introEnds),
  marker('outro', outroBegins, op - outroBegins),
];

/** The marker that says an animation simply goes round. */
const loopMarker = (op: number): Json[] => [marker('loop', 0, op)];

function doc(name: string, op: number, layers: Json[], markers: Json[]): Json {
  return {
    // The format has no licence field, so Pulp's own key carries it (`lottieExtras`); every
    // other tool ignores it, and the Info tab shows CC0 rather than "not stated".
    'x-pulp': { license: 'CC0-1.0', author: 'Pulp' },
    v: '5.12.2',
    fr: STARTER_FPS,
    ip: 0,
    op,
    w: STARTER_SIZE,
    h: STARTER_SIZE,
    nm: name,
    ddd: 0,
    assets: [],
    layers: layers.map((l, i) => ({ ...l, ind: i + 1 })),
    markers,
  };
}

// ---------------------------------------------------------------- the set

/** The palette: one warm accent, one cool, and an ink that reads on either. */
const ACCENT = '#f59e0b';
const COOL = '#38bdf8';
const INK = '#e6e8eb';
const WARM = '#fb7185';

export interface StarterAnimation {
  /** The file's name without its extension, and its library id's stem. */
  id: string;
  /** The folder under `templates/` it is written to; its last part names the type. */
  folder: string;
  /** What it is called, for the file name and the item. */
  name: string;
  build(): Json;
}

/** A stroke drawn on, held, and taken away: the shape of most of the icons here. */
function drawnIcon(name: string, vertices: Vertex[], color: string, width: number, op = 45): Json {
  const introEnds = Math.round(op * 0.4);
  const outroBegins = Math.round(op * 0.78);
  return doc(
    name,
    op,
    [
      shapeLayer(
        name,
        [group(name, [path(vertices), stroke(color, width), drawOn(0, introEnds), drawOff(outroBegins, op)])],
        transform(),
        op,
      ),
    ],
    holdMarkers(introEnds, outroBegins, op),
  );
}

/** A filled shape that pops in, holds and goes: the shape of most of the social marks. */
function poppedIcon(name: string, items: Json[], op = 45): Json {
  const introEnds = Math.round(op * 0.38);
  const outroBegins = Math.round(op * 0.8);
  return doc(
    name,
    op,
    [shapeLayer(name, items, transform({ s: popScale(0, Math.round(introEnds * 0.7), outroBegins, op) }), op)],
    holdMarkers(introEnds, outroBegins, op),
  );
}

/**
 * The middle of the square. Shapes are drawn **around (0, 0)** — a layer's own
 * coordinates — and the layer's transform puts them here; a path in canvas
 * coordinates would be moved by the transform as well and land off the edge.
 */
const C = STARTER_SIZE / 2;

/** A tick, drawn from its short arm. */
const TICK: Vertex[] = [{ v: [-96, 6] }, { v: [-26, 74] }, { v: [100, -72] }];

/** Four-point sparkle arms, as a closed path. */
function sparkle(radius: number, waist: number): Vertex[] {
  return [
    { v: [0, -radius] }, { v: [waist, -waist] }, { v: [radius, 0] }, { v: [waist, waist] },
    { v: [0, radius] }, { v: [-waist, waist] }, { v: [-radius, 0] }, { v: [-waist, -waist] },
  ];
}

/** A five-pointed star, as a closed path. */
function star(outer: number, inner: number): Vertex[] {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return { v: [round2(Math.cos(angle) * r), round2(Math.sin(angle) * r)] as Point };
  });
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A heart, from two shoulders and a point. */
const HEART: Vertex[] = [
  { v: [0, 86], i: [52, -34], o: [-52, -34] },
  { v: [-112, -24], i: [0, 46], o: [0, -52] },
  { v: [-56, -82], i: [-30, 0], o: [34, 0] },
  { v: [0, -36], i: [-22, -26], o: [22, -26] },
  { v: [56, -82], i: [-34, 0], o: [30, 0] },
  { v: [112, -24], i: [0, -52], o: [0, 46] },
];

/** A bell: a dome on a lip, with a clapper under it. */
const BELL: Vertex[] = [
  { v: [-92, 44] }, { v: [-72, 44], i: [0, 18], o: [0, -8] },
  { v: [-72, -16], i: [0, -48], o: [0, 10] },
  { v: [0, -86], i: [-40, 0], o: [40, 0] },
  { v: [72, -16], i: [0, 10], o: [0, -48] },
  { v: [72, 44], i: [0, -8], o: [0, 18] },
  { v: [92, 44] },
];

export const STARTER_ANIMATIONS: readonly StarterAnimation[] = [
  // ------------------------------------------------ icons
  { id: 'check-draw', folder: 'animated/icons', name: 'Check draw', build: () => drawnIcon('Tick', TICK, ACCENT, 26) },
  {
    id: 'cross-draw', folder: 'animated/icons', name: 'Cross draw',
    build: () => {
      const op = 45;
      const a: Vertex[] = [{ v: [-82, -82] }, { v: [82, 82] }];
      const b: Vertex[] = [{ v: [82, -82] }, { v: [-82, 82] }];
      return doc('Cross', op, [
        shapeLayer('Cross', [
          group('Cross', [path(a), stroke(WARM, 26), drawOn(0, 14), drawOff(36, op)]),
          group('Cross back', [path(b), stroke(WARM, 26), drawOn(8, 22), drawOff(36, op)]),
        ], transform(), op),
      ], holdMarkers(22, 36, op));
    },
  },
  {
    id: 'spinner-loop', folder: 'animated/icons', name: 'Spinner loop',
    build: () => {
      const op = 60;
      return doc('Spinner', op, [
        shapeLayer('Spinner', [
          group('Track', [ellipse([180, 180]), stroke('#394150', 20)]),
          group('Spinner', [ellipse([180, 180]), stroke(COOL, 20), {
            ty: 'tm', s: keys([{ t: 0, s: [0] }, { t: 30, s: [40] }, { t: op, s: [100] }], 'linear'),
            e: keys([{ t: 0, s: [25] }, { t: 30, s: [95] }, { t: op, s: [100] }], 'linear'), o: fixed(0), m: 1,
          }]),
        ], transform({ r: keys([{ t: 0, s: [0] }, { t: op, s: [360] }], 'linear') }), op),
      ], loopMarker(op));
    },
  },
  {
    id: 'lock-click', folder: 'animated/icons', name: 'Lock click',
    build: () => {
      const op = 45;
      const shackle: Vertex[] = [
        { v: [-48, -6] }, { v: [-48, -56], i: [0, 28], o: [0, -28] },
        { v: [0, -100], i: [-28, 0], o: [28, 0] },
        { v: [48, -56], i: [0, -28], o: [0, 28] }, { v: [48, -6] },
      ];
      return doc('Lock', op, [
        shapeLayer('Shackle', [group('Shackle', [path(shackle), stroke(INK, 22)])],
          transform({ p: keys([{ t: 0, s: [C, C - 44, 0] }, { t: 16, s: [C, C, 0] }], 'out') }), op),
        shapeLayer('Body', [group('Body', [rect([188, 148], [0, 52], 28), fill(ACCENT)])],
          transform({ s: popScale(6, 20, 36, op) }), op),
      ], holdMarkers(22, 36, op));
    },
  },
  {
    id: 'gear-turn', folder: 'animated/icons', name: 'Gear turn',
    build: () => {
      const op = 60;
      const teeth = Array.from({ length: 8 }, (_, i) =>
        // Every tooth is the gear, so they share one name and one colour to change.
        group('Gear', [rect([40, 196], [0, 0], 10), fill(INK)], groupTransform({ r: fixed(round2((180 / 8) * i)) })),
      );
      return doc('Gear', op, [
        shapeLayer('Gear', [
          ...teeth,
          group('Gear', [ellipse([168, 168]), fill(INK)]),
          group('Hub', [ellipse([74, 74]), fill('#16181d')]),
        ], transform({ r: keys([{ t: 0, s: [0] }, { t: op, s: [90] }], 'linear') }), op),
      ], loopMarker(op));
    },
  },
  {
    id: 'download-arrow', folder: 'animated/icons', name: 'Download arrow',
    build: () => {
      const op = 45;
      const shaft: Vertex[] = [{ v: [0, -96] }, { v: [0, 36] }];
      const head: Vertex[] = [{ v: [-54, -18] }, { v: [0, 36] }, { v: [54, -18] }];
      const tray: Vertex[] = [{ v: [-86, 46] }, { v: [-86, 96] }, { v: [86, 96] }, { v: [86, 46] }];
      return doc('Download', op, [
        shapeLayer('Arrow', [
          group('Arrow', [path(shaft), stroke(COOL, 24), drawOn(0, 16)]),
          group('Arrow head', [path(head), stroke(COOL, 24), drawOn(10, 22)]),
        ], transform({ o: fadeInOut(0, 8, 34, op) }), op),
        shapeLayer('Tray', [group('Tray', [path(tray), stroke(INK, 22)])], transform(), op),
      ], holdMarkers(22, 34, op));
    },
  },

  // ------------------------------------------------ arrows
  {
    id: 'arrow-right', folder: 'animated/arrows', name: 'Arrow right',
    build: () => {
      const op = 45;
      const shaft: Vertex[] = [{ v: [-110, 0] }, { v: [86, 0] }];
      const head: Vertex[] = [{ v: [26, -60] }, { v: [86, 0] }, { v: [26, 60] }];
      return doc('Arrow', op, [
        shapeLayer('Arrow', [
          group('Arrow', [path(shaft), stroke(ACCENT, 26), drawOn(0, 16), drawOff(36, op)]),
          group('Arrow head', [path(head), stroke(ACCENT, 26), drawOn(12, 24), drawOff(36, op)]),
        ], transform(), op),
      ], holdMarkers(24, 36, op));
    },
  },
  {
    id: 'swipe-up', folder: 'animated/arrows', name: 'Swipe up',
    build: () => {
      const op = 60;
      const chevron: Vertex[] = [{ v: [-56, 28] }, { v: [0, -28] }, { v: [56, 28] }];
      const one = (index: number, offset: number) =>
        shapeLayer(`Chevron ${index}`, [group('Chevron', [path(chevron), stroke(COOL, 24)])],
          transform({
            p: keys([{ t: 0, s: [C, C + 86 + offset, 0] }, { t: op, s: [C, C - 86 + offset, 0] }], 'linear'),
            o: keys([{ t: 0, s: [0] }, { t: 14, s: [100] }, { t: 44, s: [100] }, { t: op, s: [0] }], 'linear'),
          }), op);
      return doc('Swipe up', op, [one(1, 0), one(2, 70), one(3, 140)], loopMarker(op));
    },
  },
  {
    id: 'chevron-bounce', folder: 'animated/arrows', name: 'Chevron bounce',
    build: () => {
      const op = 60;
      const chevron: Vertex[] = [{ v: [-34, -46] }, { v: [22, 0] }, { v: [-34, 46] }];
      const one = (index: number, x: number, at: number) =>
        shapeLayer(`Chevron ${index}`, [group('Chevron', [path(chevron), stroke(ACCENT, 22)])],
          transform({
            p: fixed([C + x, C, 0]),
            o: keys([{ t: at, s: [25] }, { t: at + 10, s: [100] }, { t: at + 24, s: [25] }, { t: op, s: [25] }], 'smooth'),
          }), op);
      return doc('Chevron bounce', op, [one(1, -70, 0), one(2, 0, 8), one(3, 70, 16)], loopMarker(op));
    },
  },
  {
    id: 'curved-arrow', folder: 'animated/arrows', name: 'Curved arrow',
    build: () => {
      const op = 45;
      const curve: Vertex[] = [
        { v: [-112, 62], o: [36, -48] },
        { v: [10, -54], i: [-50, 6], o: [44, -6] },
        { v: [92, 10], i: [-10, -44] },
      ];
      const head: Vertex[] = [{ v: [36, 10] }, { v: [92, 10] }, { v: [92, -46] }];
      return doc('Curved arrow', op, [
        shapeLayer('Curved arrow', [
          group('Curve', [path(curve), stroke(WARM, 24), drawOn(0, 20), drawOff(36, op)]),
          group('Arrow head', [path(head), stroke(WARM, 24), drawOn(16, 26), drawOff(36, op)]),
        ], transform(), op),
      ], holdMarkers(26, 36, op));
    },
  },

  // ------------------------------------------------ social
  { id: 'heart-burst', folder: 'animated/social', name: 'Heart burst', build: () => poppedIcon('Heart', [group('Heart', [path(HEART, true), fill(WARM)])]) },
  {
    id: 'bell-ring', folder: 'animated/social', name: 'Bell ring',
    build: () => {
      const op = 60;
      const swing = keys([
        { t: 0, s: [0] }, { t: 8, s: [14] }, { t: 20, s: [-12] }, { t: 32, s: [8] }, { t: 44, s: [-4] }, { t: op, s: [0] },
      ], 'smooth');
      return doc('Bell', op, [
        shapeLayer('Bell', [
          group('Bell', [path(BELL, true), stroke(ACCENT, 22)]),
          group('Clapper', [ellipse([44, 44], [0, 76]), fill(ACCENT)]),
        ], transform({ a: fixed([0, -86, 0]), p: fixed([C, C - 86, 0]), r: swing }), op),
      ], loopMarker(op));
    },
  },
  {
    id: 'thumbs-up', folder: 'animated/social', name: 'Thumbs up',
    build: () => {
      const thumb: Vertex[] = [
        { v: [-18, 92] }, { v: [78, 92], i: [-18, 10], o: [18, -10] },
        { v: [100, 10], i: [6, 26], o: [-6, -26] },
        { v: [32, -16] }, { v: [46, -72], i: [8, 22], o: [-6, -18] },
        { v: [10, -96], i: [16, 0], o: [-12, 0] },
        { v: [-18, -10] },
      ];
      return poppedIcon('Thumbs up', [
        group('Thumb', [path(thumb, true), fill(COOL)]),
        group('Cuff', [rect([62, 112], [-50, 36], 12), fill('#0ea5e9')]),
      ], 48);
    },
  },
  {
    id: 'follow-plus', folder: 'animated/social', name: 'Follow plus',
    build: () => {
      const op = 45;
      const across: Vertex[] = [{ v: [-56, 0] }, { v: [56, 0] }];
      const down: Vertex[] = [{ v: [0, -56] }, { v: [0, 56] }];
      return doc('Follow', op, [
        shapeLayer('Ring', [group('Follow', [ellipse([196, 196]), stroke(ACCENT, 20)])],
          transform({ s: popScale(0, 12, 36, op) }), op),
        shapeLayer('Plus', [
          group('Follow', [path(across), stroke(ACCENT, 22), drawOn(10, 20)]),
          group('Follow down', [path(down), stroke(ACCENT, 22), drawOn(14, 24)]),
        ], transform({ o: fadeInOut(8, 16, 34, op) }), op),
      ], holdMarkers(24, 36, op));
    },
  },
  {
    id: 'share-pop', folder: 'animated/social', name: 'Share pop',
    build: () => {
      const op = 45;
      const up: Vertex[] = [{ v: [-54, 10] }, { v: [46, -54] }];
      const down: Vertex[] = [{ v: [-54, 22] }, { v: [46, 76] }];
      const dot = (x: number, y: number, at: number) =>
        shapeLayer(`Dot ${at}`, [group('Share', [ellipse([62, 62], [x, y]), fill(COOL)])],
          transform({ s: popScale(at, at + 8, 34, op) }), op);
      return doc('Share', op, [
        shapeLayer('Link', [
          group('Share', [path(up), stroke(COOL, 16), drawOn(8, 20)]),
          group('Share down', [path(down), stroke(COOL, 16), drawOn(12, 24)]),
        ], transform({ o: fadeInOut(6, 14, 34, op) }), op),
        dot(-54, 16, 0), dot(46, -54, 6), dot(46, 76, 12),
      ], holdMarkers(24, 34, op));
    },
  },

  // ------------------------------------------------ confetti
  {
    id: 'confetti-burst', folder: 'animated/confetti', name: 'Confetti burst',
    build: () => {
      const op = 60;
      const colors = [ACCENT, COOL, WARM, '#a3e635', '#c084fc', '#facc15'];
      // A fixed spread rather than a random one: the file must be the same every time it is built.
      const pieces = Array.from({ length: 12 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 12 + 0.18;
        const distance = 150 + (i % 3) * 42;
        const spin = 180 + (i % 4) * 90;
        // Named by which of the six colours it is, so the Colours card offers six, each saying
        // which pieces it paints, rather than six rows all called the same thing.
        return shapeLayer(`Piece ${i + 1}`, [group(`Confetti ${(i % colors.length) + 1}`, [rect([26, 40], [0, 0], 4), fill(colors[i % colors.length]!)])],
          transform({
            p: keys([
              { t: 0, s: [C, C, 0] },
              { t: op, s: [round2(C + Math.cos(angle) * distance), round2(C + Math.sin(angle) * distance + 56), 0] },
            ], 'out'),
            r: keys([{ t: 0, s: [0] }, { t: op, s: [spin] }], 'linear'),
            s: keys([{ t: 0, s: [0, 0] }, { t: 8, s: [100, 100] }, { t: op, s: [100, 100] }], 'out'),
            o: keys([{ t: 0, s: [100] }, { t: 38, s: [100] }, { t: op, s: [0] }], 'smooth'),
          }), op);
      });
      return doc('Confetti burst', op, pieces, []);
    },
  },
  {
    id: 'sparkle-twinkle', folder: 'animated/confetti', name: 'Sparkle twinkle',
    build: () => {
      const op = 60;
      const one = (index: number, x: number, y: number, size: number, at: number) =>
        shapeLayer(`Sparkle ${index}`, [group('Sparkle', [path(sparkle(size, round2(size * 0.22)), true), fill(ACCENT)])],
          transform({
            p: fixed([C + x, C + y, 0]),
            s: keys([{ t: at, s: [0, 0] }, { t: at + 10, s: [100, 100] }, { t: at + 22, s: [0, 0] }, { t: op, s: [0, 0] }], 'smooth'),
            r: fixed(index * 12),
          }), op);
      return doc('Sparkle twinkle', op, [one(1, 0, -10, 96, 0), one(2, -104, 58, 58, 12), one(3, 96, 44, 48, 24), one(4, 52, -92, 40, 34)], loopMarker(op));
    },
  },
  { id: 'star-pop', folder: 'animated/confetti', name: 'Star pop', build: () => poppedIcon('Star', [group('Star', [path(star(108, 46), true), fill(ACCENT)])]) },

  // ------------------------------------------------ shapes
  {
    id: 'underline-draw', folder: 'animated/shapes', name: 'Underline draw',
    build: () => {
      const op = 45;
      const line: Vertex[] = [
        { v: [-160, 22], o: [52, 16] },
        { v: [0, 34], i: [-56, 4], o: [56, -4] },
        { v: [160, 10], i: [-50, 14] },
      ];
      return doc('Underline', op, [
        shapeLayer('Underline', [group('Underline', [path(line), stroke(ACCENT, 20), drawOn(0, 16), drawOff(36, op)])], transform(), op),
      ], holdMarkers(16, 36, op));
    },
  },
  {
    id: 'circle-scribble', folder: 'animated/shapes', name: 'Circle scribble',
    build: () => {
      const op = 50;
      const ring: Vertex[] = [
        { v: [8, -128], i: [-62, 4], o: [66, -4] },
        { v: [150, 4], i: [-6, -70], o: [6, 72] },
        { v: [-4, 134], i: [68, 10], o: [-70, -10] },
        { v: [-150, -6], i: [4, 70], o: [-4, -66] },
        { v: [26, -136], i: [-66, -6], o: [48, 4] },
      ];
      return doc('Circle scribble', op, [
        shapeLayer('Scribble', [group('Scribble', [path(ring), stroke(WARM, 18), drawOn(0, 22), drawOff(40, op)])], transform(), op),
      ], holdMarkers(22, 40, op));
    },
  },
];
