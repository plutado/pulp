/**
 * Clip clean-up in the window (milestone 52): the key dialog, and the
 * split-at-cuts flow, both reached from a clip's Info tab.
 *
 * The key dialog shows the same frame twice — plain, where a point on it
 * picks the colour (the picker: the colour wanted is nearly always in the
 * footage), and keyed with the settings as they stand, over a checkerboard —
 * drawn afresh by the main process as the settings move, debounced so a slider
 * drag asks once. Make alpha clip runs the whole clip and says where it went;
 * the library's rescan brings it into the results on its own.
 */

import { KEY_DEFAULTS, sanitizeChromaKey, type ChromaKeySettings } from '../core/clip-clean';
import { playheadSeconds } from './store';

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
        els.status.textContent = result.message;
        return;
      }
      els.status.classList.remove('error');
      if (!state.keying) els.status.textContent = '';
      els.plain.src = result.plain;
      els.keyed.src = result.keyed;
    });
  }, 250);
}

function settingsChanged(): void {
  state.settings = readSettings();
  refreshPreview();
}

/** The picker: a point on the plain frame is the colour to key out. */
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
  els.status.textContent = 'Keying the whole clip…';
  const result = await window.pulp.chromaKeyClip(id, state.settings);
  state.keying = false;
  if (!els || state.id !== id) return;
  els.make.disabled = false;
  if (!result.ok) {
    els.status.classList.add('error');
    els.status.textContent = result.message;
    return;
  }
  // The name, never the path (docs/ui-style.md): the clip is in the results now, beside the original.
  els.status.textContent = `Made ${result.path.split(/[\\/]/).pop()}, in the library beside the original.`;
}

/** Open the key dialog on a clip, with the previews at the playhead's frame. */
export function openChromaKey(id: string): void {
  if (!els) return;
  state.id = id;
  state.at = Math.max(0, playheadSeconds.peek());
  state.settings = { ...KEY_DEFAULTS };
  state.keying = false;
  els.status.textContent = 'Reading the frame…';
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
