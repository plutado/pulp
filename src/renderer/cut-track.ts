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

import { effect, untracked } from '@preact/signals';
import { COLLECTION_DRAG_TYPE } from '../core/collection';
import {
  cutIndexAt, cutRates, cutSeconds, cutFromClip, cutWindows, DEFAULT_HOLD_SECONDS, DEFAULT_TRANSITION_SECONDS, snapTime, splitAt, trackAudio,
  trackDuration, transitionAt, withCutHold, withCutInserted, withCutMoved, withCutRemoved, withCutSound, withCutSpeed, withCutTransition,
  withCutWindow, withFreezeAt, withSilencesCut, type Cut, type CutSound, type CutSpeed, type CutTransition, type CutTrack,
 cutReframe, cutReframeWide, withCutReframe, type ReframeWideSpan } from '../core/cut-track';
import type { MenuCommand, MenuItemSpec } from '../core/menu';
import { openContextMenu } from './context-menu';
import { layerBarPeaks } from '../core/layer-audio';
import { WAVEFORM_BUCKETS, waveformPath } from '../core/waveform';
import { requestWaveform, waveforms } from './waveforms';
import { chooseFilmStrip, filmStripMode, filmStrips, paintFilm } from './film-strip';
import { cutFilmSlots, FILM_STRIP_MODES, sanitizeFilmStripMode } from '../core/film-strip';
import type { TemplateManifest } from '../core/manifest';
import type { MediaEntry } from '../core/library-types';
import { resolveLength } from '../core/timing';
import { layerEditor } from './layer-edit';
import { bindAttr, bindText, t, whenLocaleChanges } from './i18n';
import { appState, frameSize, playheadSeconds, selectedTemplate, trim } from './store';
import { aspectOf } from '../core/aspect';
import { centredReframe } from '../core/reframe';

/** The elements of one cut, kept across updates so a drag keeps its pointer. */
interface CutEl {
  root: HTMLDivElement;
  body: HTMLButtonElement;
  label: HTMLSpanElement;
  /** The cut's speed or hold, said on it (milestone 56); hidden in real time. */
  speed: HTMLSpanElement;
  start: HTMLButtonElement;
  end: HTMLButtonElement;
  /** The transition into the next cut, marked at the boundary (milestone 49); hidden on a straight cut. */
  join: HTMLSpanElement;
  /** The clip's frames along the cut (milestone 87), under its sound and its name. */
  film: HTMLCanvasElement;
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

/** What the lane was last drawn from, so a change of language can draw it again in the new words. */
let lastUpdate: Parameters<typeof cutTrackUpdate> | null = null;

/** Draw the lane for this track at this length; nothing when the project has no track. */
export function cutTrackUpdate(track: CutTrack | null, manifest: TemplateManifest | null, chosenLength: number | undefined, showing: boolean): void {
  if (!host) return;
  lastUpdate = [track, manifest, chosenLength, showing];
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
    // Read with t(), not bound: the name may itself be a word in the language, so the lane is drawn
    // again when the language changes (mountCutTrack) rather than stamped.
    const name = mediaFor(cut.id)?.name ?? t('cut-track.cut.missing');
    el.label.textContent = name;
    const speed = speedLabel(cut);
    el.speed.textContent = speed;
    el.speed.toggleAttribute('hidden', speed === '');
    el.root.classList.toggle('hold', cut.hold !== undefined);
    const said = { number: index + 1, name, start: tidy(windows[index]!.start), end: tidy(windows[index]!.end), from: tidy(cut.from) };
    if (cut.hold !== undefined) {
      el.body.title = t('cut-track.cut.title.hold', { ...said, hold: tidy(cut.hold) });
      el.body.setAttribute('aria-label', t('cut-track.cut.aria-label.hold', { ...said, hold: tidy(cut.hold) }));
    } else if (speed) {
      el.body.title = t('cut-track.cut.title.speed', { ...said, speed });
      el.body.setAttribute('aria-label', t('cut-track.cut.aria-label.speed', { ...said, speed }));
    } else {
      el.body.title = t('cut-track.cut.title', said);
      el.body.setAttribute('aria-label', t('cut-track.cut.aria-label', said));
    }
    // Reframed for this shape with what matters wider than the crop (milestone 89): marked, and said
    // in its tooltip and its name, with Letterbox suggested.
    const aspect = stageAspect();
    const wide = cutReframeWide(cut, aspect);
    el.root.classList.toggle('wide', wide.length > 0);
    if (wide.length > 0) {
      const note = t('cut-track.cut.wide', { aspect, spans: spansText(wide) });
      el.body.title = [el.body.title, note].join('\n');
      el.body.setAttribute('aria-label', `${el.body.getAttribute('aria-label') ?? ''}. ${note}`);
    }
    for (const [handle, which, value] of [[el.start, 'start', windows[index]!.start], [el.end, 'end', windows[index]!.end]] as const) {
      handle.setAttribute('aria-label', t(which === 'start' ? 'cut-track.trim.start.aria-label' : 'cut-track.trim.end.aria-label', { number: index + 1 }));
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', String(tidy(Math.max(current.length, trackDuration(track!)))));
      handle.setAttribute('aria-valuenow', String(tidy(value)));
      handle.setAttribute('aria-valuetext', t('cut-track.trim.aria-valuetext', { seconds: tidy(value) }));
    }
  });
  cuts.forEach((cut, index) => {
    const el = cutEls[index]!;
    const transition = track ? transitionAt(track, index) : null;
    el.join.toggleAttribute('hidden', !transition);
    if (transition) el.join.title = joinTitle(transition);
  });
  // The shaded silences were found for the track as it stood; an edit makes them stale.
  if (silences.length > 0 && JSON.stringify(track?.cuts ?? []) !== silenceKey) clearSilences();
  if (selected !== null && selected >= cuts.length) selected = null;
  paintSelection();
  paintWaves();
  paintFilms();
}

/**
 * Each cut's frames along it (milestone 87): the clip's strip, a picture per
 * slot placed by the cut's own timing — a trim, a speed or a ramp, a freeze
 * frame — or the first frame alone, or nothing, as the lanes are set. The
 * lane is taller while frames show (the `film` class), which the stylesheet
 * gives back to the stage when they do not.
 */
function paintFilms(): void {
  if (!host) return;
  const mode = filmStripMode.value;
  host.classList.toggle('film', mode !== 'off');
  const track = current.track;
  if (!track || host.hidden) return;
  cutEls.forEach((el, index) => {
    const cut = track.cuts[index];
    if (!cut) return;
    paintFilm(el.film, mode, cut.id, (width, slot) => cutFilmSlots(cut, width, slot, mode));
  });
}

/** What the mark at a boundary says of the transition there. */
function joinTitle(transition: CutTransition): string {
  const values = { seconds: transition.seconds };
  if (transition.type === 'dissolve') return t('cut-track.join.dissolve.title', values);
  if (transition.type === 'dip') return t('cut-track.join.dip.title', values);
  return t('cut-track.join.wipe.title', values);
}

/** A rate as the lane says it: ¼×, ½×, 2×, and anything else as a decimal. */
function rateText(rate: number): string {
  if (rate === 0.25) return '¼×';
  if (rate === 0.5) return '½×';
  return `${Number(rate.toFixed(2))}×`;
}

/** What a cut's speed says on it (milestone 56): nothing in real time, the rate, a ramp, or a held frame. */
function speedLabel(cut: Cut): string {
  if (cut.hold !== undefined) return t('cut-track.speed.hold', { seconds: tidy(cut.hold) });
  const { start, end } = cutRates(cut);
  if (start === 1 && end === 1) return '';
  return start === end ? rateText(start) : `${rateText(start)}→${rateText(end)}`;
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
  // A hold has no piece and a ramp has several (milestone 56), so the pieces are matched to their
  // cuts by the index each carries; a cut with none stays plain, and a ramp draws its first slice.
  const drawn = new Set<number>();
  cutEls.forEach((el, index) => {
    if (!trackAudio(track).some((piece) => piece.cut === index)) {
      el.wave.toggleAttribute('hidden', true);
      el.wavePath.removeAttribute('d');
    }
  });
  trackAudio(track).forEach((cut) => {
    const index = cut.cut;
    const el = cutEls[index];
    if (!el || drawn.has(index)) return;
    drawn.add(index);
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
    const bars = layerBarPeaks({ kind: 'sound', path: '', value: cut.value, source: { duration }, span: cut.span, ...(cut.speed !== undefined ? { speed: cut.speed } : {}) }, peaks, current.length, columns);
    el.wave.setAttribute('viewBox', `0 0 ${columns} 12`);
    el.wavePath.setAttribute('d', waveformPath(bars, columns, 12));
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
  const next = withCutInserted(track, track.cuts.length, cutFromClip(id, entry.meta.duration, entry.path));
  if (next === track) {
    say(t('cut-track.full'));
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
  const speed = document.createElement('span');
  speed.className = 'cut-speed';
  speed.toggleAttribute('hidden', true);
  // The frames first, then the sound, so the label draws over both — the bars' own order (src/renderer/stage-bars.ts).
  const film = document.createElement('canvas');
  film.className = 'cut-film';
  film.setAttribute('aria-hidden', 'true');
  film.hidden = true;
  const wave = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wave.setAttribute('class', 'cut-wave');
  wave.setAttribute('preserveAspectRatio', 'none');
  wave.setAttribute('aria-hidden', 'true');
  const wavePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  wave.append(wavePath);
  wave.toggleAttribute('hidden', true);
  body.append(film, wave, label, speed);
  const start = trimHandle('start');
  const end = trimHandle('end');
  const join = document.createElement('span');
  join.className = 'cut-join';
  join.toggleAttribute('hidden', true);
  root.append(body, start, end, join);
  body.addEventListener('pointerdown', onMovePointerDown);
  body.addEventListener('pointermove', onMovePointerMove);
  body.addEventListener('pointerup', onMovePointerUp);
  body.addEventListener('pointercancel', onMovePointerUp);
  body.addEventListener('keydown', onCutKeyDown);
  body.addEventListener('contextmenu', onCutContextMenu);
  for (const [which, handle] of [['start', start], ['end', end]] as const) {
    handle.addEventListener('pointerdown', (e) => onTrimPointerDown(e, which));
    handle.addEventListener('pointermove', onTrimPointerMove);
    handle.addEventListener('pointerup', onTrimPointerUp);
    handle.addEventListener('pointercancel', onTrimPointerUp);
  }
  return { root, body, label, speed, start, end, join, film, wave, wavePath };
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

/** Stretches of a clip as a reader reads them: "0-2, 5.5-7". */
function spansText(spans: readonly ReframeWideSpan[]): string {
  return spans.map((s) => `${tidy(s.from)}-${tidy(s.to)}`).join(', ');
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
  const { start, end } = cutWindows(drag.track)[drag.index]!;
  // A freeze frame has no window to trim: its edge sets how long it holds.
  if (cut.hold !== undefined) return withCutHold(drag.track, drag.index, drag.which === 'start' ? end - edge : edge - start);
  // The edge is a moment of the timeline; the window is seconds of the file, one delta apart —
  // scaled by the cut's speed (milestone 56), so a second of the lane is a second of the file at
  // 1× and two of them at 2×. A ramp trims by its mean rate, which keeps its length honest.
  const rates = cutRates(cut);
  const mean = (rates.start + rates.end) / 2;
  const source = drag.which === 'start' ? cut.from + (edge - start) * mean : cut.from + (edge - start) * mean;
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

// ---------------------------------------------------------------- the cut's own menu (milestone 49)

/** A template a wipe transition may play: typed a wipe, or an older bundled one tagged as one. */
function isWipeTemplate(manifest: { type?: string; tags?: string[] }): boolean {
  return manifest.type === 'wipe' || (manifest.tags ?? []).includes('wipe');
}

/** The bundled wipes a transition may play, by name. */
function wipeChoices(): { id: string; name: string }[] {
  return (appState.value.index?.templates ?? [])
    .filter((t) => isWipeTemplate(t.manifest))
    .map((t) => ({ id: t.id, name: t.manifest.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);
}

/** The rates the menu offers, from a quarter to four times (milestone 56). */
const RATES = [0.25, 0.5, 1, 2, 4] as const;
/** How long a freeze frame may be asked to hold from the menu. */
const HOLDS = [0.5, 1, 2, 3, 5] as const;

/** What the menu offers a cut: its transition, its sound unlinked, its speed or hold, a freeze frame, the track's silences, and the ripple. */
function cutMenuItems(track: CutTrack, index: number): MenuItemSpec[] {
  const cut = track.cuts[index]!;
  const last = index === track.cuts.length - 1;
  const tr = cut.transition;
  const radio = (label: string, arg: string, checked: boolean): MenuItemSpec =>
    ({ command: 'cut.transition', label, arg, type: 'radio', checked });
  const transition: MenuItemSpec[] = [
    radio(t('cut-track.menu.transition.none'), 'none', !tr),
    radio(t('cut-track.menu.transition.dissolve'), 'dissolve', tr?.type === 'dissolve'),
    radio(t('cut-track.menu.transition.dip-black'), 'dip:#000000', tr?.type === 'dip' && (tr.color ?? '#000000') === '#000000'),
    radio(t('cut-track.menu.transition.dip-white'), 'dip:#ffffff', tr?.type === 'dip' && tr.color === '#ffffff'),
    ...wipeChoices().map((w) => radio(w.name, `wipe:${w.id}`, tr?.type === 'wipe' && tr.template === w.id)),
    { type: 'separator' },
    ...[0.25, 0.5, 1, 2].map((seconds): MenuItemSpec => ({
      command: 'cut.transitionSeconds', label: t('cut-track.menu.transition.seconds', { seconds }), arg: String(seconds), type: 'radio',
      checked: (tr?.seconds ?? DEFAULT_TRANSITION_SECONDS) === seconds, enabled: Boolean(tr),
    })),
  ];
  const soundRadio = (label: string, arg: string, checked: boolean): MenuItemSpec =>
    ({ command: 'cut.sound', label, arg, type: 'radio', checked });
  const sd = cut.sound;
  const sound: MenuItemSpec[] = [
    soundRadio(t('cut-track.menu.sound.linked'), 'linked', !sd),
    soundRadio(t('cut-track.menu.sound.muted'), 'muted', sd?.muted === true),
    { type: 'separator' },
    ...[0.25, 0.5, 1].map((v) => soundRadio(t('cut-track.menu.sound.lead', { seconds: v }), `lead:${v}`, sd?.lead === v && !sd?.muted)),
    ...[0.25, 0.5, 1].map((v) => soundRadio(t('cut-track.menu.sound.tail', { seconds: v }), `tail:${v}`, sd?.tail === v && !sd?.muted)),
  ];
  // The speed (milestone 56): a rate, a ramp from the rate to another across the cut, and smooth
  // slow motion where frames have to be made up. A freeze frame offers how long it holds instead.
  const { start: rate, end: rateTo } = cutRates(cut);
  const speedRadio = (label: string, arg: string, checked: boolean): MenuItemSpec => ({ command: 'cut.speed', label, arg, type: 'radio', checked });
  const rampRadio = (label: string, arg: string, checked: boolean): MenuItemSpec => ({ command: 'cut.ramp', label, arg, type: 'radio', checked });
  const speed: MenuItemSpec[] = [
    ...RATES.map((r) => speedRadio(rateText(r), String(r), rate === r)),
    { type: 'separator' },
    rampRadio(t('cut-track.menu.ramp.none'), 'none', cut.speed?.to === undefined),
    ...RATES.map((r) => rampRadio(t('cut-track.menu.ramp.to', { rate: rateText(r) }), String(r), cut.speed?.to === r)),
    { type: 'separator' },
    { command: 'cut.smooth', label: t('cut-track.menu.smooth'), type: 'checkbox', checked: cut.speed?.smooth === true, enabled: Math.min(rate, rateTo) < 1 },
  ];
  const hold: MenuItemSpec[] = HOLDS.map((v) => ({ command: 'cut.hold', label: t('cut-track.menu.hold.seconds', { seconds: v }), arg: String(v), type: 'radio', checked: cut.hold === v }));
  const freeze: MenuItemSpec[] = HOLDS.map((v) => ({ command: 'cut.freeze', label: t('cut-track.menu.freeze.seconds', { seconds: v }), arg: String(v) }));
  // Reframing for the frame's shape (milestone 77): the subject followed, the middle kept, or the
  // picture letterboxed as before. Named for the shape on the stage, which is the one it changes.
  const aspect = stageAspect();
  const keys = cutReframe(cut, aspect);
  // A cut whose interest was found wider than the crop has Letterbox suggested (milestone 89).
  const suggestLetterbox = cutReframeWide(cut, aspect).length > 0;
  const reframe: MenuItemSpec[] = [
    { command: 'cut.reframe', label: t('cut-track.menu.reframe.follow'), arg: 'follow', type: 'radio', checked: (keys?.length ?? 0) > 1 },
    { command: 'cut.reframe', label: t('cut-track.menu.reframe.center'), arg: 'center', type: 'radio', checked: keys?.length === 1 },
    { command: 'cut.reframe', label: t(suggestLetterbox ? 'cut-track.menu.reframe.off-suggested' : 'cut-track.menu.reframe.off'), arg: 'off', type: 'radio', checked: !keys },
  ];
  return [
    ...(last ? [] : [{ label: t('cut-track.menu.transition'), submenu: transition } satisfies MenuItemSpec]),
    { label: t('cut-track.menu.sound'), submenu: sound },
    ...(cut.hold !== undefined ? [{ label: t('cut-track.menu.hold'), submenu: hold } satisfies MenuItemSpec] : [{ label: t('cut-track.menu.speed'), submenu: speed } satisfies MenuItemSpec]),
    { label: t('cut-track.menu.freeze'), submenu: freeze },
    { label: t('cut-track.menu.reframe', { aspect }), submenu: reframe },
    // What the lanes draw of every clip (milestone 87): a choice for the timeline, kept with the settings.
    { label: t('cut-track.menu.thumbnails'), submenu: FILM_STRIP_MODES.map((mode): MenuItemSpec => ({
      command: 'cut.thumbnails', label: t(`cut-track.menu.thumbnails.${mode}`), arg: mode, type: 'radio', checked: filmStripMode.value === mode,
    })) },
    { type: 'separator' },
    { command: 'cut.silences', label: t('cut-track.menu.silences') },
    { command: 'cut.export', label: t('cut-track.menu.export') },
    { command: 'cut.delete', label: t('cut-track.menu.delete') },
  ];
}

function onCutContextMenu(e: MouseEvent): void {
  const index = indexOfEl(e.currentTarget);
  const track = current.track;
  if (!track || !track.cuts[index]) return;
  e.preventDefault();
  e.stopPropagation();
  selected = index;
  paintSelection();
  openContextMenu({
    x: e.clientX,
    y: e.clientY,
    doc: (e.currentTarget as HTMLElement).ownerDocument,
    items: cutMenuItems(track, index),
    run: (command: MenuCommand, arg: string | null) => runCutCommand(command, arg, index),
  });
}

function runCutCommand(command: string, arg: string | null, index: number): void {
  const editor = layerEditor();
  const track = editor?.track();
  const cut = track?.cuts[index];
  if (!editor || !track || !cut) return;
  if (command === 'cut.delete') {
    selected = null;
    setTrack(withCutRemoved(track, index), true);
    return;
  }
  if (command === 'cut.silences') {
    openSilenceDialog();
    return;
  }
  if (command === 'cut.reframe') {
    const aspect = stageAspect();
    if (arg === 'off') {
      setTrack(withCutReframe(track, index, aspect, null), true);
      return;
    }
    if (arg === 'center') {
      setTrack(withCutReframe(track, index, aspect, centredReframe(cut.from)), true);
      return;
    }
    // Follow the subject: found on this machine, from the cut's own window of the clip.
    const frame = frameSize.value ?? { width: 1080, height: 1920 };
    say(t('cut-track.reframe.finding'));
    void window.pulp.reframeCut({ clip: cut.id, from: cut.from, to: cut.to, frame }).then((result) => {
      if (!result.ok) {
        say(t('cut-track.reframe.failed', { reason: result.message }));
        return;
      }
      const now = layerEditor()?.track();
      if (!now || now.cuts[index]?.id !== cut.id) return;
      setTrack(withCutReframe(now, index, aspect, result.keys, result.wide), true);
      // What matters wider than the crop in some shot is said rather than cut quietly (milestone 89).
      if (result.wide.length > 0) say(t('cut-track.reframe.wide', { count: result.wide.length, aspect }));
      else say(t(result.faces > 0 ? 'cut-track.reframe.done-faces' : 'cut-track.reframe.done', { shots: result.shots, keys: result.keys.length }));
    });
    return;
  }
  if (command === 'cut.thumbnails') {
    if (arg) chooseFilmStrip(sanitizeFilmStripMode(arg));
    return;
  }
  if (command === 'cut.export') {
    // FCPXML, an EDL and the graphics with alpha, written beside each other where the save
    // dialog says (milestone 49): the shots referenced in place, the titles finished elsewhere.
    const entry = selectedTemplate.value;
    if (!entry) return;
    void window.pulp.exportEdit({ templateId: entry.id, name: entry.manifest.name, params: editor.params() }).then((result) => {
      if (result.ok) say(t('cut-track.exported', { path: result.fcpxml }));
      else if (!result.cancelled) say(result.message);
    });
    return;
  }
  if (command === 'cut.transition') {
    const seconds = cut.transition?.seconds ?? DEFAULT_TRANSITION_SECONDS;
    let transition: CutTransition | null = null;
    if (arg === 'dissolve') transition = { type: 'dissolve', seconds };
    else if (arg?.startsWith('dip:')) transition = { type: 'dip', seconds, color: arg.slice(4) };
    else if (arg?.startsWith('wipe:')) transition = { type: 'wipe', seconds, template: arg.slice(5) };
    setTrack(withCutTransition(track, index, transition), true);
    return;
  }
  if (command === 'cut.transitionSeconds' && cut.transition) {
    setTrack(withCutTransition(track, index, { ...cut.transition, seconds: Number(arg) || DEFAULT_TRANSITION_SECONDS }), true);
    return;
  }
  if (command === 'cut.speed') {
    // The new rate keeps the ramp's far end and the smoothness, as changing one thing should.
    const rate = Number(arg) || 1;
    const speed: CutSpeed = { rate, ...(cut.speed?.to !== undefined ? { to: cut.speed.to } : {}), ...(cut.speed?.smooth ? { smooth: true as const } : {}) };
    setTrack(withCutSpeed(track, index, speed), true);
    return;
  }
  if (command === 'cut.ramp') {
    const { start } = cutRates(cut);
    const speed: CutSpeed = { rate: start, ...(arg !== 'none' && arg ? { to: Number(arg) || 1 } : {}), ...(cut.speed?.smooth ? { smooth: true as const } : {}) };
    setTrack(withCutSpeed(track, index, speed), true);
    return;
  }
  if (command === 'cut.smooth') {
    const { start, end } = cutRates(cut);
    const speed: CutSpeed = { rate: start, ...(cut.speed?.to !== undefined ? { to: end } : {}), ...(cut.speed?.smooth ? {} : { smooth: true as const }) };
    setTrack(withCutSpeed(track, index, speed), true);
    return;
  }
  if (command === 'cut.hold') {
    setTrack(withCutHold(track, index, Number(arg) || DEFAULT_HOLD_SECONDS), true);
    return;
  }
  if (command === 'cut.freeze') {
    // At the playhead when it is inside this cut, so the shot stops on the frame being looked
    // at; otherwise at the head of the cut.
    const windows = cutWindows(track);
    const playhead = playheadSeconds.peek();
    const inside = playhead > windows[index]!.start && playhead < windows[index]!.end;
    const at = inside ? playhead : windows[index]!.start;
    const frozen = withFreezeAt(track, at, Number(arg) || DEFAULT_HOLD_SECONDS);
    if (frozen !== track) setTrack(frozen, true);
    return;
  }
  if (command === 'cut.sound') {
    let sound: CutSound | null = null;
    if (arg === 'muted') sound = { ...cut.sound, muted: true };
    else if (arg?.startsWith('lead:')) sound = { ...cut.sound, lead: Number(arg.slice(5)) };
    else if (arg?.startsWith('tail:')) sound = { ...cut.sound, tail: Number(arg.slice(5)) };
    if (sound?.muted !== true && sound) delete sound.muted;
    setTrack(withCutSound(track, index, sound), true);
  }
}

// ---------------------------------------------------------------- silence removal (milestone 49)

/** The quiet stretches last found, on the timeline, and the cuts they were found for. */
let silences: { start: number; end: number }[] = [];
let silenceKey = '';
const shades: HTMLSpanElement[] = [];

function clearSilences(): void {
  silences = [];
  silenceKey = '';
  for (const shade of shades.splice(0)) shade.remove();
  const cutButton = document.getElementById('silence-cut') as HTMLButtonElement | null;
  if (cutButton) cutButton.disabled = true;
  const found = document.getElementById('silence-found');
  if (found) foundText(found, '');
}

/** Shade the found stretches on the lane, where the cut will fall. */
function paintSilences(): void {
  for (const shade of shades.splice(0)) shade.remove();
  if (!host || current.length <= 0) return;
  for (const range of silences) {
    const shade = document.createElement('span');
    shade.className = 'cut-silence';
    shade.style.left = `${(range.start / current.length) * 100}%`;
    shade.style.width = `${((range.end - range.start) / current.length) * 100}%`;
    bindAttr(shade, 'title', 'cut-track.silence.title', { from: Math.round(range.start * 100) / 100, to: Math.round(range.end * 100) / 100 });
    host.append(shade);
    shades.push(shade);
  }
}

/** The silence dialog's finding in words already worked out (none, here), so no message stamped on it earlier comes back. */
function foundText(el: HTMLElement, text: string): void {
  delete el.dataset.i18n;
  delete el.dataset.i18nValues;
  el.textContent = text;
}

function openSilenceDialog(): void {
  (document.getElementById('silence-dialog') as HTMLDialogElement | null)?.showModal();
}

function wireSilenceDialog(): void {
  const dialog = document.getElementById('silence-dialog') as HTMLDialogElement | null;
  if (!dialog) return;
  const threshold = document.getElementById('silence-threshold') as HTMLInputElement;
  const minimum = document.getElementById('silence-min') as HTMLInputElement;
  const find = document.getElementById('silence-find') as HTMLButtonElement;
  const found = document.getElementById('silence-found') as HTMLElement;
  const cutButton = document.getElementById('silence-cut') as HTMLButtonElement;
  find.addEventListener('click', () => {
    const track = layerEditor()?.track();
    if (!track) return;
    bindText(found, 'cut-track.silence.listening');
    const asked = JSON.stringify(track.cuts);
    void window.pulp.trackSilences({ cuts: track.cuts.map((c) => ({ id: c.id, from: c.from, to: c.to })), thresholdDb: Number(threshold.value), minSeconds: Number(minimum.value) })
      .then(({ ranges }) => {
        if (JSON.stringify(layerEditor()?.track()?.cuts ?? []) !== asked) return;
        silences = ranges;
        silenceKey = asked;
        paintSilences();
        const total = Math.round(ranges.reduce((sum, r) => sum + (r.end - r.start), 0) * 10) / 10;
        if (ranges.length === 0) bindText(found, 'cut-track.silence.none');
        else bindText(found, 'cut-track.silence.found', { count: ranges.length, total });
        cutButton.disabled = ranges.length === 0;
      });
  });
  cutButton.addEventListener('click', () => {
    const editor = layerEditor();
    const track = editor?.track();
    if (!editor || !track || silences.length === 0) return;
    // One call, one undo step: every quiet stretch goes together.
    const cut = withSilencesCut(track, silences);
    clearSilences();
    editor.setTrack(cut.cuts.length > 0 ? cut : null, true);
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    // The shading belongs to the conversation the dialog held; closed, the lane is itself again.
    clearSilences();
  });
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
    say(t('cut-track.drop.no-template'));
    return;
  }
  const entry = mediaFor(itemId);
  if (!entry || entry.mediaKind !== 'video' || entry.sequence) {
    // A bundled wipe dropped on the track lands on the join nearest the hand (milestone 49).
    const wipe = (appState.value.index?.templates ?? []).find((t) => t.id === itemId && isWipeTemplate(t.manifest));
    const track = current.track;
    if (wipe && track && track.cuts.length > 1) {
      const time = timeAt(e.clientX);
      const ends = cutWindows(track).slice(0, -1).map((w) => w.end);
      let boundary = 0;
      ends.forEach((end, i) => {
        if (Math.abs(end - time) < Math.abs(ends[boundary]! - time)) boundary = i;
      });
      const seconds = track.cuts[boundary]!.transition?.seconds ?? DEFAULT_TRANSITION_SECONDS;
      selected = boundary;
      setTrack(withCutTransition(track, boundary, { type: 'wipe', seconds, template: wipe.id }), true);
      return;
    }
    if (wipe) {
      say(t('cut-track.drop.wipe-needs-two'));
      return;
    }
    say(t('cut-track.drop.clip-only'));
    return;
  }
  if (entry.offline || !entry.meta?.duration || entry.meta.duration <= 0) {
    say(t('cut-track.drop.no-length'));
    return;
  }
  const track = current.track ?? { cuts: [] };
  // The drop lands at the boundary nearest the hand: inside a cut it lands before or after it.
  const time = timeAt(e.clientX);
  const under = cutIndexAt(track, time);
  const windows = cutWindows(track);
  const index = under === null ? track.cuts.length : time - windows[under]!.start < cutSeconds(track.cuts[under]!) / 2 ? under : under + 1;
  const next = withCutInserted(track, index, cutFromClip(entry.id, entry.meta.duration, entry.path));
  if (next === track) {
    say(t('cut-track.full'));
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
  // A drop the picture track takes stops there and never reaches the lanes, and a drag ends at its
  // source: heard on the document in capture, so the lanes' highlight never outlives the drag.
  for (const type of ['drop', 'dragend'] as const) document.addEventListener(type, () => lanes?.classList.remove('drop-target'), true);
  lanes.addEventListener('drop', onDrop);
  window.addEventListener('keydown', onSplitKey);
  wireSilenceDialog();
  // The lane's words are read as it is drawn: a change of language draws it again.
  whenLocaleChanges(() => {
    if (lastUpdate) cutTrackUpdate(...lastUpdate);
  });
  // Peaks arrive in the background: the cuts catch up when they land.
  effect(() => {
    void waveforms.value;
    paintWaves();
  });
  // So do the film strips (milestone 87), and the choice of what the lanes draw changes them all.
  effect(() => {
    void filmStrips.value;
    void filmStripMode.value;
    paintFilms();
  });
  // A wider or narrower lane has more or fewer slots along each cut.
  new ResizeObserver(() => paintFilms()).observe(el);
  // A cut's wide mark is for the stage's shape (milestone 89): a change of shape draws the lane again.
  effect(() => {
    void frameSize.value;
    // Only the shape is listened for: what the redraw reads besides is not this effect's to follow.
    untracked(() => {
      if (lastUpdate) cutTrackUpdate(...lastUpdate);
    });
  });
}

/** The shape the stage shows the picture at, which is the shape a reframe is for. */
function stageAspect(): string {
  const size = frameSize.value ?? { width: 1920, height: 1080 };
  return aspectOf(size.width, size.height);
}
