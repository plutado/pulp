/**
 * The Settings window (milestone 8): what `settings.json` keeps with no other
 * home, in one place — the start screen at launch, audition on choosing a
 * sound, where FFmpeg was found, and the render cache's folder, limit and
 * clearing. Every control writes the very setting the rest of the window
 * reads, through the call that part of the window already uses, so there is
 * one setting and two ways to reach it rather than two settings.
 *
 * And the Acknowledgements (the same milestone): the third-party notices,
 * `THIRD_PARTY_NOTICES.md` inlined at build time so the dialog is the file.
 */

import noticesText from '../../THIRD_PARTY_NOTICES.md?raw';
import { noticeSections } from '../core/notices';
import type { PlayerState } from '../core/player';
import { setCacheSummary } from './status-bar';

/**
 * How audition is set: the stage registers its own setter at mount, so the dialog changes the
 * preference through the very path the stage's button takes, and this module never reaches into
 * the stage (docs/ui-layout.md: regions meet through state, not each other's elements).
 */
let setPlayer: (change: Partial<PlayerState>) => void = () => undefined;

export function registerPlayerSetter(fn: (change: Partial<PlayerState>) => void): void {
  setPlayer = fn;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

function showCache(stats: { summary: string; dir: string; maxMB: number }): void {
  const summary = $('settings-cache-summary');
  summary.textContent = stats.summary;
  // The folder's path lives in the tooltip, where the rest of the window keeps paths.
  summary.dataset.tip = stats.dir;
  $<HTMLInputElement>('settings-cache-limit').value = String(stats.maxMB);
  setCacheSummary(stats.summary);
}

/** Open the window with every control reading its setting afresh. */
export async function showSettings(): Promise<void> {
  const dialog = $<HTMLDialogElement>('settings-dialog');
  const [prefs, player, ffmpeg, cache] = await Promise.all([
    window.pulp.getStartScreenPrefs(),
    window.pulp.getPlayer(),
    window.pulp.ffmpegStatus(),
    window.pulp.renderCacheStats(),
  ]);
  $<HTMLInputElement>('settings-start-screen').checked = prefs.showAtStartup;
  $<HTMLInputElement>('settings-audition').checked = player.audition;
  const line = $('settings-ffmpeg');
  line.textContent = ffmpeg.ok ? `FFmpeg ${ffmpeg.version ?? ''} found.`.replace('  ', ' ') : 'FFmpeg was not found, so renders are off.';
  if (ffmpeg.ok && ffmpeg.path) line.dataset.tip = ffmpeg.path;
  else delete line.dataset.tip;
  showCache(cache);
  if (!dialog.open) dialog.showModal();
}

export function showAcknowledgements(): void {
  const body = $('notices-body');
  body.replaceChildren();
  for (const section of noticeSections(noticesText)) {
    const head = document.createElement('h3');
    head.textContent = section.title;
    body.append(head);
    for (const block of section.blocks) {
      if (typeof block === 'string') {
        const p = document.createElement('p');
        p.textContent = block;
        body.append(p);
        continue;
      }
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const cell of block.header) {
        const th = document.createElement('th');
        th.textContent = cell;
        headRow.append(th);
      }
      thead.append(headRow);
      const tbody = document.createElement('tbody');
      for (const row of block.rows) {
        const tr = document.createElement('tr');
        for (const cell of row) {
          const td = document.createElement('td');
          td.textContent = cell;
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(thead, tbody);
      body.append(table);
    }
  }
  $<HTMLDialogElement>('notices-dialog').showModal();
}

export function initSettings(): void {
  $<HTMLInputElement>('settings-start-screen').addEventListener('change', (e) => {
    void window.pulp.setShowStartScreen((e.currentTarget as HTMLInputElement).checked);
  });
  $<HTMLInputElement>('settings-audition').addEventListener('change', (e) => {
    setPlayer({ audition: (e.currentTarget as HTMLInputElement).checked });
  });
  $<HTMLInputElement>('settings-cache-limit').addEventListener('change', () => {
    void window.pulp.setRenderCacheLimit(Number($<HTMLInputElement>('settings-cache-limit').value)).then(showCache);
  });
  $('settings-cache-dir').addEventListener('click', () => {
    void window.pulp.chooseRenderCacheDir().then((stats) => {
      if (stats) showCache(stats);
    });
  });
  $('settings-cache-clear').addEventListener('click', () => {
    void window.pulp.clearRenderCache().then(showCache);
  });
  $('settings-close').addEventListener('click', () => $<HTMLDialogElement>('settings-dialog').close());
  $('notices-close').addEventListener('click', () => $<HTMLDialogElement>('notices-dialog').close());
}
