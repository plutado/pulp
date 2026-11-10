/**
 * The second picture track (milestone 57, ADR 0023): the project's video
 * layers, shown as a lane of their own between the layer bars and the cut
 * track. One picture track carries the shots; this one carries what sits over
 * them — a reaction in a corner, a cutaway over an interview, b-roll over a
 * voice — each a clip anywhere on the timeline, gaps allowed.
 *
 * **It is not a second model.** A video layer already is a clip at a moment
 * with a span, a place and a size on the stage (the handles move and scale
 * it), its own sound in the mix, a speed and keys. What this adds is the lane
 * to see them as a track and to drop a clip on at a moment: a drop here makes
 * a video layer that starts where it was dropped, runs for the clip's length
 * once, and lands in a corner at picture-in-picture size, ready for the
 * stage's handles. Its crop and border live on the clip value
 * (src/core/video-layer.ts) with the rest of how it plays.
 *
 * The lane reads the layers as the bars do (src/renderer/stage-bars.ts) and
 * writes through the layer editor, so nothing here is a second answer.
 */

import { CLIP_DRAG_TYPE, COLLECTION_DRAG_TYPE } from '../core/collection';
import type { CutTrack } from '../core/cut-track';
import { spanWindow } from '../core/layer-time';
import type { Layer, LayerValues } from '../core/layers';
import type { TemplateManifest } from '../core/manifest';
import { resolveLength } from '../core/timing';
import { layerEditor, selectedLayer } from './layer-edit';
import { bindAttr, bindText, t } from './i18n';
import { appState } from './store';

/** A dropped clip's height as a fraction of the frame's short side: a corner's worth, not the frame's. */
export const PIP_SIZE = 0.3;
/** Where a dropped clip lands, as fractions of the frame from its center: the top right corner, clear of a lower third. */
export const PIP_PLACE = { dx: 0.28, dy: -0.24 } as const;

interface PipEl {
  root: HTMLDivElement;
  body: HTMLButtonElement;
  label: HTMLSpanElement;
}

let host: HTMLDivElement | null = null;
let say: (text: string) => void = () => undefined;
const els = new Map<string, PipEl>();
let current: { length: number } = { length: 0 };
/** The arguments of the last update, so a drag starting or ending can draw the lane again. */
let last: Parameters<typeof overlayTrackUpdate> | null = null;
/** A clip is being dragged over the lanes (milestone 85): the empty lane shows, to be dropped on. */
let dragging = false;
let hint: HTMLSpanElement | null = null;

/** The video layers with a clip, in the stack's order: what the lane shows. */
function rows(manifest: TemplateManifest | null, layers: LayerValues): { block: string; layer: Layer }[] {
  const out: { block: string; layer: Layer }[] = [];
  for (const block of manifest?.blocks ?? []) {
    for (const layer of layers[block.id] ?? block.layers) {
      if (layer.type === 'video' && layer.clip?.id && !layer.hidden && !layer.clip.hidden) out.push({ block: block.id, layer });
    }
  }
  return out;
}

/**
 * Draw the lane: a block per clip over the shots, at its span on the scrub
 * bar's own scale. Shown while a clip is on it. **Empty, it takes no room at
 * rest** (milestone 85): it appears only while a clip is dragged over the
 * lanes of a project with shots to sit over, as a highlighted lane saying
 * what a drop there does — the way an editing app draws a drop target, and
 * milestone 42's rule that nothing empty takes room from the stage.
 */
export function overlayTrackUpdate(manifest: TemplateManifest | null, layers: LayerValues, chosenLength: number | undefined, showing: boolean, track: CutTrack | null): void {
  last = [manifest, layers, chosenLength, showing, track];
  if (!host) return;
  current = { length: manifest ? resolveLength(manifest.duration, manifest.structure ?? null, chosenLength) : 0 };
  const list = rows(manifest, layers);
  const ready = list.length === 0 && dragging && Boolean(track && track.cuts.length > 0);
  const show = showing && current.length > 0 && (list.length > 0 || ready);
  host.hidden = !show;
  host.classList.toggle('empty', list.length === 0);
  host.classList.toggle('drop-lane', show && ready);
  if (hint) hint.hidden = !(show && ready);
  if (!show) {
    for (const el of els.values()) el.root.remove();
    els.clear();
    return;
  }
  const keep = new Set<string>();
  const pct = (seconds: number) => `${(seconds / Math.max(0.001, current.length)) * 100}%`;
  list.forEach(({ block, layer }, index) => {
    const key = `${block}.${layer.id}`;
    keep.add(key);
    let el = els.get(key);
    if (!el) {
      el = makePip(block, layer.id);
      els.set(key, el);
      host!.append(el.root);
    }
    const window = spanWindow(layer.span, current.length);
    el.root.style.left = pct(window.from);
    el.root.style.width = pct(Math.max(0.05, window.to - window.from));
    el.root.style.order = String(index);
    const name = layer.type === 'video' && layer.clip?.id ? (appState.value.index?.media.find((m) => m.id === layer.clip!.id)?.name ?? layer.label) : layer.label;
    el.label.textContent = name;
    const said = { number: index + 1, name, from: tidy(window.from), to: tidy(window.to) };
    bindAttr(el.body, 'title', 'overlay-track.pip.title', said);
    bindAttr(el.body, 'aria-label', 'overlay-track.pip.aria-label', said);
    const selected = selectedLayer.value;
    el.root.classList.toggle('selected', selected?.block === block && selected.id === layer.id);
  });
  for (const [key, el] of els) {
    if (keep.has(key)) continue;
    el.root.remove();
    els.delete(key);
  }
}

function makePip(block: string, id: string): PipEl {
  const root = document.createElement('div');
  root.className = 'pip';
  root.dataset.block = block;
  root.dataset.layer = id;
  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'pip-body';
  const label = document.createElement('span');
  label.className = 'pip-label';
  body.append(label);
  root.append(body);
  // Choosing the clip here is choosing its layer: the stage's handles and the card follow.
  body.addEventListener('click', () => {
    selectedLayer.value = { block, id };
  });
  return { root, body, label };
}

function tidy(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

/**
 * A clip dropped on the lane becomes a video layer starting at the moment it
 * was dropped (milestone 57): its span is the clip's own length from there,
 * played once, at picture-in-picture size in the top right corner — where the
 * stage's handles take over. True when the lane took it.
 */
export function overlayTrackTakeDrop(id: string, time: number): boolean {
  const editor = layerEditor();
  const entry = appState.value.index?.media.find((m) => m.id === id);
  if (!editor || !entry || current.length <= 0) return false;
  const duration = entry.meta?.duration && entry.meta.duration > 0 ? entry.meta.duration : 2;
  const start = Math.round(Math.max(0, Math.min(current.length - 0.05, time)) * 1000) / 1000;
  const end = Math.round(Math.min(current.length, start + duration) * 1000) / 1000;
  const added = editor.addLayer('video', entry.name, id);
  if ('refused' in added) {
    say(added.refused);
    return true;
  }
  editor.edit(added.block, added.id, (layer) => {
    if (layer.type !== 'video' || !layer.clip) return layer;
    return {
      ...layer,
      size: PIP_SIZE,
      span: { start, end },
      placement: { default: { ...PIP_PLACE, scale: 1, rotate: 0 } },
      clip: { ...layer.clip, delay: start, ending: 'once' },
    };
  }, true);
  selectedLayer.value = { block: added.block, id: added.id };
  say(t('overlay-track.added', { name: entry.name, start: tidy(start) }));
  return true;
}

/** Mount the lane: its own drop target, ahead of the lanes' drop onto the cut track. */
export function mountOverlayTrack(el: HTMLDivElement, note: (text: string) => void): void {
  host = el;
  say = note;
  // What the empty lane says while a clip is dragged over it, from the message catalog.
  hint = document.createElement('span');
  hint.className = 'drop-hint';
  hint.hidden = true;
  bindText(hint, 'overlay-track.drop-hint');
  el.append(hint);
  // The lanes say when a clip comes over them and when it goes: the drag's types are readable
  // before the drop, and a clip is marked among them (CLIP_DRAG_TYPE, set where the drag starts).
  const lanes = el.parentElement;
  const setDragging = (next: boolean) => {
    if (dragging === next) return;
    dragging = next;
    if (last) overlayTrackUpdate(...last);
  };
  if (lanes) {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(CLIP_DRAG_TYPE)) setDragging(true);
    };
    lanes.addEventListener('dragenter', over);
    lanes.addEventListener('dragover', over);
    // Leaving for one of the lanes' own children is still over them; leaving them is not.
    lanes.addEventListener('dragleave', (e) => {
      const to = e.relatedTarget;
      if (!(to instanceof Node) || !lanes.contains(to)) setDragging(false);
    });
  }
  // However the drag ends — dropped here, on the cut track, anywhere, or given up — the lane goes,
  // unless it now holds the clip. Heard in capture, since the lane's own drop stops the event from
  // bubbling; acted on after it, since that drop measures the lane where the clip landed.
  for (const type of ['drop', 'dragend'] as const) document.addEventListener(type, () => setTimeout(() => setDragging(false), 0), true);
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(COLLECTION_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop-target');
  });
  for (const type of ['dragleave', 'dragend', 'drop'] as const) el.addEventListener(type, () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData(COLLECTION_DRAG_TYPE);
    if (!id || !host) return;
    const entry = appState.value.index?.media.find((m) => m.id === id);
    // Only a clip is a picture over the shots; anything else falls through to the lanes' own drop,
    // which says what it can take.
    if (!entry || entry.mediaKind !== 'video') return;
    e.preventDefault();
    e.stopPropagation();
    const rect = host.getBoundingClientRect();
    const time = ((e.clientX - rect.left) / Math.max(1, rect.width)) * current.length;
    overlayTrackTakeDrop(id, time);
  });
}
