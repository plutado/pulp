/** The status bar region. The ffmpeg line and library counts are written by main.ts
 * (they already carry ids here); this module owns the scan, render and cache spans. */

import { effect } from '@preact/signals';
import { appState } from './store';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

export function setScanning(on: boolean): void {
  $('status-scan').textContent = on ? 'Scanning…' : '';
}

export function setCacheSummary(text: string): void {
  $('status-cache').textContent = text ? `Cache: ${text}` : '';
}

export function initStatusBar(): void {
  effect(() => {
    const jobs = appState.value.jobs.jobs;
    const running = jobs.filter((j) => j.status === 'running').length;
    const queued = jobs.filter((j) => j.status === 'queued').length;
    const active = running + queued;
    $('status-renders').textContent =
      active === 0 ? '' : active === 1 ? 'Rendering…' : `Rendering, ${active - 1} more queued…`;
  });
}
