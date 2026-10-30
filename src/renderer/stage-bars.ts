/**
 * One bar per layer under the scrub bar (milestone 28): where each layer is on
 * screen against the graphic's length, lined up under the scrub bar's own
 * scale so a start can be read against what the template is doing above it.
 * Its entrance and exit are shaded at the ends, and the ends drag — or, since
 * each is a slider, step by the arrow keys. Clicking a bar selects its layer,
 * as clicking it on the stage does. The bars live in the transport row's lanes
 * (milestone 37), the row's grid column under the scrub bar, so they share its
 * edges without measuring anything.
 *
 * The Parameters tab owns the layer values, so every change goes through the
 * layer editor (./layer-edit.ts) and comes back as new values to draw, exactly
 * as a move on the stage does. Bars are updated in place rather than rebuilt,
 * so an end being dragged keeps its pointer under it.
 */

import { effect } from '@preact/signals';
import { isWholeGraphic, MIN_ON_SCREEN, spanWindow, transitionSeconds, type LayerSpan } from '../core/layer-time';
import type { Layer, LayerValues } from '../core/layers';
import type { TemplateManifest } from '../core/manifest';
import { resolveLength } from '../core/timing';
import { layerEditor, selectedLayer } from './layer-edit';

/** The bar for a layer, kept across updates so a drag keeps its element. */
interface Bar {
  root: HTMLDivElement;
  body: HTMLSpanElement;
  enter: HTMLSpanElement;
  leave: HTMLSpanElement;
  label: HTMLSpanElement;
  start: HTMLButtonElement;
  end: HTMLButtonElement;
}

let host: HTMLDivElement | null = null;
let transport: HTMLElement | null = null;
const bars = new Map<string, Bar>();
let current: { manifest: TemplateManifest | null; layers: LayerValues; length: number } = { manifest: null, layers: {}, length: 0 };

/** Draw the bars for this template's layers at this length; nothing when there are no layers. */
export function layerBarsUpdate(manifest: TemplateManifest | null, layers: LayerValues, chosenLength: number | undefined, showing: boolean): void {
  if (!host || !transport) return;
  current = { manifest, layers, length: manifest ? resolveLength(manifest.duration, manifest.structure ?? null, chosenLength) : 0 };
  const rows: { block: string; layer: Layer }[] = [];
  for (const block of manifest?.blocks ?? []) {
    for (const layer of layers[block.id] ?? block.layers) if (!layer.hidden) rows.push({ block: block.id, layer });
  }
  const show = showing && rows.length > 0 && current.length > 0;
  host.hidden = !show;
  transport.classList.toggle('has-bars', show);
  if (!show) {
    for (const bar of bars.values()) bar.root.remove();
    bars.clear();
    return;
  }
  const keep = new Set<string>();
  rows.forEach(({ block, layer }, index) => {
    const key = `${block}.${layer.id}`;
    keep.add(key);
    let bar = bars.get(key);
    if (!bar) {
      bar = makeBar(block, layer.id);
      bars.set(key, bar);
    }
    host!.append(bar.root);
    bar.root.style.order = String(index);
    placeBar(bar, layer, current.length);
  });
  for (const [key, bar] of bars) {
    if (keep.has(key)) continue;
    bar.root.remove();
    bars.delete(key);
  }
  paintSelection();
}

function makeBar(block: string, id: string): Bar {
  const root = document.createElement('div');
  root.className = 'layer-bar';
  root.dataset.block = block;
  root.dataset.layer = id;
  const body = document.createElement('span');
  body.className = 'bar-body';
  const enter = document.createElement('span');
  enter.className = 'bar-in';
  const leave = document.createElement('span');
  leave.className = 'bar-out';
  const label = document.createElement('span');
  label.className = 'bar-label';
  const start = endHandle('start');
  const end = endHandle('end');
  body.append(enter, leave, label, start, end);
  root.append(body);
  body.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).classList.contains('bar-end')) return;
    selectedLayer.value = { block, id };
  });
  for (const [which, handle] of [['start', start], ['end', end]] as const) {
    handle.addEventListener('pointerdown', (e) => onEndPointerDown(e, block, id, which));
    handle.addEventListener('pointermove', onEndPointerMove);
    handle.addEventListener('pointerup', onEndPointerUp);
    handle.addEventListener('pointercancel', onEndPointerUp);
    handle.addEventListener('keydown', (e) => onEndKeyDown(e, block, id, which));
  }
  return { root, body, enter, leave, label, start, end };
}

function endHandle(which: 'start' | 'end'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `bar-end ${which}`;
  b.setAttribute('role', 'slider');
  b.dataset.end = which;
  return b;
}

/** Put a bar where its layer's window is, with its ends shaded for the time its transitions take. */
function placeBar(bar: Bar, layer: Layer, length: number): void {
  const window = spanWindow(layer.span, length);
  const pct = (seconds: number) => `${(seconds / Math.max(0.001, length)) * 100}%`;
  bar.body.style.left = pct(window.from);
  bar.body.style.width = pct(window.to - window.from);
  const ends = transitionSeconds(layer.transition, window);
  const room = Math.max(0.001, window.to - window.from);
  bar.enter.style.width = `${(ends.in / room) * 100}%`;
  bar.leave.style.width = `${(ends.out / room) * 100}%`;
  bar.label.textContent = layer.label;
  bar.body.title = `${layer.label}: ${tidy(window.from)}-${tidy(window.to)} s`;
  for (const [handle, which, value] of [[bar.start, 'start', window.from], [bar.end, 'end', window.to]] as const) {
    handle.setAttribute('aria-label', `${layer.label} ${which}, seconds`);
    handle.setAttribute('aria-valuemin', which === 'start' ? '0' : String(tidy(window.from + MIN_ON_SCREEN)));
    handle.setAttribute('aria-valuemax', which === 'start' ? String(tidy(window.to - MIN_ON_SCREEN)) : String(tidy(length)));
    handle.setAttribute('aria-valuenow', String(tidy(value)));
    handle.setAttribute('aria-valuetext', `${tidy(value)} seconds`);
  }
}

function tidy(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

function paintSelection(): void {
  const chosen = selectedLayer.value;
  for (const [key, bar] of bars) bar.root.classList.toggle('selected', chosen !== null && key === `${chosen.block}.${chosen.id}`);
}

/**
 * Move one end of a layer's span to a moment, held inside the graphic and
 * clear of the other end, and hand it to the layer editor; `commit` makes it
 * one undo step. An end at the graphic's own end is no end at all, so the
 * layer follows the length rather than being pinned to it.
 */
function setEnd(block: string, id: string, which: 'start' | 'end', seconds: number, commit: boolean): void {
  const editor = layerEditor();
  const layer = editor?.get(block, id);
  if (!editor || !layer) return;
  const length = current.length;
  const window = spanWindow(layer.span, length);
  const wanted = Math.round(seconds * 10) / 10;
  let { from, to } = window;
  if (which === 'start') from = Math.min(Math.max(0, wanted), Math.max(0, to - MIN_ON_SCREEN));
  else to = Math.max(Math.min(length, wanted), Math.min(length, from + MIN_ON_SCREEN));
  const span: LayerSpan = { start: tidy(from), end: to >= length ? null : tidy(to) };
  editor.edit(block, id, (l) => {
    const next = { ...l };
    if (isWholeGraphic(span)) delete next.span;
    else next.span = span;
    return next;
  }, commit);
}

let drag: { pointerId: number; block: string; id: string; which: 'start' | 'end'; from: number; startX: number; secondsPerPx: number; handle: HTMLButtonElement } | null = null;

function onEndPointerDown(e: PointerEvent, block: string, id: string, which: 'start' | 'end'): void {
  if (e.button !== 0 || !host) return;
  const layer = layerEditor()?.get(block, id);
  if (!layer) return;
  const window = spanWindow(layer.span, current.length);
  const width = host.getBoundingClientRect().width;
  const handle = e.currentTarget as HTMLButtonElement;
  // The bar's scale when the drag began sets how far a pixel goes, as the length handle's does.
  drag = { pointerId: e.pointerId, block, id, which, from: which === 'start' ? window.from : window.to, startX: e.clientX, secondsPerPx: current.length / Math.max(1, width), handle };
  selectedLayer.value = { block, id };
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    // Not a capturable pointer (a test's synthetic one): the drag still works over the handle.
  }
  e.preventDefault();
  e.stopPropagation();
}

function onEndPointerMove(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  setEnd(drag.block, drag.id, drag.which, drag.from + (e.clientX - drag.startX) * drag.secondsPerPx, false);
}

function onEndPointerUp(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const finished = drag;
  drag = null;
  // One undo step for the gesture, whatever it passed through on the way.
  setEnd(finished.block, finished.id, finished.which, finished.from + (e.clientX - finished.startX) * finished.secondsPerPx, true);
}

/** Each end is a slider, so the arrows move it: a tenth of a second, or a second with Shift. */
function onEndKeyDown(e: KeyboardEvent, block: string, id: string, which: 'start' | 'end'): void {
  const step = e.shiftKey ? 1 : 0.1;
  const moves: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
  const move = moves[e.key];
  if (move === undefined) return;
  const layer = layerEditor()?.get(block, id);
  if (!layer) return;
  const window = spanWindow(layer.span, current.length);
  setEnd(block, id, which, (which === 'start' ? window.from : window.to) + move, true);
  e.preventDefault();
}

/** `transportEl` is the transport row, which is told whether it has bars to show. */
export function mountLayerBars(el: HTMLDivElement, transportEl: HTMLElement): void {
  host = el;
  transport = transportEl;
  effect(() => {
    void selectedLayer.value;
    paintSelection();
  });
}
