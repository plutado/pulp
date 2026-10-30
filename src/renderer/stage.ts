/**
 * The player: the stage region — the picture, with the background toggle and
 * the safe areas, the only chrome it keeps (milestone 37) — and the transport
 * row across the bottom of the window that plays and scrubs it (play, frame
 * step, loop, in and out marks, timecode, volume, the scrub bar with a bar per
 * layer under it). Two regions in the layout, one playhead: a template is
 * drawn a frame at a time by its page, a frame sequence by index, a clip or a
 * sound by its media element, and every one of them is counted, stepped and
 * marked by the same row. Owns its elements and playback state; other regions
 * talk to it only through this API (show, clear, set parameters) and through
 * the shared `trim` and `transport` signals, never through its DOM.
 *
 * What the controls mean lives in `src/core/player.ts`; the preferences they
 * set are kept in settings.json.
 */

import { templateDefaultSize } from '../core/aspect';
import { imageGrantKey, imageGrantRequests, imageRequestKey, imageRequests, imageSlots } from '../core/image-slot';
import { blockStates, layerClipChoices, layerImageChoices, type BlockState } from '../core/layer-layout';
import { clipProxySize, type ClipSource, type ClipValue } from '../core/video-layer';
import type { LayerValues } from '../core/layers';
import { effect } from '@preact/signals';
import type { MediaEntry, TemplateEntry } from '../core/library-types';
import type { TemplateManifest } from '../core/manifest';
import { mediaDefaultFps } from '../core/media-render';
import { SEQUENCE_FPS } from '../core/media-sequence';
import { lengthFrameCount, lengthParts, MAX_LENGTH_SECONDS, minimumLength, resolveLength } from '../core/timing';
import type { ResolvedParams } from '../core/params';
import { mountStageDrop, mountStageLayers, stageLayersUpdate } from './stage-layers';
import { layerBarsUpdate, mountLayerBars } from './stage-bars';
import { layerEditor, selectedLayer } from './layer-edit';
import type { LaidReport } from '../core/stage-place';
import { DEFAULT_PLAYER, markPercent, playheadAt, SAFE_AREAS, sanitizePlayer, steppedFrame, trimmedAway, VERTICAL_ZONES, verticalZonesFor, type PlayerState, type StageBackground } from '../core/player';
import { frameState } from '../core/runtime';
import { formatTimecode } from '../core/timecode';
import { mediaFrameUrlFor, mediaUrlFor, templateUrlFor } from '../shared/api';
import { psdCompositeUrlFor } from '../core/media-url';
import { isPsdEntry, psdHidden } from './psd-state';
import { setIcon } from './icons';
import { appState, frameSize, transport, trim } from './store';
import { peaksFor, waveforms } from './waveforms';
import { waveformPath } from '../core/waveform';

/** Element by id. Typed as Element, not HTMLElement: the stage's waveform is an SVG. */
const $ = <T extends Element>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as unknown as T;
};

const els = {
  /** The transport row (milestone 37): told what kind of thing is shown, so a still can hide the scrub bar. */
  row: $<HTMLElement>('region-transport'),
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
  partEntrance: $<HTMLSpanElement>('part-entrance'),
  partHold: $<HTMLSpanElement>('part-hold'),
  partExit: $<HTMLSpanElement>('part-exit'),
  lengthHandle: $<HTMLButtonElement>('length-handle'),
  sequenceRate: $<HTMLSpanElement>('sequence-rate'),
  sequenceFps: $<HTMLInputElement>('sequence-fps'),
  sequenceFpsReset: $<HTMLButtonElement>('sequence-fps-reset'),
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
  /** Seconds the graphic runs for, when a length has been chosen (milestone 30). */
  length: undefined as number | undefined,
  /**
   * A frame sequence being previewed on its own (milestone 30): a folder of
   * numbered frames has no video element to play it, so the stage steps it
   * through the same transport a template uses.
   */
  sequence: null as { entry: MediaEntry; frames: number; fps: number } | null,
  /**
   * A clip or a sound on the stage (milestone 37): its element plays it, and
   * the transport row counts it in frames at the rate the Output tab trims it
   * at, so a mark on the bar is the frame the field shows. `frames` is 0 until
   * the metadata has arrived.
   */
  media: null as { el: HTMLMediaElement; fps: number; frames: number } | null,
  /** A still is shown: nothing to play, so the row shows no scrub bar and keeps its place. */
  still: false,
  /** Preferences from settings.json: loop, background, safe areas, volume. */
  player: DEFAULT_PLAYER as PlayerState,
  /** The audio item on the stage, so its waveform can be drawn again when the peaks land. */
  audio: null as MediaEntry | null,
  /** The layered file on the stage (milestone 33), so its picture follows the layers shown or hidden. */
  psd: null as MediaEntry | null,
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
  publishTransport();
  els.volume.value = String(Math.round(p.volume * 100));
  els.mute.setAttribute('aria-pressed', String(p.muted));
  els.mute.setAttribute('aria-label', p.muted ? 'Unmute' : 'Mute');
  setIcon(els.mute, p.muted ? 'speaker-slash' : 'speaker-high', 20);
  for (const el of [els.mediaVideo, els.mediaAudio]) {
    el.volume = p.volume;
    el.muted = p.muted;
    // The row's loop toggle is the one loop: a clip or a sound comes round at its end as a template does.
    el.loop = p.loop;
  }
}

/**
 * Frames the preview holds: the chosen length's, or the template's own when
 * no length was chosen or nothing may stretch (milestone 30). Every count on
 * the stage goes through here, so the scrub bar, the transport and the
 * timecode all agree with what a render would write.
 */
function previewFrames(): number {
  if (s.sequence) return s.sequence.frames;
  if (s.media) return s.media.frames;
  if (!s.manifest) return 0;
  return lengthFrameCount(resolveLength(s.manifest.duration, s.manifest.structure ?? null, s.length), s.manifest.fps);
}

/** The rate the transport runs at: the template's, or the rate a sequence is read at. */
function previewFps(): number {
  if (s.sequence) return s.sequence.fps;
  if (s.media) return s.media.fps;
  return s.manifest?.fps ?? SEQUENCE_FPS;
}

/** Is there something the transport can step through — a template, a sequence, a clip or a sound? */
function hasTimeline(): boolean {
  return Boolean(s.manifest || s.sequence || s.media);
}

/**
 * The parts of the graphic shaded over the scrub bar, and the handle that sets
 * its length (milestone 30). Only a template that declares what may stretch
 * has parts to show; for every other the bar is as it always was.
 */
/** The rate control, shown only while a frame sequence is being previewed (milestone 30). */
function applySequenceRate(): void {
  const seq = s.sequence;
  els.sequenceRate.hidden = !seq;
  if (!seq) return;
  els.sequenceFps.value = String(seq.fps);
  els.sequenceFpsReset.hidden = seq.fps === SEQUENCE_FPS;
}

/** Read a sequence at another rate, kept with the item; `undefined` is Pulp's stated default. */
function setSequenceFps(fps: number | undefined): void {
  const seq = s.sequence;
  if (!seq) return;
  const next = fps === undefined ? SEQUENCE_FPS : Math.min(240, Math.max(1, Math.round(fps)));
  s.sequence = { ...seq, fps: next };
  // The count does not change, so the playhead stays where it is; only the pace does.
  applySequenceRate();
  updateTimecode(s.frame);
  void window.pulp.setItemSequenceFps(seq.entry.id, fps === undefined ? undefined : next);
}

function applyParts(): void {
  const structure = s.manifest?.structure;
  const hasParts = Boolean(s.manifest && structure);
  for (const el of [els.partEntrance, els.partHold, els.partExit]) el.hidden = !hasParts;
  els.lengthHandle.hidden = !hasParts;
  if (!hasParts || !s.manifest || !structure) return;
  const duration = s.manifest.duration;
  const length = resolveLength(duration, structure, s.length);
  const parts = lengthParts(duration, structure, length);
  const pct = (seconds: number) => `${(seconds / Math.max(0.001, length)) * 100}%`;
  els.partEntrance.style.left = '0';
  els.partEntrance.style.width = pct(parts.entrance);
  els.partHold.style.left = pct(parts.holdFrom);
  els.partHold.style.width = pct(parts.holdTo - parts.holdFrom);
  els.partExit.style.left = pct(parts.holdTo);
  els.partExit.style.width = pct(length - parts.holdTo);
  // The handle sits at the graphic's end, which is what dragging it moves.
  els.lengthHandle.style.left = '100%';
  els.lengthHandle.setAttribute('aria-valuemin', String(minimumLength(structure, duration)));
  els.lengthHandle.setAttribute('aria-valuemax', String(MAX_LENGTH_SECONDS));
  els.lengthHandle.setAttribute('aria-valuenow', String(length));
  els.lengthHandle.setAttribute('aria-valuetext', `${length} seconds`);
}

/** The in and out marks over the scrub bar, and what a render would drop. */
function applyTrim(): void {
  const total = previewFrames();
  const { inFrame, outFrame } = trim.value;
  const away = trimmedAway(inFrame, outFrame, total);
  els.trimBefore.style.width = `${away.before}%`;
  els.trimAfter.style.width = `${away.after}%`;
  els.markInFlag.hidden = inFrame === null;
  els.markOutFlag.hidden = outFrame === null;
  if (inFrame !== null) els.markInFlag.style.left = `${markPercent(inFrame, total)}%`;
  if (outFrame !== null) els.markOutFlag.style.left = `${markPercent(outFrame, total)}%`;
  els.markClear.disabled = !hasTimeline() || (inFrame === null && outFrame === null);
  applyParts();
  applySequenceRate();
  applyLayerBars();
}

/** The bars under the scrub bar (milestone 28): the layers of the template being previewed, at its length. */
function applyLayerBars(): void {
  layerBarsUpdate(s.manifest, s.layers, s.length, Boolean(s.manifest) && !s.sequence);
}

function updateTransport(): void {
  // A template once its page is ready, a sequence at once, a clip or a sound once its length is known.
  const ready = (Boolean(s.manifest) && s.previewReady) || Boolean(s.sequence) || Boolean(s.media && s.media.frames > 0);
  els.play.disabled = !ready;
  els.stepBack.disabled = !ready;
  els.stepForward.disabled = !ready;
  els.scrub.disabled = !hasTimeline();
  // Marks are frames of whatever has a timeline: the Output tab trims a media render too (milestone 15).
  els.markIn.disabled = !hasTimeline();
  els.markOut.disabled = !hasTimeline();
  // Nothing chosen, or nothing that plays: the row stays in place, disabled; a still shows no scrub bar.
  els.row.classList.toggle('still', s.still);
  if (!hasTimeline()) updateTimecode(0);
  applyTrim();
  publishTransport();
}

/**
 * What the transport can do, for anyone outside the stage who follows it — the
 * application menu's Playback items. A preview becoming ready changes nothing
 * else in the window, so without saying so here nothing would know it had.
 */
function publishTransport(): void {
  const next = { canPlay: !els.play.disabled, playing: s.playing, loop: s.player.loop };
  const now = transport.value;
  if (now.canPlay === next.canPlay && now.playing === next.playing && now.loop === next.loop) return;
  transport.value = next;
}

function clearNote(): void {
  els.note.hidden = true;
  els.note.textContent = '';
}

function updateTimecode(frame: number): void {
  if (!hasTimeline()) {
    els.timecode.textContent = '--';
    return;
  }
  els.scrub.value = String(frame);
  els.timecode.textContent = `${formatTimecode(frame, previewFps())} · ${frame + 1}/${previewFrames()}`;
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
  win.postMessage({ type: 'pulp:render', id: frame, state: frameState(s.manifest, frame, s.params, previewSize(), s.layers, s.clipSources, s.length) }, '*');
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
  const requests = [...imageRequests(slots), ...layerImageChoices(blocks).map((c) => ({ id: c.id, treatment: c.treatment, tint: c.tint, ...(c.psd ? { psd: c.psd } : {}) }))]
    .filter((r, i, all) => all.findIndex((o) => imageRequestKey(o) === imageRequestKey(r)) === i);
  // The clips video layers chose, with how tall each is drawn here, so only that much is decoded.
  const clipRequests = layerClipChoices(blocks)
    .filter((c, i, all) => all.findIndex((o) => o.id === c.id) === i)
    .map((c) => ({ id: c.id, value: c as ClipValue, drawnHeight: clipDrawnHeight(blocks, c.id, size.height) }));
  const key = [
    ...requests.map((r) => imageRequestKey(r)),
    // The proxy step, not the exact height: a window nudged a few pixels wider asks for the
    // same frames, so nothing is decoded again for it (milestone 26).
    ...clipRequests.map((c) => `clip:${c.id}|${c.value.inPoint}|${c.value.outPoint}|${clipProxySize(c.drawnHeight * 2)}`),
  ].sort().join(',');
  if (key === s.imagesKey) return;
  s.imagesKey = key;
  s.imagesReady = false;
  const id = ++s.prepareId;
  // The main process reads exactly the chosen stills and clips, and the page gets their bytes (ADR 0013).
  void Promise.all([
    window.pulp.loadSlotImages(imageGrantRequests(requests)),
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
    const srcByKey = new Map(handed.images.map((i) => [i.key, i.src]));
    win.postMessage({
      type: 'pulp:prepare',
      id,
      requests: [...requests.filter((r) => srcByKey.has(imageGrantKey(r))).map((r) => ({ ...r, src: srcByKey.get(imageGrantKey(r)) })), ...clips.clips],
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
  if (s.sequence) {
    // No page to ask and no bridge to wait for: the frame is a file, served by index.
    const at = Math.max(0, Math.min(s.sequence.frames - 1, frame));
    els.mediaImage.src = mediaFrameUrlFor(s.sequence.entry.id, at);
    els.scrub.value = String(at);
    updateTimecode(at);
    return;
  }
  if (s.media) {
    // The element holds the picture; the row only tells it where to be.
    const at = Math.max(0, Math.min(Math.max(0, s.media.frames - 1), frame));
    s.frame = at;
    if (s.media.frames > 0) s.media.el.currentTime = at / s.media.fps;
    updateTimecode(at);
    return;
  }
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
  if (!s.playing || !hasTimeline()) return;
  if (s.media) {
    // The element keeps its own time; the row follows it, and learns the length if it arrived late.
    const el = s.media.el;
    if (s.media.frames === 0 && Number.isFinite(el.duration) && el.duration > 0) setMediaLength(el.duration);
    const total = previewFrames();
    const frame = Math.min(Math.max(0, total - 1), Math.floor(el.currentTime * s.media.fps));
    if (frame !== s.frame) {
      s.frame = frame;
      updateTimecode(frame);
    }
    rafId = requestAnimationFrame(tick);
    return;
  }
  const total = previewFrames();
  const frame = playheadAt(playStartFrame, now - playStart, previewFps(), total, s.player.loop);
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
  if (!hasTimeline() || (s.manifest && !s.previewReady)) return;
  if (s.media) {
    // The element plays; its own play and pause events put the row in step (startFollowing).
    if (!s.player.loop && s.media.frames > 0 && s.frame >= s.media.frames - 1) s.media.el.currentTime = 0;
    void s.media.el.play().catch(() => undefined);
    return;
  }
  // Starting from the last frame with looping off would stop at once; begin again instead.
  if (!s.player.loop && s.frame >= previewFrames() - 1) s.frame = 0;
  s.playing = true;
  playStart = performance.now();
  playStartFrame = s.frame;
  setIcon(els.play, 'pause', 24);
  els.play.setAttribute('aria-label', 'Pause');
  publishTransport();
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
  publishTransport();
  if (s.media && !s.media.el.paused) s.media.el.pause();
}

/** A clip or a sound began playing — by the row, or by audition: the row follows its time. */
function startFollowing(el: HTMLMediaElement): void {
  if (s.media?.el !== el) return;
  s.playing = true;
  setIcon(els.play, 'pause', 24);
  els.play.setAttribute('aria-label', 'Pause');
  publishTransport();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

/** The clip or the sound stopped, at its end with looping off or by the row: the row shows it stopped. */
function stopFollowing(el: HTMLMediaElement): void {
  if (s.media?.el !== el || !s.playing) return;
  stageStop();
}

/** The length of the clip or the sound on the stage has arrived: the row can count it now. */
function setMediaLength(seconds: number): void {
  if (!s.media || !Number.isFinite(seconds) || seconds <= 0) return;
  s.media.frames = Math.max(1, Math.round(seconds * s.media.fps));
  els.scrub.max = String(s.media.frames - 1);
  updateTimecode(Math.min(s.frame, s.media.frames - 1));
  updateTransport();
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
  // A sequence's transport belongs to the sequence; nothing shown, nothing to step.
  s.sequence = null;
  s.media = null;
  s.still = false;
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
  s.frame = Math.floor(previewFrames() / 2);
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
  els.scrub.max = String(previewFrames() - 1);
  els.scrub.value = String(s.frame);
  updateTransport();
  applyLayerBars();
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
    // A frame sequence is a clip made of image files, and <video> cannot play one — so the
    // stage steps it itself, through the same transport a template uses (milestone 30).
    els.mediaImage.hidden = false;
    els.mediaImage.onload = () => fit(els.mediaImage.naturalWidth, els.mediaImage.naturalHeight);
    s.sequence = { entry, frames: entry.sequence.count, fps: entry.meta?.fps ?? SEQUENCE_FPS };
    s.frame = 0;
    els.scrub.max = String(Math.max(0, entry.sequence.count - 1));
    updateTransport();
    requestFrame(0);
  } else if (entry.mediaKind === 'video') {
    // The element draws the clip; the transport row plays, steps and scrubs it (milestone 37), counting
    // frames at the rate the Output tab trims it at.
    els.mediaVideo.hidden = false;
    s.media = { el: els.mediaVideo, fps: mediaDefaultFps(entry), frames: 0 };
    s.frame = 0;
    els.scrub.max = '0';
    els.mediaVideo.onloadedmetadata = () => {
      fit(els.mediaVideo.videoWidth, els.mediaVideo.videoHeight);
      setMediaLength(els.mediaVideo.duration);
    };
    els.mediaVideo.src = url;
    updateTransport();
  } else if (isPsdEntry(entry)) {
    // A layered file is shown composited by the main process, with the layers the Info tab hides left out.
    els.mediaImage.hidden = false;
    els.mediaImage.onload = () => fit(els.mediaImage.naturalWidth, els.mediaImage.naturalHeight);
    s.psd = entry;
    s.still = true;
    els.mediaImage.src = psdCompositeUrlFor(entry.id, psdHidden.peek()[entry.id] ?? []);
    updateTransport();
  } else if (entry.mediaKind === 'image') {
    els.mediaImage.hidden = false;
    els.mediaImage.onload = () => fit(els.mediaImage.naturalWidth, els.mediaImage.naturalHeight);
    s.still = true;
    els.mediaImage.src = url;
    updateTransport();
  } else {
    setPreviewShape(16, 9);
    els.mediaAudio.hidden = false;
    s.media = { el: els.mediaAudio, fps: mediaDefaultFps(entry), frames: 0 };
    s.frame = 0;
    els.scrub.max = '0';
    els.mediaAudio.onloadedmetadata = () => setMediaLength(els.mediaAudio.duration);
    els.mediaAudio.src = url;
    s.audio = entry;
    drawWaveform(entry);
    updateTransport();
    // Audition mode: picking a sound plays it, so a list can be heard by arrowing through it.
    if (s.player.audition) play();
  }
}

/** Empty stage: nothing selected. */
export function stageClear(): void {
  s.manifest = null;
  s.psd = null;
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
  applyLayerBars();
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

/**
 * Dragging the graphic's end on the scrub bar (milestone 30). The bar's scale
 * at the moment the drag began sets how far a pixel goes, so the length
 * follows the pointer at the rate the bar was showing — a bar that rescales
 * under a drag that is changing its scale would chase itself.
 */
let lengthDrag: { pointerId: number; from: number; startX: number; secondsPerPx: number } | null = null;

function lengthFloor(): number {
  const structure = s.manifest?.structure;
  return s.manifest && structure ? minimumLength(structure, s.manifest.duration) : 0;
}

/** Set the length from the handle, clamped, and tell the Parameters tab so undo and presets carry it. */
function setLengthFromHandle(seconds: number, commit: boolean): void {
  if (!s.manifest) return;
  const wanted = Math.min(MAX_LENGTH_SECONDS, Math.max(lengthFloor(), Math.round(seconds * 10) / 10));
  // Back at the template's own length, there is nothing to remember.
  const next = wanted === s.manifest.duration ? undefined : wanted;
  layerEditor()?.setLength(next, commit);
}

function onLengthPointerDown(e: PointerEvent): void {
  if (!s.manifest || e.button !== 0) return;
  const width = els.scrub.getBoundingClientRect().width;
  const length = resolveLength(s.manifest.duration, s.manifest.structure ?? null, s.length);
  lengthDrag = { pointerId: e.pointerId, from: length, startX: e.clientX, secondsPerPx: length / Math.max(1, width) };
  try {
    els.lengthHandle.setPointerCapture(e.pointerId);
  } catch {
    // Not a capturable pointer (a test's synthetic one): the drag still works over the handle.
  }
  e.preventDefault();
}

function onLengthPointerMove(e: PointerEvent): void {
  if (!lengthDrag || e.pointerId !== lengthDrag.pointerId) return;
  setLengthFromHandle(lengthDrag.from + (e.clientX - lengthDrag.startX) * lengthDrag.secondsPerPx, false);
}

function onLengthPointerUp(e: PointerEvent): void {
  if (!lengthDrag || e.pointerId !== lengthDrag.pointerId) return;
  const finished = lengthDrag;
  lengthDrag = null;
  // One undo step for the gesture, whatever it passed through on the way.
  setLengthFromHandle(finished.from + (e.clientX - finished.startX) * finished.secondsPerPx, true);
}

/** The handle is a slider, so the arrows move it: a tenth of a second, or a second with Shift. */
function onLengthKeyDown(e: KeyboardEvent): void {
  if (!s.manifest) return;
  const step = e.shiftKey ? 1 : 0.1;
  const moves: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
  const move = moves[e.key];
  if (move === undefined) return;
  const length = resolveLength(s.manifest.duration, s.manifest.structure ?? null, s.length);
  setLengthFromHandle(length + move, true);
  e.preventDefault();
}

/** New parameter values (edit, undo, preset): redraw the current frame with them. */
export function stageSetParams(params: ResolvedParams, layers: LayerValues = {}, length?: number): void {
  s.params = params;
  s.layers = layers;
  // A new length changes how many frames there are, so the scrub bar and the playhead follow it.
  if (length !== s.length) {
    s.length = length;
    const last = Math.max(0, previewFrames() - 1);
    els.scrub.max = String(last);
    if (s.frame > last) s.frame = last;
    applyTrim();
  } else {
    applyLayerBars();
  }
  requestFrame(s.frame);
}

/** Move by whole frames; stepping stops playback, as scrubbing does. */
function step(delta: number): void {
  if (!hasTimeline()) return;
  stageStop();
  requestFrame(steppedFrame(s.frame, delta, previewFrames(), s.player.loop));
}

export function initStage(): void {
  // A layer of the layered file on the stage was shown or hidden: the picture follows (milestone 33).
  effect(() => {
    const hidden = psdHidden.value;
    if (!s.psd) return;
    els.mediaImage.src = psdCompositeUrlFor(s.psd.id, hidden[s.psd.id] ?? []);
  });
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
  els.sequenceFps.addEventListener('change', () => {
    const value = Number(els.sequenceFps.value);
    if (Number.isFinite(value) && value > 0) setSequenceFps(value);
  });
  els.sequenceFpsReset.addEventListener('click', () => setSequenceFps(undefined));
  mountLayerBars($<HTMLDivElement>('layer-bars'), els.row);
  els.lengthHandle.addEventListener('pointerdown', onLengthPointerDown);
  els.lengthHandle.addEventListener('pointermove', onLengthPointerMove);
  els.lengthHandle.addEventListener('pointerup', onLengthPointerUp);
  els.lengthHandle.addEventListener('pointercancel', onLengthPointerUp);
  els.lengthHandle.addEventListener('keydown', onLengthKeyDown);
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
  for (const el of [els.mediaVideo, els.mediaAudio]) {
    // The elements have no controls of their own (milestone 37), but a volume change from anywhere is the preference.
    el.addEventListener('volumechange', () => setPlayer({ volume: el.volume, muted: el.muted }));
    // Playing and pausing are the element's own events, so the row is right whoever started it.
    el.addEventListener('play', () => startFollowing(el));
    el.addEventListener('pause', () => stopFollowing(el));
    el.addEventListener('ended', () => stopFollowing(el));
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
