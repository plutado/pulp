/** The status items, at the end of the transport row since milestone 42 (a bar of their own
 * across the bottom of the window before that). The ffmpeg item and the library counts are
 * written by main.ts (they already carry ids here); this module owns the scan, render and
 * cache spans.
 *
 * A status is written when its own state changes, so its words are bound to their message
 * (milestone 59): a change of language rewrites what is showing without waiting for the next. */

import { effect } from '@preact/signals';
import type { MessageId, MessageValues } from '../core/i18n';
import { appState } from './store';
import { setIcon, type IconName } from './icons';
import { bindAttr, bindText } from './i18n';

/** What a status says: a message (followed through a change of language), words already made elsewhere, or nothing. */
type Words = { id: MessageId; values?: MessageValues } | { text: string } | null;

/** Take an element's text off its message, so a change of language leaves what is written now alone. */
function unbindText(el: HTMLElement): void {
  delete el.dataset.i18n;
  delete el.dataset.i18nValues;
}

/** Take an attribute off its message and off the element. */
function unbindAttr(el: HTMLElement, name: string): void {
  const pairs = (el.dataset.i18nAttr ?? '').split(';').filter((p) => p && p.split(':')[0] !== name);
  if (pairs.length > 0) el.dataset.i18nAttr = pairs.join(';');
  else delete el.dataset.i18nAttr;
  if (el.dataset.i18nAttrValues) {
    try {
      const all = JSON.parse(el.dataset.i18nAttrValues) as Record<string, unknown>;
      delete all[name];
      if (Object.keys(all).length > 0) el.dataset.i18nAttrValues = JSON.stringify(all);
      else delete el.dataset.i18nAttrValues;
    } catch {
      delete el.dataset.i18nAttrValues;
    }
  }
  el.removeAttribute(name);
}

/** A status item is an optional icon plus a label span; a spinning icon says "in progress". */
function setStatus(el: HTMLElement, icon: IconName | null, words: Words, spin = false): void {
  const label = el.querySelector<HTMLElement>('.label') ?? el;
  if (words && 'id' in words) {
    bindText(label, words.id, words.values);
  } else {
    unbindText(label);
    label.textContent = words?.text ?? '';
  }
  const text = label.textContent;
  el.querySelector(':scope > svg.icon')?.remove(); // i18n-exempt(technical): a selector
  if (icon && text) {
    setIcon(el, icon);
    el.querySelector(':scope > svg.icon')?.classList.toggle('spin', spin); // i18n-exempt(technical): a selector
  }
}

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

export function setScanning(on: boolean): void {
  setStatus($('status-scan'), 'spinner', on ? { id: 'status.scanning' } : null, true); // i18n-exempt(technical): an icon's name
}

/** The cache on the row is its icon, a button that opens the Render cache dialog; the summary is its tooltip and its label. */
export function setCacheSummary(text: string): void {
  const el = $('status-cache');
  // The summary is the main process's, made in its language; the frame around it is this window's.
  setStatus(el, 'hard-drive', text ? { id: 'status.cache', values: { summary: text } } : null); // i18n-exempt(technical): an icon's name
  if (text) bindAttr(el, 'data-tip', 'status.cache.data-tip', { summary: text });
  else unbindAttr(el, 'data-tip');
}

export function initStatusBar(): void {
  effect(() => {
    const jobs = appState.value.jobs.jobs;
    const running = jobs.filter((j) => j.status === 'running').length;
    const queued = jobs.filter((j) => j.status === 'queued').length;
    const active = running + queued;
    setStatus($('status-renders'), 'spinner', active === 0 ? null : active === 1 ? { id: 'status.rendering' } : { id: 'status.rendering-queued', values: { count: active - 1 } }, true); // i18n-exempt(technical): an icon's name
  });
}

/** The ffmpeg line: version and path, or why rendering is unavailable. */
export function setFfmpeg(info: { ok: boolean; version?: string; path?: string; message?: string }): void {
  const el = $('ffmpeg-status');
  el.classList.toggle('error', !info.ok);
  // Why it is missing is the main process's own words when it has them; this window's otherwise.
  const words: Words = info.ok
    ? { id: 'status.ffmpeg', values: { version: String(info.version) } }
    : info.message
      ? { text: info.message.charAt(0).toUpperCase() + info.message.slice(1) }
      : { id: 'status.ffmpeg.not-found' };
  setStatus(el, info.ok ? 'check-circle' : 'warning', words); // i18n-exempt(technical): icons' names
  // Found, the item is its tick alone on the row (the stylesheet hides the label), so the version
  // and the path — which matters when the wrong ffmpeg is found — live in the tooltip.
  if (info.ok && info.path) bindAttr(el, 'data-tip', 'status.ffmpeg.data-tip', { version: String(info.version), path: info.path });
  else if (info.ok) bindAttr(el, 'data-tip', 'status.ffmpeg', { version: String(info.version) });
  else unbindAttr(el, 'data-tip');
}
