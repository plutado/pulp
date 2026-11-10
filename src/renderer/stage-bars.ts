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
import { layerBarPeaks, type AudioLayer } from '../core/layer-audio';
import { keyMovedTo, sanitizeKeys, withKeyAt, type LayerKey } from '../core/layer-keys';
import { MIN_ON_SCREEN, spanWindow, transitionSeconds } from '../core/layer-time';
import { layerWithSpan, spanWithEnd } from '../core/stage-menu';
import type { Layer, LayerValues } from '../core/layers';
import { heardStems } from '../core/sound-layer';
import type { MediaEntry } from '../core/library-types';
import type { TemplateManifest } from '../core/manifest';
import { resolveLength, templateTimeAt } from '../core/timing';
import { WAVEFORM_BUCKETS, waveformPath } from '../core/waveform';
import { openContextMenu } from './context-menu';
import { bindAttr, bindText, t } from './i18n';
import { layerEditor, selectedLayer } from './layer-edit';
import { appState, playheadSeconds } from './store';
import { requestWaveform, waveforms } from './waveforms';
import { filmStripMode, filmStrips, paintTemplateFilm } from './film-strip';
import { filmSlots } from '../core/film-strip';

/** The bar for a layer, kept across updates so a drag keeps its element. */
interface Bar {
  root: HTMLDivElement;
  body: HTMLSpanElement;
  enter: HTMLSpanElement;
  leave: HTMLSpanElement;
  label: HTMLSpanElement;
  start: HTMLButtonElement;
  end: HTMLButtonElement;
  /** The template's own frames along the bar (milestone 87), under everything else. */
  film: HTMLCanvasElement;
  /** The layer's sound, drawn inside the body (milestone 48); empty while it has none. */
  wave: SVGSVGElement;
  wavePath: SVGPathElement;
  /** One mark per keyframe (milestone 51), kept across updates so a dragged mark keeps its pointer. */
  marks: HTMLButtonElement[];
  /** The layer as last placed, so the waveform can be redrawn when its peaks arrive. */
  layer: Layer | null;
}

let host: HTMLDivElement | null = null;
let transport: HTMLElement | null = null;
const bars = new Map<string, Bar>();
let current: { manifest: TemplateManifest | null; layers: LayerValues; length: number } = { manifest: null, layers: {}, length: 0 };

/** Draw the bars for this template's layers at this length; nothing when there are no layers. */
export function layerBarsUpdate(manifest: TemplateManifest | null, layers: LayerValues, chosenLength: number | undefined, showing: boolean): void {
  if (!host || !transport) return;
  current = { manifest, layers, length: manifest ? resolveLength(manifest.duration, manifest.structure ?? null, chosenLength) : 0 };
  const rows: { block: string; layer: Layer; stem?: number }[] = [];
  for (const block of manifest?.blocks ?? []) {
    for (const layer of layers[block.id] ?? block.layers) {
      if (layer.hidden) continue;
      // Music as stems (milestone 16): one lane per stem, each with its own waveform and its
      // mute and solo, so the mix is read and worked where it is heard. Muted stems keep their
      // lane — the lane is where the mute is pressed back off.
      const stems = layer.type === 'audio' && !layer.sound?.hidden ? layer.sound?.stems : undefined;
      if (stems && stems.length > 0) stems.forEach((_, i) => rows.push({ block: block.id, layer, stem: i }));
      else rows.push({ block: block.id, layer });
    }
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
  rows.forEach(({ block, layer, stem }, index) => {
    const key = stem === undefined ? `${block}.${layer.id}` : `${block}.${layer.id}#${stem}`;
    keep.add(key);
    let bar = bars.get(key);
    if (!bar) {
      bar = makeBar(block, layer.id, stem);
      bars.set(key, bar);
    }
    host!.append(bar.root);
    bar.root.style.order = String(index);
    placeBar(bar, layer, current.length, stem);
  });
  for (const [key, bar] of bars) {
    if (keep.has(key)) continue;
    bar.root.remove();
    bars.delete(key);
  }
  paintSelection();
}

function makeBar(block: string, id: string, stem?: number): Bar {
  const root = document.createElement('div');
  root.className = 'layer-bar';
  root.dataset.block = block;
  root.dataset.layer = id;
  if (stem !== undefined) root.dataset.stem = String(stem);
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
  // The frames, then the sound, so the shades, the label and the handles draw over them.
  const film = document.createElement('canvas');
  film.className = 'bar-film';
  film.setAttribute('aria-hidden', 'true');
  film.hidden = true;
  const wave = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wave.setAttribute('class', 'bar-wave');
  wave.setAttribute('preserveAspectRatio', 'none');
  wave.setAttribute('aria-hidden', 'true');
  const wavePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  wave.append(wavePath);
  wave.toggleAttribute('hidden', true);
  body.append(film, wave, enter, leave, label, start, end);
  // A stem's lane carries the mixer's two buttons (milestone 16): mute, and solo.
  if (stem !== undefined) {
    const mute = stemButton('bars.stem.mute', 'bar-mute');
    const solo = stemButton('bars.stem.solo', 'bar-solo');
    mute.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStem(block, id, stem, 'muted');
    });
    solo.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStem(block, id, stem, 'solo');
    });
    for (const b of [mute, solo]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
    body.append(mute, solo);
  }
  root.append(body);
  body.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).classList.contains('bar-end')) return;
    selectedLayer.value = { block, id };
  });
  // A copied key can land on any bar, so the body offers the paste where there is no mark to ask.
  body.addEventListener('contextmenu', (e) => {
    if (copiedKey === null) return;
    e.preventDefault();
    e.stopPropagation();
    selectedLayer.value = { block, id };
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      doc: body.ownerDocument,
      items: [{ command: 'key.paste', label: t('bars.key.paste') }],
      run: () => pasteKey(block, id),
    });
  });
  for (const [which, handle] of [['start', start], ['end', end]] as const) {
    handle.addEventListener('pointerdown', (e) => onEndPointerDown(e, block, id, which));
    handle.addEventListener('pointermove', onEndPointerMove);
    handle.addEventListener('pointerup', onEndPointerUp);
    handle.addEventListener('pointercancel', onEndPointerUp);
    handle.addEventListener('keydown', (e) => onEndKeyDown(e, block, id, which));
  }
  return { root, body, enter, leave, label, start, end, film, wave, wavePath, marks: [], layer: null };
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
function placeBar(bar: Bar, layer: Layer, length: number, stem?: number): void {
  const window = spanWindow(layer.span, length);
  const pct = (seconds: number) => `${(seconds / Math.max(0.001, length)) * 100}%`;
  bar.body.style.left = pct(window.from);
  bar.body.style.width = pct(window.to - window.from);
  const ends = transitionSeconds(layer.transition, window);
  const room = Math.max(0.001, window.to - window.from);
  bar.enter.style.width = `${(ends.in / room) * 100}%`;
  bar.leave.style.width = `${(ends.out / room) * 100}%`;
  const stemValue = stem !== undefined && layer.type === 'audio' ? layer.sound?.stems?.[stem] : undefined;
  const label = stemValue ? `${layer.label} · ${stemValue.label}` : layer.label;
  bar.label.textContent = stemValue ? stemValue.label : layer.label;
  bindAttr(bar.body, 'title', 'bars.body.title', { label, from: tidy(window.from), to: tidy(window.to) });
  if (stemValue) {
    // The lane says what the mixer holds: a pressed M, a pressed S, and a dimmed body while silent.
    const mute = bar.body.querySelector<HTMLButtonElement>('.bar-mute');
    const solo = bar.body.querySelector<HTMLButtonElement>('.bar-solo');
    mute?.setAttribute('aria-pressed', String(stemValue.muted));
    if (mute) bindAttr(mute, 'aria-label', 'bars.stem.mute.aria-label', { label });
    solo?.setAttribute('aria-pressed', String(stemValue.solo));
    if (solo) bindAttr(solo, 'aria-label', 'bars.stem.solo.aria-label', { label });
    const heard = layer.type === 'audio' && layer.sound ? heardStems(layer.sound).includes(stemValue) : true;
    bar.root.classList.toggle('stem-silent', !heard);
  }
  for (const [handle, which, value] of [[bar.start, 'start', window.from], [bar.end, 'end', window.to]] as const) {
    bindAttr(handle, 'aria-label', which === 'start' ? 'bars.end.start.aria-label' : 'bars.end.end.aria-label', { label });
    handle.setAttribute('aria-valuemin', which === 'start' ? '0' : String(tidy(window.from + MIN_ON_SCREEN)));
    handle.setAttribute('aria-valuemax', which === 'start' ? String(tidy(window.to - MIN_ON_SCREEN)) : String(tidy(length)));
    handle.setAttribute('aria-valuenow', String(tidy(value)));
    bindAttr(handle, 'aria-valuetext', 'bars.end.aria-valuetext', { seconds: tidy(value) });
  }
  bar.layer = layer;
  paintWave(bar, layer, length, stem);
  paintBarFilm(bar, layer, length);
  placeKeys(bar, layer, length);
}

/**
 * The template's own frames along a layer's bar (milestone 87): what the
 * graphic looks like at each moment the layer is on screen, through the
 * template's own timing — a stretched hold holds its frame — from the strip
 * its card already scrubs through.
 */
function paintBarFilm(bar: Bar, layer: Layer, length: number): void {
  const manifest = current.manifest;
  const entry = manifest ? appState.value.index?.templates.find((t) => t.manifest.id === manifest.id) : undefined;
  const window = spanWindow(layer.span, length);
  const span = window.to - window.from;
  paintTemplateFilm(bar.film, filmStripMode.value, entry && manifest ? { id: entry.id, fps: manifest.fps, duration: manifest.duration } : null, (width, slot) =>
    filmSlots(width, slot, filmStripMode.value, (fraction) => templateTimeAt(window.from + fraction * span, manifest!.duration, manifest!.structure ?? null, length)));
}

/** One of the lane's two letters, pressed or not; the state is painted by placeBar. */
function stemButton(letter: 'bars.stem.mute' | 'bars.stem.solo', className: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `bar-stem ${className}`;
  bindText(b, letter);
  b.setAttribute('aria-pressed', 'false');
  return b;
}

/** Flip one stem's mute or solo, one undo step, through the layer editor like every other layer edit. */
function toggleStem(block: string, id: string, index: number, field: 'muted' | 'solo'): void {
  const editor = layerEditor();
  if (!editor) return;
  editor.edit(block, id, (l) => {
    if (l.type !== 'audio' || !l.sound?.stems?.[index]) return l;
    const stems = l.sound.stems.map((s, i) => (i === index ? { ...s, [field]: !s[field] } : s));
    return { ...l, sound: { ...l.sound, stems } };
  }, true);
}

// ---------------------------------------------------------------- the keys on the bar (milestone 51)

/**
 * The one copied key — its pose and easing, never its moment, since pasting
 * writes it at the playhead. In memory like a copied layer (src/renderer/
 * stage-menu.ts): a key means nothing to any other program.
 */
let copiedKey: Omit<LayerKey, 'at'> | null = null;

/** A moment held inside the graphic, where every mark must sit. */
function clampTime(seconds: number): number {
  return Math.min(current.length, Math.max(0, seconds));
}

/**
 * One mark per key, updated in place like the bars themselves: a key's moment
 * is a fraction of the graphic, and the row spans the graphic, so the mark
 * sits on the row — a key can sit outside the layer's span and still hold the
 * pose at its edge, and its mark stays reachable.
 */
function placeKeys(bar: Bar, layer: Layer, length: number): void {
  const keys = layer.keys ?? [];
  while (bar.marks.length > keys.length) {
    // Never the mark a pointer holds: removing it would end its capture and strand the drag.
    const last = bar.marks[bar.marks.length - 1]!;
    const victim = last === keyDrag?.handle && bar.marks.length > 1 ? bar.marks.splice(bar.marks.length - 2, 1)[0]! : bar.marks.pop()!;
    victim.remove();
  }
  while (bar.marks.length < keys.length) {
    const mark = keyMark(bar.root.dataset.block!, bar.root.dataset.layer!);
    bar.marks.push(mark);
    bar.root.append(mark);
  }
  keys.forEach((key, index) => {
    const mark = bar.marks[index]!;
    mark.dataset.index = String(index);
    mark.style.left = `${Math.min(100, (key.at / Math.max(0.001, length)) * 100)}%`;
    bindAttr(mark, 'aria-label', 'bars.key.aria-label', { label: layer.label, at: key.at });
    mark.setAttribute('aria-valuemin', '0');
    mark.setAttribute('aria-valuemax', String(tidy(length)));
    mark.setAttribute('aria-valuenow', String(key.at));
    bindAttr(mark, 'aria-valuetext', 'bars.key.aria-valuetext', { at: key.at });
    bindAttr(mark, 'title', 'bars.key.title', { label: layer.label, at: key.at });
  });
}

function keyMark(block: string, id: string): HTMLButtonElement {
  const mark = document.createElement('button');
  mark.type = 'button';
  mark.className = 'bar-key';
  mark.setAttribute('role', 'slider');
  mark.addEventListener('pointerdown', (e) => onKeyPointerDown(e, block, id));
  mark.addEventListener('pointermove', onKeyPointerMove);
  mark.addEventListener('pointerup', onKeyPointerUp);
  mark.addEventListener('pointercancel', onKeyPointerUp);
  mark.addEventListener('keydown', (e) => onKeyKeyDown(e, block, id));
  mark.addEventListener('contextmenu', (e) => onKeyContextMenu(e, block, id));
  return mark;
}

/**
 * Write a layer's keys, by the Animate card's own rule (src/renderer/
 * inspector-params.ts): sanitized, and an empty list is no keys at all.
 * `commit` makes it one undo step, false is a live drag.
 */
function setLayerKeys(block: string, id: string, next: LayerKey[], commit: boolean): void {
  const editor = layerEditor();
  if (!editor) return;
  editor.edit(block, id, (l) => {
    const out: Layer = { ...l, keys: sanitizeKeys(next) ?? [] };
    if ((out.keys?.length ?? 0) === 0) delete out.keys;
    return out;
  }, commit);
}

/** The key under a mark as the layer stands now, by the index the mark was last placed at. */
function markKey(mark: HTMLElement, block: string, id: string): { layer: Layer; keys: LayerKey[]; index: number; key: LayerKey } | null {
  const layer = layerEditor()?.get(block, id);
  const keys = layer?.keys;
  const index = Number(mark.dataset.index);
  const key = keys?.[index];
  if (!layer || !keys || !key) return null;
  return { layer, keys, index, key };
}

function copyKey(key: LayerKey): void {
  const pose: Omit<LayerKey, 'at'> & { at?: number } = { ...key };
  delete pose.at;
  copiedKey = pose;
}

/**
 * The copied key written at the playhead, as Add key at the playhead writes
 * one: the first key takes the look's opacity with it, since an animated
 * opacity lives in the keys alone (the Animate card's rule).
 */
function pasteKey(block: string, id: string): void {
  const editor = layerEditor();
  const pose = copiedKey;
  if (!editor || !pose) return;
  const at = clampTime(Math.max(0, playheadSeconds.peek()));
  editor.edit(block, id, (l) => {
    const first = (l.keys?.length ?? 0) === 0;
    const out: Layer = { ...l, keys: sanitizeKeys(withKeyAt(l.keys ?? [], { ...pose, at })) ?? [] };
    if (first && out.look && (l.look?.opacity ?? 1) !== 1) out.look = { ...out.look, opacity: 1 };
    return out;
  }, true);
}

let keyDrag: { pointerId: number; block: string; id: string; index: number; from: LayerKey[]; startX: number; secondsPerPx: number; handle: HTMLButtonElement } | null = null;

function onKeyPointerDown(e: PointerEvent, block: string, id: string): void {
  if (e.button !== 0 || !host) return;
  const mark = e.currentTarget as HTMLButtonElement;
  const found = markKey(mark, block, id);
  if (!found) return;
  const width = host.getBoundingClientRect().width;
  // The bar's scale when the drag began sets how far a pixel goes, as an end handle's does. The
  // keys as they stood are kept too: every move is computed from them, so a drag that crosses
  // another key swallows it only while it is there, and gives it back when dragged away.
  keyDrag = { pointerId: e.pointerId, block, id, index: found.index, from: found.keys, startX: e.clientX, secondsPerPx: current.length / Math.max(1, width), handle: mark };
  selectedLayer.value = { block, id };
  try {
    mark.setPointerCapture(e.pointerId);
  } catch {
    // Not a capturable pointer (a test's synthetic one): the drag still works over the mark.
  }
  e.preventDefault();
  e.stopPropagation();
}

function onKeyPointerMove(e: PointerEvent): void {
  if (!keyDrag || e.pointerId !== keyDrag.pointerId) return;
  const at = clampTime(keyDrag.from[keyDrag.index]!.at + (e.clientX - keyDrag.startX) * keyDrag.secondsPerPx);
  setLayerKeys(keyDrag.block, keyDrag.id, keyMovedTo(keyDrag.from, keyDrag.index, at), false);
}

function onKeyPointerUp(e: PointerEvent): void {
  if (!keyDrag || e.pointerId !== keyDrag.pointerId) return;
  const finished = keyDrag;
  keyDrag = null;
  // One undo step for the gesture, whatever it passed through on the way.
  const at = clampTime(finished.from[finished.index]!.at + (e.clientX - finished.startX) * finished.secondsPerPx);
  setLayerKeys(finished.block, finished.id, keyMovedTo(finished.from, finished.index, at), true);
}

/** A mark is a slider too: arrows move it in time, and the clipboard keys act on the key itself. */
function onKeyKeyDown(e: KeyboardEvent, block: string, id: string): void {
  const found = markKey(e.currentTarget as HTMLElement, block, id);
  if (!found) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    setLayerKeys(block, id, found.keys.filter((_, i) => i !== found.index), true);
    e.preventDefault();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'c' || e.key === 'C')) {
    copyKey(found.key);
    e.preventDefault();
    return;
  }
  if (mod && (e.key === 'v' || e.key === 'V')) {
    pasteKey(block, id);
    e.preventDefault();
    return;
  }
  const step = e.shiftKey ? 1 : 0.1;
  const moves: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
  const move = moves[e.key];
  if (move === undefined) return;
  setLayerKeys(block, id, keyMovedTo(found.keys, found.index, clampTime(found.key.at + move)), true);
  e.preventDefault();
}

function onKeyContextMenu(e: MouseEvent, block: string, id: string): void {
  const mark = e.currentTarget as HTMLButtonElement;
  e.preventDefault();
  e.stopPropagation();
  selectedLayer.value = { block, id };
  openContextMenu({
    x: e.clientX,
    y: e.clientY,
    doc: mark.ownerDocument,
    focusBack: mark,
    items: [
      { command: 'key.copy', label: t('bars.key.copy') },
      { command: 'key.paste', label: t('bars.key.paste'), enabled: copiedKey !== null },
      { type: 'separator' },
      { command: 'key.delete', label: t('bars.key.delete') },
    ],
    run: (command) => {
      const found = markKey(mark, block, id);
      if (command === 'key.copy' && found) copyKey(found.key);
      else if (command === 'key.paste') pasteKey(block, id);
      else if (command === 'key.delete' && found) setLayerKeys(block, id, found.keys.filter((_, i) => i !== found.index), true);
    },
  });
}

// ---------------------------------------------------------------- the sound on the bar (milestone 48)

/** The library entry behind a sound or a clip id; a drawn template has no file and is not here. */
function mediaFor(id: string): MediaEntry | undefined {
  return appState.value.index?.media.find((m) => m.id === id);
}

/**
 * The layer's sound, if it has one with a file the library has measured: what
 * the waveform is resampled through. Mute and volume are left out on purpose —
 * the bar is about time, and a muted layer still shows what it holds.
 */
function barSound(layer: Layer, stem?: number): { audio: AudioLayer; entry: MediaEntry } | null {
  const span = layer.span ? { span: layer.span } : {};
  if (layer.type === 'audio' && layer.sound?.id && !layer.sound.hidden) {
    // A stem's lane shows that stem's own file (milestone 16) — muted or not, since the bar is
    // about time and a muted stem still shows what it holds, as a muted layer does.
    const stemValue = stem !== undefined ? layer.sound.stems?.[stem] : undefined;
    if (stem !== undefined && !stemValue) return null;
    const value = stemValue ? (({ stems: _stems, ...rest }) => ({ ...rest, id: stemValue.id }))(layer.sound) : layer.sound;
    const entry = mediaFor(value.id!);
    const duration = entry?.meta?.duration;
    if (!entry || !duration || duration <= 0) return null;
    return { audio: { kind: 'sound', path: '', value, source: { duration }, ...span }, entry };
  }
  if (layer.type === 'video' && layer.clip?.id && !layer.clip.hidden) {
    const entry = mediaFor(layer.clip.id);
    const meta = entry?.meta;
    if (!entry || entry.sequence || !meta?.audioCodec || !meta.duration || !meta.fps) return null;
    return { audio: { kind: 'clip', path: '', value: layer.clip, source: { frames: Math.max(1, Math.round(meta.duration * meta.fps)), fps: meta.fps }, ...span }, entry };
  }
  return null;
}

/**
 * Draw the layer's sound inside its bar, at the project's time: the peaks
 * milestone 12 caches, resampled so a beat sits on the bar where it will be
 * heard — through the in point, the loop, a clip's speed, the delay and the
 * fades. Peaks arrive in the background; until they do the bar is plain, and
 * the `waveforms` signal repaints it when they land.
 */
function paintWave(bar: Bar, layer: Layer, length: number, stem?: number): void {
  const sound = barSound(layer, stem);
  const peaks = sound ? waveforms.value.get(sound.entry.id) : undefined;
  if (!sound || !peaks || peaks.length === 0) {
    if (sound && peaks === undefined) requestWaveform(sound.entry);
    bar.wave.toggleAttribute('hidden', true);
    bar.wavePath.removeAttribute('d');
    return;
  }
  const window = spanWindow(layer.span, length);
  // Columns in step with the stored resolution: a bar over half the graphic gets half the buckets.
  const columns = Math.max(16, Math.round(((window.to - window.from) / Math.max(0.001, length)) * WAVEFORM_BUCKETS));
  const drawn = layerBarPeaks(sound.audio, peaks, length, columns);
  bar.wave.setAttribute('viewBox', `0 0 ${columns} 12`);
  bar.wavePath.setAttribute('d', waveformPath(drawn, columns, 12));
  bar.wave.toggleAttribute('hidden', false);
}

function tidy(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

function paintSelection(): void {
  const chosen = selectedLayer.value;
  // A stem's lane belongs to its layer, so selecting the layer lights every one of its lanes.
  for (const bar of bars.values()) {
    bar.root.classList.toggle('selected', chosen !== null && bar.root.dataset.block === chosen.block && bar.root.dataset.layer === chosen.id);
  }
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
  // The same rule the menu's Start and End at Playhead use (src/core/stage-menu.ts): one place
  // decides where an end may sit, so a dragged handle and a menu item cannot disagree.
  const span = spanWithEnd(layer.span, which, seconds, current.length);
  editor.edit(block, id, (l) => layerWithSpan(l, span), commit);
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
  // The template's frames land in the background, and the choice of what lanes draw changes them (milestone 87).
  effect(() => {
    void filmStrips.value;
    void filmStripMode.value;
    for (const bar of bars.values()) if (bar.layer) paintBarFilm(bar, bar.layer, current.length);
  });
  // Peaks arrive in the background, and the library's metadata with them: the bars catch up.
  effect(() => {
    void waveforms.value;
    for (const bar of bars.values()) {
      if (!bar.layer) continue;
      const stem = bar.root.dataset.stem !== undefined ? Number(bar.root.dataset.stem) : undefined;
      paintWave(bar, bar.layer, current.length, stem);
    }
  });
}
