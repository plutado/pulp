/**
 * The offscreen window a frame is captured from, fitted to the screen where
 * the screen is too small for it (Linux; src/core/capture-fit.ts has the why
 * and the arithmetic).
 *
 * Every page Pulp captures — a render, a caption style beside it, a drawn
 * clip's frames, the visual references — is made here, so one place knows
 * that on Linux a window the screen's size comes back a pixel short, and how
 * to ask for a smaller window at a higher scale instead. After the page has
 * loaded, `fitPageToFrame` tells it, through device emulation, that its
 * viewport is the frame's own size at a device pixel ratio of 1, scaled into
 * the small window: the capture is then the frame, pixel for pixel. Emulation
 * is enabled after the load on purpose — enabled before it, the renderer
 * crashed on the Linux virtual screen it was tried on.
 */

import { BrowserWindow, screen } from 'electron';
import { captureFit, type CaptureFit, type Size } from '../core/capture-fit';

/**
 * Device scale factor of a plain offscreen window. Always 1; PULP_OFFSCREEN_SCALE
 * exists only so tests can simulate a HiDPI surface and check that such a
 * render is refused rather than resized.
 */
export function offscreenDeviceScaleFactor(): number {
  const override = Number(process.env.PULP_OFFSCREEN_SCALE);
  return Number.isFinite(override) && override > 0 ? override : 1;
}

/** The primary display's size in device-independent pixels, which is what a window's size is measured in. */
export function primaryScreenSize(): Size | null {
  try {
    const { width, height } = screen.getPrimaryDisplay().size;
    return { width, height };
  } catch {
    // Before the app is ready, or with no display at all: nothing to fit to.
    return null;
  }
}

export interface CaptureWindow {
  win: BrowserWindow;
  /** How the frame is painted from the window; scale 1 is the frame's own window. */
  fit: CaptureFit;
  /** The frame the window was made for. */
  frame: Size;
}

/**
 * An offscreen, transparent, frameless window that captures `frame`: the
 * frame's own size where the platform allows it, and on a Linux screen too
 * small for it a smaller window at the scale that paints the frame whole.
 */
export function createCaptureWindow(frame: Size, options: { backgroundThrottling?: boolean } = {}): CaptureWindow {
  const fit = captureFit(frame, primaryScreenSize()) ?? { window: { ...frame }, scale: 1 };
  const win = new BrowserWindow({
    show: false,
    width: fit.window.width,
    height: fit.window.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      // Scale 1 on purpose: a 1920x1080 template is captured as 1920x1080 pixels on any display,
      // and window.devicePixelRatio is 1 inside the template. A fitted window paints at its own
      // scale, which `fitPageToFrame` hides from the page.
      offscreen: { deviceScaleFactor: fit.scale === 1 ? offscreenDeviceScaleFactor() : fit.scale },
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      ...(options.backgroundThrottling === false ? { backgroundThrottling: false } : {}),
    },
  });
  win.setContentSize(fit.window.width, fit.window.height);
  return { win, fit, frame };
}

/**
 * Once the page has loaded: give a fitted window's page the frame's own
 * viewport at a device pixel ratio of 1, scaled into the window, and wait for
 * the paint that follows so the first capture sees the page laid out for it.
 * Nothing at all for a window at scale 1.
 */
export async function fitPageToFrame({ win, fit, frame }: CaptureWindow): Promise<void> {
  if (fit.scale === 1 || win.isDestroyed()) return;
  win.webContents.enableDeviceEmulation({
    screenPosition: 'desktop',
    screenSize: { width: frame.width, height: frame.height },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 1,
    viewSize: { width: frame.width, height: frame.height },
    scale: 1 / fit.scale,
  });
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      win.webContents.removeListener('paint', done);
      resolve();
    };
    const timer = setTimeout(done, 500);
    win.webContents.once('paint', done);
    win.webContents.invalidate();
  });
}

/** What a refused capture can add on Linux: the screen that is in the way, and the way round it that was not open. */
export function screenHint(frame: Size): string {
  if (process.platform !== 'linux') return '';
  const size = primaryScreenSize();
  if (!size) return '';
  return ` On Linux a window is kept inside the screen (${size.width}x${size.height}); a frame the screen's size or larger is captured from a smaller window at a whole-number scale, which needs a size that divides by one — ${frame.width}x${frame.height} does not.`;
}
