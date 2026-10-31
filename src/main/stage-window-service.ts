/**
 * The stage's own window (milestone 43, ADR 0019). The renderer opens it with
 * `window.open` under a known name and moves the stage's elements into it, so
 * the window's page is the renderer's own and nothing is mirrored; this side
 * does what only the main process can: let exactly that window open, place it
 * where it was last — on a display that is still connected — remember where
 * it goes, hold its close until the stage has been put back, and fill a
 * display with it for theater.
 */

import { app, ipcMain, screen, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
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
 * where it was last if that display is connected; at its size alone, centred by
 * the platform, if not; at a default the first time.
 */
export function stageWindowOptions(frameName: string): BrowserWindowConstructorOptions | null {
  if (frameName !== STAGE_WINDOW_NAME) return null;
  return {
    ...stageWindowPlacement(remembered, displays()),
    minWidth: STAGE_WINDOW_MIN.width,
    minHeight: STAGE_WINDOW_MIN.height,
    title: 'Stage',
    backgroundColor: '#16181d',
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  // Where it is, remembered as it settles; not while full screen or minimised, which are not places.
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

/** The main window is going: its stage window goes with it, remembered as it was. */
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
}
