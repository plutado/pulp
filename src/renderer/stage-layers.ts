/**
 * Layers on the stage (milestone 25): the overlay that lets a person click a
 * drawn line or logo, drag it anywhere, scale it by a corner and nudge it with
 * the arrows. It reads the laid boxes the template page reports with each
 * frame (src/core/stage-place.ts does the arithmetic), draws the selection and
 * the snap guides, and edits the layer through the Parameters tab's own editor
 * (src/renderer/layer-edit.ts), so every gesture is one undo step and the
 * preview redraws through the one real pipeline.
 */

import { effect } from '@preact/signals';
import { aspectOf } from '../core/aspect';
import { angleFromDrag, clampPlacement, clampScale, EMPTY_LAID, framePointIn, hitLayer, nudgeFraction, placedAngle, placedBounds, placedBox, placedCentre, scaleFromDrag, snapMove, type LaidReport, type SnapGuide } from '../core/stage-place';
import { isIdentityPlacement, placementFor, type Layer, type LayerPlacement, type LayerPlacements } from '../core/layers';
import { COLLECTION_DRAG_TYPE } from '../core/collection';
import { layerEditor, selectedLayer } from './layer-edit';

/** How close a drag has to come to a line before it takes, in screen pixels. */
const SNAP_SCREEN_PX = 6;

/**
 * How far off a layer a click may land and still take it, in screen pixels. The preview is
 * usually much smaller than the frame, so a line of type can be a few pixels tall on screen;
 * without this, selecting one would ask for an aim nobody has.
 */
const GRAB_SCREEN_PX = 4;

interface Host {
  /** The template pixels the preview is rendered at. */
  frameSize(): { width: number; height: number };
}

let host: Host | null = null;
let overlay: HTMLElement | null = null;
let laid: LaidReport = EMPTY_LAID;

interface DragState {
  kind: 'move' | 'resize' | 'rotate';
  block: string;
  id: string;
  pointerId: number;
  /** Where the drag started, in frame pixels. */
  start: { x: number; y: number };
  /** The placement the layer had when the gesture began, for this aspect. */
  from: LayerPlacement;
  /** The placed centre at the gesture's start, for resize. */
  centre: { x: number; y: number };
  /** Where the layer sat when the gesture began, in frame pixels: the box every candidate is measured from. */
  startBox: { x: number; y: number; width: number; height: number };
  moved: boolean;
}

let drag: DragState | null = null;

/** Keep the gesture when the pointer leaves the overlay; a pointer that cannot be captured (a test's synthetic one) still works, it just has to stay over the overlay. */
function capture(pointerId: number): void {
  try {
    overlay?.setPointerCapture(pointerId);
  } catch {
    // Not a capturable pointer: fine.
  }
}

/** The frame-pixel point of a pointer event, mapped through the overlay's box. */
function framePoint(e: PointerEvent): { x: number; y: number } {
  return framePointIn(overlay!.getBoundingClientRect(), host!.frameSize(), { x: e.clientX, y: e.clientY });
}

/** Frame pixels to overlay percent, for positioning the chrome. */
function pct(v: number, of: number): string {
  return `${(v / of) * 100}%`;
}

function laidLayer(block: string, id: string) {
  return laid.blocks[block]?.layers.find((l) => l.id === id) ?? null;
}

/** The placement the layer currently stores for the frame's aspect. */
function currentPlacement(block: string, id: string): LayerPlacement {
  const layer = layerEditor()?.get(block, id);
  const size = host!.frameSize();
  return { ...placementFor(layer?.placement, aspectOf(size.width, size.height)) };
}

/** Write one aspect's placement back onto the layer, dropping what says nothing. */
function writePlacement(block: string, id: string, next: LayerPlacement, commit: boolean): void {
  const editor = layerEditor();
  if (!editor) return;
  const size = host!.frameSize();
  const aspect = aspectOf(size.width, size.height);
  editor.edit(
    block,
    id,
    (layer: Layer): Layer => {
      const placements: LayerPlacements = { ...layer.placement };
      if (isIdentityPlacement(next)) delete placements[aspect];
      else placements[aspect] = next;
      if (Object.keys(placements).length === 0) {
        const rest = { ...layer };
        delete rest.placement;
        return rest;
      }
      return { ...layer, placement: placements };
    },
    commit,
  );
}

function clearGuides(): void {
  overlay?.querySelectorAll('.stage-guide').forEach((g) => g.remove());
}

function showGuides(guides: SnapGuide[]): void {
  clearGuides();
  if (!overlay || !host) return;
  const size = host.frameSize();
  for (const guide of guides) {
    const line = document.createElement('div');
    line.className = `stage-guide ${guide.axis}`;
    if (guide.axis === 'x') line.style.left = pct(guide.at, size.width);
    else line.style.top = pct(guide.at, size.height);
    overlay.append(line);
  }
}

/** Draw (or clear) the selection chrome: a thin outline with four corner handles. */
function paintSelection(): void {
  if (!overlay || !host) return;
  overlay.querySelectorAll('.stage-select').forEach((el) => el.remove());
  const chosen = selectedLayer.value;
  if (!chosen) return;
  const layer = laidLayer(chosen.block, chosen.id);
  if (!layer || layer.box.width <= 0) return;
  const size = host.frameSize();
  const box = placedBox(layer);
  const angle = placedAngle(layer);
  const el = document.createElement('div');
  el.className = 'stage-select';
  el.style.left = pct(box.x, size.width);
  el.style.top = pct(box.y, size.height);
  el.style.width = pct(box.width, size.width);
  el.style.height = pct(box.height, size.height);
  // The outline is the slot, turned about the centre of what the layer draws — the same point
  // the canvas turns about (milestone 29) — so the outline is the drawn shape exactly. For a
  // line aligned in a wide block that centre is well off the slot's middle, which is why the
  // origin is set rather than left at the default.
  if (angle) {
    const centre = placedCentre(layer);
    // As a fraction of the outline's own box, since the box is sized in percentages of the
    // overlay: frame pixels would mean something else again on a preview of any other size.
    const ox = box.width > 0 ? ((centre.x - box.x) / box.width) * 100 : 50;
    const oy = box.height > 0 ? ((centre.y - box.y) / box.height) * 100 : 50;
    el.style.transformOrigin = `${ox}% ${oy}%`;
    el.style.transform = `rotate(${angle}deg)`;
  }
  el.dataset.angle = String(angle);
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const handle = document.createElement('div');
    handle.className = `stage-handle ${corner}`;
    handle.dataset.handle = corner;
    el.append(handle);
  }
  const rotate = document.createElement('div');
  rotate.className = 'stage-handle rotate';
  rotate.dataset.handle = 'rotate';
  rotate.title = 'Turn the layer; hold Shift for 15° steps';
  el.append(rotate);
  if (drag?.kind === 'rotate') {
    const readout = document.createElement('div');
    readout.className = 'stage-angle';
    readout.textContent = `${Math.round(angle)}°`;
    el.append(readout);
  }
  overlay.append(el);
}

/** The stage reports what the frame laid; the overlay follows it. */
export function stageLayersUpdate(report: LaidReport | null): void {
  laid = report ?? EMPTY_LAID;
  // A preview with no room on screen has nothing to click: the overlay stays out of the way
  // rather than swallowing clicks that could never land on a layer.
  const hasRoom = (overlay?.getBoundingClientRect().width ?? 0) > 8;
  const any = hasRoom && Object.values(laid.blocks).some((b) => b.layers.length > 0);
  if (overlay) {
    overlay.classList.toggle('active', any);
    // The frame this report describes, so anyone waiting for the overlay to catch up with the
    // preview can see that it has (the end-to-end test does; see docs/platform-notes.md).
    overlay.dataset.laidFrame = laid.frame === null ? '' : String(laid.frame);
    if (!any) clearGuides();
  }
  placePendingDrop();
  paintSelection();
}

function onPointerDown(e: PointerEvent): void {
  // A right-click is the menu's (milestone 39), and a left-click under an open menu closes it first.
  if (!overlay || !host || e.button !== 0) return;
  const target = e.target as HTMLElement;
  const point = framePoint(e);
  const chosen = selectedLayer.value;

  if (target.dataset.handle && chosen) {
    const layer = laidLayer(chosen.block, chosen.id);
    if (!layer) return;
    const box = placedBox(layer);
    drag = {
      kind: target.dataset.handle === 'rotate' ? 'rotate' : 'resize',
      block: chosen.block, id: chosen.id, pointerId: e.pointerId,
      start: point, from: currentPlacement(chosen.block, chosen.id),
      centre: placedCentre(layer), startBox: box, moved: false,
    };
    capture(e.pointerId);
    e.preventDefault();
    return;
  }

  const grab = (GRAB_SCREEN_PX / Math.max(1, overlay.getBoundingClientRect().width)) * host.frameSize().width;
  const hit = hitLayer(laid, point.x, point.y, grab);
  selectedLayer.value = hit;
  if (!hit) return;
  // Snapping measures the upright box that contains the layer as drawn, so a turned one
  // lines its real edges up with the frame's lines rather than its unturned ones.
  const hitBox = placedBounds(laidLayer(hit.block, hit.id)!);
  drag = { kind: 'move', block: hit.block, id: hit.id, pointerId: e.pointerId, start: point, from: currentPlacement(hit.block, hit.id), centre: point, startBox: hitBox, moved: false };
  capture(e.pointerId);
  overlay.focus();
  e.preventDefault();
}

function onPointerMove(e: PointerEvent): void {
  if (!drag || !overlay || !host || e.pointerId !== drag.pointerId) return;
  const size = host.frameSize();
  const point = framePoint(e);
  drag.moved = true;

  if (drag.kind === 'rotate') {
    const rotate = angleFromDrag(drag.start, point, drag.centre, drag.from.rotate, e.shiftKey);
    writePlacement(drag.block, drag.id, { ...drag.from, rotate }, false);
    return;
  }

  if (drag.kind === 'resize') {
    const next = { ...drag.from, scale: clampScale(scaleFromDrag(drag.start, point, drag.centre, drag.from.scale)) };
    writePlacement(drag.block, drag.id, next, false);
    return;
  }

  // Everything is measured from where the layer sat when the gesture began, so a drag never
  // chases its own live redraws: candidate box = start box moved by the pointer's travel.
  const travel = { x: point.x - drag.start.x, y: point.y - drag.start.y };
  const candidate = { ...drag.startBox, x: drag.startBox.x + travel.x, y: drag.startBox.y + travel.y };
  const threshold = (SNAP_SCREEN_PX / overlay.getBoundingClientRect().width) * size.width;
  const block = laid.blocks[drag.block]?.box ?? { x: 0, y: 0, width: size.width, height: size.height };
  const snap = snapMove(candidate, size, block, threshold);
  showGuides(snap.guides);
  const dx = drag.from.dx + (travel.x + snap.dx) / size.width;
  const dy = drag.from.dy + (travel.y + snap.dy) / size.height;
  writePlacement(drag.block, drag.id, { ...drag.from, dx: clampPlacement(dx), dy: clampPlacement(dy) }, false);
}

function onPointerUp(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const finished = drag;
  drag = null;
  clearGuides();
  if (finished.moved) layerEditor()?.commit();
}

function onKeyDown(e: KeyboardEvent): void {
  const chosen = selectedLayer.value;
  if (!chosen || !host) return;
  const step = nudgeFraction(e.shiftKey);
  const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const move = moves[e.key];
  if (e.key === 'Escape') {
    selectedLayer.value = null;
    e.preventDefault();
    return;
  }
  if (!move) return;
  const from = currentPlacement(chosen.block, chosen.id);
  writePlacement(chosen.block, chosen.id, { ...from, dx: clampPlacement(from.dx + move[0]), dy: clampPlacement(from.dy + move[1]) }, true);
  e.preventDefault();
}

/**
 * A drop that has been added but not yet placed (milestone 26). A new layer
 * lands wherever its block's stack puts it, and only the page can say where
 * that was — so the drop point is kept until the frame that holds the layer is
 * reported, and the placement that moves it there is applied then, as one more
 * step of the same undo entry.
 */
let pendingDrop: { block: string; id: string; point: { x: number; y: number } } | null = null;

/**
 * Put a layer that has just been added at a point on the frame, once the page
 * has said where its stack put it: a drop from the results (milestone 26), and
 * Add Text Here or Add Asset Here from the right-click menu (milestone 39).
 */
export function placeLayerAt(block: string, id: string, point: { x: number; y: number }): void {
  // Held until the *next* report: the one in hand was laid before this layer existed, and an id
  // freed by a layer just removed could otherwise be matched against where that one sat.
  pendingDrop = { block, id, point };
}

/** Place a freshly dropped layer under the pointer, once the page has said where it landed. */
function placePendingDrop(): void {
  if (!pendingDrop || !host) return;
  const report = laidLayer(pendingDrop.block, pendingDrop.id);
  if (!report) return;
  const { block, id, point } = pendingDrop;
  pendingDrop = null;
  const editor = layerEditor();
  if (!editor) return;
  const size = host.frameSize();
  const box = placedBox(report);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const aspect = aspectOf(size.width, size.height);
  const dx = clampPlacement((point.x - centre.x) / size.width);
  const dy = clampPlacement((point.y - centre.y) / size.height);
  editor.edit(block, id, (layer) => {
    const placement: LayerPlacements = { ...(layer.placement ?? {}) };
    placement[aspect] = { ...placementFor(layer.placement, aspect), dx, dy };
    return { ...layer, placement };
  }, true);
  selectedLayer.value = { block, id };
}

/** The frame point a drag event is over, for a drop. */
function dropPoint(e: DragEvent, el: HTMLElement): { x: number; y: number } {
  return framePointIn(el.getBoundingClientRect(), host!.frameSize(), { x: e.clientX, y: e.clientY });
}

/**
 * Dropping a library item on the preview makes it a layer where it was
 * dropped (milestone 26): a still becomes an image layer, a clip a video
 * layer. Anything else — a sound, a template — is refused with a word about
 * why rather than ignored.
 */
export function mountStageDrop(el: HTMLElement, stageHost: Host, lookup: (id: string) => { kind: 'image' | 'video' | 'other'; name: string } | null, note: (text: string) => void): void {
  host = stageHost;
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(COLLECTION_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop-target');
  });
  for (const type of ['dragleave', 'dragend', 'drop'] as const) {
    el.addEventListener(type, () => el.classList.remove('drop-target'));
  }
  el.addEventListener('drop', (e) => {
    const itemId = e.dataTransfer?.getData(COLLECTION_DRAG_TYPE);
    if (!itemId) return;
    e.preventDefault();
    const found = lookup(itemId);
    if (!found) return;
    if (found.kind === 'other') {
      note('Only a picture or a clip can be dropped on the stage.');
      return;
    }
    const editor = layerEditor();
    if (!editor) return;
    const added = editor.addLayer(found.kind === 'video' ? 'video' : 'image', found.name, itemId);
    if ('refused' in added) {
      note(added.refused);
      return;
    }
    placeLayerAt(added.block, added.id, dropPoint(e, el));
  });
}

/** The middle of what a layer draws, in frame pixels; where a menu opened from the keyboard appears. */
export function layerCentre(block: string, id: string): { x: number; y: number } | null {
  const report = laidLayer(block, id);
  return report && report.box.width > 0 ? placedCentre(report) : null;
}

/** The layer at a point on the frame, with the same reach a click has; what the right-click menu acts on. */
export function layerAtPoint(point: { x: number; y: number }): { block: string; id: string } | null {
  if (!overlay || !host) return null;
  const width = Math.max(1, overlay.getBoundingClientRect().width);
  const grab = (GRAB_SCREEN_PX / width) * host.frameSize().width;
  return hitLayer(laid, point.x, point.y, grab);
}

export function mountStageLayers(el: HTMLElement, stageHost: Host): void {
  overlay = el;
  host = stageHost;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('keydown', onKeyDown);
  effect(() => {
    void selectedLayer.value;
    paintSelection();
  });
}
