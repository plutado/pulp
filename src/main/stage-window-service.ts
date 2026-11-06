/**
 * The stage's own window (milestone 43, ADR 0019). The renderer opens it with
 * `window.open` under a known name and moves the stage's elements into it, so
 * the window's page is the renderer's own and nothing is mirrored; this side
 * does what only the main process can: let exactly that window open, place it
 * where it was last — on a display that is still connected — remember where
 * it goes, hold its close until the stage has been put back, and fill a
 * display with it for theater.
 */

import { tr } from '../core/i18n';
import { app, ipcMain, screen, type BrowserWindow, type BrowserWindowConstructorOptions, type Display } from 'electron';
import type { StageOnDisplayResult } from '../shared/api';
import {
  DEFAULT_STAGE_WINDOW,
  STAGE_WINDOW_MIN,
  STAGE_WINDOW_NAME,
  stageWindowAtLaunch,
  stageWindowPlacement,
  type DisplayArea,
  type StageWindowState,
} from '../core/stage-window';
import { loadSettings, updateSettings } from './settings';
import { windowBackground } from './appearance-service';

let stageWindow: BrowserWindow | null = null;
/** The renderer has put the stage back and asked for the close: let it through. */
let closeAllowed = false;
/** The app is quitting: its windows close without being held, and the stage stays remembered as out. */
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});
/** The setting as last read or written, so the synchronous open handler can place the window. */
let remembered: StageWindowState = DEFAULT_STAGE_WINDOW;

function displays(): DisplayArea[] {
  return screen.getAllDisplays().map((d) => d.workArea);
}

async function remember(patch: Partial<StageWindowState>): Promise<void> {
  remembered = { ...remembered, ...patch };
  const next = remembered;
  await updateSettings((s) => ({ ...s, stageWindow: next }));
}

/** Read once at startup, so the first pop-out opens where the last one was. */
export async function loadStageWindowSetting(): Promise<void> {
  remembered = (await loadSettings()).stageWindow;
}

/**
 * The window options for a `window.open` the renderer makes under the stage's
 * name, or null for any other, which the main window refuses as before. Placed
 * where it was last if that display is connected; at its size alone, centered by
 * the platform, if not; at a default the first time.
 */
export function stageWindowOptions(frameName: string): BrowserWindowConstructorOptions | null {
  if (frameName !== STAGE_WINDOW_NAME) return null;
  return {
    ...stageWindowPlacement(remembered, displays()),
    minWidth: STAGE_WINDOW_MIN.width,
    minHeight: STAGE_WINDOW_MIN.height,
    title: tr('stage-window.title'),
    // The palette it opens in, as the main window's (milestone 62).
    backgroundColor: windowBackground(),
    // The application menu is the main window's; here it would only take a row from the picture.
    autoHideMenuBar: true,
    webPreferences: {
      // The picture answers frame requests through requestAnimationFrame, which throttling stops
      // (src/main/index.ts); a stage on a second display is often behind the main window's focus.
      backgroundThrottling: false,
    },
  };
}

/** Take charge of the window Electron made for the renderer's `window.open`. */
export function adoptStageWindow(win: BrowserWindow, main: BrowserWindow): void {
  stageWindow = win;
  closeAllowed = false;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // i18n-exempt(technical)
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  // Where it is, remembered as it settles; not while full screen or minimized, which are not places.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
      void remember({ open: true, bounds: win.getBounds() });
    }, 300);
  };
  win.on('move', save);
  win.on('resize', save);
  void remember({ open: true, bounds: win.getBounds() });

  // Its own close button, or the platform's close: the stage goes back first, then the window
  // goes (`stage-window:close`), so the picture is never lost with its window.
  win.on('close', (event) => {
    if (closeAllowed || quitting) return;
    event.preventDefault();
    main.webContents.send('stage-window:close-requested');
  });
  win.on('enter-full-screen', () => main.webContents.send('stage-window:full-screen-changed', true));
  win.on('leave-full-screen', () => main.webContents.send('stage-window:full-screen-changed', false));
  win.on('closed', () => {
    clearTimeout(timer);
    if (stageWindow === win) stageWindow = null;
  });
}

/** Wait for a full-screen transition to land, or give up: the animation takes about a second on macOS. */
function transition(win: BrowserWindow, event: 'enter-full-screen' | 'leave-full-screen', ms = 2_000): Promise<void> {
  return new Promise((resolve) => {
    if (win.isDestroyed()) {
      resolve();
      return;
    }
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    // Named one at a time: the typings overload per event, and a union of the two satisfies neither.
    if (event === 'enter-full-screen') win.once('enter-full-screen', done);
    else win.once('leave-full-screen', done);
  });
}

/**
 * Put the window on this display and fill it, and make sure the ask took.
 *
 * macOS grants full screen by moving the window to a Space of its own, and it
 * drops the request without a word when the window is not in a state to take
 * one: still coming up (this is called moments after the renderer opened it),
 * minimized, or sitting behind in another Space — which is where it is when a
 * run of other work has been in front of it. So the window is shown and given
 * focus where it is going first, the transition is waited for, and the ask is
 * repeated while it has not landed. Returns whether it ended up full screen;
 * a Linux session with no window manager to grant one says false rather than
 * leaving the caller to guess from the platform.
 */
async function fillDisplay(win: BrowserWindow, display: Display, tries = 4): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (win.isDestroyed()) return false;
    if (win.isFullScreen()) return true;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    // Inside the display first, so full screen takes that display and no other.
    const area = display.workArea;
    const width = Math.min(win.getBounds().width, area.width - 40);
    const height = Math.min(win.getBounds().height, area.height - 40);
    win.setBounds({ x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height });
    win.setFullScreen(true);
    await transition(win, 'enter-full-screen');
  }
  return !win.isDestroyed() && win.isFullScreen();
}

/** The stage's window, waiting a moment for one that is being opened right now. */
async function stageWindowSoon(): Promise<BrowserWindow | null> {
  for (let tries = 0; tries < 30; tries++) {
    if (stageWindow && !stageWindow.isDestroyed()) return stageWindow;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** The main window is going: its stage window goes with it, remembered as it was. */
/** The stage's window while it is out, so its background can follow the palette. */
export function currentStageWindow(): BrowserWindow | null {
  return stageWindow && !stageWindow.isDestroyed() ? stageWindow : null;
}

export function destroyStageWindow(): void {
  if (!stageWindow || stageWindow.isDestroyed()) return;
  closeAllowed = true;
  stageWindow.destroy();
  stageWindow = null;
}

export function registerStageWindowIpc(): void {
  // At launch: out again where it was, unless that display has gone — then in the main window,
  // the place forgotten so the next pop-out opens somewhere visible.
  ipcMain.handle('stage-window:state', async () => {
    remembered = (await loadSettings()).stageWindow;
    const next = stageWindowAtLaunch(remembered, displays());
    if (next !== remembered) await remember(next);
    return { open: next.open };
  });
  ipcMain.handle('stage-window:close', async () => {
    await remember({ open: false });
    // Destroyed rather than closed: the stage is already back, so there is nothing in the window to
    // ask — and a page that unloaded itself (a script's `window.close()`) could never answer a
    // close's unload round trip, which would leave the empty window standing.
    if (stageWindow && !stageWindow.isDestroyed()) {
      closeAllowed = true;
      stageWindow.destroy();
    }
    stageWindow = null;
  });
  ipcMain.handle('stage-window:full-screen', (_event, on: unknown) => {
    if (stageWindow && !stageWindow.isDestroyed()) stageWindow.setFullScreen(on === true);
  });
  // View → Stage on Display (milestone 43): the stage's window moves to the chosen display and
  // fills it. The renderer has just popped the stage out if it was not; the window it opened is
  // adopted within the same turn, but it is waited for rather than assumed.
  ipcMain.handle('stage-window:on-display', async (_event, id: unknown): Promise<StageOnDisplayResult> => {
    const display = screen.getAllDisplays().find((d) => d.id === id);
    if (!display) return { moved: false, fullScreen: false };
    const win = await stageWindowSoon();
    if (!win) return { moved: false, fullScreen: false };
    // Out of one display's full screen before into another's: the two cannot be asked at once.
    if (win.isFullScreen()) {
      win.setFullScreen(false);
      await transition(win, 'leave-full-screen');
    }
    const fullScreen = await fillDisplay(win, display);
    return { moved: !win.isDestroyed(), fullScreen };
  });
}
