/**
 * The Settings window (milestone 8): what `settings.json` keeps with no other
 * home, in one place — the start screen at launch, audition on choosing a
 * sound, the appearance (milestone 62), where FFmpeg was found, and the render
 * cache's folder, limit and clearing. Every control writes the very setting the rest of the window
 * reads, through the call that part of the window already uses, so there is
 * one setting and two ways to reach it rather than two settings.
 *
 * And the Acknowledgements (the same milestone): the third-party notices,
 * `THIRD_PARTY_NOTICES.md` inlined at build time so the dialog is the file.
 */

import noticesText from '../../THIRD_PARTY_NOTICES.md?raw';
import { docSections, isDocTable } from '../core/doc-page';
import { downloadSizeText } from '../core/ffmpeg-download';
import { semanticSetAvailable } from './semantic';
import type { PlayerState } from '../core/player';
import { setCacheSummary } from './status-bar';
import { effect } from '@preact/signals';
import { APPEARANCES } from '../core/appearance';
import { appearanceChoice, chooseAppearance } from './appearance';

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
 * how big it is and under what license **before** the button is pressed:
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

/**
 * Semantic search (milestone 9, ADR 0024): the toggle, the one line of what
 * stands — the runner, the model, how far the indexing has come — and the
 * offer that says what would be fetched, from whom, how big and under what
 * license **before** the button exists to press, the speech model's own rule.
 */
async function showSemantic(): Promise<void> {
  const status = await window.pulp.semanticStatus();
  $<HTMLInputElement>('settings-semantic').checked = status.enabled;
  const note = $('settings-semantic-note');
  const get = $<HTMLButtonElement>('settings-semantic-get');
  if (!status.runner.ok) {
    note.textContent = status.runner.message ?? 'llama.cpp was not found.';
    get.hidden = true;
  } else if (!status.model.installed) {
    note.textContent = `${status.model.label} (${downloadSizeText(status.model.bytes)}, ${status.model.license}) would be fetched from its publisher. ${status.model.note}`;
    get.hidden = !status.enabled;
    get.disabled = false;
    get.textContent = `Download the model (${downloadSizeText(status.model.bytes)})`;
  } else {
    note.textContent = status.indexing.total > 0
      ? `Indexing the library… ${status.indexing.done} of ${status.indexing.total}.`
      : `${status.model.label} is here; the library is indexed as it changes. Everything runs on this machine.`;
    get.hidden = true;
  }
  semanticSetAvailable(status.enabled, status.runner.ok && status.model.installed);
}

/**
 * The editor panel's bridge (milestone 54, ADR 0025): the toggle, and one line
 * saying where it listens — the loopback port while it runs, and where the
 * panels read it from, since that file is the whole handshake.
 */
async function showPanel(): Promise<void> {
  const status = await window.pulp.panelStatus();
  $<HTMLInputElement>('settings-panel').checked = status.enabled;
  const note = $('settings-panel-note');
  if (status.running && status.port !== undefined) {
    note.textContent = `Listening on 127.0.0.1:${status.port}. The panels find it through panel-bridge.json beside your settings.`;
    note.dataset.tip = status.bridgeFile;
  } else {
    note.textContent = 'Not listening. Panels inside the editing apps will say Pulp is not reachable.';
    delete note.dataset.tip;
  }
}

/** Open the window with every control reading its setting afresh. */
export async function showSettings(): Promise<void> {
  const dialog = $<HTMLDialogElement>('settings-dialog');
  const [prefs, player, cache] = await Promise.all([
    window.pulp.getStartScreenPrefs(),
    window.pulp.getPlayer(),
    window.pulp.renderCacheStats(),
    showFfmpeg(),
    showSemantic(),
    showPanel(),
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

/** System, Light and Dark as three radios, from the one list View → Appearance is built from too. */
function initAppearanceChoice(): void {
  const group = $('settings-appearance');
  for (const a of APPEARANCES) {
    const label = document.createElement('label');
    label.className = 'field inline';
    label.dataset.tip = a.hint;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'settings-appearance';
    input.id = `settings-appearance-${a.id}`;
    input.value = a.id;
    input.addEventListener('change', () => {
      if (input.checked) void chooseAppearance(a.id);
    });
    const text = document.createElement('span');
    text.textContent = a.label;
    label.append(input, text);
    group.append(label);
  }
  // Chosen here or in the View menu, the radios show the one that is on.
  effect(() => {
    const chosen = appearanceChoice.value;
    for (const input of group.querySelectorAll<HTMLInputElement>('input[type=radio]')) input.checked = input.value === chosen;
  });
}

export function initSettings(): void {
  initAppearanceChoice();
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

  // Semantic search: the toggle writes the setting; the model button is the asking (ADR 0024).
  $<HTMLInputElement>('settings-semantic').addEventListener('change', (e) => {
    void window.pulp.setSemanticSearch((e.currentTarget as HTMLInputElement).checked).then(() => showSemantic());
  });
  const semanticGet = $<HTMLButtonElement>('settings-semantic-get');
  semanticGet.addEventListener('click', () => {
    semanticGet.disabled = true;
    void window.pulp.fetchSemanticModel().then(async (result) => {
      if (!result.ok) {
        semanticGet.disabled = false;
        $('settings-semantic-note').textContent = result.message;
        return;
      }
      await showSemantic();
    });
  });
  window.pulp.onSemanticProgress((progress) => {
    const dialog = $<HTMLDialogElement>('settings-dialog');
    if (!dialog.open) return;
    const percent = progress.fraction === null ? '' : ` ${Math.round(progress.fraction * 100)}%`;
    $('settings-semantic-note').textContent = `${progress.note}${percent}`;
  });

  // The editor panel: the toggle starts or stops the listener there and then, and the line says where it landed.
  $<HTMLInputElement>('settings-panel').addEventListener('change', (e) => {
    void window.pulp.setEditorPanel((e.currentTarget as HTMLInputElement).checked).then(() => showPanel());
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
