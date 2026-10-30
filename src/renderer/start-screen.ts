/**
 * The start screen (milestone 31): shown at launch and from File → Home. Get
 * going (a new project, blank or by shape, and the example projects), the
 * recent projects with pins and relinking, Learn (the tour, what's new, the
 * shortcuts), set up and status, and "What are you making?" leading into the
 * browse categories. What it offers is pure (src/core/start-screen.ts); this
 * draws it over the window and runs the choices.
 */

import { effect } from '@preact/signals';
import { setFor, setLook, setScope } from '../core/app-state';
import {
  lastOpenedLabel, libraryGlance, MAKING_CHOICES, makingChoiceLanding, orderRecents, PROJECT_SHAPES, setupChecklist,
} from '../core/start-screen';
import type { RecentProjectRow } from '../core/start-screen';
import { appState, dispatch, facets, preferredAspect } from './store';
import { browseFoldToActive } from './browse';
import { newProject, openExampleFrom, openProjectFrom } from './project';
import { showShortcuts } from './shortcuts';
import { showWhatsNew } from './whats-new';
import { startTour } from './tour';
import { setIcon } from './icons';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** Press the button that does this thing, as the menu does; the start screen grows no second way. */
function press(id: string): void {
  const el = document.getElementById(id) as HTMLButtonElement | null;
  if (el && !el.disabled) el.click();
}

export function startScreenShowing(): boolean {
  return !$('start-screen').hidden;
}

export function hideStartScreen(): void {
  $('start-screen').hidden = true;
}

// ---------------------------------------------------------------- the lists

/** The thumbnail the library has for a template, by its manifest id. */
function thumbnailFor(templateId: string | undefined): string | null {
  if (!templateId) return null;
  const entry = appState.value.index?.templates.find((t) => t.manifest.id === templateId);
  return entry?.thumbnail ?? null;
}

/** A card's picture: the thumbnail where there is one, an empty well otherwise. */
function thumbWell(templateId: string | undefined): HTMLElement {
  const well = document.createElement('span');
  well.className = 'start-thumb';
  const url = thumbnailFor(templateId);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    well.append(img);
  }
  return well;
}

async function fillExamples(): Promise<void> {
  const list = $('start-examples');
  const examples = await window.pulp.listExamples();
  list.replaceChildren();
  $('start-examples-empty').hidden = examples.length > 0;
  for (const example of examples) {
    const row = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'start-card';
    open.append(thumbWell(example.thumbTemplateId));
    const text = document.createElement('span');
    text.className = 'start-card-text';
    const name = document.createElement('span');
    name.className = 'start-card-name';
    name.textContent = example.name;
    const meta = document.createElement('span');
    meta.className = 'start-card-meta';
    meta.textContent = example.description;
    text.append(name, meta);
    open.append(text);
    open.addEventListener('click', () => {
      void openExampleFrom(example.path).then((opened) => {
        if (opened) hideStartScreen();
      });
    });
    row.append(open);
    list.append(row);
  }
}

function recentRow(row: RecentProjectRow): HTMLLIElement {
  const li = document.createElement('li');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'start-card';
  open.title = row.path;
  open.append(thumbWell(row.thumbTemplateId));
  const text = document.createElement('span');
  text.className = 'start-card-text';
  const name = document.createElement('span');
  name.className = 'start-card-name';
  name.textContent = row.name;
  const meta = document.createElement('span');
  meta.className = 'start-card-meta';
  meta.textContent = row.missing ? 'Missing — the file is not where it was' : lastOpenedLabel(row.lastOpened);
  if (row.missing) meta.classList.add('danger');
  text.append(name, meta);
  open.append(text);
  if (row.missing) {
    // Opening cannot work; the button that acts is Relink.
    open.disabled = true;
    const relink = document.createElement('button');
    relink.type = 'button';
    relink.textContent = 'Relink…';
    relink.addEventListener('click', () => {
      void window.pulp.relinkRecentProject(row.path).then((result) => {
        if (result.ok) void fillRecents();
      });
    });
    li.append(open, relink);
  } else {
    open.addEventListener('click', () => {
      void openProjectFrom(row.path).then((opened) => {
        if (opened) hideStartScreen();
        else void fillRecents(); // a file that has just gone missing is relisted as missing
      });
    });
    li.append(open);
  }
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'icon-button start-pin';
  pin.setAttribute('aria-label', row.pinned ? `Unpin ${row.name}` : `Pin ${row.name}`);
  pin.setAttribute('aria-pressed', row.pinned ? 'true' : 'false');
  setIcon(pin, row.pinned ? 'push-pin-fill' : 'push-pin');
  pin.addEventListener('click', () => {
    void window.pulp.setProjectPinned(row.path, !row.pinned).then(() => fillRecents());
  });
  li.append(pin);
  return li;
}

async function fillRecents(): Promise<void> {
  const list = $('start-recent');
  const rows = orderRecents(await window.pulp.recentProjectsDetailed());
  list.replaceChildren();
  $('start-recent-empty').hidden = rows.length > 0;
  for (const row of rows) list.append(recentRow(row));
}

function fillMaking(): void {
  const list = $('start-making');
  list.replaceChildren();
  for (const choice of MAKING_CHOICES) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'start-card';
    const text = document.createElement('span');
    text.className = 'start-card-text';
    const name = document.createElement('span');
    name.className = 'start-card-name';
    name.textContent = choice.label;
    const meta = document.createElement('span');
    meta.className = 'start-card-meta';
    meta.textContent = choice.hint;
    text.append(name, meta);
    button.append(text);
    button.addEventListener('click', () => {
      // The category, with "For…" set when the library has anything there for it (milestone 34).
      const landing = makingChoiceLanding(choice, facets.peek());
      if (!landing) return;
      dispatch((s) => setLook(setFor(setScope(s, landing.scope), landing.forTheme), null));
      browseFoldToActive();
      hideStartScreen();
    });
    li.append(button);
    list.append(li);
  }
}

function fillShapes(): void {
  const wrap = $('start-shapes');
  wrap.replaceChildren();
  for (const shape of PROJECT_SHAPES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${shape.label} · ${shape.hint}`;
    button.addEventListener('click', () => {
      void newProject().then((made) => {
        if (!made) return;
        preferredAspect.value = shape.id;
        hideStartScreen();
      });
    });
    wrap.append(button);
  }
}

async function fillSetup(): Promise<void> {
  const index = appState.value.index;
  const ffmpeg = await window.pulp.ffmpegStatus();
  const list = $('start-checklist');
  list.replaceChildren();
  const items = setupChecklist({ ffmpegOk: ffmpeg.ok, roots: index?.roots ?? [], ...(index?.builtInRoot ? { builtInRoot: index.builtInRoot } : {}) });
  for (const item of items) {
    const li = document.createElement('li');
    li.className = item.done ? 'done' : 'todo';
    const mark = document.createElement('span');
    mark.className = 'start-check-mark';
    mark.setAttribute('aria-hidden', 'true');
    setIcon(mark, item.done ? 'check-circle' : 'circle');
    const label = document.createElement('span');
    label.textContent = item.label;
    li.append(mark, label);
    if (!item.done && item.action) {
      const act = document.createElement('button');
      act.type = 'button';
      act.textContent = item.action;
      act.addEventListener('click', () => {
        press(item.id === 'folder' ? 'add-folder' : 'add-sample-media');
      });
      li.append(act);
    }
    list.append(li);
  }
  $('start-glance').textContent = libraryGlance(index);
}

// ---------------------------------------------------------------- showing

export function showStartScreen(): void {
  const screen = $('start-screen');
  screen.hidden = false;
  void fillExamples();
  void fillRecents();
  void fillSetup();
  void window.pulp.getStartScreenPrefs().then((prefs) => {
    $<HTMLInputElement>('start-show-at-startup').checked = prefs.showAtStartup;
    // The tour is suggested until it has been taken or skipped once.
    $('start-tour-hint').hidden = prefs.tourSeen;
  });
  $<HTMLButtonElement>('start-close').focus();
}

export function initStartScreen(): void {
  fillMaking();
  fillShapes();
  $('start-close').addEventListener('click', hideStartScreen);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && startScreenShowing()) hideStartScreen();
  });
  $<HTMLInputElement>('start-show-at-startup').addEventListener('change', (e) => {
    void window.pulp.setShowStartScreen((e.currentTarget as HTMLInputElement).checked);
  });
  $('start-new-blank').addEventListener('click', () => {
    void newProject().then((made) => {
      if (!made) return;
      preferredAspect.value = null;
      hideStartScreen();
    });
  });
  $('start-tour').addEventListener('click', () => {
    // The tour points at the window, so the screen over it goes first.
    hideStartScreen();
    startTour();
  });
  $('start-whats-new').addEventListener('click', showWhatsNew);
  $('start-shortcuts').addEventListener('click', () => void showShortcuts());
  $('start-add-folder').addEventListener('click', () => press('add-folder'));
  $('start-import-pack').addEventListener('click', () => press('import-pack'));
  $('start-sample-media').addEventListener('click', () => press('add-sample-media'));
  // The checklist and glance follow the library: a folder added from here ticks itself off.
  effect(() => {
    void appState.value.index;
    if (startScreenShowing()) void fillSetup();
  });
  // For tests and scripting: show and hide without the menu.
  const hooks = window as unknown as { pulpStartScreen?: (show: boolean) => void };
  hooks.pulpStartScreen = (show: boolean) => (show ? showStartScreen() : hideStartScreen());
}
