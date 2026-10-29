/**
 * The stage region: the template preview with playback, the media preview, the
 * transport and the preview tools (loop, frame step, in and out marks, volume,
 * background and safe areas). Owns its elements and playback state; other
 * regions talk to it only through this API (show, clear, set parameters) and
 * through the shared `trim` signal, never through its DOM.
 *
 * What the controls mean lives in `src/core/player.ts`; the preferences they
 * set are kept in settings.json.
 */

import { templateDefaultSize } from '../core/aspect';
import { chosenImageIds, imageRequests, imageSlots } from '../core/image-slot';
import { blockStates, layerClipChoices, layerImageChoices, layerImageIds, type BlockState } from '../core/layer-layout';
import type { ClipSource, ClipValue } from '../core/video-layer';
import type { LayerValues } from '../core/layers';
import { effect } from '@preact/signals';
import type { MediaEntry, TemplateEntry } from '../core/library-types';
import { frameCount, type TemplateManifest } from '../core/manifest';
import type { ResolvedParams } from '../core/params';
import { mountStageDrop, mountStageLayers, stageLayersUpdate } from './stage-layers';
import { selectedLayer } from './layer-edit';
import type { LaidReport } from '../core/stage-place';
import { DEFAULT_PLAYER, markPercent, playheadAt, SAFE_AREAS, sanitizePlayer, steppedFrame, trimmedAway, VERTICAL_ZONES, verticalZonesFor, type PlayerState, type StageBackground } from '../core/player';
import { frameState } from '../core/runtime';
import { formatTimecode } from '../core/timecode';
import { mediaFrameUrlFor, mediaUrlFor, templateUrlFor } from '../shared/api';
import { setIcon } from './icons';
import { appState, frameSize, trim } from './store';
import { peaksFor, waveforms } from './waveforms';
import { waveformPath } from '../core/waveform';

/** Element by id. Typed as Element, not HTMLElement: the stage's waveform is an SVG. */
const $ = <T extends Element>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as unknown as T;
};

const els = {
  previewFrame: $<HTMLDivElement>('preview-frame'),
  preview: $<HTMLIFrameElement>('preview'),
  previewEmpty: $<HTMLDivElement>('preview-empty'),
  mediaVideo: $<HTMLVideoElement>('media-video'),
  mediaImage: $<HTMLImageElement>('media-image'),
  mediaAudio: $<HTMLAudioElement>('media-audio'),
  mediaWaveform: $<SVGSVGElement>('media-waveform'),
  play: $<HTMLButtonElement>('play'),
  stepBack: $<HTMLButtonElement>('step-back'),
  stepForward: $<HTMLButtonElement>('step-forward'),
  loop: $<HTMLButtonElement>('loop'),
  scrub: $<HTMLInputElement>('scrub'),
  timecode: $<HTMLSpanElement>('timecode'),
  note: $<HTMLParagraphElement>('stage-note'),
  trimBefore: $<HTMLSpanElement>('trim-before'),
  trimAfter: $<HTMLSpanElement>('trim-after'),
  markInFlag: $<HTMLSpanElement>('mark-in-flag'),
  markOutFlag: $<HTMLSpanElement>('mark-out-flag'),
  markIn: $<HTMLButtonElement>('mark-in'),
  markOut: $<HTMLButtonElement>('mark-out'),
  markClear: $<HTMLButtonElement>('mark-clear'),
  mute: $<HTMLButtonElement>('mute'),
  volume: $<HTMLInputElement>('volume'),
  bgCustom: $<HTMLInputElement>('bg-custom'),
  audition: $<HTMLButtonElement>('audition'),
  safeToggle: $<HTMLButtonElement>('safe-toggle'),
  layerOverlay: $<HTMLDivElement>('layer-overlay'),
  safeOverlay: $<HTMLDivElement>('safe-overlay'),
  safeAction: $<HTMLDivElement>('safe-action'),
  safeTitle: $<HTMLDivElement>('safe-title'),
  safeZones: $<HTMLDivElement>('safe-zones'),
};

const BACKGROUND_BUTTONS: Record<Exclude<StageBackground, 'custom'>, HTMLButtonElement> = {
  checker: $<HTMLButtonElement>('bg-checker'),
  black: $<HTMLButtonElement>('bg-black'),
  white: $<HTMLButtonElement>('bg-white'),
};

const s = {
  manifest: null as TemplateManifest | null,
  params: {} as ResolvedParams,
  /** The layer stacks the person built, or none: the template's own then (src/core/layers.ts). */
  layers: {} as LayerValues,
  frame: 0,
  playing: false,
  previewReady: false,
  /** The shape the box shows now, in any units; the vertical zones read it. */
  shape: { width: 16, height: 9 } as { width: number; height: number },
  inFlight: false,
  pendingFrame: null as number | null,
  /** Image slots (ADR 0013): the key of the images the page was last handed; frames wait while it changes. */
  imagesKey: '',
  imagesReady: true,
  prepareId: 0,
  /** What the host measured about each clip a video layer chose, by library id (milestone 26). */
  clipSources: {} as Record<string, ClipSource>,
  /** Preferences from settings.json: loop, background, safe areas, volume. */
  player: DEFAULT_PLAYER as PlayerState,
  /** The audio item on the stage, so its waveform can be drawn again when the peaks land. */
  audio: null as MediaEntry | null,
};

/** Change a preference, apply it and store it. */
function setPlayer(change: Partial<PlayerState>): void {
  const next = sanitizePlayer({ ...s.player, ...change });
  if (JSON.stringify(next) === JSON.stringify(s.player)) return;
  s.player = next;
  applyPlayer();
  void window.pulp.savePlayer(next);
}

/** Put the preferences on the elements: background, safe areas, loop, volume. */
function applyPlayer(): void {
  const p = s.player;
  els.loop.setAttribute('aria-pressed', String(p.loop));
  for (const [kind, button] of Object.entries(BACKGROUND_BUTTONS)) button.setAttribute('aria-pressed', String(p.background === kind));
  els.bgCustom.value = p.customBackground;
  els.bgCustom.classList.toggle('active', p.background === 'custom');
  // The checkerboard is a class so it keeps the stylesheet's pattern; the rest is one colour.
  els.previewFrame.classList.toggle('checker', p.background === 'checker');
  const solid = { checker: '', black: '#000000', white: '#ffffff', custom: p.customBackground }[p.background];
  els.previewFrame.style.backgroundColor = solid;
  els.audition.setAttribute('aria-pressed', String(p.audition));
  els.safeToggle.setAttribute('aria-pressed', String(p.safeAreas));
  els.safeOverlay.hidden = !p.safeAreas;
  for (const area of SAFE_AREAS) {
    const el = area.id === 'action' ? els.safeAction : els.safeTitle;
    el.style.inset = `${area.inset * 100}%`;
    el.title = area.label;
  }
  applyZones();
  els.volume.value = String(Math.round(p.volume * 100));
  els.mute.setAttribute('aria-pressed', String(p.muted));
  els.mute.setAttribute('aria-label', p.muted ? 'Unmute' : 'Mute');
  setIcon(els.mute, p.muted ? 'speaker-slash' : 'speaker-high', 20);
  for (const el of [els.mediaVideo, els.mediaAudio]) {
    el.volume = p.volume;
    el.muted = p.muted;
  }
}

/** The in and out marks over the scrub bar, and what a render would drop. */
function applyTrim(): void {
  const total = s.manifest ? frameCount(s.manifest) : 0;
  const { inFrame, outFrame } = trim.value;
  const away = trimmedAway(inFrame, outFrame, total);
  els.trimBefore.style.width = `${away.before}%`;
  els.trimAfter.style.width = `${away.after}%`;
  els.markInFlag.hidden = inFrame === null;
  els.markOutFlag.hidden = outFrame === null;
  if (inFrame !== null) els.markInFlag.style.left = `${markPercent(inFrame, total)}%`;
  if (outFrame !== null) els.markOutFlag.style.left = `${markPercent(outFrame, total)}%`;
  els.markClear.disabled = !s.manifest || (inFrame === null && outFrame === null);
}

function updateTransport(): void {
  const ready = Boolean(s.manifest) && s.previewReady;
  els.play.disabled = !ready;
  els.stepBack.disabled = !ready;
  els.stepForward.disabled = !ready;
  els.scrub.disabled = !s.manifest;
  // Marks are frames of a template's timeline; a media item has no render to trim.
  els.markIn.disabled = !s.manifest;
  els.markOut.disabled = !s.manifest;
  applyTrim();
}

function clearNote(): void {
  els.note.hidden = true;
  els.note.textContent = '';
}

function updateTimecode(frame: number): void {
  if (!s.manifest) {
    els.timecode.textContent = '--';
    return;
  }
  els.scrub.value = String(frame);
  els.timecode.textContent = `${formatTimecode(frame, s.manifest.fps)} · ${frame + 1}/${frameCount(s.manifest)}`;
}

/**
 * How long a frame may be in flight before the preview assumes the answer is
 * not coming and asks again. The page replies after two animation frames
 * (BRIDGE_SCRIPT), and **a frame with no room on screen runs no animation
 * frames at all** — collapse the stage, or squeeze it to nothing, and the
 * reply never arrives. Without this the one unanswered request would wedge
 * `inFlight` and the preview would never draw again, even once it had room
 * (docs/platform-notes.md, "Windows CI").
 */
const FRAME_REPLY_TIMEOUT_MS = 4000;
let replyWatchdog: ReturnType<typeof setTimeout> | undefined;

/** Stop waiting on the frame in flight: its reply has arrived, or there is nothing to wait for. */
function clearReplyWatchdog(): void {
  clearTimeout(replyWatchdog);
  replyWatchdog = undefined;
}

/** How many times the watchdog has let a frame go this session: a count that should stay at zero. */
let watchdogFired = 0;

/** The preview's state, readable from the DOM: what a failing test prints, and what a person can inspect. */
function noteFrameState(): void {
  els.previewFrame.dataset.frame = String(s.frame);
  els.previewFrame.dataset.inFlight = String(s.inFlight);
  els.previewFrame.dataset.pending = s.pendingFrame === null ? '' : String(s.pendingFrame);
  els.previewFrame.dataset.watchdog = String(watchdogFired);
}

function postFrame(frame: number): void {
  const win = els.preview.contentWindow;
  if (!win || !s.manifest) return;
  s.inFlight = true;
  clearReplyWatchdog();
  replyWatchdog = setTimeout(() => {
    // No reply: let go of the request and ask for the frame that matters now, so the preview
    // catches up by itself the moment it has room again.
    replyWatchdog = undefined;
    if (!s.inFlight) return;
    watchdogFired++;
    s.inFlight = false;
    const next = s.pendingFrame ?? s.frame;
    s.pendingFrame = null;
    requestFrame(next);
  }, FRAME_REPLY_TIMEOUT_MS);
  win.postMessage({ type: 'pulp:render', id: frame, state: frameState(s.manifest, frame, s.params, previewSize(), s.layers, s.clipSources) }, '*');
  updateTimecode(frame);
  noteFrameState();
}

/**
 * Before a frame can use an image slot, the page must have been handed the
 * chosen stills and have decoded them. Both happen here, once per change of
 * the choice, and frames hold until the page says it is prepared — so a frame
 * is never drawn with a half-loaded logo.
 */
function syncImages(): void {
  const win = els.preview.contentWindow;
  if (!s.manifest || !win) return;
  const size = previewSize();
  const slots = imageSlots(s.manifest.parameters, s.params, size);
  // The slots' images and the ones chosen for image layers are handed over together.
  const blocks = blockStates(s.manifest, s.layers, size);
  const layerIds = layerImageIds(blocks);
  const requests = [...imageRequests(slots), ...layerImageChoices(blocks).map((c) => ({ id: c.id, treatment: c.treatment, tint: c.tint }))]
    .filter((r, i, all) => all.findIndex((o) => o.id === r.id && o.treatment === r.treatment && o.tint === r.tint) === i);
  // The clips video layers chose, with how tall each is drawn here, so only that much is decoded.
  const clipRequests = layerClipChoices(blocks)
    .filter((c, i, all) => all.findIndex((o) => o.id === c.id) === i)
    .map((c) => ({ id: c.id, value: c as ClipValue, drawnHeight: clipDrawnHeight(blocks, c.id, size.height) }));
  const key = [
    ...requests.map((r) => `${r.id}|${r.treatment}|${r.tint}`),
    ...clipRequests.map((c) => `clip:${c.id}|${c.value.inPoint}|${c.value.outPoint}|${c.drawnHeight}`),
  ].sort().join(',');
  if (key === s.imagesKey) return;
  s.imagesKey = key;
  s.imagesReady = false;
  const id = ++s.prepareId;
  // The main process reads exactly the chosen stills and clips, and the page gets their bytes (ADR 0013).
  void Promise.all([
    window.pulp.loadSlotImages([...new Set([...chosenImageIds(slots), ...layerIds])]),
    clipRequests.length > 0 ? window.pulp.loadLayerClips(clipRequests) : Promise.resolve({ clips: [], sources: {}, missing: [] }),
  ]).then(([handed, clips]) => {
    if (id !== s.prepareId || !s.manifest || els.preview.contentWindow !== win) return;
    if (handed.missing.length > 0) {
      els.note.hidden = false;
      els.note.textContent = 'An image chosen for this template is not in the library; its slot shows the fallback.';
    } else if (clips.missing.length > 0) {
      els.note.hidden = false;
      els.note.textContent = 'A clip chosen for a layer could not be read; that layer draws nothing.';
    }
    s.clipSources = clips.sources;
    const srcById = new Map(handed.images.map((i) => [i.id, i.src]));
    win.postMessage({
      type: 'pulp:prepare',
      id,
      requests: [...requests.filter((r) => srcById.has(r.id)).map((r) => ({ ...r, src: srcById.get(r.id) })), ...clips.clips],
    }, '*');
  });
}

/** How tall, in preview pixels, the tallest layer using this clip is drawn: what to decode it at. */
function clipDrawnHeight(blocks: Record<string, BlockState>, clipId: string, frameHeight: number): number {
  let tallest = 0;
  for (const block of Object.values(blocks)) {
    for (const layer of block.layers) {
      if (layer.type !== 'video' || layer.clip?.id !== clipId) continue;
      tallest = Math.max(tallest, layer.size * Math.max(1, layer.placement?.scale ?? 1));
    }
  }
  return Math.max(16, Math.min(frameHeight, Math.round(tallest)));
}

/** Only one frame is in flight at a time; newer requests replace queued ones. */
function requestFrame(frame: number): void {
  s.frame = frame;
  if (!s.previewReady) return;
  syncImages();
  if (!s.imagesReady) {
    s.pendingFrame = frame;
    return;
  }
  if (s.inFlight) {
    s.pendingFrame = frame;
    return;
  }
  postFrame(frame);
}

let rafId = 0;
let playStart = 0;
let playStartFrame = 0;

function tick(now: number): void {
  if (!s.playing || !s.manifest) return;
  const total = frameCount(s.manifest);
  const frame = playheadAt(playStartFrame, now - playStart, s.manifest.fps, total, s.player.loop);
  if (frame === null) {
    // The end, with looping off: stop on the last frame rather than snapping back.
    requestFrame(total - 1);
    stageStop();
    return;
  }
  if (frame !== s.frame) requestFrame(frame);
  rafId = requestAnimationFrame(tick);
}

function play(): void {
  if (!s.manifest || !s.previewReady) return;
  // Starting from the last frame with looping off would stop at once; begin again instead.
  if (!s.player.loop && s.frame >= frameCount(s.manifest) - 1) s.frame = 0;
  s.playing = true;
  playStart = performance.now();
  playStartFrame = s.frame;
  setIcon(els.play, 'pause', 24);
  els.play.setAttribute('aria-label', 'Pause');
  rafId = requestAnimationFrame(tick);
}

/** Escape from the results: stop the preview, whichever kind it is. */
export function stopPlayback(): void {
  stageStop();
  for (const el of [els.mediaVideo, els.mediaAudio]) if (!el.paused) el.pause();
}

export function stageStop(): void {
  s.playing = false;
  cancelAnimationFrame(rafId);
  setIcon(els.play, 'play', 24);
  els.play.setAttribute('aria-label', 'Play');
}

function clearMediaPreview(): void {
  for (const el of [els.mediaVideo, els.mediaAudio]) {
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.hidden = true;
  }
  els.mediaImage.removeAttribute('src');
  els.mediaImage.hidden = true;
  els.mediaWaveform.setAttribute('hidden', '');
  s.audio = null;
}

/**
 * The waveform behind an audio item's transport. Peaks arrive after the file is
 * shown, so this runs again when they land; until then the box is simply empty.
 */
function drawWaveform(entry: MediaEntry): void {
  const peaks = peaksFor(entry);
  const path = els.mediaWaveform.querySelector('path');
  if (!peaks || peaks.length === 0 || !path) {
    els.mediaWaveform.setAttribute('hidden', '');
    return;
  }
  path.setAttribute('d', waveformPath(peaks, 1000, 200));
  els.mediaWaveform.removeAttribute('hidden');
}

/** Load a template and show the frame at mid-progress, the frame the thumbnails use. */
export function stageShowTemplate(entry: TemplateEntry, params: ResolvedParams, layers: LayerValues = {}): void {
  stageStop();
  clearMediaPreview();
  clearNote();
  // A different template is a different stack: nothing stays selected across the change.
  selectedLayer.value = null;
  stageLayersUpdate(null);
  const m = entry.manifest;
  s.manifest = m;
  s.params = params;
  s.layers = layers;
  s.frame = Math.floor(frameCount(m) / 2);
  s.previewReady = false;
  s.inFlight = false;
  clearReplyWatchdog();
  s.pendingFrame = null;
  s.imagesKey = '';
  s.imagesReady = true;
  applyPreviewShape();
  if (entry.offline) {
    // The folder is not reachable; keep the item (and its edits) but do not try to load it.
    els.preview.removeAttribute('src');
    els.previewEmpty.textContent = 'This template\'s folder is offline. It will load again when the folder is back.';
    els.previewEmpty.hidden = false;
  } else {
    els.previewEmpty.hidden = true;
    els.preview.src = templateUrlFor(m.id, m.entry);
  }
  els.scrub.max = String(frameCount(m) - 1);
  els.scrub.value = String(s.frame);
  updateTransport();
}

/** Show a media item, served by id through pulp-media://. */
export function stageShowMedia(entry: MediaEntry): void {
  // Volume and mute are the player's, not each file's.
  applyPlayer();
  if (entry.offline) {
    els.previewEmpty.textContent = 'This file\'s folder is offline.';
    return;
  }
  els.previewEmpty.hidden = true;
  const url = mediaUrlFor(entry.id);
  const fit = (w: number, h: number) => {
    if (w > 0 && h > 0) setPreviewShape(w, h);
  };
  if (entry.sequence) {
    // A frame sequence is a clip made of image files: <video> cannot play one, so the stage
    // shows a frame. Stepping through them belongs with Video layers, which decodes a clip
    // for the template's own time (milestone 26); until then this is its first frame.
    els.mediaImage.hidden = false;
    els.mediaImage.onload = () => fit(els.mediaImage.naturalWidth, els.mediaImage.naturalHeight);
    els.mediaImage.src = mediaFrameUrlFor(entry.id, 0);
  } else if (entry.mediaKind === 'video') {
    els.mediaVideo.hidden = false;
    els.mediaVideo.onloadedmetadata = () => fit(els.mediaVideo.videoWidth, els.mediaVideo.videoHeight);
    els.mediaVideo.src = url;
  } else if (entry.mediaKind === 'image') {
    els.mediaImage.hidden = false;
    els.mediaImage.onload = () => fit(els.mediaImage.naturalWidth, els.mediaImage.naturalHeight);
    els.mediaImage.src = url;
  } else {
    setPreviewShape(16, 9);
    els.mediaAudio.hidden = false;
    els.mediaAudio.src = url;
    s.audio = entry;
    drawWaveform(entry);
    // Audition mode: picking a sound plays it, so a list can be heard by arrowing through it.
    if (s.player.audition) void els.mediaAudio.play().catch(() => undefined);
  }
}

/** Empty stage: nothing selected. */
export function stageClear(): void {
  s.manifest = null;
  s.previewReady = false;
  selectedLayer.value = null;
  stageLayersUpdate(null);
  // Marks belong to a template's timeline; nothing selected means nothing marked.
  trim.value = { inFrame: null, outFrame: null };
  stageStop();
  els.preview.removeAttribute('src');
  clearMediaPreview();
  clearNote();
  els.previewEmpty.textContent = 'Select a template';
  els.previewEmpty.hidden = false;
  updateTransport();
}

/** The size the template is drawn at: the Output tab's choice, else the template's default. */
function previewSize(): { width: number; height: number } {
  return frameSize.value ?? (s.manifest ? templateDefaultSize(s.manifest) : { width: 1920, height: 1080 });
}

/** The box takes a shape; the vertical zones follow, since they belong to tall frames only. */
function setPreviewShape(width: number, height: number): void {
  els.previewFrame.style.aspectRatio = `${width} / ${height}`;
  // The stylesheet sizes the box from its container with this ratio, so it is never stretched (styles.css, .preview).
  els.previewFrame.style.setProperty('--preview-ar', String(width / height));
  els.previewFrame.dataset.orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait';
  s.shape = { width, height };
  applyZones();
}

/** The preview box takes the chosen shape, so a tall render is previewed tall. */
function applyPreviewShape(): void {
  const size = previewSize();
  setPreviewShape(size.width, size.height);
}

/**
 * The vertical zones: shown with the safe areas, and only while the shown shape
 * is tall. Each zone is a fraction of the frame, so it holds at any size.
 */
function applyZones(): void {
  const zones = verticalZonesFor(s.shape.width, s.shape.height);
  els.safeZones.hidden = zones.length === 0;
  for (const zone of VERTICAL_ZONES) {
    const el = els.safeZones.querySelector<HTMLElement>(`[data-zone="${zone.id}"]`);
    if (!el) continue;
    el.style.left = `${zone.left * 100}%`;
    el.style.top = `${zone.top * 100}%`;
    el.style.width = `${zone.width * 100}%`;
    el.style.height = `${zone.height * 100}%`;
    el.title = zone.label;
  }
}

/** New parameter values (edit, undo, preset): redraw the current frame with them. */
export function stageSetParams(params: ResolvedParams, layers: LayerValues = {}): void {
  s.params = params;
  s.layers = layers;
  requestFrame(s.frame);
}

/** Move by whole frames; stepping stops playback, as scrubbing does. */
function step(delta: number): void {
  if (!s.manifest) return;
  stageStop();
  requestFrame(steppedFrame(s.frame, delta, frameCount(s.manifest), s.player.loop));
}

export function initStage(): void {
  // The Output tab's aspect or resolution changed: reshape the box and draw the frame for the new canvas.
  effect(() => {
    void frameSize.value;
    if (!s.manifest) return;
    applyPreviewShape();
    requestFrame(s.frame);
  });
  els.play.addEventListener('click', () => (s.playing ? stageStop() : play()));
  els.stepBack.addEventListener('click', () => step(-1));
  els.stepForward.addEventListener('click', () => step(1));
  els.loop.addEventListener('click', () => setPlayer({ loop: !s.player.loop }));
  els.scrub.addEventListener('input', () => {
    stageStop();
    requestFrame(Number(els.scrub.value));
  });

  // In and out marks write the Output tab's trim through the shared signal, and
  // follow it when it is edited there.
  els.markIn.addEventListener('click', () => {
    trim.value = { ...trim.value, inFrame: s.frame };
  });
  els.markOut.addEventListener('click', () => {
    trim.value = { ...trim.value, outFrame: s.frame };
  });
  els.markClear.addEventListener('click', () => {
    trim.value = { inFrame: null, outFrame: null };
  });
  effect(() => {
    void trim.value;
    applyTrim();
  });

  els.mute.addEventListener('click', () => setPlayer({ muted: !s.player.muted }));
  // <video> and <audio> carry their own volume control; what the user does there is the preference too.
  for (const el of [els.mediaVideo, els.mediaAudio]) {
    el.addEventListener('volumechange', () => setPlayer({ volume: el.volume, muted: el.muted }));
  }
  els.volume.addEventListener('input', () => setPlayer({ volume: Number(els.volume.value) / 100, muted: false }));
  for (const [kind, button] of Object.entries(BACKGROUND_BUTTONS)) {
    button.addEventListener('click', () => setPlayer({ background: kind as StageBackground }));
  }
  els.bgCustom.addEventListener('input', () => setPlayer({ background: 'custom', customBackground: els.bgCustom.value }));
  els.safeToggle.addEventListener('click', () => setPlayer({ safeAreas: !s.player.safeAreas }));
  mountStageLayers(els.layerOverlay, { frameSize: () => previewSize() });
  // Dropping a picture or a clip from the results makes it a layer where it was dropped
  // (milestone 26). The preview frame takes the drop, not the overlay, which stands aside
  // when a template has no layers yet — which is exactly when a first drop is likely.
  mountStageDrop(
    els.previewFrame,
    { frameSize: () => previewSize() },
    (id) => {
      const entry = appState.value.index?.media.find((m) => m.id === id);
      if (!entry || entry.offline) return null;
      const kind = entry.mediaKind === 'image' ? 'image' : entry.mediaKind === 'video' ? 'video' : 'other';
      return { kind, name: entry.name };
    },
    (text) => {
      els.note.hidden = false;
      els.note.textContent = text;
    },
  );
  els.audition.addEventListener('click', () => setPlayer({ audition: !s.player.audition }));

  // Peaks arrive after the file is shown; redraw the one on screen when they do.
  effect(() => {
    void waveforms.value;
    const shown = s.audio;
    if (shown) drawWaveform(shown);
  });

  applyPlayer();
  void window.pulp.getPlayer().then((saved) => {
    s.player = saved;
    applyPlayer();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== els.preview.contentWindow) return;
    const data = event.data as { type?: string; message?: string };
    if (data?.type === 'pulp:ready') {
      s.previewReady = true;
      s.inFlight = false;
      clearReplyWatchdog();
      requestFrame(s.frame);
      updateTransport();
    } else if (data?.type === 'pulp:prepared') {
      if ((data as { id?: number }).id !== s.prepareId) return;
      s.imagesReady = true;
      if (data.message) {
        els.note.hidden = false;
        els.note.textContent = `Image slot: ${data.message}`;
      }
      if (s.pendingFrame !== null) {
        const next = s.pendingFrame;
        s.pendingFrame = null;
        requestFrame(next);
      }
    } else if (data?.type === 'pulp:rendered' || data?.type === 'pulp:error') {
      s.inFlight = false;
      clearReplyWatchdog();
      noteFrameState();
      if (data.type === 'pulp:rendered') stageLayersUpdate((data as { laid?: LaidReport }).laid ?? null);
      if (data.type === 'pulp:error') {
        els.note.hidden = false;
        els.note.textContent = `Template error: ${data.message ?? 'unknown'}`;
      }
      if (s.pendingFrame !== null) {
        const next = s.pendingFrame;
        s.pendingFrame = null;
        postFrame(next);
      }
    }
  });
  updateTransport();
}
