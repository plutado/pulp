/**
 * The start screen, redesigned around the few ways a person actually starts
 * (milestone 60; milestone 31 built what it offers). One lead action — New
 * project, the screen's only primary button — with Open beside it, the four
 * shapes as proportion tiles and the platforms as one list; then sections in
 * reading order: Continue (recent projects with recognizable thumbnails),
 * Start from an idea (the making choices and the example projects, one
 * gallery of real pictures with the browse cards' hover scrub), and Learn.
 * On a first run the set-up checklist is a card near the top with its
 * progress and Continue gives way to an invitation; once set up the checklist
 * leaves the screen (Help → Set-up Checklist still shows it). What it offers
 * is pure (src/core/start-screen.ts); this draws it and runs the choices.
 */

import { effect } from '@preact/signals';
import { setFor, setLook, setScope } from '../core/app-state';
import {
  ideaPicture, lastOpenedLabel, libraryGlance, MAKING_CHOICES, makingChoiceLanding, orderRecents,
  PROJECT_SHAPES, setupChecklist, startArrangement,
} from '../core/start-screen';
import type { RecentProjectRow } from '../core/start-screen';
import { HOVER_DWELL_MS, STRIP_FRAMES } from '../core/hover-scrub';
import { limitsCheckedLabel, PLATFORM_PRESETS, platformSummary } from '../core/platform-presets';
import { ASPECTS } from '../core/aspect';
import type { TemplateEntry } from '../core/library-types';
import { appState, dispatch, facets, preferredAspect, preferredPlatform } from './store';
import { browseFoldToActive } from './browse';
import { newProject, openExampleFrom, openProjectFrom } from './project';
import { showShortcuts } from './shortcuts';
import { showSettings } from './settings';
import { runLibraryAdd } from './library-add';
import { showWhatsNew } from './whats-new';
import { showUserGuide } from './user-guide';
import { startTour } from './tour';
import { setIcon, type IconName } from './icons';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export function startScreenShowing(): boolean {
  return !$('start-screen').hidden;
}

export function hideStartScreen(): void {
  $('start-screen').hidden = true;
}

// ---------------------------------------------------------------- pictures

/** The library entry behind a template's manifest id, for its thumbnail and its hover strip. */
function entryFor(templateId: string | undefined): TemplateEntry | undefined {
  if (!templateId) return undefined;
  return appState.value.index?.templates.find((t) => t.manifest.id === templateId);
}

/**
 * A card's picture: the entry's poster thumbnail, and — the browse cards' own
 * hover scrub (milestone 12) — eight frames of it under the pointer, the tile
 * picked by where the pointer is across the picture.
 */
/**
 * Put a hover strip's first frame on an element as its picture, and mark it `data-pictured` only once
 * the image is decoded and on the element. Marked when the strip's address was known, the picture was
 * still loading: anything waiting for "pictured" — the visual references do — could catch an empty well
 * on a slow machine and a filled one on a fast one, and the same screen captured two ways.
 */
function wearStrip(el: HTMLElement, url: string): void {
  const img = new Image();
  img.src = url;
  void img.decode().then(() => {
    if (el.querySelector('img')) return;
    el.style.backgroundImage = `url("${url}")`;
    el.style.backgroundSize = `${STRIP_FRAMES * 100}% 100%`;
    el.style.backgroundPosition = '0 0';
    el.dataset.pictured = '1';
  }, () => undefined);
}

/** A poster as an element's picture, marked `data-pictured` once it is decoded (see wearStrip). */
function posterImage(el: HTMLElement, src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  void img.decode().then(() => { el.dataset.pictured = '1'; }, () => undefined);
  return img;
}

function pictureFor(entry: TemplateEntry | undefined, stripOnly = false): HTMLElement {
  const pic = document.createElement('span');
  pic.className = 'start-idea-pic';
  if (!entry) return pic;
  if (entry.thumbnail && !stripOnly) pic.append(posterImage(pic, entry.thumbnail));
  const strip = document.createElement('span');
  strip.className = 'strip';
  pic.append(strip);
  // No poster made yet: the hover strip is rendered on demand, and its first frame is the
  // picture — a card never sits as an empty well waiting for the background queue (milestone 60).
  if (!entry.thumbnail || stripOnly) {
    void window.pulp.hoverStrip(entry.id).then((result) => {
      if (result.url && !pic.querySelector('img')) wearStrip(pic, result.url);
    });
  }
  let dwell: ReturnType<typeof setTimeout> | undefined;
  let url: string | null | undefined;
  const place = (e: PointerEvent) => {
    const box = pic.getBoundingClientRect();
    const across = Math.max(0, Math.min(0.999, (e.clientX - box.left) / Math.max(1, box.width)));
    const tile = Math.floor(across * STRIP_FRAMES);
    strip.style.backgroundPosition = `${(tile / (STRIP_FRAMES - 1)) * 100}% 0`;
  };
  pic.addEventListener('pointerenter', () => {
    dwell = setTimeout(() => {
      if (url === undefined) {
        void window.pulp.hoverStrip(entry.id).then((result) => {
          url = result.url;
          if (url && pic.matches(':hover')) {
            strip.style.backgroundImage = `url("${url}")`;
            pic.classList.add('scrubbing');
          }
        });
      } else if (url) {
        strip.style.backgroundImage = `url("${url}")`;
        pic.classList.add('scrubbing');
      }
    }, HOVER_DWELL_MS);
  });
  pic.addEventListener('pointermove', place);
  pic.addEventListener('pointerleave', () => {
    clearTimeout(dwell);
    pic.classList.remove('scrubbing');
  });
  return pic;
}

// ---------------------------------------------------------------- the lead

/** The four shapes as small tiles drawn in their own proportions, each starting a project leaning that way. */
function fillShapes(): void {
  const wrap = $('start-shapes');
  wrap.replaceChildren();
  for (const shape of PROJECT_SHAPES) {
    const aspect = ASPECTS.find((a) => a.id === shape.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'start-shape';
    button.setAttribute('aria-label', `New project at ${shape.id} (${shape.hint})`);
    button.dataset.tip = `${shape.hint} · the Output tab opens set to ${shape.id}`;
    const box = document.createElement('span');
    box.className = 'shape-box';
    const ratio = aspect ? aspect.w / aspect.h : 1;
    box.style.width = `${Math.round(24 * Math.max(0.5, ratio))}px`;
    const label = document.createElement('span');
    label.textContent = shape.id;
    button.append(box, label);
    button.addEventListener('click', () => {
      void newProject().then((made) => {
        if (!made) return;
        preferredAspect.value = shape.id;
        preferredPlatform.value = null;
        hideStartScreen();
      });
    });
    wrap.append(button);
  }
}

/** The platforms as one list (milestone 60), not sixteen buttons: choosing one starts the project leaning on it. */
function fillPlatforms(): void {
  const select = $<HTMLSelectElement>('start-platform-select');
  select.replaceChildren();
  const head = document.createElement('option');
  head.value = '';
  head.textContent = 'Choose…';
  select.append(head);
  for (const platform of PLATFORM_PRESETS) {
    const option = document.createElement('option');
    option.value = platform.id;
    option.textContent = platform.label;
    option.title = `${platform.hint} · ${platformSummary(platform)}`;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const platform = PLATFORM_PRESETS.find((p) => p.id === select.value);
    if (!platform) return;
    select.value = '';
    void newProject().then((made) => {
      if (!made) return;
      preferredAspect.value = platform.aspect;
      preferredPlatform.value = platform.id;
      hideStartScreen();
    });
  });
  $('start-platforms-note').textContent = `A platform sets the aspect, size, frame rate and encoder; limits ${limitsCheckedLabel()}.`;
}

// ---------------------------------------------------------------- continue

function recentRow(row: RecentProjectRow): HTMLLIElement {
  const li = document.createElement('li');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'start-recent-card';
  open.title = row.path;
  const well = document.createElement('span');
  well.className = 'start-thumb';
  const entry = entryFor(row.thumbTemplateId);
  if (entry?.thumbnail && !forcedMode) {
    well.append(posterImage(well, entry.thumbnail));
  } else if (entry) {
    // The poster is not made yet: the hover strip's first frame stands in, made on demand.
    void window.pulp.hoverStrip(entry.id).then((result) => {
      if (result.url && !well.querySelector('img')) wearStrip(well, result.url);
    });
  }
  open.append(well);
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
    relink.className = 'start-relink';
    relink.textContent = 'Relink…';
    relink.addEventListener('click', () => {
      void window.pulp.relinkRecentProject(row.path).then((result) => {
        if (result.ok) void arrange();
      });
    });
    li.append(open, relink);
  } else {
    open.addEventListener('click', () => {
      void openProjectFrom(row.path).then((opened) => {
        if (opened) hideStartScreen();
        else void arrange(); // a file that has just gone missing is relisted as missing
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
    void window.pulp.setProjectPinned(row.path, !row.pinned).then(() => arrange());
  });
  li.append(pin);
  return li;
}

// ---------------------------------------------------------------- start from an idea

/** One gallery: the making choices and the example projects, every card wearing a real picture. */
async function fillIdeas(): Promise<void> {
  const list = $('start-ideas');
  const examples = await window.pulp.listExamples();
  list.replaceChildren();
  for (const choice of MAKING_CHOICES) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'start-idea';
    button.append(pictureFor(ideaPicture(choice, appState.value.index, !forcedMode), !!forcedMode));
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
  for (const example of examples) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'start-idea start-example';
    const pic = pictureFor(entryFor(example.thumbTemplateId), !!forcedMode);
    const badge = document.createElement('span');
    badge.className = 'start-idea-badge';
    badge.textContent = 'Example';
    pic.append(badge);
    button.append(pic);
    const text = document.createElement('span');
    text.className = 'start-card-text';
    const name = document.createElement('span');
    name.className = 'start-card-name';
    name.textContent = example.name;
    const meta = document.createElement('span');
    meta.className = 'start-card-meta';
    meta.textContent = example.description;
    // The tile shows three lines of it at most; the whole of it is a hover away.
    button.dataset.tip = example.description;
    text.append(name, meta);
    button.append(text);
    button.addEventListener('click', () => {
      void openExampleFrom(example.path).then((opened) => {
        if (opened) hideStartScreen();
      });
    });
    li.append(button);
    list.append(li);
  }
}

// ---------------------------------------------------------------- set up, and the arrangement

/** Help → Set-up Checklist shows the card even once everything is done. */
let checklistAsked = false;
/** The visual references force an arrangement (tests only); undefined is the truth. */
let forcedMode: 'first-run' | 'returning' | undefined;

async function arrange(): Promise<void> {
  const index = appState.value.index;
  const [ffmpeg, download, recents] = await Promise.all([
    window.pulp.ffmpegStatus(),
    window.pulp.ffmpegDownloadStatus(),
    window.pulp.recentProjectsDetailed(),
  ]);
  // The forced first run (the visual references) draws its steps from fixed facts — FFmpeg found,
  // nothing added yet — so the card is the same on every machine, whatever this one has set up.
  const items = setupChecklist(forcedMode === 'first-run' ? { ffmpegOk: true, ffmpegDownloadable: false, roots: [] } : {
    ffmpegOk: ffmpeg.ok,
    ffmpegDownloadable: download.build !== null,
    roots: index?.roots ?? [],
    ...(index?.builtInRoot ? { builtInRoot: index.builtInRoot } : {}),
  });
  let plan = startArrangement(items, recents.length, checklistAsked);
  if (forcedMode === 'first-run') plan = { ...plan, firstRun: true, showContinue: false, showChecklist: true };
  if (forcedMode === 'returning') plan = { ...plan, firstRun: false, showContinue: true, showChecklist: false };

  // The set-up card, with its progress, near the top on a first run.
  $('start-setup-card').hidden = !plan.showChecklist;
  $('start-progress').textContent = plan.progress;
  const list = $('start-checklist');
  list.replaceChildren();
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
        // FFmpeg's own button opens Settings, where the offer says what would be fetched,
        // from whom and under what license — the asking, which happens in one place.
        if (item.id === 'ffmpeg') {
          void showSettings();
          return;
        }
        runLibraryAdd(item.id === 'folder' ? 'library.addFolder' : 'library.addSampleMedia');
      });
      li.append(act);
    }
    list.append(li);
  }

  // Continue leads with the most recent work; on a first run it gives way to the invitation.
  // The forced returning arrangement (the visual references) pins it to one row, the seeded project.
  let rows = plan.showContinue ? orderRecents(recents) : [];
  if (forcedMode === 'returning') rows = (rows.some((r) => r.name === 'interview') ? rows.filter((r) => r.name === 'interview') : rows).slice(0, 1);
  const recentList = $('start-recent');
  recentList.replaceChildren();
  for (const row of rows) recentList.append(recentRow(row));
  $('start-invite').hidden = plan.showContinue;

  // The library at a glance: one quiet line in the foot, not a block.
  // The forced arrangements (the visual references) count the bundled library alone — no media, no
  // favorites — so the line does not change with whatever the session has added or starred.
  const glanced = forcedMode && index
    ? { ...index, templates: index.templates.filter((t) => t.root === index.builtInRoot).map((t) => ({ ...t, favorite: false })), media: [] }
    : index;
  $('start-glance').textContent = libraryGlance(glanced);
}

// ---------------------------------------------------------------- showing

/** Which showing the screen is on, so a slower one finishing late cannot mark a newer one settled. */
let showing = 0;

export function showStartScreen(options: { checklist?: boolean } = {}): void {
  checklistAsked = options.checklist === true;
  const screen = $('start-screen');
  screen.hidden = false;
  const ticket = ++showing;
  delete screen.dataset.settled;
  const prefs = window.pulp.getStartScreenPrefs().then((prefs) => {
    $<HTMLInputElement>('start-show-at-startup').checked = prefs.showAtStartup;
    // The tour is suggested until it has been taken or skipped once; the forced arrangements pin it
    // to what each stands for, so a tour taken on this machine does not move the references.
    $('start-tour-hint').hidden = forcedMode ? forcedMode === 'returning' : prefs.tourSeen;
  });
  // The screen says when everything it shows has arrived — the arrangement, the gallery and the
  // switches — as `data-settled` naming the arrangement. The three finish in their own order, and the
  // visual references once caught a returning screen still wearing the first run's tour hint.
  void Promise.all([arrange(), fillIdeas(), prefs]).then(() => {
    if (ticket === showing) screen.dataset.settled = forcedMode ?? 'live';
  });
  // The lead action is where starting begins; the keyboard starts there too.
  $<HTMLButtonElement>('start-new-blank').focus();
}

export function initStartScreen(): void {
  fillShapes();
  fillPlatforms();
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
      preferredPlatform.value = null;
      hideStartScreen();
    });
  });
  $('start-open').addEventListener('click', () => {
    void openProjectFrom(null).then((opened) => {
      if (opened) hideStartScreen();
    });
  });
  $('start-tour').addEventListener('click', () => {
    // The tour points at the window, so the screen over it goes first.
    hideStartScreen();
    startTour();
  });
  $('start-guide').addEventListener('click', showUserGuide);
  $('start-whats-new').addEventListener('click', showWhatsNew);
  $('start-shortcuts').addEventListener('click', () => void showShortcuts());
  // The same three the browse panel's Add offers, in the same words (milestone 47) — plain
  // links in the foot now: the least important choices on the screen, but still on it.
  $('start-add-folder').addEventListener('click', () => runLibraryAdd('library.addFolder'));
  $('start-import-pack').addEventListener('click', () => runLibraryAdd('pack.import'));
  $('start-sample-media').addEventListener('click', () => runLibraryAdd('library.addSampleMedia'));
  // The section icons, from the bundled set: nothing decorative that says nothing — each names its section.
  for (const el of document.querySelectorAll<HTMLElement>('#start-screen [data-start-icon]')) {
    setIcon(el, el.dataset.startIcon as IconName);
  }
  // The checklist, Continue and the glance follow the library: a folder added here ticks itself off.
  effect(() => {
    void appState.value.index;
    // Not under a forced arrangement: its content is pinned (the visual references), and rebuilding the
    // gallery each time a background thumbnail lands could change the screen between a wait and a capture.
    if (startScreenShowing() && forcedMode === undefined) {
      void arrange();
      void fillIdeas();
    }
  });
  // For tests and scripting: show and hide without the menu, and the visual references' forced arrangements.
  const hooks = window as unknown as { pulpStartScreen?: (show: boolean, mode?: 'first-run' | 'returning') => void };
  hooks.pulpStartScreen = (show: boolean, mode?: 'first-run' | 'returning') => {
    forcedMode = mode;
    if (show) showStartScreen();
    else hideStartScreen();
  };
}
