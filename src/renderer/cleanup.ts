/**
 * Clip clean-up in the window (milestone 52): the key dialog, the
 * split-at-cuts flow, and the Stabilize dialog (milestone 78), all reached
 * from a clip's Info tab.
 *
 * Stabilize runs ffmpeg's two passes over the whole clip, so the dialog shows
 * how far along they are and offers Stop; an ffmpeg built without vid.stab is
 * said plainly when the dialog opens, before anything is asked of it.
 *
 * The key dialog shows the same frame twice — plain, where a point on it
 * picks the color (the picker: the color wanted is nearly always in the
 * footage), and keyed with the settings as they stand, over a checkerboard —
 * drawn afresh by the main process as the settings move, debounced so a slider
 * drag asks once. Make alpha clip runs the whole clip and says where it went;
 * the library's rescan brings it into the results on its own.
 */

import { KEY_DEFAULTS, sanitizeChromaKey, STABILIZE_DEFAULTS, type ChromaKeySettings, type StabilizeSettings } from '../core/clip-clean';
import { playheadSeconds } from './store';
import { bindText } from './i18n';
import { showSettings as showFfmpegSettings } from './settings';
import type { MessageId, MessageValues } from '../core/i18n';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

let els: {
  dialog: HTMLDialogElement;
  plain: HTMLImageElement;
  keyed: HTMLImageElement;
  color: HTMLInputElement;
  green: HTMLButtonElement;
  blue: HTMLButtonElement;
  tolerance: HTMLInputElement;
  spill: HTMLInputElement;
  status: HTMLParagraphElement;
  make: HTMLButtonElement;
  close: HTMLButtonElement;
} | null = null;

const state = {
  id: null as string | null,
  /** The frame previews are drawn at: the playhead when the dialog opened. */
  at: 0,
  settings: { ...KEY_DEFAULTS } as ChromaKeySettings,
  /** Only the newest preview ask paints; a slider drag outruns the decodes. */
  asked: 0,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  keying: false,
};

/** The status line in words already worked out — the main process's, or none — letting go of any message stamped on it. */
function statusText(text: string): void {
  if (!els) return;
  delete els.status.dataset.i18n;
  delete els.status.dataset.i18nValues;
  els.status.textContent = text;
}

/** The status line from the catalog: a change of language rewrites it while it shows. */
function statusMessage(id: MessageId, values?: MessageValues): void {
  if (els) bindText(els.status, id, values);
}

function readSettings(): ChromaKeySettings {
  if (!els) return { ...KEY_DEFAULTS };
  return sanitizeChromaKey({
    color: els.color.value,
    tolerance: Number(els.tolerance.value) / 100,
    spill: Number(els.spill.value) / 100,
  });
}

function showSettings(): void {
  if (!els) return;
  els.color.value = state.settings.color;
  els.tolerance.value = String(Math.round(state.settings.tolerance * 100));
  els.spill.value = String(Math.round(state.settings.spill * 100));
}

/** Draw both frames again, after the sliders settle. */
function refreshPreview(): void {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    const id = state.id;
    if (!id || !els) return;
    const asked = ++state.asked;
    void window.pulp.chromaKeyPreview(id, state.settings, state.at).then((result) => {
      if (asked !== state.asked || !els || state.id !== id) return;
      if (!result.ok) {
        els.status.classList.add('error');
        statusText(result.message);
        return;
      }
      els.status.classList.remove('error');
      if (!state.keying) statusText('');
      els.plain.src = result.plain;
      els.keyed.src = result.keyed;
    });
  }, 250);
}

function settingsChanged(): void {
  state.settings = readSettings();
  refreshPreview();
}

/** The picker: a point on the plain frame is the color to key out. */
function pickFromFrame(e: MouseEvent): void {
  if (!els || !els.plain.naturalWidth) return;
  const box = els.plain.getBoundingClientRect();
  const x = Math.floor(((e.clientX - box.left) / Math.max(1, box.width)) * els.plain.naturalWidth);
  const y = Math.floor(((e.clientY - box.top) / Math.max(1, box.height)) * els.plain.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = els.plain.naturalWidth;
  canvas.height = els.plain.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(els.plain, 0, 0);
  const [r, g, b] = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, x)), Math.max(0, Math.min(canvas.height - 1, y)), 1, 1).data;
  const hex = `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
  state.settings = sanitizeChromaKey({ ...state.settings, color: hex });
  showSettings();
  refreshPreview();
}

async function makeClip(): Promise<void> {
  const id = state.id;
  if (!id || !els || state.keying) return;
  state.keying = true;
  els.make.disabled = true;
  els.status.classList.remove('error');
  statusMessage('cleanup.keying');
  const result = await window.pulp.chromaKeyClip(id, state.settings);
  state.keying = false;
  if (!els || state.id !== id) return;
  els.make.disabled = false;
  if (!result.ok) {
    els.status.classList.add('error');
    statusText(result.message);
    return;
  }
  // The name, never the path (docs/ui-style.md): the clip is in the results now, beside the original.
  statusMessage('cleanup.made', { name: result.path.split(/[\\/]/).pop() ?? '' });
}

/** Open the key dialog on a clip, with the previews at the playhead's frame. */
export function openChromaKey(id: string): void {
  if (!els) return;
  state.id = id;
  state.at = Math.max(0, playheadSeconds.peek());
  state.settings = { ...KEY_DEFAULTS };
  state.keying = false;
  statusMessage('cleanup.reading');
  els.status.classList.remove('error');
  els.plain.removeAttribute('src');
  els.keyed.removeAttribute('src');
  els.make.disabled = false;
  showSettings();
  els.dialog.showModal();
  refreshPreview();
}

export function initCleanup(): void {
  els = {
    dialog: $('key-dialog'),
    plain: $('key-plain'),
    keyed: $('key-keyed'),
    color: $('key-color'),
    green: $('key-green'),
    blue: $('key-blue'),
    tolerance: $('key-tolerance'),
    spill: $('key-spill'),
    status: $('key-status'),
    make: $('key-make'),
    close: $('key-close'),
  };
  els.plain.addEventListener('click', pickFromFrame);
  els.color.addEventListener('input', settingsChanged);
  els.tolerance.addEventListener('input', settingsChanged);
  els.spill.addEventListener('input', settingsChanged);
  els.green.addEventListener('click', () => {
    state.settings = sanitizeChromaKey({ ...state.settings, color: '#00ff00' });
    showSettings();
    refreshPreview();
  });
  els.blue.addEventListener('click', () => {
    state.settings = sanitizeChromaKey({ ...state.settings, color: '#0000ff' });
    showSettings();
    refreshPreview();
  });
  els.make.addEventListener('click', () => void makeClip());
  els.close.addEventListener('click', () => els?.dialog.close());
  els.dialog.addEventListener('close', () => {
    state.id = null;
    clearTimeout(state.timer);
  });
}

// ---------------------------------------------------------------- stabilize (milestone 78)

let stabEls: {
  dialog: HTMLDialogElement;
  smoothing: HTMLInputElement;
  edges: HTMLSelectElement;
  progress: HTMLProgressElement;
  status: HTMLParagraphElement;
  make: HTMLButtonElement;
  cancel: HTMLButtonElement;
  close: HTMLButtonElement;
  /** Settings → FFmpeg, offered where this build lacks vid.stab (milestone 88): the fix, one click away. */
  fix: HTMLButtonElement;
} | null = null;

const stab = {
  id: null as string | null,
  settings: { ...STABILIZE_DEFAULTS } as StabilizeSettings,
  running: false,
};

/** The status line in words already worked out — the main process's, or none. */
function stabStatusText(text: string, error = false): void {
  if (!stabEls) return;
  delete stabEls.status.dataset.i18n;
  delete stabEls.status.dataset.i18nValues;
  stabEls.status.textContent = text;
  stabEls.status.classList.toggle('error', error);
}

function stabStatusMessage(id: MessageId, values?: MessageValues): void {
  if (!stabEls) return;
  stabEls.status.classList.remove('error');
  bindText(stabEls.status, id, values);
}

function stabShowRunning(running: boolean): void {
  if (!stabEls) return;
  stab.running = running;
  stabEls.make.disabled = running;
  stabEls.cancel.hidden = !running;
  stabEls.progress.hidden = !running;
  stabEls.smoothing.disabled = running;
  stabEls.edges.disabled = running;
  if (!running) stabEls.progress.removeAttribute('value');
}

async function runStabilize(): Promise<void> {
  if (!stabEls || !stab.id || stab.running) return;
  const id = stab.id;
  stabShowRunning(true);
  stabEls.progress.value = 0;
  stabStatusMessage('cleanup.stabilize.pass1');
  const result = await window.pulp.stabilizeClip(id, {
    smoothing: Number(stabEls.smoothing.value),
    edges: stabEls.edges.value === 'keep' ? 'keep' : 'zoom',
  });
  stabShowRunning(false);
  if (result.ok) {
    // The name, never the path (docs/ui-style.md): the clip is in the results now, beside the original.
    stabStatusMessage('cleanup.made', { name: result.path.split(/[\\/]/).pop() ?? '' });
  } else if (result.cancelled) {
    stabStatusMessage('cleanup.stabilize.cancelled');
  } else {
    stabStatusText(result.message, true);
  }
}

/** Open the Stabilize dialog on a clip: whether this ffmpeg can comes first, said plainly where it cannot. */
export function openStabilize(id: string): void {
  if (!stabEls) return;
  stab.id = id;
  stabShowRunning(false);
  stabStatusText('');
  stabEls.make.disabled = true;
  stabEls.dialog.showModal();
  void window.pulp.stabilizeStatus().then((status) => {
    if (!stabEls || stab.id !== id) return;
    if (status.ok) stabEls.make.disabled = false;
    else stabStatusText(status.message, true);
    stabEls.fix.hidden = status.ok || !('missing' in status && status.missing);
  });
}

export function initStabilize(): void {
  stabEls = {
    dialog: $('stab-dialog'),
    smoothing: $('stab-smoothing'),
    edges: $('stab-edges'),
    progress: $('stab-progress'),
    status: $('stab-status'),
    make: $('stab-make'),
    cancel: $('stab-cancel'),
    close: $('stab-close'),
    fix: $('stab-fix'),
  };
  stabEls.fix.addEventListener('click', () => {
    stabEls?.dialog.close();
    void showFfmpegSettings();
  });
  stabEls.make.addEventListener('click', () => void runStabilize());
  stabEls.cancel.addEventListener('click', () => void window.pulp.cancelStabilize());
  stabEls.close.addEventListener('click', () => stabEls?.dialog.close());
  // Closing the dialog mid-run stops the run: a dialog gone with ffmpeg grinding on would be a mystery fan noise.
  stabEls.dialog.addEventListener('close', () => {
    if (stab.running) void window.pulp.cancelStabilize();
    stab.id = null;
  });
  window.pulp.onStabilizeProgress(({ pass, fraction }) => {
    if (!stabEls || !stab.running) return;
    if (fraction === null) stabEls.progress.removeAttribute('value');
    else stabEls.progress.value = fraction;
    stabStatusMessage(pass === 1 ? 'cleanup.stabilize.pass1' : 'cleanup.stabilize.pass2');
  });
}
