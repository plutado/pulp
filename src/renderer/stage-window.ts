/**
 * The stage popped out into a window of its own (milestone 43, ADR 0019), on
 * any display: a second screen for the picture, the main one for browsing.
 *
 * The stage **moves rather than mirrors**. The renderer opens a child window
 * with `window.open` — an `about:blank` page, which shares this page's origin
 * and script — and moves the stage's own elements into it: the region with
 * the picture, the layer overlay and the corner controls, and the transport
 * row's first line, the scrub bar with the lanes under it. Every listener,
 * signal and module that was wired to those elements is still wired to them,
 * because they are the same elements; nothing is copied and nothing is
 * synchronised. What a window owns rather than an element — resize, the
 * template page's messages, tooltips, the right-click menu's closing, the
 * `T` key — is told where the stage is (`stageRehome`, and the watchers here).
 *
 * The main process places the window where it was last (on a display that is
 * still connected), remembers where it goes, and holds its close until the
 * stage has been put back, so the picture is never lost with its window
 * (src/main/stage-window-service.ts).
 */

import { STAGE_WINDOW_NAME } from '../core/stage-window';
import { watchContextMenuIn } from './context-menu';
import { setIcon } from './icons';
import { initTooltips } from './tooltip';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** The stage's window while it is out, and where its elements came from, to put them back. */
let out: {
  win: Window;
  stage: HTMLElement;
  scrubLine: HTMLElement;
  lanes: HTMLElement;
  stageParent: HTMLElement;
  stageNext: Node | null;
  rowParent: HTMLElement;
  rowNext: Node | null;
} | null = null;

/**
 * Told when the stage leaves for a window (its document) and when it is back
 * (null), once its elements have moved. The stage itself listens (it re-homes
 * what is wired to a window rather than an element), as do theater and the
 * menus; this module imports none of them, so the menus can import it without
 * dragging the stage's elements into every page that builds a menu.
 */
const watchers: ((doc: Document | null) => void)[] = [];
export function onStageWindow(cb: (doc: Document | null) => void): void {
  watchers.push(cb);
}

export function stageIsOut(): boolean {
  return out !== null;
}

/** The document the stage's elements are in: the stage's own window's, or null when it is here. */
export function stageDocument(): Document | null {
  return out?.win.document ?? null;
}

/**
 * A control by id, wherever the stage is: the main document, or the stage's
 * window when a stage control has gone there with it. For the menus, which
 * read and press the window's own buttons rather than keeping state of their own.
 */
export function findControl(id: string): HTMLElement | null {
  return document.getElementById(id) ?? stageDocument()?.getElementById(id) ?? null;
}

/** The stylesheet, serialised: the fallback when the window cannot load it by link. */
function stylesheetText(): string {
  const rules: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) rules.push(rule.cssText);
    } catch {
      // A sheet this document may not read: nothing of ours.
    }
  }
  return rules.join('\n');
}

function paintButton(): void {
  const button = findControl('stage-popout');
  if (!button) return;
  const isOut = stageIsOut();
  button.setAttribute('aria-pressed', String(isOut));
  button.setAttribute('aria-label', isOut ? 'Bring the stage back' : 'Pop out the stage');
  button.dataset.tip = isOut ? 'Bring the stage back into the main window' : 'Pop out the stage into a window of its own, for any display';
  setIcon(button, isOut ? 'arrow-square-in' : 'arrow-square-out', 20);
}

/**
 * Move the stage out. False when the window could not be opened, which leaves
 * everything as it was.
 */
export function popOutStage(): boolean {
  if (out) return true;
  const win = window.open('about:blank', STAGE_WINDOW_NAME);
  if (!win) return false;
  const doc = win.document;
  doc.documentElement.lang = 'en';
  doc.title = 'Stage';
  // The same stylesheet as this page's, by the same link; serialised in place should the link fail.
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./styles.css', document.baseURI).href;
  link.onerror = () => {
    const style = doc.createElement('style');
    style.textContent = stylesheetText();
    doc.head.append(style);
  };
  doc.head.append(link);
  doc.body.className = 'stage-window';

  const stage = $('region-stage');
  const scrubLine = $('scrub-line');
  const lanes = $('transport-lanes');
  out = {
    win,
    stage,
    scrubLine,
    lanes,
    stageParent: stage.parentElement!,
    stageNext: stage.nextSibling,
    rowParent: scrubLine.parentElement!,
    rowNext: lanes.nextSibling,
  };
  // The timeline under the picture: the row's first line, in a host of its own that the scrub
  // bar is placed against as it was against the row.
  const timeline = doc.createElement('div');
  timeline.className = 'stage-timeline';
  timeline.append(scrubLine, lanes);
  doc.body.append(stage, timeline);
  // The window going without asking — a script's `window.close()`, which Electron takes past the
  // close the main process holds — still gives the stage back: its document is alive through
  // pagehide, which is when the elements come home. The ordinary close never gets here with the
  // stage still out.
  win.addEventListener('pagehide', () => {
    if (out?.win === win) popInStage();
  });

  initTooltips(doc);
  watchContextMenuIn(doc);
  $('app').classList.add('stage-out');
  paintButton();
  for (const cb of watchers) cb(doc);
  return true;
}

/** Put the stage back where it was, and let its window go. */
export function popInStage(): void {
  if (!out) return;
  const was = out;
  out = null;
  was.stageParent.insertBefore(was.stage, was.stageNext);
  was.rowParent.insertBefore(was.scrubLine, was.rowNext);
  was.rowParent.insertBefore(was.lanes, was.rowNext);
  $('app').classList.remove('stage-out');
  paintButton();
  for (const cb of watchers) cb(null);
  // The window closes once the stage is out of it, never before.
  void window.pulp.closeStageWindow();
}

export function toggleStagePopOut(): void {
  if (out) popInStage();
  else popOutStage();
}

/** View → Stage on Display: the stage in its own window, filling that display with the picture alone. */
export function stageOnDisplay(id: number): void {
  if (!Number.isFinite(id)) return;
  if (!out && !popOutStage()) return;
  void window.pulp.stageWindowOnDisplay(id);
}

export function initStageWindow(): void {
  $('stage-popout').addEventListener('click', toggleStagePopOut);
  // The window's own close button: the stage comes back first, then the window goes.
  window.pulp.onStageWindowCloseRequested(() => popInStage());
  // Out again at launch if it was left out — unless its display has gone, which the main process decides.
  void window.pulp.stageWindowState().then(({ open }) => {
    if (open) popOutStage();
  });
  paintButton();
}
