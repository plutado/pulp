import { describe, expect, it } from 'vitest';
import {
  angleFromDrag,
  ANGLE_SNAP_DEGREES,
  clampPlacement,
  clampScale,
  hitLayer,
  nudgeFraction,
  placedBounds,
  placedBox,
  placedCentre,
  placedPoint,
  placedQuad,
  rotateHandleAt,
  scaleFromDrag,
  snapLines,
  snapMove,
  type LaidReport,
} from '../src/core/stage-place';
import { SAFE_AREAS } from '../src/core/player';

const layer = (id: string, box: { x: number; y: number; width: number; height: number }, draw: Partial<{ alpha: number; dx: number; dy: number; scale: number; rotate: number }> = {}) => ({
  id, type: 'text' as const, box, draw: { alpha: 1, dx: 0, dy: 0, scale: 1, ...draw },
});
const FRAME = { width: 1920, height: 1080 };

describe('placedBox', () => {
  it('moves the slot by the draw and scales it about its centre', () => {
    expect(placedBox(layer('a', { x: 100, y: 200, width: 200, height: 100 }))).toEqual({ x: 100, y: 200, width: 200, height: 100 });
    expect(placedBox(layer('a', { x: 100, y: 200, width: 200, height: 100 }, { dx: 50, dy: -20 }))).toEqual({ x: 150, y: 180, width: 200, height: 100 });
    // Scaling doubles about the centre: the middle stays put.
    const scaled = placedBox(layer('a', { x: 100, y: 200, width: 200, height: 100 }, { scale: 2 }));
    expect(scaled).toEqual({ x: 0, y: 150, width: 400, height: 200 });
  });
});

describe('hitLayer', () => {
  const laid: LaidReport = {
    frame: 110,
    blocks: { card: {
      box: { x: 0, y: 0, width: 1920, height: 1080 },
      layers: [
        layer('under', { x: 100, y: 100, width: 400, height: 200 }),
        layer('over', { x: 200, y: 150, width: 400, height: 200 }),
        layer('ghost', { x: 0, y: 0, width: 1920, height: 1080 }, { alpha: 0 }),
        layer('empty', { x: 0, y: 0, width: 0, height: 0 }),
      ],
    } },
  };
  it('answers the topmost drawn layer, skipping invisible and empty ones', () => {
    expect(hitLayer(laid, 300, 200)).toEqual({ block: 'card', id: 'over' }); // overlap: the later one is on top
    expect(hitLayer(laid, 120, 120)).toEqual({ block: 'card', id: 'under' });
    expect(hitLayer(laid, 1800, 1000)).toBeNull(); // only the ghost is there, and it is not drawn
  });
  it('forgives a near miss by the tolerance, so a thin line on a small preview is still clickable', () => {
    // 2 px above the "under" layer's top edge: a miss with no tolerance, a hit with 4.
    expect(hitLayer(laid, 300, 98)).toBeNull();
    expect(hitLayer(laid, 300, 98, 4)).toEqual({ block: 'card', id: 'under' });
    // The tolerance does not reach a layer that was never drawn.
    expect(hitLayer(laid, 1800, 1000, 40)).toBeNull();
  });

  it('hits where the layer was drawn, not where its slot is', () => {
    const moved: LaidReport = { frame: 1, blocks: { b: { box: { x: 0, y: 0, width: 1920, height: 1080 }, layers: [layer('m', { x: 0, y: 0, width: 100, height: 100 }, { dx: 500, dy: 500 })] } } };
    expect(hitLayer(moved, 550, 550)).toEqual({ block: 'b', id: 'm' });
    expect(hitLayer(moved, 50, 50)).toBeNull();
  });
});

describe('snapping', () => {
  const block = { x: 192, y: 108, width: 960, height: 540 };
  it('offers the centre lines, both safe areas and the block edges', () => {
    const lines = snapLines(FRAME, block);
    expect(lines.x).toContain(960);
    expect(lines.y).toContain(540);
    for (const area of SAFE_AREAS) {
      expect(lines.x).toContain(1920 * area.inset);
      expect(lines.x).toContain(1920 * (1 - area.inset));
    }
    expect(lines.x).toContain(192);
    expect(lines.x).toContain(192 + 960);
  });
  it('snaps the nearest edge or centre inside the threshold, each axis on its own', () => {
    // A box whose centre is 6 px left of the frame's centre line: it snaps right by 6.
    const near = { x: 960 - 100 - 6, y: 300, width: 200, height: 100 };
    const snap = snapMove(near, FRAME, block, 8);
    expect(snap.dx).toBe(6);
    expect(snap.guides).toContainEqual({ axis: 'x', at: 960 });
    // Too far: no snap, no guide.
    expect(snapMove({ ...near, x: 700 }, FRAME, block, 8).guides.filter((g) => g.axis === 'x')).toEqual([]);
  });
  it('a nudge is a fraction of the frame, bolder with Shift, and clamps stay honest', () => {
    expect(nudgeFraction(false)).toBeLessThan(nudgeFraction(true));
    expect(clampPlacement(2)).toBe(1);
    expect(clampPlacement(-2)).toBe(-1);
    expect(clampScale(0)).toBe(0.05);
    expect(clampScale(99)).toBe(10);
  });
});

describe('scaleFromDrag', () => {
  it('scales by the pointer\'s distance from the centre, proportions kept by construction', () => {
    const centre = { x: 500, y: 500 };
    expect(scaleFromDrag({ x: 600, y: 500 }, { x: 700, y: 500 }, centre, 1)).toBe(2);
    expect(scaleFromDrag({ x: 700, y: 500 }, { x: 600, y: 500 }, centre, 2)).toBe(1);
    // A degenerate start at the centre changes nothing rather than exploding.
    expect(scaleFromDrag(centre, { x: 900, y: 500 }, centre, 1.5)).toBe(1.5);
  });
});

describe('a turned layer (milestone 29)', () => {
  const box = { x: 100, y: 200, width: 200, height: 100 };
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  };

  it('keeps its centre and its size, and turns its corners about that centre', () => {
    const turned = layer('a', box, { rotate: 90 });
    // The box a drag works in is the unturned one; the quad is where it was really drawn.
    expect(placedBox(turned)).toEqual(box);
    near(placedCentre(turned), { x: 200, y: 250 });
    const quad = placedQuad(turned);
    expect(quad).toHaveLength(4);
    // A quarter turn clockwise takes the top-left corner to the top-right of the centre.
    near(quad[0]!, { x: 250, y: 150 });
    near(quad[2]!, { x: 150, y: 350 });
    // Every corner stays its own distance from the centre: a turn is not a resize.
    for (const corner of quad) {
      expect(Math.hypot(corner.x - 200, corner.y - 250)).toBeCloseTo(Math.hypot(100, 50), 6);
    }
    // No angle, no change.
    expect(placedQuad(layer('a', box))[0]).toEqual({ x: 100, y: 200 });
  });

  it('reports the upright box that contains it, which is what snapping measures', () => {
    // Upright, the bounds are the box itself.
    expect(placedBounds(layer('a', box))).toEqual(box);
    // At a quarter turn the sides swap.
    const quarter = placedBounds(layer('a', box, { rotate: 90 }));
    expect(quarter.width).toBeCloseTo(100, 6);
    expect(quarter.height).toBeCloseTo(200, 6);
    near({ x: quarter.x + quarter.width / 2, y: quarter.y + quarter.height / 2 }, { x: 200, y: 250 });
    // At 45° it is wider than either side, and still centred on the same point.
    const diagonal = placedBounds(layer('a', box, { rotate: 45 }));
    expect(diagonal.width).toBeCloseTo(Math.SQRT1_2 * (200 + 100), 6);
    near({ x: diagonal.x + diagonal.width / 2, y: diagonal.y + diagonal.height / 2 }, { x: 200, y: 250 });
  });

  it('is hit where it was drawn, not where its upright box is', () => {
    const laid: LaidReport = {
      frame: 1,
      blocks: { card: { box: { x: 0, y: 0, width: 1920, height: 1080 }, layers: [layer('turned', box, { rotate: 90 })] } },
    };
    // Turned a quarter, the layer is tall and narrow about (200, 250).
    expect(hitLayer(laid, 200, 330)).toEqual({ block: 'card', id: 'turned' });
    expect(hitLayer(laid, 290, 250), 'outside the turned shape, inside the unturned box').toBeNull();
    expect(hitLayer(laid, 200, 250), 'the centre is always inside').toEqual({ block: 'card', id: 'turned' });
    // The tolerance still widens it, in the layer's own frame.
    expect(hitLayer(laid, 200, 356)).toBeNull();
    expect(hitLayer(laid, 200, 356, 10)).toEqual({ block: 'card', id: 'turned' });
  });

  it('turns by the angle the pointer sweeps, settling on 15° steps with Shift', () => {
    const centre = { x: 0, y: 0 };
    // A quarter sweep clockwise from the right-hand side adds 90°.
    expect(angleFromDrag({ x: 100, y: 0 }, { x: 0, y: 100 }, centre, 0, false)).toBeCloseTo(90, 6);
    // It adds to the angle already there, and folds past half a turn.
    expect(angleFromDrag({ x: 100, y: 0 }, { x: 0, y: 100 }, centre, 120, false)).toBeCloseTo(-150, 6);
    // Shift settles the result on a step, whatever angle the layer started from.
    expect(angleFromDrag({ x: 100, y: 0 }, { x: 100, y: 12 }, centre, 7, true) % ANGLE_SNAP_DEGREES).toBe(0);
    expect(angleFromDrag({ x: 100, y: 0 }, { x: 0, y: 100 }, centre, 7, true)).toBe(90);
    // A pointer that has not moved asks for the angle the layer already had.
    expect(angleFromDrag({ x: 100, y: 0 }, { x: 100, y: 0 }, centre, 33, false)).toBe(33);
  });

  it('turns about what it draws, not the slot it sits in', () => {
    // A line aligned at the left of a block-wide slot: the slot is 1000 wide, the words 200.
    const slot = { x: 0, y: 100, width: 1000, height: 50 };
    const ink = { x: 0, y: 100, width: 200, height: 50 };
    const line = { id: 'who', type: 'text' as const, box: slot, ink, draw: { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 90 } };
    // It spins about the middle of the words, not the middle of the block.
    near(placedCentre(line), { x: 100, y: 125 });
    // So the drawn shape stays over the words rather than swinging across the frame.
    const bounds = placedBounds(line);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(100, 6);
    // Without an ink box — a page too old to report one — the slot is all there is to go on.
    near(placedCentre({ ...line, ink: undefined }), { x: 500, y: 125 });
    // The offset and the scale move that centre, as they move everything else.
    // Scaling is about the slot's centre (500, 125), so the ink centre at (100, 125) is pushed
    // twice as far from it, and the offset moves everything: 500 + 40 + (100 - 500) * 2 = -260.
    near(placedCentre({ ...line, draw: { alpha: 1, dx: 40, dy: 10, scale: 2, rotate: 0 } }), { x: -260, y: 135 });
    near(placedPoint(line, { x: 500, y: 125 }), { x: 500, y: 125 });
    // A hit lands on the turned words.
    const laid: LaidReport = { frame: 1, blocks: { card: { box: { x: 0, y: 0, width: 1920, height: 1080 }, layers: [line] } } };
    expect(hitLayer(laid, 100, 400)).toEqual({ block: 'card', id: 'who' });
    expect(hitLayer(laid, 600, 125), 'the far end of the empty slot is not the layer').toBeNull();
  });

  it('puts the rotate handle above the layer, turned with it', () => {
    // Upright: straight above the top edge.
    near(rotateHandleAt(layer('a', box), 30), { x: 200, y: 170 });
    // Turned a quarter clockwise, "above" is to the right.
    near(rotateHandleAt(layer('a', box, { rotate: 90 }), 30), { x: 280, y: 250 });
  });
});
