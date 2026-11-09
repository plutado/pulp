import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPOGRAPHY } from '../src/core/layers';
import {
  applyCase,
  ASCENT,
  blockStates,
  complexText,
  lineDirection,
  layerImageIds,
  layoutBlock,
  layoutTextLayer,
  SHRINK_STEP,
  textWidth,
  type BlockState,
  type ImageLayerState,
  type LayerState,
  type ShapeLayerState,
  type Measure,
  type TextLayerState,
} from '../src/core/layer-layout';
import type { ImageLayer, TextLayer } from '../src/core/layers';
import { DEFAULT_TRANSITION, type LayerTransition, type LayerTransitions } from '../src/core/layer-time';
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
    id: 'a', label: 'A', type: 'text', position: 0, spaceBefore: 0, align: 'left', placement: { dx: 0, dy: 0, scale: 1, rotate: 0 },
    text: 'Hello', family: 'Test', fontSize: 100, weight: 400, italic: false, case: 'none',
    letterSpacing: 0, kerning: true, lineHeight: 1.2, color: '#ffffff', overflow: 'wrap', maxLines: 3,
    ...over,
  };
}

function image(over: Partial<ImageLayerState> = {}): ImageLayerState {
  return { id: 'i', label: 'I', type: 'image', position: 0, spaceBefore: 0, align: 'left', placement: { dx: 0, dy: 0, scale: 1, rotate: 0 }, image: { id: 'a'.repeat(24), treatment: 'original', tint: '#ffffff', effect: 'none', hidden: false }, size: 80, ...over };
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

  it('measures complex-script text as one shaped run, whatever its spacing or kerning (milestone 70)', () => {
    // Arabic with letter spacing, Hebrew with kerning off: character-by-character measuring would
    // undo the joining the shaper does, so the whole string goes to the measurer in one piece.
    expect(textWidth('سلام', text(), 100, 0.1, measure)).toBe(200);
    expect(textWidth('שלום', text({ kerning: false }), 100, 0, measure)).toBe(200);
    expect(textWidth('क्का', text(), 100, 0.2, measure)).toBe(200);
  });

  it('knows which text carries a complex script and which does not', () => {
    expect(complexText('Hello')).toBe(false);
    expect(complexText('Grüße 123')).toBe(false);
    expect(complexText('سلام')).toBe(true);
    expect(complexText('שלום')).toBe(true);
    expect(complexText('नमस्ते')).toBe(true); // Devanagari
    expect(complexText('வணக்கம்')).toBe(true); // Tamil
    expect(complexText('a سلام b')).toBe(true);
  });

  it('reads a line\'s base direction from its first strong character, so neutrals land right', () => {
    expect(lineDirection('Hello')).toBe('ltr');
    expect(lineDirection('שלום.')).toBe('rtl');
    expect(lineDirection('سلام 123')).toBe('rtl');
    expect(lineDirection('"שלום" he said')).toBe('rtl'); // the quote is neutral; the Hebrew is the first strong character
    expect(lineDirection('Pulp — سلام')).toBe('ltr');
    expect(lineDirection('नमस्ते')).toBe('ltr'); // Devanagari reads left to right
    expect(lineDirection('123 …')).toBe('ltr'); // nothing strong at all
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

  it('truncate cuts a whole code point at a time, never half a surrogate pair', () => {
    // Each UTF-16 unit measures 50, so '🙂🙂🙂🙂🙂' (ten units) is 500 wide and must lose whole
    // characters to fit 325 with the ellipsis; a split pair would leave a lone surrogate behind.
    const { lines } = layoutTextLayer(text({ text: '🙂🙂🙂🙂🙂', overflow: 'truncate' }), 325, 0, measure);
    expect(lines[0]).toBe('🙂🙂…');
  });

  it('wraps right-to-left words in their logical order, first word on the first line (milestone 70)', () => {
    const { lines } = layoutTextLayer(text({ text: 'שלום עולם' }), 250, 0, measure);
    expect(lines).toEqual(['שלום', 'עולם']);
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

  it('aligns each line on its own, left, centered or right', () => {
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
    // Centered, the whole row sits in the middle of the box instead.
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

describe('a keyed layer (milestone 51)', () => {
  const keys = [
    { at: 0, dx: -100, dy: 0, scale: 1, rotate: 0, opacity: 1, easing: 'linear' as const },
    { at: 2, dx: 100, dy: 50, scale: 2, rotate: 90, opacity: 0.5, easing: 'linear' as const },
  ];

  it('moves by its keys, composed around the template\'s own draw', () => {
    const b = block([text({ keys })]);
    const at = (elapsed: number) => layoutBlock(b, measure, noImages, { watched: { elapsed, length: 4 } }).layers[0]!.draw;
    expect(at(0)).toMatchObject({ dx: -100, dy: 0, scale: 1, rotate: 0, alpha: 1 });
    const mid = at(1);
    expect(mid.dx).toBeCloseTo(0, 6);
    expect(mid.dy).toBeCloseTo(25, 6);
    expect(mid.scale).toBeCloseTo(1.5, 6);
    expect(mid.rotate).toBeCloseTo(45, 6);
    expect(mid.alpha).toBeCloseTo(0.75, 6);
    expect(at(3)).toMatchObject({ dx: 100, scale: 2, rotate: 90 });
  });

  it('moves by its keys instead of its placement: two answers to one question would drift', () => {
    const b = block([text({ keys, placement: { dx: 999, dy: 999, scale: 4, rotate: 180 } })]);
    const draw = layoutBlock(b, measure, noImages, { watched: { elapsed: 0, length: 4 } }).layers[0]!.draw;
    expect(draw.dx).toBe(-100);
    expect(draw.scale).toBe(1);
    // And without keys the placement stands, as it always has.
    const placedOnly = block([text({ placement: { dx: 10, dy: 0, scale: 2, rotate: 0 } })]);
    expect(layoutBlock(placedOnly, measure, noImages, { watched: { elapsed: 0, length: 4 } }).layers[0]!.draw.dx).toBe(10);
  });

  it('composes with an entrance, an exit and a span of the layer\'s own', () => {
    const fades: LayerTransitions = { in: { ...DEFAULT_TRANSITION, type: 'fade', seconds: 1 }, out: { ...DEFAULT_TRANSITION, type: 'fade', seconds: 1 } };
    const b = block([text({ keys, transition: fades, span: { start: 1, end: 3 } })]);
    const at = (elapsed: number) => layoutBlock(b, measure, noImages, { each: () => ({ alpha: 1 }), watched: { elapsed, length: 4 } }).layers[0]!.draw;
    // Outside its span it is not there at all, however loud the keys.
    expect(at(0.5).alpha).toBe(0);
    expect(at(3.5).alpha).toBe(0);
    // Half way through the fade in: the keys' pose at 1.5 s, at half the entrance's alpha times the keyed opacity.
    const arriving = at(1.5);
    expect(arriving.dx).toBeCloseTo(50, 6);
    expect(arriving.scale).toBeCloseTo(1.75, 6);
    expect(arriving.rotate).toBeCloseTo(67.5, 6);
    expect(arriving.alpha).toBeCloseTo(0.5 * 0.625, 6);
    // Half way through the fade out: the last key's pose, at half the exit times its opacity.
    const leaving = at(2.5);
    expect(leaving.dx).toBeCloseTo(100, 6);
    expect(leaving.alpha).toBeCloseTo(0.5 * 0.5, 6);
  });

  it('scales a key\'s offsets to this frame\'s pixels, as a placement\'s are', () => {
    const manifest = { blocks: [{ id: 'b', label: 'B', box: { x: 0, y: 0, width: 1, height: 1 }, open: true, typography: DEFAULT_TYPOGRAPHY, direction: 'column' as const, gap: 0, align: 'left' as const, verticalAlign: 'top' as const, layers: [] }] };
    const layer = { id: 't', label: 'T', required: false, hidden: false, spaceBefore: 0, type: 'text' as const, ...DEFAULT_TYPOGRAPHY, text: 'x', maxLines: 3, keys: [{ at: 0, dx: 0.5, dy: 0.5, scale: 1, rotate: 0, opacity: 1, easing: 'linear' as const }] };
    const states = blockStates(manifest, { b: [layer] }, { width: 1920, height: 1080 });
    expect(states.b!.layers[0]!.keys![0]).toMatchObject({ dx: 960, dy: 540 });
  });
});

describe('a layer with an entrance or an exit of its own (milestone 28)', () => {
  const watched = { elapsed: 0.25, length: 4 };
  const ends = (over: Partial<LayerTransitions>): LayerTransitions => ({ in: { ...DEFAULT_TRANSITION }, out: { ...DEFAULT_TRANSITION }, ...over });
  const now = (type: LayerTransition['type']) => ends({ in: { ...DEFAULT_TRANSITION, type, seconds: 0.5 } });
  /** Two lines the template staggers in: the first is already full, the second not yet. */
  const staggered = () => block([text({ id: 'a', position: 0 }), text({ id: 'b', text: 'Second', position: 1 })]);
  const each = (_l: LayerState, position: number) => ({ alpha: position === 0 ? 1 : 0 });

  it('keeps the template\'s own movement until a layer asks for something else', () => {
    const laid = layoutBlock(staggered(), measure, noImages, { each, watched });
    expect(laid.layers.map((l) => l.draw.alpha)).toEqual([1, 0]);
    // And with no timing given at all — a caller that is not drawing a frame — the template's stands.
    const over = block([text({ transition: now('fade') })]);
    expect(layoutBlock(over, measure, noImages, { each: () => ({ alpha: 0.5 }) }).layers[0]!.draw.alpha).toBe(0.5);
  });

  it('replaces the template\'s movement for that layer, and leaves the others alone', () => {
    const b = staggered();
    b.layers[1] = text({ id: 'b', text: 'Second', position: 1, transition: now('none') });
    const laid = layoutBlock(b, measure, noImages, { each, watched });
    // The template was holding the second line back; its own entrance says it is simply there.
    expect(laid.layers.map((l) => l.draw.alpha)).toEqual([1, 1]);
  });

  it('goes when the graphic goes: a layer of one\'s own is capped by the most the template is showing', () => {
    const b = staggered();
    b.layers[0] = text({ id: 'a', position: 0, transition: now('none') });
    // The template has cleared the whole block — every layer at zero — so the layer clears too.
    const gone = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 0 }), watched });
    expect(gone.layers[0]!.draw.alpha).toBe(0);
    // Half way out, it is held to half: it can never outlive the design.
    const going = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 0.5 }), watched });
    expect(going.layers[0]!.draw.alpha).toBe(0.5);
    // But a stagger is not an exit: while the leading line is full, a layer may show from the first frame.
    const early = layoutBlock(b, measure, noImages, { each, watched: { elapsed: 0, length: 4 } });
    expect(early.layers[0]!.draw.alpha).toBe(1);
  });

  it('drops the letter spacing the template was animating: the layer is the person\'s now', () => {
    const b = block([text({ transition: now('fade') })]);
    const laid = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 1, letterSpacing: 0.5 }), watched: { elapsed: 4, length: 4 } });
    expect(laid.layers[0]!.draw.letterSpacing).toBeUndefined();
    // Measured at the layer's own spacing, then: five characters at 100 px, no tracking added.
    expect(laid.layers[0]!.lines![0]!.width).toBe(250);
  });

  it('slides by the layer\'s own size, down the stack for a column and across for a row', () => {
    const slide = now('slide');
    const start = { elapsed: 0, length: 4 };
    const col = layoutBlock(block([text({ fontSize: 60, transition: slide })]), measure, noImages, { each, watched: start });
    expect(col.layers[0]!.draw).toMatchObject({ dx: 0, dy: 60 });
    const row = layoutBlock(block([text({ fontSize: 60, transition: slide })], { direction: 'row' }), measure, noImages, { each, watched: start });
    expect(row.layers[0]!.draw).toMatchObject({ dx: -60, dy: 0 });
    // An image layer slides by its own height.
    const picture = layoutBlock(block([image({ size: 120, transition: slide })]), measure, () => 1, { each, watched: start });
    expect(picture.layers[0]!.draw.dy).toBe(120);
  });

  it('moves a layer without moving where the stack puts it: the box is where it always was', () => {
    const plain = layoutBlock(staggered(), measure, noImages, { each, watched });
    const b = staggered();
    b.layers[1] = text({ id: 'b', text: 'Second', position: 1, transition: now('slide') });
    const moved = layoutBlock(b, measure, noImages, { each, watched });
    expect(moved.layers[1]!.box).toEqual(plain.layers[1]!.box);
    expect(moved.layers[1]!.draw.dy).toBeGreaterThan(0);
  });

  it('takes the exit from the layer\'s end, over whatever the template was already doing', () => {
    const b = block([text({ transition: ends({ out: { ...DEFAULT_TRANSITION, type: 'fade', seconds: 1 } }) })]);
    // The entrance is still the template's, so what it asks for stands until the exit begins.
    const held = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 0.8 }), watched: { elapsed: 1, length: 4 } });
    expect(held.layers[0]!.draw.alpha).toBe(0.8);
    // Half a second from the end, half way through a one-second fade out, over the template's 0.8.
    const leaving = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 0.8 }), watched: { elapsed: 3.5, length: 4 } });
    expect(leaving.layers[0]!.draw.alpha).toBeCloseTo(0.8 * 0.5, 10);
  });

  it('carries a wipe through to the draw, which is the only thing that can act on it', () => {
    const b = block([text({ transition: now('wipe') })]);
    const quarter = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 1 }), watched: { elapsed: 0.25, length: 4 } });
    // A wipe does not fade: the layer is whole, and how much of it shows is the draw's business.
    expect(quarter.layers[0]!.draw.alpha).toBe(1);
    expect(quarter.layers[0]!.draw.wipe!.from).toBe('bottom');
    expect(quarter.layers[0]!.draw.wipe!.shown).toBeCloseTo(0.5, 10);
    expect(layoutBlock(b, measure, noImages, { each: () => ({ alpha: 1 }), watched: { elapsed: 2, length: 4 } }).layers[0]!.draw.wipe!.shown).toBe(1);
  });
});

describe("a layer placed on the stage (milestone 25)", () => {
  const watched = { elapsed: 2, length: 4 };
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
    const placed: TextLayer = { ...title, placement: { '16:9': { dx: 0.1, dy: -0.05, scale: 1.5, rotate: 0 }, default: { dx: 0.5, dy: 0.5, scale: 2, rotate: 0 } } };
    const wide = blockStates(m, { card: [placed] }, { width: 1920, height: 1080 }).card!;
    expect(wide.layers[0]!.placement).toEqual({ dx: 192, dy: -54, scale: 1.5, rotate: 0 });
    // A tall frame answers with "default", so the 16:9 layout never moves the 9:16 one.
    const tall = blockStates(m, { card: [placed] }, { width: 1080, height: 1920 }).card!;
    expect(tall.layers[0]!.placement).toEqual({ dx: 540, dy: 960, scale: 2, rotate: 0 });
    // No placement is identity.
    const plain = blockStates(m, { card: [title] }, { width: 1920, height: 1080 }).card!;
    expect(plain.layers[0]!.placement).toEqual({ dx: 0, dy: 0, scale: 1, rotate: 0 });
  });

  it('wraps the template\'s own draw: offsets add, scales multiply, and the box never moves', () => {
    const b = block([text({ placement: { dx: 100, dy: 40, scale: 1.5, rotate: 0 } })]);
    const laid = layoutBlock(b, measure, noImages, { each, watched });
    expect(laid.layers[0]!.draw).toMatchObject({ alpha: 0.8, dx: 105, dy: 37, scale: 3 });
    // The layout slot is untouched: placement is drawn around the stack, not into it.
    const plain = layoutBlock(block([text()]), measure, noImages, { each, watched });
    expect(laid.layers[0]!.box).toEqual(plain.layers[0]!.box);
  });

  it('turns a layer about its center, adding angles as it adds offsets (milestone 29)', () => {
    const b = block([text({ placement: { dx: 0, dy: 0, scale: 1, rotate: 30 } })]);
    const laid = layoutBlock(b, measure, noImages, { each, watched });
    expect(laid.layers[0]!.draw.rotate).toBe(30);
    // The slot is untouched: a turn is drawn around the stack, never laid into it.
    const plain = layoutBlock(block([text()]), measure, noImages, { each, watched });
    expect(laid.layers[0]!.box).toEqual(plain.layers[0]!.box);
    expect(plain.layers[0]!.draw.rotate ?? 0).toBe(0);
    // A turn rides along with an offset and a scale rather than replacing them.
    const all = layoutBlock(block([text({ placement: { dx: 100, dy: 40, scale: 1.5, rotate: -45 } })]), measure, noImages, { each, watched });
    expect(all.layers[0]!.draw).toMatchObject({ dx: 105, dy: 37, scale: 3, rotate: -45 });
  });

  it('wraps a motion override the same way', () => {
    const b = block([text({ transition: { in: { ...DEFAULT_TRANSITION, type: 'none' }, out: { ...DEFAULT_TRANSITION } }, placement: { dx: 50, dy: 0, scale: 2, rotate: 0 } })]);
    const laid = layoutBlock(b, measure, noImages, { each: () => ({ alpha: 1 }), watched });
    expect(laid.layers[0]!.draw).toMatchObject({ alpha: 1, dx: 50, dy: 0, scale: 2 });
  });
});

describe('a layer with a start and an end of its own (milestone 28)', () => {
  const each = () => ({ alpha: 1 });
  const alphaAt = (elapsed: number, layer: LayerState) =>
    layoutBlock(block([layer]), measure, noImages, { each, watched: { elapsed, length: 6 } }).layers[0]!.draw.alpha;

  it('leaves a layer that says nothing on screen for the whole graphic', () => {
    const plain = text();
    expect([alphaAt(0, plain), alphaAt(3, plain), alphaAt(5.9, plain)]).toEqual([1, 1, 1]);
    // And with no watched time at all — a caller that is not drawing a frame — nothing changes.
    const timed = text({ span: { start: 2, end: 4 } });
    expect(layoutBlock(block([timed]), measure, noImages, { each }).layers[0]!.draw.alpha).toBe(1);
  });

  it('draws it between its start and its end, and nowhere else', () => {
    const timed = text({ span: { start: 2, end: 4 } });
    expect([alphaAt(1.9, timed), alphaAt(2, timed), alphaAt(3.9, timed), alphaAt(4, timed)]).toEqual([0, 1, 1, 0]);
  });

  it('has the last word over the template\'s own movement and over an entrance of its own', () => {
    // The template is showing this layer in full; the span says it has not arrived.
    const owned = text({ span: { start: 3, end: null } });
    expect(alphaAt(1, owned)).toBe(0);
    // Its own entrance says it is simply there; the span still takes it off screen.
    const over = text({ transition: { in: { ...DEFAULT_TRANSITION, type: 'none' }, out: { ...DEFAULT_TRANSITION } }, span: { start: 3, end: null } });
    expect(alphaAt(1, over)).toBe(0);
    expect(alphaAt(4, over)).toBe(1);
  });

  it('dims with the design rather than replacing it: the template clearing still clears it', () => {
    const timed = text({ span: { start: 0, end: 4 } });
    const going = layoutBlock(block([timed]), measure, noImages, { each: () => ({ alpha: 0.5 }), watched: { elapsed: 2, length: 6 } });
    expect(going.layers[0]!.draw.alpha).toBe(0.5);
  });

  it('leaves the layout alone: a layer waiting its turn keeps the room the stack gave it', () => {
    const b = block([text({ id: 'a' }), text({ id: 'b', text: 'Second', position: 1, span: { start: 3, end: null } })]);
    const before = layoutBlock(b, measure, noImages, { each, watched: { elapsed: 0, length: 6 } });
    const during = layoutBlock(b, measure, noImages, { each, watched: { elapsed: 4, length: 6 } });
    expect(before.layers[1]!.draw.alpha).toBe(0);
    expect(during.layers[1]!.draw.alpha).toBe(1);
    expect(before.layers[1]!.box).toEqual(during.layers[1]!.box);
  });

  it('is carried into the layer states a block is built from', () => {
    const r = validateManifest(rawManifest({
      blocks: [{ id: 'card', label: 'Card', box: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 }, layers: [{ id: 'title', type: 'text', label: 'Title', text: 'Hello' }] }],
    }));
    if (!r.ok) throw new Error(r.errors.map((e) => e.path).join());
    const title = r.manifest.blocks[0]!.layers[0] as TextLayer;
    const timed: TextLayer = { ...title, span: { start: 1, end: 3 } };
    const states = blockStates(r.manifest, { card: [timed] }, { width: 1920, height: 1080 }).card!;
    expect(states.layers[0]!.span).toEqual({ start: 1, end: 3 });
    // A layer with none has none, so nothing a template ships carries a key it never asked for.
    expect(blockStates(r.manifest, { card: [title] }, { width: 1920, height: 1080 }).card!.layers[0]!.span).toBeUndefined();
  });
});

describe('shape layers (milestone 55)', () => {
  function shape(over: Partial<ShapeLayerState> = {}): ShapeLayerState {
    return { id: 's', label: 'S', type: 'shape', position: 0, spaceBefore: 0, align: 'left', placement: { dx: 0, dy: 0, scale: 1, rotate: 0 }, shape: 'rectangle', color: '#e8a33d', size: 80, ratio: 1, ...over };
  }

  it('takes its room from its own ratio: height is its size, width is size times ratio', () => {
    const laid = layoutBlock(block([shape({ size: 80, ratio: 2.5 })]), measure, noImages);
    expect(laid.layers[0]!.box).toEqual({ x: 100, y: 200, width: 200, height: 80 });
  });

  it('is capped by the block the way a picture is, keeping its ratio', () => {
    const laid = layoutBlock(block([shape({ size: 800, ratio: 4 })]), measure, noImages);
    // 800 * 4 = 3200 wide would overflow the 1000-wide box: the width caps and the height follows.
    expect(laid.layers[0]!.box.width).toBe(1000);
    expect(laid.layers[0]!.box.height).toBe(250);
  });

  it('aligns across the block and stacks with text, needing no picture to have room', () => {
    const laid = layoutBlock(block([shape({ size: 100, ratio: 1, align: 'center' }), text({ text: 'ab' })], { gap: 10 }), measure, noImages);
    expect(laid.layers[0]!.box).toEqual({ x: 550, y: 200, width: 100, height: 100 });
    // The line starts under the shape and its gap: 200 + 100 + 10.
    expect(laid.layers[1]!.box.y).toBe(310);
  });

  it('reaches the page through blockStates with its size in pixels of the frame', () => {
    const r = validateManifest(rawManifest({
      blocks: [{ id: 'b', label: 'B', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [{ id: 'bar', label: 'Bar', type: 'shape', shape: 'ellipse', color: '#112233', size: 0.25, ratio: 2 }] }],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const states = blockStates(r.manifest, { b: r.manifest.blocks[0]!.layers }, { width: 1920, height: 1080 });
    const laid = states.b!.layers[0]!;
    expect(laid.type).toBe('shape');
    if (laid.type !== 'shape') return;
    expect(laid.shape).toBe('ellipse');
    expect(laid.color).toBe('#112233');
    expect(laid.size).toBe(270);
    expect(laid.ratio).toBe(2);
  });
});
