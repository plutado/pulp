/**
 * The cut track's lane (milestone 49): the project's shots end to end under
 * the layer bars, in the transport row's lanes, on the scrub bar's own scale —
 * so a cut can be read against the playhead and the graphic above it.
 *
 * A clip dropped from the results joins the track where it was dropped; a
 * cut's ends trim by dragging, rippling everything after by the model's own
 * shape; a cut moves along the track by dragging its body, landing at the
 * boundary nearest the hand; Delete ripples a cut out; and Cmd/Ctrl+B splits
 * the cut under the playhead. A trim's dragged edge snaps to the other cuts,
 * the playhead and the in and out marks. Every gesture is one undo step.
 *
 * The Parameters tab owns the track as it owns the layers — it rides with the
 * parameters under `@track` — so every change goes through the layer editor
 * (./layer-edit.ts) and comes back as a new track to draw, exactly as a bar's
 * drag does. Cut elements are updated in place, so a handle being dragged
 * keeps its pointer under it. The arithmetic is src/core/cut-track.ts's; the
 * lane never keeps a second answer of its own.
 */

import { effect } from '@preact/signals';
import { COLLECTION_DRAG_TYPE } from '../core/collection';
import {
  cutIndexAt, cutSeconds, cutFromClip, cutWindows, snapTime, splitAt, trackAudio, trackDuration,
  withCutInserted, withCutMoved, withCutRemoved, withCutWindow, type CutTrack,
} from '../core/cut-track';
import { layerBarPeaks } from '../core/layer-audio';
import { WAVEFORM_BUCKETS, waveformPath } from '../core/waveform';
import { requestWaveform, waveforms } from './waveforms';
import type { TemplateManifest } from '../core/manifest';
import type { MediaEntry } from '../core/library-types';
import { resolveLength } from '../core/timing';
import { layerEditor } from './layer-edit';
import { appState, playheadSeconds, trim } from './store';

/** The elements of one cut, kept across updates so a drag keeps its pointer. */
interface CutEl {
  root: HTMLDivElement;
  body: HTMLButtonElement;
  label: HTMLSpanElement;
  start: HTMLButtonElement;
  end: HTMLButtonElement;
  /** The cut's sound, drawn inside the body (milestone 49); empty while it has none. */
  wave: SVGSVGElement;
  wavePath: SVGPathElement;
}

let host: HTMLDivElement | null = null;
let lanes: HTMLDivElement | null = null;
let say: (text: string) => void = () => undefined;
const cutEls: CutEl[] = [];
let current: { track: CutTrack | null; length: number; fps: number; showing: boolean } = { track: null, length: 0, fps: 30, showing: false };
let selected: number | null = null;

/** How close a drag must come to a target before it snaps, in pixels of the lane. */
const SNAP_PX = 8;

/** Draw the lane for this track at this length; nothing when the project has no track. */
export function cutTrackUpdate(track: CutTrack | null, manifest: TemplateManifest | null, chosenLength: number | undefined, showing: boolean): void {
  if (!host) return;
  current = {
    track,
    length: manifest ? resolveLength(manifest.duration, manifest.structure ?? null, chosenLength) : 0,
    fps: manifest?.fps ?? 30,
    showing: showing && Boolean(manifest),
  };
  const cuts = track?.cuts ?? [];
  const show = current.showing && cuts.length > 0 && current.length > 0;
  host.hidden = !show;
  if (!show) {
    for (const el of cutEls) el.root.remove();
    cutEls.length = 0;
    selected = null;
    return;
  }
  while (cutEls.length > cuts.length) {
    // Never the element a pointer holds: removing it would end its capture and strand the drag.
    const last = cutEls[cutEls.length - 1]!;
    const victim = heldEl() === last && cutEls.length > 1 ? cutEls.splice(cutEls.length - 2, 1)[0]! : cutEls.pop()!;
    victim.root.remove();
  }
  while (cutEls.length < cuts.length) {
    const el = makeCut();
    cutEls.push(el);
    host.append(el.root);
  }
  const windows = cutWindows(track!);
  const pct = (seconds: number) => `${(seconds / Math.max(0.001, current.length)) * 100}%`;
  cuts.forEach((cut, index) => {
    const el = cutEls[index]!;
    el.root.dataset.index = String(index);
    el.root.style.left = pct(windows[index]!.start);
    el.root.style.width = pct(cutSeconds(cut));
    const name = mediaFor(cut.id)?.name ?? 'Clip not found';
    el.label.textContent = name;
    const said = `${name}: ${tidy(windows[index]!.start)}-${tidy(windows[index]!.end)} s, from ${tidy(cut.from)} s of the clip`;
    el.body.title = said;
    el.body.setAttribute('aria-label', `Cut ${index + 1}, ${said}`);
    for (const [handle, which, value] of [[el.start, 'start', windows[index]!.start], [el.end, 'end', windows[index]!.end]] as const) {
      handle.setAttribute('aria-label', `Cut ${index + 1} ${which}, seconds`);
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', String(tidy(Math.max(current.length, trackDuration(track!)))));
      handle.setAttribute('aria-valuenow', String(tidy(value)));
      handle.setAttribute('aria-valuetext', `${tidy(value)} seconds`);
    }
  });
  if (selected !== null && selected >= cuts.length) selected = null;
  paintSelection();
  paintWaves();
}

/**
 * Each cut's sound on its own stretch of the lane (milestone 49): the peaks
 * the library caches, resampled through the same sound-shaped value the mix
 * plays the cut by — so a beat sits on the cut where it will be heard. Peaks
 * arrive in the background; until they do a cut is plain, and the `waveforms`
 * signal repaints it when they land. A clip with no audio stream stays plain.
 */
function paintWaves(): void {
  const track = current.track;
  if (!track || !host || host.hidden) return;
  trackAudio(track).forEach((cut, index) => {
    const el = cutEls[index];
    if (!el) return;
    const entry = mediaFor(cut.value.id!);
    const duration = entry?.meta?.duration;
    const peaks = entry && !entry.sequence && entry.meta?.audioCodec && duration ? waveforms.value.get(entry.id) : undefined;
    if (!entry || !duration || !peaks || peaks.length === 0) {
      if (entry && duration && entry.meta?.audioCodec && peaks === undefined) requestWaveform(entry);
      el.wave.toggleAttribute('hidden', true);
      el.wavePath.removeAttribute('d');
      return;
    }
    const columns = Math.max(16, Math.round((cutSeconds(track.cuts[index]!) / Math.max(0.001, current.length)) * WAVEFORM_BUCKETS));
    const drawn = layerBarPeaks({ kind: 'sound', path: '', value: cut.value, source: { duration }, span: cut.span }, peaks, current.length, columns);
    el.wave.setAttribute('viewBox', `0 0 ${columns} 12`);
    el.wavePath.setAttribute('d', waveformPath(drawn, columns, 12));
    el.wave.toggleAttribute('hidden', false);
  });
}

/** A clip dropped on the stage lands on the track (milestone 49): appended, one undo step. True when the track took it. */
export function cutTrackTakeDrop(id: string): boolean {
  const editor = layerEditor();
  if (!editor || !current.showing) return false;
  const entry = mediaFor(id);
  if (!entry || entry.mediaKind !== 'video' || entry.sequence || entry.offline || !entry.meta?.duration || entry.meta.duration <= 0) return false;
  const track = editor.track() ?? { cuts: [] };
  const next = withCutInserted(track, track.cuts.length, cutFromClip(id, entry.meta.duration));
  if (next === track) {
    say('The cut track is full.');
    return true;
  }
  selected = next.cuts.length - 1;
  editor.setTrack(next, true);
  return true;
}

function makeCut(): CutEl {
  const root = document.createElement('div');
  root.className = 'cut';
  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'cut-body';
  const label = document.createElement('span');
  label.className = 'cut-label';
  // The sound first, so the label draws over it — the bars' own order (src/renderer/stage-bars.ts).
  const wave = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wave.setAttribute('class', 'cut-wave');
  wave.setAttribute('preserveAspectRatio', 'none');
  wave.setAttribute('aria-hidden', 'true');
  const wavePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  wave.append(wavePath);
  wave.toggleAttribute('hidden', true);
  body.append(wave, label);
  const start = trimHandle('start');
  const end = trimHandle('end');
  root.append(body, start, end);
  body.addEventListener('pointerdown', onMovePointerDown);
  body.addEventListener('pointermove', onMovePointerMove);
  body.addEventListener('pointerup', onMovePointerUp);
  body.addEventListener('pointercancel', onMovePointerUp);
  body.addEventListener('keydown', onCutKeyDown);
  for (const [which, handle] of [['start', start], ['end', end]] as const) {
    handle.addEventListener('pointerdown', (e) => onTrimPointerDown(e, which));
    handle.addEventListener('pointermove', onTrimPointerMove);
    handle.addEventListener('pointerup', onTrimPointerUp);
    handle.addEventListener('pointercancel', onTrimPointerUp);
  }
  return { root, body, label, start, end, wave, wavePath };
}

function trimHandle(which: 'start' | 'end'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `cut-trim ${which}`;
  b.setAttribute('role', 'slider');
  return b;
}

function mediaFor(id: string): MediaEntry | undefined {
  return appState.value.index?.media.find((m) => m.id === id);
}

function tidy(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

function indexOfEl(from: EventTarget | null): number {
  const root = (from as HTMLElement | null)?.closest<HTMLElement>('.cut');
  return root ? Number(root.dataset.index) : -1;
}

function paintSelection(): void {
  cutEls.forEach((el, index) => el.root.classList.toggle('selected', index === selected));
}

/** The element a live gesture holds, which an update must not remove. */
function heldEl(): CutEl | undefined {
  const handle = trimDrag?.handle ?? moveDrag?.handle;
  return handle ? cutEls.find((el) => el.root.contains(handle)) : undefined;
}

/** Write the track through the one channel, as every gesture does; null removes the last cut's track. */
function setTrack(track: CutTrack, commit: boolean): void {
  layerEditor()?.setTrack(track.cuts.length > 0 ? track : null, commit);
}

/** The lane's scale: how many seconds a pixel is, from the lane as it stands. */
function secondsPerPx(): number {
  const width = host?.getBoundingClientRect().width ?? 0;
  return current.length / Math.max(1, width);
}

/** What a trim's dragged edge may snap to: the other cuts' ends, the playhead, and the in and out marks. */
function snapTargets(track: CutTrack, except: number): number[] {
  const targets: number[] = [playheadSeconds.peek()];
  const { inFrame, outFrame } = trim.peek();
  if (inFrame !== null) targets.push(inFrame / Math.max(1, current.fps));
  if (outFrame !== null) targets.push(outFrame / Math.max(1, current.fps));
  cutWindows(track).forEach((w, i) => {
    if (i !== except) targets.push(w.start, w.end);
  });
  return targets;
}

// ---------------------------------------------------------------- trimming either end

let trimDrag: {
  pointerId: number; index: number; which: 'start' | 'end'; track: CutTrack;
  edge: number; startX: number; spp: number; duration: number; targets: number[]; handle: HTMLButtonElement;
} | null = null;

function onTrimPointerDown(e: PointerEvent, which: 'start' | 'end'): void {
  const index = indexOfEl(e.currentTarget);
  const track = current.track;
  const cut = track?.cuts[index];
  if (e.button !== 0 || !track || !cut) return;
  const windows = cutWindows(track);
  // The clip's measured length bounds the out point; an unmeasured clip trims inward only.
  const duration = mediaFor(cut.id)?.meta?.duration ?? cut.to;
  trimDrag = {
    pointerId: e.pointerId, index, which, track,
    edge: which === 'start' ? windows[index]!.start : windows[index]!.end,
    startX: e.clientX, spp: secondsPerPx(), duration,
    targets: snapTargets(track, index),
    handle: e.currentTarget as HTMLButtonElement,
  };
  selected = index;
  paintSelection();
  try {
    trimDrag.handle.setPointerCapture(e.pointerId);
  } catch {
    // Not a capturable pointer (a test's synthetic one): the drag still works over the handle.
  }
  e.preventDefault();
  e.stopPropagation();
}

/** The trim a drag to `clientX` asks for, from the track as it stood when the drag began. */
function trimmedTo(drag: NonNullable<typeof trimDrag>, clientX: number): CutTrack {
  const edge = snapTime(drag.edge + (clientX - drag.startX) * drag.spp, drag.targets, SNAP_PX * drag.spp);
  const cut = drag.track.cuts[drag.index]!;
  const start = cutWindows(drag.track)[drag.index]!.start;
  // The edge is a moment of the timeline; the window is seconds of the file, one delta apart.
  const source = cut.from + (edge - start);
  return withCutWindow(drag.track, drag.index, drag.which === 'start' ? { from: source } : { to: source }, drag.duration);
}

function onTrimPointerMove(e: PointerEvent): void {
  if (!trimDrag || e.pointerId !== trimDrag.pointerId) return;
  setTrack(trimmedTo(trimDrag, e.clientX), false);
}

function onTrimPointerUp(e: PointerEvent): void {
  if (!trimDrag || e.pointerId !== trimDrag.pointerId) return;
  const finished = trimDrag;
  trimDrag = null;
  // One undo step for the gesture, whatever it passed through on the way.
  setTrack(trimmedTo(finished, e.clientX), true);
}

// ---------------------------------------------------------------- moving a cut along the track

let moveDrag: {
  pointerId: number; index: number; track: CutTrack; startX: number; spp: number;
  /** The dragged cut's start when the drag began: what the hand carries along. */
  from: number; moved: boolean; handle: HTMLButtonElement;
} | null = null;

function onMovePointerDown(e: PointerEvent): void {
  const index = indexOfEl(e.currentTarget);
  const track = current.track;
  if (e.button !== 0 || !track || !track.cuts[index]) return;
  selected = index;
  paintSelection();
  moveDrag = {
    pointerId: e.pointerId, index, track, startX: e.clientX, spp: secondsPerPx(),
    from: cutWindows(track)[index]!.start, moved: false,
    handle: e.currentTarget as HTMLButtonElement,
  };
  try {
    moveDrag.handle.setPointerCapture(e.pointerId);
  } catch {
    // Not a capturable pointer (a test's synthetic one): the drag still works over the body.
  }
}

/** Where a drag to `clientX` lands: the boundary of the other cuts nearest the carried start — snapping to cuts. */
function movedTo(drag: NonNullable<typeof moveDrag>, clientX: number): { track: CutTrack; index: number } {
  const start = drag.from + (clientX - drag.startX) * drag.spp;
  const rest = withCutRemoved(drag.track, drag.index);
  const boundaries = [0, ...cutWindows(rest).map((w) => w.end)];
  let index = 0;
  for (let i = 1; i < boundaries.length; i++) {
    if (Math.abs(boundaries[i]! - start) < Math.abs(boundaries[index]! - start)) index = i;
  }
  return { track: withCutMoved(drag.track, drag.index, index), index };
}

function onMovePointerMove(e: PointerEvent): void {
  if (!moveDrag || e.pointerId !== moveDrag.pointerId) return;
  // A click is not a move: the drag arms a few pixels out, so selecting never reorders.
  if (!moveDrag.moved && Math.abs(e.clientX - moveDrag.startX) < 4) return;
  moveDrag.moved = true;
  const landed = movedTo(moveDrag, e.clientX);
  selected = landed.index;
  setTrack(landed.track, false);
}

function onMovePointerUp(e: PointerEvent): void {
  if (!moveDrag || e.pointerId !== moveDrag.pointerId) return;
  const finished = moveDrag;
  moveDrag = null;
  if (!finished.moved) return;
  const landed = movedTo(finished, e.clientX);
  selected = landed.index;
  setTrack(landed.track, true);
}

// ---------------------------------------------------------------- delete, and the split

function onCutKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const index = indexOfEl(e.currentTarget);
  const track = current.track;
  if (!track || !track.cuts[index]) return;
  // Deleting from an end-to-end track is the ripple: the cuts after close up.
  selected = null;
  setTrack(withCutRemoved(track, index), true);
  e.preventDefault();
}

function isTextEditing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(el.type);
}

/** Cmd/Ctrl+B: split the cut under the playhead. At a boundary there is nothing to split, and no undo step. */
function onSplitKey(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return;
  if (isTextEditing(e.target)) return;
  const editor = layerEditor();
  const track = editor?.track();
  if (!editor || !track || !current.showing) return;
  const split = splitAt(track, playheadSeconds.peek());
  if (split !== track) editor.setTrack(split, true);
  e.preventDefault();
}

// ---------------------------------------------------------------- the drop from the results

/** Where on the track a pointer is, in seconds, by the lane's own scale. */
function timeAt(clientX: number): number {
  const box = (host?.hidden === false ? host : lanes)?.getBoundingClientRect();
  if (!box || box.width <= 0) return Number.MAX_SAFE_INTEGER;
  return ((clientX - box.left) / box.width) * current.length;
}

function onDrop(e: DragEvent): void {
  const itemId = e.dataTransfer?.getData(COLLECTION_DRAG_TYPE);
  if (!itemId) return;
  e.preventDefault();
  if (!current.showing) {
    say('Open a template before building its cut track.');
    return;
  }
  const entry = mediaFor(itemId);
  if (!entry || entry.mediaKind !== 'video' || entry.sequence) {
    say('Only a clip can join the cut track.');
    return;
  }
  if (entry.offline || !entry.meta?.duration || entry.meta.duration <= 0) {
    say('That clip has no measured length yet, so it cannot be cut.');
    return;
  }
  const track = current.track ?? { cuts: [] };
  // The drop lands at the boundary nearest the hand: inside a cut it lands before or after it.
  const time = timeAt(e.clientX);
  const under = cutIndexAt(track, time);
  const windows = cutWindows(track);
  const index = under === null ? track.cuts.length : time - windows[under]!.start < cutSeconds(track.cuts[under]!) / 2 ? under : under + 1;
  const next = withCutInserted(track, index, cutFromClip(entry.id, entry.meta.duration));
  if (next === track) {
    say('The cut track is full.');
    return;
  }
  selected = Math.min(index, next.cuts.length - 1);
  setTrack(next, true);
}

/** `lanesEl` takes the drop — the track's strip under the scrub bar — so the first clip has somewhere to land. */
export function mountCutTrack(el: HTMLDivElement, lanesEl: HTMLDivElement, note: (text: string) => void): void {
  host = el;
  lanes = lanesEl;
  say = note;
  lanes.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(COLLECTION_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    lanes!.classList.add('drop-target');
  });
  for (const type of ['dragleave', 'dragend', 'drop'] as const) {
    lanes.addEventListener(type, () => lanes!.classList.remove('drop-target'));
  }
  lanes.addEventListener('drop', onDrop);
  window.addEventListener('keydown', onSplitKey);
  // Peaks arrive in the background: the cuts catch up when they land.
  effect(() => {
    void waveforms.value;
    paintWaves();
  });
}
