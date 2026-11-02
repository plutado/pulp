/**
 * Fitting a capture window to a screen that is too small for it (Linux).
 *
 * On X11, Chromium shrinks any window that matches the desktop's size by a
 * pixel in each dimension, so that a window manager does not take it for a
 * fullscreen one — hidden and offscreen windows included, whatever their type.
 * A 1080p render on a 1080p desktop was therefore captured at 1919 × 1079 and
 * refused, and a 4K render on any ordinary screen could not happen at all.
 *
 * The way round it is to ask for a **smaller window at a higher device
 * scale**: a 960 × 540 window at scale 2 paints 1920 × 1080 pixels. The page
 * is then told, through device emulation, that its viewport is the frame's
 * own size at a device pixel ratio of 1 — so `innerWidth`, the CSS layout
 * and everything a template draws are exactly as on a large screen — and
 * shown scaled down by the same factor into the small window. A template's
 * canvas fills its viewport by CSS and keeps its backing at the frame's size,
 * so each of its pixels lands on exactly one captured pixel: the capture is
 * the same bitmap, byte for byte, as a plain render (checked on a Linux
 * virtual screen in tests/e2e/render.e2e.test.ts).
 *
 * The factor has to divide the frame exactly, or there would be a pixel to
 * split; the first factor from 2 that does and that brings the window under
 * the screen is the one. A frame that fits is left alone, on every platform.
 *
 * Pure: which window to make and at what scale. src/main/capture-window.ts
 * makes it.
 */

export interface Size {
  width: number;
  height: number;
}

/** The window to make for a frame: its size, and the device scale that paints the frame from it. */
export interface CaptureFit {
  /** The window's size in device-independent pixels. The frame's own when the scale is 1. */
  window: Size;
  /** The device scale factor; the frame is `window × scale`. */
  scale: number;
}

/** Past this a frame has an edge no ordinary size shares a factor with; the plain refusal says why. */
export const MAX_CAPTURE_SCALE = 16;

/** A frame has to be strictly inside the screen: a window the screen's own size is the one that is shrunk. */
export function frameFitsScreen(frame: Size, screen: Size): boolean {
  return frame.width < screen.width && frame.height < screen.height;
}

/**
 * How to capture `frame` on a machine whose screen is `screen`. Scale 1 — the
 * frame's own window — everywhere the platform allows it, which is every
 * platform but Linux, and Linux when the frame fits. Null when no factor up
 * to the limit both divides the frame and fits the screen; the caller then
 * renders plainly and the capture's own check says what happened.
 */
export function captureFit(frame: Size, screen: Size | null, platform: NodeJS.Platform = process.platform): CaptureFit | null {
  const plain: CaptureFit = { window: { width: frame.width, height: frame.height }, scale: 1 };
  if (platform !== 'linux' || !screen || screen.width <= 0 || screen.height <= 0) return plain;
  if (frameFitsScreen(frame, screen)) return plain;
  for (let scale = 2; scale <= MAX_CAPTURE_SCALE; scale++) {
    if (frame.width % scale !== 0 || frame.height % scale !== 0) continue;
    const window = { width: frame.width / scale, height: frame.height / scale };
    if (frameFitsScreen(window, screen)) return { window, scale };
  }
  return null;
}
