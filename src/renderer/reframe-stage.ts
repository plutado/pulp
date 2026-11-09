/**
 * The reframe on the stage (milestone 77): a cut reframed for the frame's
 * shape shows a handle at the frame's middle; dragging it moves the crop at
 * this frame — the picture pans under the hand — and writes a reframe key at
 * the cut's clip second, so the found path is still the person's to change,
 * for each shape on its own. The arithmetic is core's (src/core/reframe.ts);
 * this is the handle and the gesture.
 */

import { aspectOf } from '../core/aspect';
import { cutReframe, cutWindows, reframeCentreAt, trackSourceAt, withReframeKeyAt } from '../core/cut-track';
import { tr } from '../core/i18n';
import { clampCenter, coverWindowSize } from '../core/reframe';
import { layerEditor } from './layer-edit';
import { appState } from './store';

interface Host {
  frameSize(): { width: number; height: number };
  playheadSeconds(): number;
  fps(): number;
}

let host: Host | null = null;
let handle: HTMLButtonElement | null = null;
let drawnAt = -1;

/** The clip's own size, as the library measured it; null until it has been. */
function clipSize(id: string): { width: number; height: number } | null {
  const entry = appState.value.index?.media.find((m) => m.id === id);
  return entry?.meta?.width && entry.meta.height ? { width: entry.meta.width, height: entry.meta.height } : null;
}

/** The reframed cut under the playhead, with where it is on the timeline and in its file. */
function reframedUnderPlayhead(seconds: number, frame: { width: number; height: number }) {
  const editor = layerEditor();
  const track = editor?.track() ?? null;
  if (!track) return null;
  const at = trackSourceAt(track, seconds);
  if (!at) return null;
  const cut = track.cuts[at.index]!;
  const aspect = aspectOf(frame.width, frame.height);
  const keys = cutReframe(cut, aspect);
  if (!keys) return null;
  return { track, cut, index: at.index, source: at.seconds, aspect, keys, start: cutWindows(track)[at.index]!.start };
}

/** Show the handle while a reframed cut is under the playhead; hide it otherwise. */
export function reframeStageDraw(seconds: number, frame: { width: number; height: number }): void {
  drawnAt = seconds;
  if (!handle) return;
  const under = reframedUnderPlayhead(seconds, frame);
  handle.hidden = !under;
  if (!under) return;
  const center = reframeCentreAt(under.keys, under.source);
  handle.dataset.x = String(center.x);
  handle.dataset.y = String(center.y);
  handle.dataset.cut = String(under.index);
}

/** For the end-to-end test: whether the handle is shown, and the crop's center it stands for. */
export function reframeStageDebug(): { shown: boolean; x: number; y: number } | null {
  if (!handle || handle.hidden) return null;
  return { shown: true, x: Number(handle.dataset.x), y: Number(handle.dataset.y) };
}

export function mountReframeStage(frameEl: HTMLElement, h: Host): void {
  host = h;
  handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'reframe-handle';
  handle.id = 'reframe-handle';
  handle.setAttribute('aria-label', tr('reframe.handle'));
  handle.hidden = true;
  frameEl.append(handle);
  let drag: { pointerId: number; startX: number; startY: number; center: { x: number; y: number }; under: NonNullable<ReturnType<typeof reframedUnderPlayhead>>; clip: { width: number; height: number } } | null = null;
  handle.addEventListener('pointerdown', (e) => {
    if (!host) return;
    const frame = host.frameSize();
    const under = reframedUnderPlayhead(drawnAt >= 0 ? drawnAt : host.playheadSeconds(), frame);
    const clip = under ? clipSize(under.cut.id) : null;
    if (!under || !clip) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, center: reframeCentreAt(under.keys, under.source), under, clip };
    try {
      handle!.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that cannot be captured (a test's) still works while it stays over the handle.
    }
  });
  const moved = (e: PointerEvent): { x: number; y: number } | null => {
    if (!drag || !host) return null;
    const frame = host.frameSize();
    const rect = frameEl.getBoundingClientRect();
    // The picture pans under the hand: a drag of a frame's width moves the window a window's width
    // the other way, so what is under the pointer stays under it.
    const window = coverWindowSize(frame, drag.clip);
    const dx = ((e.clientX - drag.startX) / Math.max(1, rect.width)) * window.w;
    const dy = ((e.clientY - drag.startY) / Math.max(1, rect.height)) * window.h;
    return clampCenter({ x: drag.center.x - dx, y: drag.center.y - dy }, window);
  };
  handle.addEventListener('pointermove', (e) => {
    const center = moved(e);
    if (!center || !drag) return;
    const editor = layerEditor();
    if (!editor) return;
    // Live, uncommitted: the stage follows the hand frame by frame.
    editor.setTrack(withReframeKeyAt(drag.under.track, drag.under.index, drag.under.aspect, { at: drag.under.source, ...center }, host!.fps()), false);
  });
  handle.addEventListener('pointerup', (e) => {
    const center = moved(e);
    if (!center || !drag) return;
    const editor = layerEditor();
    if (editor) editor.setTrack(withReframeKeyAt(drag.under.track, drag.under.index, drag.under.aspect, { at: drag.under.source, ...center }, host!.fps()), true);
    drag = null;
  });
}
