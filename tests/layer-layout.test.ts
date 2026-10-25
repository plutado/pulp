import { describe, expect, it } from 'vitest';
import {
  applyCase,
  ASCENT,
  blockStates,
  layerImageIds,
  layoutBlock,
  layoutTextLayer,
  SHRINK_STEP,
  textWidth,
  type BlockState,
  type ImageLayerState,
  type LayerState,
  type Measure,
  type TextLayerState,
} from '../src/core/layer-layout';
import { DEFAULT_MOTION, type ImageLayer, type TextLayer } from '../src/core/layers';
import { validateManifest } from '../src/core/manifest';
import { rawManifest } from './fixtures';

/**
 * A measurer with no font files in it: every character is half its size wide,
 * so every width in these tests is `chars * size / 2` and can be worked out by
 * hand. The real one is the canvas, in the bridge.
 */
const measure: Measure = (text, font) => text.length * font.fontSize * 0.5;

const noImages = () => null;

function text(over: Partial<TextLayerState> = {}): TextLayerState {
  return {
    id: 'a', label: 'A', type: 'text', position: 0, spaceBefore: 0, align: 'left', motion: { ...DEFAULT_MOTION }, placement: { dx: 0, dy: 0, scale: 1 },
    text: 'Hello', family: 'Test', fontSize: 100, weight: 400, italic: false, case: 'none',
    letterSpacing: 0, kerning: true, lineHeight: 1.2, color: '#ffffff', overflow: 'wrap', maxLines: 3,
    ...over,
  };
}

function image(over: Partial<ImageLayerState> = {}): ImageLayerState {
  return { id: 'i', label: 'I', type: 'image', position: 0, spaceBefore: 0, align: 'left', motion: { ...DEFAULT_MOTION }, placement: { dx: 0, dy: 0, scale: 1 }, image: { id: 'a'.repeat(24), treatment: 'original', tint: '#ffffff', effect: 'none', hidden: false }, size: 80, ...over };
}

function block(layers: LayerState[], over: Partial<BlockState> = {}): BlockState {
  return { id: 'b', label: 'B', box: { x: 100, y: 200, width: 1000, height: 600 }, direction: 'column', gap: 0, align: 'left', verticalAlign: 'top', layers, ...over };
}

describe('text measuring', () => {
  it('measures the whole string when there is no letter spacing and kerning is on', () => {
    expect(textWidth('Hello', text(), 100, 0, measure)).toBe(250);
  });

  it('measures character by character when there is spacing, counting the gaps between them only', () => {
    // Five characters of 50, four gaps of 10 (0.1 em of 100).
    expect(textWidth('Hello', text(), 100, 0.1, measure)).toBe(250 + 40);
  });

  it('measures character by character with kerning off, which is what drawing then does', () => {
    expect(textWidth('Hello', text({ kerning: false }), 100, 0, measure)).toBe(250);
  });

  it('applyCase does the four cases', () => {
    expect(applyCase('a nice DAY', 'none')).toBe('a nice DAY');
    expect(applyCase('a nice DAY', 'upper')).toBe('A NICE DAY');
    expect(applyCase('a nice DAY', 'lower')).toBe('a nice day');
    expect(applyCase('a nice DAY', 'title')).toBe('A Nice Day');
  });
});

describe('layoutTextLayer', () => {
  it('wraps at the width and keeps its size when it fits in its lines', () => {
    const layer = text({ text: 'one two three four', fontSize: 100 });
    // Each word is 150 to 250 wide; 600 of room takes two words a line.
    const { size, lines } = layoutTextLayer(layer, 600, 0, measure);
    expect(size).toBe(100);
    expect(lines).toEqual(['one two', 'three four']);
  });

  it('sets a wrapped layer smaller, a step at a time, when it needs more lines than it may take', () => {
    const layer = text({ text: 'one two three four five six seven', maxLines: 2 });
    const { size, lines } = layoutTextLayer(layer, 600, 0, measure);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(size).toBeLessThan(100);
    expect(size).toBeCloseTo(100 * SHRINK_STEP ** 5, 6);
  });

  it('sets a wrapped layer smaller when one word is wider than the room', () => {
    const { size, lines } = layoutTextLayer(text({ text: 'Unconscionable' }), 400, 0, measure);
    expect(lines).toEqual(['Unconscionable']);
    expect(size * 14 * 0.5).toBeLessThanOrEqual(400);
  });

  it('shrink keeps one line and scales it to the width', () => {
    const { size, lines } = layoutTextLayer(text({ text: 'one two three', overflow: 'shrink' }), 325, 0, measure);
    expect(lines).toEqual(['one two three']);
    // 13 characters at 50 is 650 wide; half the room means half the size.
    expect(size).toBe(50);
  });

  it('shrink leaves a line that already fits alone', () => {
    expect(layoutTextLayer(text({ text: 'ab', overflow: 'shrink' }), 500, 0, measure).size).toBe(100);
  });

  it('truncate cuts with an ellipsis and keeps the size', () => {
    const { size, lines } = layoutTextLayer(text({ text: 'one two three', overflow: 'truncate' }), 325, 0, measure);
    expect(size).toBe(100);
    expect(lines[0]!.endsWith('…')).toBe(true);
    expect(textWidth(lines[0]!, text(), 100, 0, measure)).toBeLessThanOrEqual(325);
  });

  it('a layer with nothing to say has no lines', () => {
    expect(layoutTextLayer(text({ text: '   ' }), 500, 0, measure).lines).toEqual([]);
  });

  it('the case is applied before anything is measured', () => {
    expect(layoutTextLayer(text({ text: 'ab', case: 'upper' }), 500, 0, measure).lines).toEqual(['AB']);
  });
});

describe('layoutBlock', () => {
  it('stacks a column from the top, one em a line, with the baseline where the ascent puts it', () => {
    const laid = layoutBlock(block([text({ id: 'one', text: 'ab' }), text({ id: 'two', text: 'cd', fontSize: 50 })]), measure, noImages);
    const [one, two] = laid.layers;
    expect(one!.box).toMatchObject({ x: 100, y: 200, width: 1000, height: 100 });
    expect(one!.lines![0]).toMatchObject({ text: 'ab', x: 100, width: 100, baseline: 200 + ASCENT * 100 });
    // The next layer starts where the first ends: one em is the whole line box.
    expect(two!.box).toMatchObject({ y: 300, height: 50 });
    expect(two!.lines![0]!.baseline).toBe(300 + ASCENT * 50);
  });

  it('counts a gap between layers and the space before one, but not before the first', () => {
    const laid = layoutBlock(
      block([text({ id: 'one', text: 'ab' }), text({ id: 'two', text: 'cd', spaceBefore: 30 })], { gap: 20 }),
      measure,
      noImages,
    );
    expect(laid.layers[0]!.box.y).toBe(200);
    expect(laid.layers[1]!.box.y).toBe(200 + 100 + 20 + 30);
  });

  it('a second line is a line height down, and the layer is as tall as its lines', () => {
    const laid = layoutBlock(block([text({ text: 'one two three four', fontSize: 100 })], { box: { x: 0, y: 0, width: 600, height: 600 } }), measure, noImages);
    const layer = laid.layers[0]!;
    expect(layer.lines!.map((l) => l.text)).toEqual(['one two', 'three four']);
    expect(layer.lines![1]!.baseline - layer.lines![0]!.baseline).toBe(120);
    expect(layer.box.height).toBe(120 + 100);
  });

  it('aligns each line on its own, left, centred or right', () => {
    const laid = layoutBlock(block([text({ text: 'ab', align: 'center' }), text({ id: 'r', text: 'abcd', align: 'right' })]), measure, noImages);
    expect(laid.layers[0]!.lines![0]!.x).toBe(100 + (1000 - 100) / 2);
    expect(laid.layers[1]!.lines![0]!.x).toBe(100 + 1000 - 200);
  });

  it('places the whole stack by the block\'s vertical alignment', () => {
    const layers = () => [text({ id: 'one', text: 'ab' }), text({ id: 'two', text: 'cd' })];
    const top = layoutBlock(block(layers()), measure, noImages);
    const middle = layoutBlock(block(layers(), { verticalAlign: 'middle' }), measure, noImages);
    const bottom = layoutBlock(block(layers(), { verticalAlign: 'bottom' }), measure, noImages);
    expect(top.layers[0]!.box.y).toBe(200);
    expect(middle.layers[0]!.box.y).toBe(200 + (600 - 200) / 2);
    expect(bottom.layers[0]!.box.y).toBe(200 + 600 - 200);
  });

  it('a layer that draws nothing takes no room and no gap, so the stack closes up', () => {
    const laid = layoutBlock(
      block([text({ id: 'one', text: 'ab' }), text({ id: 'gone', text: '' }), image({ id: 'noimage', image: null }), text({ id: 'two', text: 'cd' })], { gap: 20 }),
      measure,
      noImages,
    );
    expect(laid.layers[1]!.box).toMatchObject({ width: 0, height: 0 });
    expect(laid.layers[1]!.lines).toEqual([]);
    expect(laid.layers[3]!.box.y).toBe(200 + 100 + 20);
  });

  it('an image layer keeps its own shape at the height the stack gives it', () => {
    const laid = layoutBlock(block([image({ size: 80, align: 'center' })], { gap: 10 }), measure, () => 2);
    expect(laid.layers[0]!.box).toMatchObject({ width: 160, height: 80, y: 200, x: 100 + (1000 - 160) / 2 });
  });

  it('an image wider than the block is held to the block and keeps its shape', () => {
    const laid = layoutBlock(block([image({ size: 800 })], {}), measure, () => 4);
    expect(laid.layers[0]!.box).toMatchObject({ width: 1000, height: 250 });
  });

  it('a row lays the layers out along the box by its alignment, each placed across it by the vertical one', () => {
    const laid = layoutBlock(
      block([text({ id: 'one', text: 'ab' }), text({ id: 'two', text: 'cd', fontSize: 50 })], { direction: 'row', gap: 20, align: 'left', verticalAlign: 'middle' }),
      measure,
      noImages,
    );
    expect(laid.layers[0]!.box).toMatchObject({ x: 100, width: 100 });
    expect(laid.layers[1]!.box).toMatchObject({ x: 100 + 100 + 20, width: 50 });
    expect(laid.layers[0]!.box.y).toBe(200 + (600 - 100) / 2);
    expect(laid.layers[1]!.box.y).toBe(200 + (600 - 50) / 2);
    // Centred, the whole row sits in the middle of the box instead.
    const centred = layoutBlock(
      block([text({ id: 'one', text: 'ab' }), text({ id: 'two', text: 'cd', fontSize: 50 })], { direction: 'row', gap: 20, align: 'center' }),
      measure,
      noImages,
    );
    expect(centred.layers[0]!.box.x).toBe(100 + (1000 - (100 + 20 + 50)) / 2);
  });

  it('the template may lay the block out in a box of its own, for a block it animates', () => {
    const laid = layoutBlock(block([text({ text: 'ab' })]), measure, noImages, { box: { x: 0, y: 0, width: 400, height: 400 } });
    expect(laid.box).toMatchObject({ x: 0, y: 0 });
    expect(laid.layers[0]!.box.y).toBe(0);
  });

  it('a template may align every layer its own way this time, for a design it mirrors', () => {
    const laid = layoutBlock(block([text({ text: 'ab' }), text({ id: 'r', text: 'abcd', align: 'center' })]), measure, noImages, { align: 'right' });
    expect(laid.layers[0]!.lines![0]!.x).toBe(100 + 1000 - 100);
    expect(laid.layers[1]!.lines![0]!.x).toBe(100 + 1000 - 200);
  });

  it('each layer carries what the template asked for it, by stack position', () => {
    const laid = layoutBlock(
      block([text({ id: 'one', text: 'ab' }), text({ id: 'two', text: 'cd' })]),
      measure,
      noImages,
      { each: (layer, position) => ({ alpha: position === 0 ? 1 : 0.25, dy: position * 10, letterSpacing: layer.type === 'text' ? 0.2 : undefined }) },
    );
    expect(laid.layers[0]!.draw).toMatchObject({ alpha: 1, dy: 0, dx: 0, scale: 1, letterSpacing: 0.2 });
    expect(laid.layers[1]!.draw).toMatchObject({ alpha: 0.25, dy: 10 });
    // The spacing the template gave is what the layout measured with: two characters, one gap of 0.2 em.
    expect(laid.layers[0]!.lines![0]!.width).toBe(100 + 20);
  });
});

describe('blockStates', () => {
  const manifest = () => {
    const r = validateManifest(
      rawManifest({
        width: undefined,
        height: undefined,
        aspects: ['16:9', '9:16'],
        blocks: [
          {
            id: 'card',
            label: 'Card',
            box: { '16:9': { x: 0.1, y: 0.2, width: 0.8, height: 0.5 }, default: { x: 0.05, y: 0.3, width: 0.9, height: 0.4 } },
            gap: 0.02,
            typography: { size: 0.08 },
            layers: [
              { id: 'title', type: 'text', label: 'Title', text: 'Hello', required: true },
              { id: 'sub', type: 'text', label: 'Subtitle', text: 'There', hidden: true, spaceBefore: 0.01 },
              { id: 'mark', type: 'image', label: 'Mark', size: 0.1 },
            ],
          },
        ],
      }),
    );
    if (!r.ok) throw new Error(r.errors.map((e) => e.path).join());
    return r.manifest;
  };

  it('turns fractions into the pixels of this frame, against the short side', () => {
    const states = blockStates(manifest(), {}, { width: 1920, height: 1080 });
    const card = states.card!;
    expect(card.box).toEqual({ x: 192, y: 216, width: 1536, height: 540 });
    // The gap, the sizes and the space before a layer are all fractions of the short side.
    expect(card.gap).toBe(1080 * 0.02);
    expect((card.layers[0] as TextLayerState).fontSize).toBeCloseTo(1080 * 0.08, 6);
    expect((card.layers[1] as ImageLayerState).size).toBeCloseTo(1080 * 0.1, 6);
  });

  it('takes the box for the frame\'s shape, and the short side of a tall frame', () => {
    const card = blockStates(manifest(), {}, { width: 1080, height: 1920 }).card!;
    expect(card.box).toEqual({ x: 54, y: 576, width: 972, height: 768 });
    expect((card.layers[0] as TextLayerState).fontSize).toBeCloseTo(1080 * 0.08, 6);
  });

  it('leaves hidden layers out, and the stack closes up around them', () => {
    const card = blockStates(manifest(), {}, { width: 1920, height: 1080 }).card!;
    expect(card.layers.map((l) => l.id)).toEqual(['title', 'mark']);
    expect(card.layers.map((l) => l.position)).toEqual([0, 1]);
  });

  it('takes the layers a person built over the template\'s own', () => {
    const m = manifest();
    const title = m.blocks[0]!.layers[0] as TextLayer;
    const card = blockStates(m, { card: [{ ...title, text: 'Changed' }] }, { width: 1920, height: 1080 }).card!;
    expect(card.layers).toHaveLength(1);
    expect((card.layers[0] as TextLayerState).text).toBe('Changed');
  });

  it('names the library ids the image layers need, for the grant', () => {
    const m = manifest();
    const mark = m.blocks[0]!.layers[2] as ImageLayer;
    const chosen: ImageLayer = { ...mark, image: { id: 'b'.repeat(24), treatment: 'original', tint: '#ffffff', effect: 'none', hidden: false } };
    const states = blockStates(m, { card: [chosen] }, { width: 1920, height: 1080 });
    expect(layerImageIds(states)).toEqual(['b'.repeat(24)]);
    expect(layerImageIds(blockStates(m, {}, { width: 1920, height: 1080 }))).toEqual([]);
  });
});

describe('a layer with a motion of its own (milestone 23)', () => {
  const at = { time: 0.25, duration: 4 };
  /** Two lines the template staggers in: the first is already full, the second not yet. */
  const staggered = () => block([text({ id: 'a', position: 0 }), text({ id: 'b', text: 'Second', position: 1 })]);
  const each = (_l: LayerState, position: number) => ({ alpha: position === 0 ? 1 : 0 });

  it('keeps the template\'s own movement until a layer asks for something else', () => {
    const laid = layoutBlock(staggered(), measure, noImages, { each, at });
    expect(laid.layers.map((l) => l.draw.alpha)).toEqual([1, 0]);
    // And with no timing given at all — a caller that is not drawing a frame — the template's stands.
    const over = block([text({ motion: { type: 'fade', delay: 0 } })]);
    expect(layoutBlock(over, measure, noImages, { each: () => ({ alpha: 0.5 }) }).layers[0]!.draw.alpha).toBe(0.5);
  });

  it('replaces the template\'s movement for that layer, and leaves the others alone', () => {
    const b = staggered();
    b.layers[1] = text({ id: 'b', text: 'Second', position: 1, motion: { type: 'none', delay: 0 } });
    const laid = layoutBlock(b, measure, noImages, { each, at });
    // The template was holding the second line back; its own motion says it is simply there.
    expect(laid.layers.map((l) => l.draw.alpha)).toEqual([1, 1]);
  });

  it('goes when the graphic goes: an override is capped by the most the template is showing', () => {
    const b = staggered();
    b.layers[0] = text({ id: 'a', position: 0, motion: { type: 'none', delay: 0 } });
    // The template has cleared the whole block — every layer at zero — so the override clears too.
    const gone = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 0 }), at });
    expect(gone.layers[0]!.draw.alpha).toBe(0);
    // Half way out, it is held to half: it can never outlive the design.
    const going = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 0.5 }), at });
    expect(going.layers[0]!.draw.alpha).toBe(0.5);
    // But a stagger is not an exit: while the leading line is full, an override may show from the first frame.
    const early = layoutBlock(b, measure, noImages, { each, at: { time: 0, duration: 4 } });
    expect(early.layers[0]!.draw.alpha).toBe(1);
  });

  it('drops the letter spacing the template was animating: the layer is the person\'s now', () => {
    const b = block([text({ motion: { type: 'fade', delay: 0 } })]);
    const laid = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 1, letterSpacing: 0.5 }), at: { time: 4, duration: 4 } });
    expect(laid.layers[0]!.draw.letterSpacing).toBeUndefined();
    // Measured at the layer's own spacing, then: five characters at 100 px, no tracking added.
    expect(laid.layers[0]!.lines![0]!.width).toBe(250);
  });

  it('slides by the layer\'s own size, down the stack for a column and across for a row', () => {
    const slide = { type: 'slide' as const, delay: 0 };
    const start = { time: 0, duration: 4 };
    const col = layoutBlock(block([text({ fontSize: 60, motion: slide })]), measure, noImages, { each, at: start });
    expect(col.layers[0]!.draw).toMatchObject({ dx: 0, dy: 60 });
    const row = layoutBlock(block([text({ fontSize: 60, motion: slide })], { direction: 'row' }), measure, noImages, { each, at: start });
    expect(row.layers[0]!.draw).toMatchObject({ dx: -60, dy: 0 });
    // An image layer slides by its own height.
    const picture = layoutBlock(block([image({ size: 120, motion: slide })]), measure, () => 1, { each, at: start });
    expect(picture.layers[0]!.draw.dy).toBe(120);
  });

  it('moves a layer without moving where the stack puts it: the box is where it always was', () => {
    const plain = layoutBlock(staggered(), measure, noImages, { each, at });
    const b = staggered();
    b.layers[1] = text({ id: 'b', text: 'Second', position: 1, motion: { type: 'slide', delay: 0 } });
    const moved = layoutBlock(b, measure, noImages, { each, at });
    expect(moved.layers[1]!.box).toEqual(plain.layers[1]!.box);
    expect(moved.layers[1]!.draw.dy).toBeGreaterThan(0);
  });
});

describe("a layer placed on the stage (milestone 25)", () => {
  const at = { time: 2, duration: 4 };
  const each = () => ({ alpha: 0.8, dx: 5, dy: -3, scale: 2 });
  const manifest = () => {
    const r = validateManifest(rawManifest({
      width: undefined, height: undefined, aspects: ['16:9', '9:16'],
      blocks: [{ id: 'card', label: 'Card', box: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 }, layers: [{ id: 'title', type: 'text', label: 'Title', text: 'Hello' }] }],
    }));
    if (!r.ok) throw new Error(r.errors.map((e) => e.path).join());
    return r.manifest;
  };

  it('resolves the placement for the frame\'s aspect into pixels of it', () => {
    const m = manifest();
    const title = m.blocks[0]!.layers[0] as TextLayer;
    const placed: TextLayer = { ...title, placement: { '16:9': { dx: 0.1, dy: -0.05, scale: 1.5 }, default: { dx: 0.5, dy: 0.5, scale: 2 } } };
    const wide = blockStates(m, { card: [placed] }, { width: 1920, height: 1080 }).card!;
    expect(wide.layers[0]!.placement).toEqual({ dx: 192, dy: -54, scale: 1.5 });
    // A tall frame answers with "default", so the 16:9 layout never moves the 9:16 one.
    const tall = blockStates(m, { card: [placed] }, { width: 1080, height: 1920 }).card!;
    expect(tall.layers[0]!.placement).toEqual({ dx: 540, dy: 960, scale: 2 });
    // No placement is identity.
    const plain = blockStates(m, { card: [title] }, { width: 1920, height: 1080 }).card!;
    expect(plain.layers[0]!.placement).toEqual({ dx: 0, dy: 0, scale: 1 });
  });

  it('wraps the template\'s own draw: offsets add, scales multiply, and the box never moves', () => {
    const b = block([text({ placement: { dx: 100, dy: 40, scale: 1.5 } })]);
    const laid = layoutBlock(b, measure, noImages, { each, at });
    expect(laid.layers[0]!.draw).toMatchObject({ alpha: 0.8, dx: 105, dy: 37, scale: 3 });
    // The layout slot is untouched: placement is drawn around the stack, not into it.
    const plain = layoutBlock(block([text()]), measure, noImages, { each, at });
    expect(laid.layers[0]!.box).toEqual(plain.layers[0]!.box);
  });

  it('wraps a motion override the same way', () => {
    const b = block([text({ motion: { type: 'none', delay: 0 }, placement: { dx: 50, dy: 0, scale: 2 } })]);
    const laid = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 1 }), at });
    expect(laid.layers[0]!.draw).toMatchObject({ alpha: 1, dx: 50, dy: 0, scale: 2 });
  });
});
