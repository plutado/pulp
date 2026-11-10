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

import { formatBytes } from '../core/app-state';
import noticesText from '../../THIRD_PARTY_NOTICES.md?raw';
import { docSections, isDocTable } from '../core/doc-page';
import { downloadSizeText } from '../core/ffmpeg-download';
import { needFor } from '../core/ffmpeg-needs';
import type { FfmpegFeatureInfo } from '../shared/api';
import { semanticSetAvailable } from './semantic';
import type { PlayerState } from '../core/player';
import { showCacheStats } from './tray';
import { effect } from '@preact/signals';
import { APPEARANCES } from '../core/appearance';
import { FILM_STRIP_MODES } from '../core/film-strip';
import { chooseFilmStrip, filmStripMode } from './film-strip';
import { appearanceChoice, chooseAppearance } from './appearance';
import { bindAttr, bindText, chooseLanguage, languageState, locale, t, whenLocaleChanges } from './i18n';
import { isLocaleId, LOCALES, resolveLocale, type MessageId } from '../core/i18n';

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

/**
 * Words that are not one of ours — a line the main process wrote, already in the interface's
 * language — put in an element that may carry a message's stamp from an earlier write, so a change
 * of language does not put that message back over them (milestone 59).
 */
function sayPlain(el: HTMLElement, text: string): void {
  delete el.dataset.i18n;
  delete el.dataset.i18nValues;
  el.textContent = text;
}

function showCache(stats: { files: number; bytes: number; dir: string; maxMB: number }): void {
  const summary = $('settings-cache-summary');
  // Written here, in the window's language, from the numbers (the tray does the same).
  summary.textContent = t('render-cache.summary', { count: stats.files, size: formatBytes(stats.bytes), max: formatBytes(stats.maxMB * 1024 * 1024) });
  // The folder's path lives in the tooltip, where the rest of the window keeps paths.
  summary.dataset.tip = stats.dir;
  $<HTMLInputElement>('settings-cache-limit').value = String(stats.maxMB);
  showCacheStats(stats);
}

/**
 * FFmpeg (milestone 17, ADR 0022; milestone 88): which one is in use and what
 * it can do — every feature in the table (src/core/ffmpeg-needs.ts), each
 * with what it lacks — which one to use, and the offer to fetch a build.
 *
 * The offer says what would be fetched, from whom, how big it is and under
 * what license **before** the button is pressed: Pulp ships no FFmpeg and what
 * arrives is GPL software from its publisher, and neither of those is
 * something to find out afterwards. It is made where there is no FFmpeg, and
 * now also where the one in use lacks a feature — the case milestone 88 is
 * for, since someone who already has an FFmpeg was never offered a better one.
 * A fetched build that would add what this one lacks is offered as a switch.
 */
async function showFfmpeg(): Promise<void> {
  const [ffmpeg, download] = await Promise.all([window.pulp.ffmpegStatus(), window.pulp.ffmpegDownloadStatus()]);
  const line = $('settings-ffmpeg');
  if (!ffmpeg.ok) bindText(line, 'settings.ffmpeg.not-found');
  else if (ffmpeg.version && ffmpeg.path) bindText(line, 'settings.ffmpeg.found.at', { version: ffmpeg.version, path: ffmpeg.path });
  else if (ffmpeg.version) bindText(line, 'settings.ffmpeg.found', { version: ffmpeg.version });
  else bindText(line, 'settings.ffmpeg.found.no-version');
  delete line.dataset.tip;

  const env = $('settings-ffmpeg-env');
  env.hidden = !ffmpeg.envOverride;
  if (ffmpeg.envOverride) bindText(env, 'settings.ffmpeg.env-override', { path: ffmpeg.envOverride });

  // What this one can do: every feature that depends on the build, a tick or what it lacks.
  const features = ffmpeg.ok ? ffmpeg.features ?? [] : [];
  const head = $('settings-ffmpeg-can-head');
  const list = $('settings-ffmpeg-features');
  head.hidden = features.length === 0;
  list.hidden = features.length === 0;
  bindText(head, 'settings.ffmpeg.can.head');
  list.replaceChildren(...features.map((f) => {
    const li = document.createElement('li');
    li.className = f.ok ? 'has' : 'lacks';
    li.dataset.feature = f.id;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = f.ok ? '✓' : '✕'; // i18n-exempt(technical): a mark, said in the line's label
    const text = document.createElement('span');
    const feature = needFor(f.id).label;
    if (f.ok) bindText(text, 'settings.ffmpeg.feature.has', { feature });
    else if (f.library) bindText(text, 'settings.ffmpeg.feature.lacks', { feature, library: f.library });
    else bindText(text, 'settings.ffmpeg.feature.lacks.names', { feature, names: f.missing.join(', ') });
    bindAttr(li, 'aria-label', f.ok ? 'settings.ffmpeg.feature.has.aria' : 'settings.ffmpeg.feature.lacks.aria', { feature });
    li.append(mark, text);
    return li;
  }));
  const lacking = features.filter((f) => !f.ok);

  // Which one to use: the first found, the fetched build where there is one, a file of one's own.
  const choice = ffmpeg.choice ?? { kind: 'auto' as const };
  bindText($('settings-ffmpeg-choice-head'), 'settings.ffmpeg.choice.head');
  const group = $('settings-ffmpeg-choice');
  const radio = (kind: 'auto' | 'fetched' | 'file', words: () => void, hint?: MessageId) => {
    const label = document.createElement('label');
    label.className = 'field inline';
    if (hint) bindAttr(label, 'data-tip', hint);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'settings-ffmpeg-choice';
    input.id = `settings-ffmpeg-choice-${kind}`;
    input.value = kind;
    input.checked = choice.kind === kind;
    const text = document.createElement('span');
    label.append(input, text);
    words.call(text);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      // A file is chosen by its button; its radio, once there, goes back to that file.
      const next = kind === 'file' && choice.kind === 'file' ? choice : kind === 'file' ? null : { kind };
      if (next) void window.pulp.chooseFfmpeg(next).then((r) => afterChoice(r));
    });
    return { label, text };
  };
  const rows = [radio('auto', function (this: HTMLElement) { bindText(this, 'settings.ffmpeg.choice.auto'); }, 'settings.ffmpeg.choice.auto.hint').label];
  if (download.installed) rows.push(radio('fetched', function (this: HTMLElement) { bindText(this, 'settings.ffmpeg.choice.fetched'); }).label);
  if (choice.kind === 'file') rows.push(radio('file', function (this: HTMLElement) { bindText(this, 'settings.ffmpeg.choice.file', { path: choice.path }); }).label);
  group.replaceChildren(...rows);
  bindText($('settings-ffmpeg-choose-file'), 'settings.ffmpeg.choose-file');

  // The offer. Fetch where there is no FFmpeg, or where this one lacks something; switch where the
  // fetched build is here and would add what this one lacks.
  const offer = $('settings-ffmpeg-offer');
  const get = $<HTMLButtonElement>('settings-ffmpeg-get');
  const use = $<HTMLButtonElement>('settings-ffmpeg-use-fetched');
  const names = (fs: readonly { id: FfmpegFeatureInfo['id'] }[]) => fs.map((f) => needFor(f.id).label).join(', ');
  const fetchedAdds = download.installed && choice.kind !== 'fetched'
    ? lacking.filter((f) => download.features?.find((d) => d.id === f.id)?.ok)
    : [];
  const canFetch = download.build !== null && !download.installed && (!ffmpeg.ok || lacking.length > 0);
  offer.hidden = true;
  get.hidden = true;
  use.hidden = true;
  delete offer.dataset.tip;
  if (canFetch && !ffmpeg.ok) {
    offer.hidden = false;
    sayPlain(offer, download.build!.note);
    get.hidden = false;
    bindText(get, 'settings.ffmpeg.download', { size: downloadSizeText(download.build!.bytes) });
  } else if (canFetch) {
    offer.hidden = false;
    bindText(offer, 'settings.ffmpeg.offer-better', { features: names(lacking), note: download.build!.note });
    get.hidden = false;
    bindText(get, 'settings.ffmpeg.download-better', { size: downloadSizeText(download.build!.bytes) });
  } else if (fetchedAdds.length > 0) {
    offer.hidden = false;
    bindText(offer, 'settings.ffmpeg.fetched-would-add', { features: names(fetchedAdds) });
    use.hidden = false;
    bindText(use, 'settings.ffmpeg.use-fetched');
  } else if (download.installed) {
    offer.hidden = false;
    bindText(offer, 'settings.ffmpeg.fetched');
    offer.dataset.tip = download.path ?? '';
  }
  get.disabled = false;
}

/** A choice made: the rest of the window reads the FFmpeg again, and Settings says what it now is. */
async function afterChoice(result: { ok: true } | { ok: false; message: string; cancelled?: true }): Promise<void> {
  refreshFfmpeg();
  await showFfmpeg();
  if (!result.ok && !result.cancelled) {
    const offer = $('settings-ffmpeg-offer');
    offer.hidden = false;
    sayPlain(offer, result.message);
  }
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
    if (status.runner.message !== undefined) sayPlain(note, status.runner.message);
    else bindText(note, 'settings.semantic.no-runner');
    get.hidden = true;
  } else if (!status.model.installed) {
    bindText(note, 'settings.semantic.offer', {
      model: status.model.label,
      size: downloadSizeText(status.model.bytes),
      licenseId: status.model.license,
      note: status.model.note,
    });
    get.hidden = !status.enabled;
    get.disabled = false;
    bindText(get, 'settings.semantic.download', { size: downloadSizeText(status.model.bytes) });
  } else {
    if (status.indexing.total > 0) bindText(note, 'settings.semantic.indexing', { done: status.indexing.done, total: status.indexing.total });
    else bindText(note, 'settings.semantic.ready', { model: status.model.label });
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
    bindText(note, 'settings.panel.listening', { port: status.port });
    note.dataset.tip = status.bridgeFile;
  } else {
    bindText(note, 'settings.panel.off');
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
    // Built once at start: bound to their messages, so a change of language rewrites them.
    bindAttr(label, 'data-tip', `appearance.${a.id}.hint`);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'settings-appearance';
    input.id = `settings-appearance-${a.id}`;
    input.value = a.id;
    input.addEventListener('change', () => {
      if (input.checked) void chooseAppearance(a.id);
    });
    const text = document.createElement('span');
    bindText(text, `appearance.${a.id}`);
    label.append(input, text);
    group.append(label);
  }
  // Chosen here or in the View menu, the radios show the one that is on.
  effect(() => {
    const chosen = appearanceChoice.value;
    for (const input of group.querySelectorAll<HTMLInputElement>('input[type=radio]')) input.checked = input.value === chosen;
  });
}

/**
 * What the timeline draws of each clip (milestone 87): Off, First frame or
 * Continuous, kept with the player's settings — the same choice a shot's
 * right-click menu offers, so the radios follow it from either.
 */
function initThumbnailsChoice(): void {
  const group = $('settings-thumbnails');
  for (const mode of FILM_STRIP_MODES) {
    const label = document.createElement('label');
    label.className = 'field inline';
    bindAttr(label, 'data-tip', `film-strip.${mode}.hint`);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'settings-thumbnails';
    input.id = `settings-thumbnails-${mode}`;
    input.value = mode;
    input.addEventListener('change', () => {
      if (input.checked) chooseFilmStrip(mode);
    });
    const text = document.createElement('span');
    bindText(text, `film-strip.${mode}`);
    label.append(input, text);
    group.append(label);
  }
  effect(() => {
    const chosen = filmStripMode.value;
    for (const input of group.querySelectorAll<HTMLInputElement>('input[type=radio]')) input.checked = input.value === chosen;
  });
}

/**
 * Settings → Language (milestone 59): the system's language first — naming the one it comes to —
 * then each language under its own name, so a person can find theirs whatever the window is in.
 * Rebuilt when the language changes, since the first line is in the window's language.
 */
function initLanguageChoice(): void {
  const select = $<HTMLSelectElement>('settings-language');
  select.addEventListener('change', () => void chooseLanguage(select.value === 'system' ? 'system' : isLocaleId(select.value) ? select.value : 'system'));
  effect(() => {
    const state = languageState.value;
    void locale.value;
    const system = resolveLocale('system', state?.system ?? []);
    const option = (value: string, text: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    };
    const language = (l: (typeof LOCALES)[number]) => {
      const o = option(l.id, l.preview ? l.previewLabel : l.label);
      o.lang = l.id;
      return o;
    };
    // A language not yet read through by a fluent speaker is offered apart, under a heading that
    // says so, and named as a preview in its own words (milestone 68).
    const previews = document.createElement('optgroup');
    previews.label = t('settings.language.previews');
    previews.append(...LOCALES.filter((l) => l.preview && !l.pseudo).map(language));
    select.replaceChildren(
      option('system', t('settings.language.system', { language: LOCALES.find((l) => l.id === system)!.label })),
      ...LOCALES.filter((l) => !l.preview && !l.pseudo).map(language),
      ...(previews.childElementCount > 0 ? [previews] : []),
    );
    select.value = state?.choice ?? 'system';
  });
}

export function initSettings(): void {
  initAppearanceChoice();
  initThumbnailsChoice();
  initLanguageChoice();
  // The fetch, and the one line of status it reports through (milestone 17). The button is
  // the asking: nothing is fetched until it is pressed, and what arrives is checked against
  // its published checksum before it is kept (ADR 0022).
  const get = $<HTMLButtonElement>('settings-ffmpeg-get');
  const offer = $('settings-ffmpeg-offer');
  window.pulp.onFfmpegProgress((progress) => {
    if (get.hidden && offer.hidden) return;
    const percent = progress.fraction === null ? '' : ` ${Math.round(progress.fraction * 100)}%`;
    offer.hidden = false;
    sayPlain(offer, `${progress.note}${percent}`);
  });
  get.addEventListener('click', () => {
    get.disabled = true;
    offer.hidden = false;
    bindText(offer, 'settings.ffmpeg.fetching');
    void window.pulp.fetchFfmpeg().then(async (result) => {
      if (!result.ok) {
        get.disabled = false;
        sayPlain(offer, result.message);
        return;
      }
      // Renders work from here on, with no restart, and with the fetched build — it was fetched to
      // be used: the status bar and the Output tab are told exactly as they were at launch.
      refreshFfmpeg();
      await showFfmpeg();
      // What the fetched build turned out to lack, read from the build itself (milestone 88).
      if (result.lacks.length > 0) {
        offer.hidden = false;
        bindText(offer, 'fetch.ffmpeg.ready-lacking', { version: result.version, lacks: result.lacks.map((f) => f.library ?? f.missing.join(', ')).join(', ') });
      }
    });
  });
  // The switch to the fetched build, and a file of one's own (milestone 88).
  $<HTMLButtonElement>('settings-ffmpeg-use-fetched').addEventListener('click', () => {
    void window.pulp.chooseFfmpeg({ kind: 'fetched' }).then((r) => afterChoice(r));
  });
  $<HTMLButtonElement>('settings-ffmpeg-choose-file').addEventListener('click', () => {
    void window.pulp.chooseFfmpegFile().then((r) => afterChoice(r));
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
        sayPlain($('settings-semantic-note'), result.message);
        return;
      }
      await showSemantic();
    });
  });
  window.pulp.onSemanticProgress((progress) => {
    const dialog = $<HTMLDialogElement>('settings-dialog');
    if (!dialog.open) return;
    const percent = progress.fraction === null ? '' : ` ${Math.round(progress.fraction * 100)}%`;
    sayPlain($('settings-semantic-note'), `${progress.note}${percent}`);
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
  // A change of language made here (Settings → Language) or elsewhere: the lines the main process
  // wrote — the FFmpeg offer, the model's note — are asked for again, in the new language, unless a
  // fetch is under way and its progress is what the line is saying.
  whenLocaleChanges(() => {
    if (!$<HTMLDialogElement>('settings-dialog').open) return;
    if (!get.disabled) void showFfmpeg();
    if (!semanticGet.disabled) void showSemantic();
  });
  $('settings-close').addEventListener('click', () => $<HTMLDialogElement>('settings-dialog').close());
  $('notices-close').addEventListener('click', () => $<HTMLDialogElement>('notices-dialog').close());
}
