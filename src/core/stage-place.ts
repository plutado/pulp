/**
 * Moving and resizing layers on the stage (milestone 25): the arithmetic. The
 * stage reads the laid boxes the template page reports with each frame, hit-
 * tests a click against where the layers were really drawn, turns a drag into
 * placement fractions, and snaps to the lines a frame cares about — its centre
 * lines, its safe-area edges, the layer's own block. Pure; the stage draws
 * what these answer.
 */

import type { PxBox } from './image-slot';
import { normalizeAngle } from './layers';
import { SAFE_AREAS } from './player';

/** What the template page reports for one drawn layer: its slot and what it was drawn with. */
export interface LaidLayerReport {
  id: string;
  type: 'text' | 'image' | 'video';
  box: PxBox;
  draw: { alpha: number; dx: number; dy: number; scale: number; rotate?: number };
}

export interface LaidBlockReport {
  box: PxBox;
  layers: LaidLayerReport[];
}

/** What the page reports for a frame: which frame it was, and the blocks it laid. */
export interface LaidReport {
  /** The frame this describes, so a report that lags the preview can be told from the current one. */
  frame: number | null;
  blocks: Record<string, LaidBlockReport>;
}

export const EMPTY_LAID: LaidReport = { frame: null, blocks: {} };

/** Where a layer was really drawn: its slot moved by the draw's offset and scaled about its centre. */
export function placedBox(layer: LaidLayerReport): PxBox {
  const { box, draw } = layer;
  const cx = box.x + draw.dx + box.width / 2;
  const cy = box.y + draw.dy + box.height / 2;
  return { x: cx - (box.width * draw.scale) / 2, y: cy - (box.height * draw.scale) / 2, width: box.width * draw.scale, height: box.height * draw.scale };
}

/** A point in frame pixels. */
export interface Point {
  x: number;
  y: number;
}

/** The angle a layer is drawn at, in degrees; 0 for one that was never turned. */
export function placedAngle(layer: LaidLayerReport): number {
  return layer.draw.rotate ?? 0;
}

/** Turn a point about a centre, clockwise, by degrees. */
export function rotatePoint(point: Point, centre: Point, degrees: number): Point {
  if (!degrees) return { x: point.x, y: point.y };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos };
}

/** The centre of where a layer was really drawn. */
export function placedCentre(layer: LaidLayerReport): Point {
  const b = placedBox(layer);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * The four corners of where a layer was really drawn, turned (milestone 29):
 * top-left, top-right, bottom-right, bottom-left. `placedBox` is the same
 * rectangle before the turn, which is still what a drag and a scale work in —
 * the selection outline and hit-testing are what need the corners.
 */
export function placedQuad(layer: LaidLayerReport): Point[] {
  const b = placedBox(layer);
  const centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const angle = placedAngle(layer);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ].map((corner) => rotatePoint(corner, centre, angle));
}

/** The upright box that contains a turned layer: what snapping measures, and what a guide lines up with. */
export function placedBounds(layer: LaidLayerReport): PxBox {
  const quad = placedQuad(layer);
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The layer under a point, topmost first — the stack draws bottom to top, so
 * the last hit wins — ignoring what was not drawn (alpha 0, an empty box).
 *
 * `tolerance` widens every box, in frame pixels. The preview is often far
 * smaller than the frame — a stage 157 px wide shows a 1920-pixel frame, where
 * a line of type is a few pixels tall on screen — so a pixel-exact hit would
 * ask for an aim nobody has. The stage passes a few screen pixels' worth.
 */
export function hitLayer(laid: LaidReport, x: number, y: number, tolerance = 0): { block: string; id: string } | null {
  let hit: { block: string; id: string } | null = null;
  for (const [block, report] of Object.entries(laid.blocks)) {
    for (const layer of report.layers) {
      if (layer.draw.alpha <= 0 || layer.box.width <= 0 || layer.box.height <= 0) continue;
      // A turned layer is tested in its own upright frame: the point is turned back about the
      // layer's centre, and the same box test then answers for the rotated outline exactly.
      const b = placedBox(layer);
      const angle = placedAngle(layer);
      const point = angle ? rotatePoint({ x, y }, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, -angle) : { x, y };
      if (point.x >= b.x - tolerance && point.x <= b.x + b.width + tolerance && point.y >= b.y - tolerance && point.y <= b.y + b.height + tolerance) {
        hit = { block, id: layer.id };
      }
    }
  }
  return hit;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  /** Where the guide lies, in pixels of the frame. */
  at: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** The vertical and horizontal lines a frame offers: its centre, its safe edges, the block's edges. */
export function snapLines(frame: { width: number; height: number }, block: PxBox): { x: number[]; y: number[] } {
  const x = [frame.width / 2];
  const y = [frame.height / 2];
  for (const area of SAFE_AREAS) {
    x.push(frame.width * area.inset, frame.width * (1 - area.inset));
    y.push(frame.height * area.inset, frame.height * (1 - area.inset));
  }
  x.push(block.x, block.x + block.width);
  y.push(block.y, block.y + block.height);
  return { x, y };
}

/**
 * Snap a moved box: its centre and both edges are tried against each line, on
 * each axis independently, and the smallest correction inside the threshold
 * wins. The answer is the correction to add to the drag, with the guides that
 * earned it.
 */
export function snapMove(moved: PxBox, frame: { width: number; height: number }, block: PxBox, thresholdPx: number): SnapResult {
  const lines = snapLines(frame, block);
  const result: SnapResult = { dx: 0, dy: 0, guides: [] };
  const tryAxis = (axis: 'x' | 'y', candidates: number[], targets: number[]): void => {
    let best: { delta: number; at: number } | null = null;
    for (const target of targets) {
      for (const candidate of candidates) {
        const delta = target - candidate;
        if (Math.abs(delta) <= thresholdPx && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: target };
      }
    }
    if (!best) return;
    if (axis === 'x') result.dx = best.delta;
    else result.dy = best.delta;
    result.guides.push({ axis, at: best.at });
  };
  tryAxis('x', [moved.x, moved.x + moved.width / 2, moved.x + moved.width], lines.x);
  tryAxis('y', [moved.y, moved.y + moved.height / 2, moved.y + moved.height], lines.y);
  return result;
}

/** One arrow press, as a fraction of the frame: fine by default, a bolder step with Shift. */
export function nudgeFraction(shift: boolean): number {
  return shift ? 0.02 : 0.002;
}

/** A clamped placement fraction, so a nudge can never push a value out of its range. */
export function clampPlacement(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** A clamped placement scale. */
export function clampScale(value: number): number {
  return Math.max(0.05, Math.min(10, value));
}

/**
 * The scale a corner drag asks for: how far the pointer is from the placed
 * centre now, over how far it was when the drag started, times the scale the
 * layer already had. Proportions keep themselves — one factor serves both axes.
 */
export function scaleFromDrag(start: { x: number; y: number }, now: { x: number; y: number }, centre: { x: number; y: number }, startScale: number): number {
  const was = Math.hypot(start.x - centre.x, start.y - centre.y);
  const is = Math.hypot(now.x - centre.x, now.y - centre.y);
  if (was < 1) return startScale;
  return clampScale(startScale * (is / was));
}

/** Angles a turn settles on when Shift is held: every 15 degrees, as a protractor reads. */
export const ANGLE_SNAP_DEGREES = 15;

/**
 * The angle a rotate-handle drag asks for: the angle the pointer has swept
 * about the placed centre since the gesture began, added to the angle the
 * layer already had. With Shift it settles on the nearest 15°, measured on the
 * **result** rather than the sweep, so the layer lands on 0, 15, 30 and so on
 * whatever angle it started from.
 */
export function angleFromDrag(start: Point, now: Point, centre: Point, startAngle: number, snap: boolean): number {
  const was = Math.atan2(start.y - centre.y, start.x - centre.x);
  const is = Math.atan2(now.y - centre.y, now.x - centre.x);
  const swept = ((is - was) * 180) / Math.PI;
  const angle = startAngle + swept;
  return normalizeAngle(snap ? Math.round(angle / ANGLE_SNAP_DEGREES) * ANGLE_SNAP_DEGREES : angle);
}

/** Where the rotate handle sits: above the layer's top edge, turned with it. */
export function rotateHandleAt(layer: LaidLayerReport, distance: number): Point {
  const b = placedBox(layer);
  const centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return rotatePoint({ x: centre.x, y: b.y - distance }, centre, placedAngle(layer));
}
