/**
 * Motion tracking on the stage (milestone 76): the tracks drawn over the
 * picture, a point or a box followed from where the pointer is, a layer pinned
 * to a track, and a wrong frame moved by hand with the track picked up again
 * from there. The arithmetic is core's (src/core/motion-track.ts and
 * src/core/track-pin.ts); the frames are read by the main process; this is the
 * overlay and the commands.
 *
 * A track belongs to the clip, so what is drawn at a moment is the tracks of
 * the clip the cut track plays there, each sample mapped through the cut's
 * timing and the letterbox the picture sits in — the same mapping a pin bakes
 * its keys through, so the path a person sees is where the pinned layer goes.
 */

import { aspectOf } from '../core/aspect';
import { cutWindows, trackSourceAt, type Cut, type CutTrack } from '../core/cut-track';
import { tr } from '../core/i18n';
import { keyedPoseAt, type KeyedPose } from '../core/layer-keys';
import { placementFor, type Layer } from '../core/layers';
import { LOST_CONFIDENCE, newTrackId, trackPositionAt, trackSpliced, type MotionTrack, type TrackKind } from '../core/motion-track';
import type { StageTrack } from '../core/stage-menu';
import { cutPictureBox, framePointOnPicture, pinKeys, trackPointOnFrame, type PxBox } from '../core/track-pin';
import { layerEditor, selectedLayer } from './layer-edit';
import { appState } from './store';

interface Host {
  frameSize(): { width: number; height: number };
  playheadSeconds(): number;
  note(text: string): void;
}

/** The overlay's own units: a thousandth of the frame each way, so the SVG scales with the picture. */
const UNITS = 1000;
/** A box tracked from the menu, where no box was drawn: this much of the picture about the point. */
const MENU_BOX_FRACTION = 0.12;

let host: Host | null = null;
let svg: SVGSVGElement | null = null;
let busy = false;

/** The clip's own size, as the library measured it; null until it has been. */
function clipSize(id: string): { width: number; height: number } | null {
  const entry = appState.value.index?.media.find((m) => m.id === id);
  const width = entry?.meta?.width;
  const height = entry?.meta?.height;
  return width && height ? { width, height } : null;
}

/** The cut under the playhead and the clip second it shows, or null when nothing plays there. */
function cutUnderPlayhead(track: CutTrack | null, seconds: number): { cut: Cut; index: number; start: number; source: number } | null {
  if (!track) return null;
  const at = trackSourceAt(track, seconds);
  if (!at) return null;
  return { cut: track.cuts[at.index]!, index: at.index, start: cutWindows(track)[at.index]!.start, source: at.seconds };
}

/** Which cut a track can be seen through, with its place on the timeline: the one under the playhead if it plays the track's clip, else the first that does. */
function cutForTrack(cutTrack: CutTrack | null, track: MotionTrack, seconds: number): { cut: Cut; start: number; end: number } | null {
  if (!cutTrack) return null;
  const windows = cutWindows(cutTrack);
  const under = cutUnderPlayhead(cutTrack, seconds);
  if (under && under.cut.id === track.clip) return { cut: under.cut, start: under.start, end: windows[under.index]!.end };
  const index = cutTrack.cuts.findIndex((c) => c.id === track.clip);
  return index >= 0 ? { cut: cutTrack.cuts[index]!, start: windows[index]!.start, end: windows[index]!.end } : null;
}

/** The names the menus show: the kind and its number among the project's tracks. */
export function motionTrackNames(): StageTrack[] {
  const tracks = layerEditor()?.tracks() ?? [];
  let points = 0;
  let boxes = 0;
  return tracks.map((track) => ({ id: track.id, name: track.kind === 'box' ? tr('track.name.box', { n: ++boxes }) : tr('track.name.point', { n: ++points }) }));
}

/** A cut plays under the playhead, so a point or a box on it can be tracked from here. */
export function canTrackHere(): boolean {
  const editor = layerEditor();
  if (!editor || !host) return false;
  return cutUnderPlayhead(editor.track(), host.playheadSeconds()) !== null;
}

/** The layer's pose at a moment: its keys', or its placement for the frame's shape with its look's opacity. */
function poseAt(layer: Layer, at: number, frame: { width: number; height: number }): KeyedPose {
  if (layer.keys && layer.keys.length > 0) return keyedPoseAt(layer.keys, at)!;
  const placed = placementFor(layer.placement, aspectOf(frame.width, frame.height));
  return { dx: placed.dx, dy: placed.dy, scale: placed.scale, rotate: placed.rotate, opacity: layer.look?.opacity ?? 1 };
}

// ---------------------------------------------------------------- tracking

async function runTracking(clip: string, cut: Cut, source: number, point: { x: number; y: number }, kind: TrackKind, size?: { w: number; h: number }, options: { forward?: boolean; backward?: boolean } = {}) {
  return window.pulp.trackMotion({ clip, from: cut.from, to: cut.to, at: source, x: point.x, y: point.y, kind, ...(size ? { size } : {}), ...options });
}

/**
 * Track a point or a box from a point on the frame at the playhead: the cut
 * under the playhead names the clip and the clip second, the letterbox turns
 * the frame point into a point on the picture, and the main process follows
 * it forward to the cut's end and back to its start.
 */
export async function trackFromPoint(point: { x: number; y: number }, kind: TrackKind): Promise<void> {
  const editor = layerEditor();
  if (!editor || !host || busy) return;
  const under = cutUnderPlayhead(editor.track(), host.playheadSeconds());
  if (!under) {
    host.note(tr('track.note.no-cut'));
    return;
  }
  const size = clipSize(under.cut.id);
  if (!size) {
    host.note(tr('track.error.unmeasured'));
    return;
  }
  const frame = host.frameSize();
  const box = cutPictureBox(frame, size);
  const picked = framePointOnPicture(point, box);
  const boxSize = kind === 'box' ? { w: MENU_BOX_FRACTION, h: (MENU_BOX_FRACTION * size.width) / size.height } : undefined;
  busy = true;
  host.note(tr('track.note.tracking'));
  try {
    const result = await runTracking(under.cut.id, under.cut, under.source, picked, kind, boxSize);
    if (!result.ok) {
      host.note(tr('track.note.failed', { reason: result.message }));
      return;
    }
    const existing = editor.tracks() ?? [];
    const track: MotionTrack = {
      id: newTrackId(existing.map((t) => t.id)),
      clip: under.cut.id,
      kind,
      size: result.size,
      from: result.from,
      to: result.to,
      fps: result.fps,
      samples: result.samples,
    };
    editor.setTracks([...existing, track], true);
    host.note(tr('track.note.done', { count: result.samples.length, lost: result.samples.filter((s) => s.c < LOST_CONFIDENCE).length }));
    redraw();
  } finally {
    busy = false;
  }
}

export function removeTrack(id: string): void {
  const editor = layerEditor();
  if (!editor) return;
  const left = (editor.tracks() ?? []).filter((t) => t.id !== id);
  editor.setTracks(left.length > 0 ? left : null, true);
  // A layer pinned to it keeps its keys — they are its own now — and forgets the pin.
  for (const block of editor.blocks()) {
    for (const layer of editor.stack(block.id) ?? []) {
      if (layer.pin?.track === id || layer.pin?.second === id) {
        editor.edit(block.id, layer.id, (l) => {
          const rest = { ...l };
          if (l.pin?.track === id) delete rest.pin;
          else if (l.pin) rest.pin = { track: l.pin.track };
          return rest;
        }, true);
      }
    }
  }
  redraw();
}

/**
 * Pin the selected layer to a track: its keys baked from the track through
 * the cut that plays the clip, keeping the layer where it stands at the
 * playhead. With `second`, the two points' distance and bearing scale and turn
 * it as well.
 */
export function pinSelected(trackId: string, second?: string | null): void {
  const editor = layerEditor();
  const chosen = selectedLayer.value;
  if (!editor || !host || !chosen) return;
  const layer = editor.get(chosen.block, chosen.id);
  if (!layer) return;
  const pin = { track: trackId, ...(second ? { second } : second === undefined && layer.pin?.second ? { second: layer.pin.second } : {}) };
  const keys = bakedKeys(layer, pin, host.playheadSeconds());
  if (!keys) {
    host.note(tr('track.note.no-track-cut'));
    return;
  }
  editor.edit(chosen.block, chosen.id, (l) => ({ ...l, keys, pin }), true);
  const names = motionTrackNames();
  host.note(tr('track.note.pinned', { layer: layer.label, track: names.find((n) => n.id === trackId)?.name ?? trackId }));
}

export function unpinSelected(): void {
  const editor = layerEditor();
  const chosen = selectedLayer.value;
  if (!editor || !chosen) return;
  editor.edit(chosen.block, chosen.id, (l) => {
    const rest = { ...l };
    delete rest.pin;
    return rest;
  }, true);
}

/** The keys a pin writes for a layer, anchored at a moment; null when no cut plays the track's clip. */
function bakedKeys(layer: Layer, pin: { track: string; second?: string }, at: number) {
  const editor = layerEditor();
  if (!editor || !host) return null;
  const tracks = editor.tracks() ?? [];
  const track = tracks.find((t) => t.id === pin.track);
  if (!track) return null;
  const second = pin.second ? tracks.find((t) => t.id === pin.second) : undefined;
  const through = cutForTrack(editor.track(), track, at);
  const clip = clipSize(track.clip);
  if (!through || !clip) return null;
  const frame = host.frameSize();
  // Anchored where the layer is seen through this cut: at the playhead when the cut is under it, else at the cut's start.
  const anchor = at >= through.start - 1e-6 && at <= through.end + 1e-6 ? at : through.start;
  return pinKeys({ track, ...(second ? { second } : {}), cut: through.cut, cutStart: through.start, frame, clip, at: anchor, pose: poseAt(layer, anchor, frame) });
}

/** A track changed: every layer pinned to it is baked again, so the fix reaches what follows the track. */
function repinLayers(trackId: string): void {
  const editor = layerEditor();
  if (!editor || !host) return;
  for (const block of editor.blocks()) {
    for (const layer of editor.stack(block.id) ?? []) {
      if (layer.pin?.track !== trackId && layer.pin?.second !== trackId) continue;
      // Anchored at the first key, which is where the pin was made from: the pose there stays.
      const at = layer.keys?.[0]?.at ?? host.playheadSeconds();
      const keys = bakedKeys(layer, layer.pin, at);
      if (keys) editor.edit(block.id, layer.id, (l) => ({ ...l, keys }), true);
    }
  }
}

/**
 * A wrong frame moved by hand: the sample at the playhead's clip second is set
 * where the handle was dropped, and the track is followed again from there to
 * the cut's end; the frames before it stand.
 */
async function fixTrackAt(track: MotionTrack, source: number, picture: { x: number; y: number }): Promise<void> {
  const editor = layerEditor();
  if (!editor || !host || busy) return;
  const through = cutForTrack(editor.track(), track, host.playheadSeconds());
  if (!through) return;
  busy = true;
  host.note(tr('track.note.tracking'));
  try {
    const result = await runTracking(track.clip, { ...through.cut, from: Math.max(through.cut.from, source) }, source, picture, track.kind, track.kind === 'box' ? track.size : undefined, { backward: false });
    if (!result.ok) {
      host.note(tr('track.note.failed', { reason: result.message }));
      return;
    }
    const fixed = trackSpliced(track, result.samples[0]?.at ?? source, result.samples);
    editor.setTracks((editor.tracks() ?? []).map((t) => (t.id === track.id ? fixed : t)), true);
    repinLayers(track.id);
    host.note(tr('track.note.fixed', { at: Math.round(source * 100) / 100 }));
    redraw();
  } finally {
    busy = false;
  }
}

// ---------------------------------------------------------------- the overlay

const NS = 'http://www.w3.org/2000/svg';
let drawnAt = -1;

function toUnits(point: { x: number; y: number }, frame: { width: number; height: number }): { x: number; y: number } {
  return { x: (point.x / frame.width) * UNITS, y: (point.y / frame.height) * UNITS };
}

/** Draw the tracks of the clip under the playhead at a moment; nothing when none plays or none is tracked. */
export function motionTracksDraw(seconds: number, frame: { width: number; height: number }): void {
  drawnAt = seconds;
  if (!svg) return;
  const editor = layerEditor();
  const tracks = editor?.tracks() ?? [];
  const under = editor ? cutUnderPlayhead(editor.track(), seconds) : null;
  svg.replaceChildren();
  const shown = under ? tracks.filter((t) => t.clip === under.cut.id) : [];
  svg.toggleAttribute('hidden', shown.length === 0);
  svg.dataset.tracks = String(shown.length);
  if (!under || shown.length === 0) return;
  const clip = clipSize(under.cut.id);
  if (!clip) return;
  const box = cutPictureBox(frame, clip);
  const names = motionTrackNames();
  for (const track of shown) {
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', `track-path track-${track.kind}`);
    group.dataset.track = track.id;
    const points = track.samples.filter((s) => s.at >= under.cut.from - 1e-6 && s.at <= under.cut.to + 1e-6);
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', points.map((s) => { const u = toUnits(trackPointOnFrame(s, box), frame); return `${u.x.toFixed(1)},${u.y.toFixed(1)}`; }).join(' '));
    group.append(line);
    // Frames the tracker was unsure of, marked so a person knows where to look.
    for (const s of points) {
      if (s.c >= LOST_CONFIDENCE) continue;
      const u = toUnits(trackPointOnFrame(s, box), frame);
      const mark = document.createElementNS(NS, 'circle');
      mark.setAttribute('class', 'track-lost');
      mark.setAttribute('cx', u.x.toFixed(1));
      mark.setAttribute('cy', u.y.toFixed(1));
      mark.setAttribute('r', '4');
      group.append(mark);
    }
    // The frame's own sample, as the handle that fixes it.
    const now = trackPositionAt(track, under.source);
    if (now) {
      const u = toUnits(trackPointOnFrame(now, box), frame);
      const handle = document.createElementNS(NS, 'circle');
      handle.setAttribute('class', 'track-handle');
      handle.setAttribute('cx', u.x.toFixed(1));
      handle.setAttribute('cy', u.y.toFixed(1));
      handle.setAttribute('r', '7');
      handle.setAttribute('role', 'slider');
      handle.setAttribute('tabindex', '0');
      handle.setAttribute('aria-label', `${names.find((n) => n.id === track.id)?.name ?? track.id}: ${tr('track.overlay.handle')}`);
      handle.dataset.x = String(now.x);
      handle.dataset.y = String(now.y);
      handle.dataset.c = String(now.c);
      wireHandle(handle, track, under.source, box, frame);
      group.append(handle);
      if (track.kind === 'box') {
        const rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('class', 'track-box');
        const w = (track.size.w * box.width / frame.width) * UNITS;
        const h = (track.size.h * box.height / frame.height) * UNITS;
        rect.setAttribute('x', (u.x - w / 2).toFixed(1));
        rect.setAttribute('y', (u.y - h / 2).toFixed(1));
        rect.setAttribute('width', w.toFixed(1));
        rect.setAttribute('height', h.toFixed(1));
        group.append(rect);
      }
    }
    svg.append(group);
  }
}

function redraw(): void {
  if (host) motionTracksDraw(drawnAt >= 0 ? drawnAt : host.playheadSeconds(), host.frameSize());
}

/** The handle drags in frame space; on release the sample is set and the track followed again from here. */
function wireHandle(handle: SVGCircleElement, track: MotionTrack, source: number, box: PxBox, frame: { width: number; height: number }): void {
  let dragging = false;
  const pictureFrom = (e: PointerEvent): { x: number; y: number } => {
    const r = svg!.getBoundingClientRect();
    const point = { x: ((e.clientX - r.left) / Math.max(1, r.width)) * frame.width, y: ((e.clientY - r.top) / Math.max(1, r.height)) * frame.height };
    const p = framePointOnPicture(point, box);
    return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that cannot be captured (a test's) still works while it stays over the handle.
    }
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = pictureFrom(e);
    const u = toUnits(trackPointOnFrame(p, box), frame);
    handle.setAttribute('cx', u.x.toFixed(1));
    handle.setAttribute('cy', u.y.toFixed(1));
  });
  handle.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    void fixTrackAt(track, source, pictureFrom(e));
  });
}

/** For the end-to-end test: the tracks as they stand and what the overlay shows. */
export function motionTracksDebug(): { tracks: MotionTrack[]; shown: number; busy: boolean } {
  return { tracks: layerEditor()?.tracks() ?? [], shown: Number(svg?.dataset.tracks ?? 0), busy };
}

/** Mount the overlay on the picture: an SVG over the frame that only its handles answer to. */
export function mountMotionTracks(frameEl: HTMLElement, h: Host): void {
  host = h;
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'track-overlay');
  svg.setAttribute('viewBox', `0 0 ${UNITS} ${UNITS}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'false');
  svg.setAttribute('hidden', '');
  frameEl.append(svg);
}
