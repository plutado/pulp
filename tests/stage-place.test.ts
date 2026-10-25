import { describe, expect, it } from 'vitest';
import { clampPlacement, clampScale, hitLayer, nudgeFraction, placedBox, scaleFromDrag, snapLines, snapMove, type LaidReport } from '../src/core/stage-place';
import { SAFE_AREAS } from '../src/core/player';

const layer = (id: string, box: { x: number; y: number; width: number; height: number }, draw: Partial<{ alpha: number; dx: number; dy: number; scale: number }> = {}) => ({
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
