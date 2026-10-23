/**
 * The stage region: the template preview with playback, the media preview and the
 * transport. Owns its elements and playback state; other regions talk to it only
 * through this API (show, clear, set parameters), never through its DOM.
 */

import type { MediaEntry, TemplateEntry } from '../core/library-types';
import { frameCount, type TemplateManifest } from '../core/manifest';
import type { ResolvedParams } from '../core/params';
import { frameState } from '../core/runtime';
import { formatTimecode } from '../core/timecode';
import { mediaUrlFor, templateUrlFor } from '../shared/api';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  previewFrame: $<HTMLDivElement>('preview-frame'),
  preview: $<HTMLIFrameElement>('preview'),
  previewEmpty: $<HTMLDivElement>('preview-empty'),
  mediaVideo: $<HTMLVideoElement>('media-video'),
  mediaImage: $<HTMLImageElement>('media-image'),
  mediaAudio: $<HTMLAudioElement>('media-audio'),
  play: $<HTMLButtonElement>('play'),
  scrub: $<HTMLInputElement>('scrub'),
  timecode: $<HTMLSpanElement>('timecode'),
  note: $<HTMLParagraphElement>('stage-note'),
};

const s = {
  manifest: null as TemplateManifest | null,
  params: {} as ResolvedParams,
  frame: 0,
  playing: false,
  previewReady: false,
  inFlight: false,
  pendingFrame: null as number | null,
};

function updateTransport(): void {
  els.play.disabled = !s.manifest || !s.previewReady;
  els.scrub.disabled = !s.manifest;
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
  const frame = (playStartFrame + Math.floor(((now - playStart) / 1000) * s.manifest.fps)) % total;
  if (frame !== s.frame) requestFrame(frame);
  rafId = requestAnimationFrame(tick);
}

function play(): void {
  if (!s.manifest || !s.previewReady) return;
  s.playing = true;
  playStart = performance.now();
  playStartFrame = s.frame;
  els.play.textContent = 'Pause';
  rafId = requestAnimationFrame(tick);
}

export function stageStop(): void {
  s.playing = false;
  cancelAnimationFrame(rafId);
  els.play.textContent = 'Play';
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
  els.previewFrame.classList.toggle('checker', m.alpha);
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
  els.previewFrame.classList.add('checker');
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
  }
}

/** Empty stage: nothing selected. */
export function stageClear(): void {
  s.manifest = null;
  s.previewReady = false;
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

export function initStage(): void {
  els.play.addEventListener('click', () => (s.playing ? stageStop() : play()));
  els.scrub.addEventListener('input', () => {
    stageStop();
    requestFrame(Number(els.scrub.value));
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
