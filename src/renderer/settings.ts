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
import { docSections, isDocTable } from '../core/doc-page';
import { downloadSizeText } from '../core/ffmpeg-download';
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

/**
 * What the rest of the window does when FFmpeg is found, registered by the
 * module that does it at startup (src/renderer/main.ts): the status bar's
 * item and the Output tab's presets. A fetch here makes renders possible
 * without a restart, so the window has to hear about it the same way it
 * heard at launch — through that one function, not a second copy of it.
 */
let refreshFfmpeg: () => void = () => undefined;

export function registerFfmpegRefresh(fn: () => void): void {
  refreshFfmpeg = fn;
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

/**
 * Where FFmpeg was found, and the offer to fetch one where it was not
 * (milestone 17, ADR 0022). The offer says what would be fetched, from whom,
 * how big it is and under what licence **before** the button is pressed:
 * Pulp ships no FFmpeg and what arrives is GPL software from its publisher,
 * and neither of those is something to find out afterwards.
 */
async function showFfmpeg(): Promise<void> {
  const [ffmpeg, download] = await Promise.all([window.pulp.ffmpegStatus(), window.pulp.ffmpegDownloadStatus()]);
  const line = $('settings-ffmpeg');
  line.textContent = ffmpeg.ok ? `FFmpeg ${ffmpeg.version ?? ''} found.`.replace('  ', ' ') : 'FFmpeg was not found, so renders are off.';
  if (ffmpeg.ok && ffmpeg.path) line.dataset.tip = ffmpeg.path;
  else delete line.dataset.tip;
  const offer = $('settings-ffmpeg-offer');
  const button = $<HTMLButtonElement>('settings-ffmpeg-get');
  // There is something to fetch only where nothing was found, there is a build for this
  // machine, and Pulp has not already fetched one. Someone who has FFmpeg is offered
  // nothing: the helper is a way out of having none, not a second way to have one.
  const canFetch = !ffmpeg.ok && download.build !== null && !download.installed;
  offer.hidden = !canFetch && !download.installed;
  if (download.installed) {
    offer.textContent = 'This is a build Pulp fetched, kept beside your settings. An FFmpeg of your own still comes first.';
    offer.dataset.tip = download.path ?? '';
  } else if (canFetch) {
    delete offer.dataset.tip;
    offer.textContent = download.build!.note;
  }
  button.hidden = !canFetch;
  button.disabled = false;
  if (canFetch) button.textContent = `Download FFmpeg (${downloadSizeText(download.build!.bytes)})`;
}

/** Open the window with every control reading its setting afresh. */
export async function showSettings(): Promise<void> {
  const dialog = $<HTMLDialogElement>('settings-dialog');
  const [prefs, player, cache] = await Promise.all([
    window.pulp.getStartScreenPrefs(),
    window.pulp.getPlayer(),
    window.pulp.renderCacheStats(),
    showFfmpeg(),
  ]);
  $<HTMLInputElement>('settings-start-screen').checked = prefs.showAtStartup;
  $<HTMLInputElement>('settings-audition').checked = player.audition;
  showCache(cache);
  if (!dialog.open) dialog.showModal();
}

export function showAcknowledgements(): void {
  const body = $('notices-body');
  body.replaceChildren();
  for (const section of docSections(noticesText)) {
    const head = document.createElement('h3');
    head.textContent = section.title;
    body.append(head);
    for (const block of section.blocks) {
      if (!isDocTable(block)) {
        const p = document.createElement('p');
        p.textContent = typeof block === 'string' ? block : block.items.join(' · ');
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
  // The fetch, and the one line of status it reports through (milestone 17). The button is
  // the asking: nothing is fetched until it is pressed, and what arrives is checked against
  // its published checksum before it is kept (ADR 0022).
  const get = $<HTMLButtonElement>('settings-ffmpeg-get');
  const offer = $('settings-ffmpeg-offer');
  window.pulp.onFfmpegProgress((progress) => {
    if (get.hidden && offer.hidden) return;
    const percent = progress.fraction === null ? '' : ` ${Math.round(progress.fraction * 100)}%`;
    offer.hidden = false;
    offer.textContent = `${progress.note}${percent}`;
  });
  get.addEventListener('click', () => {
    get.disabled = true;
    offer.hidden = false;
    offer.textContent = 'Fetching FFmpeg…';
    void window.pulp.fetchFfmpeg().then(async (result) => {
      if (!result.ok) {
        get.disabled = false;
        offer.textContent = result.message;
        return;
      }
      // Renders work from here on, with no restart: the status bar and the Output tab are
      // told exactly as they were at launch.
      refreshFfmpeg();
      await showFfmpeg();
    });
  });

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
