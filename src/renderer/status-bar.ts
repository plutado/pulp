/** The status bar region. The ffmpeg line and library counts are written by main.ts
 * (they already carry ids here); this module owns the scan, render and cache spans. */

import { effect } from '@preact/signals';
import { appState } from './store';
import { setIcon, type IconName } from './icons';

/** A status item is an optional icon plus a label span; a spinning icon says "in progress". */
function setStatus(el: HTMLElement, icon: IconName | null, text: string, spin = false): void {
  const label = el.querySelector<HTMLElement>('.label') ?? el;
  label.textContent = text;
  el.querySelector(':scope > svg.icon')?.remove();
  if (icon && text) {
    setIcon(el, icon);
    el.querySelector(':scope > svg.icon')?.classList.toggle('spin', spin);
  }
}

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

export function setScanning(on: boolean): void {
  setStatus($('status-scan'), 'spinner', on ? 'Scanning…' : '', true);
}

export function setCacheSummary(text: string): void {
  setStatus($('status-cache'), 'hard-drive', text ? `Cache: ${text}` : '');
}

export function initStatusBar(): void {
  effect(() => {
    const jobs = appState.value.jobs.jobs;
    const running = jobs.filter((j) => j.status === 'running').length;
    const queued = jobs.filter((j) => j.status === 'queued').length;
    const active = running + queued;
    setStatus($('status-renders'), 'spinner', active === 0 ? '' : active === 1 ? 'Rendering…' : `Rendering, ${active - 1} more queued…`, true);
  });
}

/** The ffmpeg line: version and path, or why rendering is unavailable. */
export function setFfmpeg(info: { ok: boolean; version?: string; path?: string; message?: string }): void {
  const el = $('ffmpeg-status');
  el.classList.toggle('error', !info.ok);
  const message = info.message ?? 'FFmpeg not found';
  setStatus(el, info.ok ? 'check-circle' : 'warning', info.ok ? `FFmpeg ${info.version}` : message.charAt(0).toUpperCase() + message.slice(1));
  // The executable path matters when the wrong ffmpeg is found; it lives in the tooltip.
  if (info.ok && info.path) el.dataset.tip = info.path;
  else delete el.dataset.tip;
}
