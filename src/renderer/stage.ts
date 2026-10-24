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

import { effect } from '@preact/signals';
import type { MediaEntry, TemplateEntry } from '../core/library-types';
import { frameCount, type TemplateManifest } from '../core/manifest';
import type { ResolvedParams } from '../core/params';
import { DEFAULT_PLAYER, markPercent, playheadAt, SAFE_AREAS, sanitizePlayer, steppedFrame, trimmedAway, type PlayerState, type StageBackground } from '../core/player';
import { frameState } from '../core/runtime';
import { formatTimecode } from '../core/timecode';
import { mediaUrlFor, templateUrlFor } from '../shared/api';
import { setIcon } from './icons';
import { trim } from './store';
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
  safeOverlay: $<HTMLDivElement>('safe-overlay'),
  safeAction: $<HTMLDivElement>('safe-action'),
  safeTitle: $<HTMLDivElement>('safe-title'),
};

const BACKGROUND_BUTTONS: Record<Exclude<StageBackground, 'custom'>, HTMLButtonElement> = {
  checker: $<HTMLButtonElement>('bg-checker'),
  black: $<HTMLButtonElement>('bg-black'),
  white: $<HTMLButtonElement>('bg-white'),
};

const s = {
  manifest: null as TemplateManifest | null,
  params: {} as ResolvedParams,
  frame: 0,
  playing: false,
  previewReady: false,
  inFlight: false,
  pendingFrame: null as number | null,
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

function postFrame(frame: number): void {
  const win = els.preview.contentWindow;
  if (!win || !s.manifest) return;
  s.inFlight = true;
  win.postMessage({ type: 'pulp:render', id: frame, state: frameState(s.manifest, frame, s.params) }, '*');
  updateTimecode(frame);
}

/** Only one frame is in flight at a time; newer requests replace queued ones. */
function requestFrame(frame: number): void {
  s.frame = frame;
  if (!s.previewReady) return;
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
export function stageShowTemplate(entry: TemplateEntry, params: ResolvedParams): void {
  stageStop();
  clearMediaPreview();
  clearNote();
  const m = entry.manifest;
  s.manifest = m;
  s.params = params;
  s.frame = Math.floor(frameCount(m) / 2);
  s.previewReady = false;
  s.inFlight = false;
  s.pendingFrame = null;
  els.previewFrame.style.aspectRatio = `${m.width} / ${m.height}`;
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
    if (w > 0 && h > 0) els.previewFrame.style.aspectRatio = `${w} / ${h}`;
  };
  if (entry.mediaKind === 'video') {
    els.mediaVideo.hidden = false;
    els.mediaVideo.onloadedmetadata = () => fit(els.mediaVideo.videoWidth, els.mediaVideo.videoHeight);
    els.mediaVideo.src = url;
  } else if (entry.mediaKind === 'image') {
    els.mediaImage.hidden = false;
    els.mediaImage.onload = () => fit(els.mediaImage.naturalWidth, els.mediaImage.naturalHeight);
    els.mediaImage.src = url;
  } else {
    els.previewFrame.style.aspectRatio = '16 / 9';
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

/** New parameter values (edit, undo, preset): redraw the current frame with them. */
export function stageSetParams(params: ResolvedParams): void {
  s.params = params;
  requestFrame(s.frame);
}

/** Move by whole frames; stepping stops playback, as scrubbing does. */
function step(delta: number): void {
  if (!s.manifest) return;
  stageStop();
  requestFrame(steppedFrame(s.frame, delta, frameCount(s.manifest), s.player.loop));
}

export function initStage(): void {
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
      requestFrame(s.frame);
      updateTransport();
    } else if (data?.type === 'pulp:rendered' || data?.type === 'pulp:error') {
      s.inFlight = false;
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
