/**
 * The captions in the preview (milestone 50): the chosen caption style drawn
 * over the graphic, on its own page, a frame at a time.
 *
 * A caption style **is a template** (docs/template-format.md, "Caption
 * styles"), so it is drawn the way every template is drawn here — its own
 * page in an iframe, handed a frame state and asked to paint it. What it is
 * handed on top of the usual state is `captions`: the line on screen at this
 * moment, which of its words is being spoken, and the band of the frame a
 * caption belongs in at this shape. All of that is computed by
 * src/core/captions.ts, so what the preview shows and what the lines say can
 * never drift apart.
 *
 * The page sits above the graphic and takes no pointer: captions are the last
 * thing over the picture, and nothing on the stage is clicked through them.
 */

import { captionFrame, type CaptionsValue } from '../core/captions';
import { captionBandFor } from '../core/player';
import { frameState } from '../core/runtime';
import { defaultParams } from '../core/params';
import { templateUrlFor } from '../shared/api';
import type { TemplateEntry } from '../core/library-types';
import { appState } from './store';
import { frameColorScheme } from '../core/appearance';

let frame: HTMLIFrameElement | null = null;
/** The style the page is showing now, so it is loaded once rather than per frame. */
let loaded: string | null = null;
let shown: CaptionsValue | null = null;
/** The last frame asked for, re-asked once the page says it is ready. */
let pending: { time: number; size: { width: number; height: number } } | null = null;

export function mountCaptionsPreview(el: HTMLIFrameElement): void {
  frame = el;
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; colorScheme?: unknown } | null;
    if (data?.type !== 'pulp:ready' || !frame || event.source !== frame.contentWindow) return;
    // The page's own color scheme on its frame, as the template's (src/core/appearance.ts).
    frame.style.colorScheme = frameColorScheme(data.colorScheme);
    // A page that has just loaded has missed the frame that was asked for before it was there.
    if (pending) captionsPreviewDraw(pending.time, pending.size);
  });
}

/** The caption style this project draws with, as the library knows it, or null for none. */
function styleEntry(captions: CaptionsValue | null): TemplateEntry | null {
  if (!captions?.style || captions.lines.length === 0) return null;
  const found = (appState.value.index?.templates ?? []).find((t) => t.id === captions.style);
  return found?.manifest.captions ? found : null;
}

/**
 * Bring the page in line with the project's captions: nothing to draw hides
 * it, a new style loads it, and the same style twice does nothing — so this
 * is called as often as the stage likes.
 */
export function captionsPreviewSync(captions: CaptionsValue | null): void {
  shown = captions;
  if (!frame) return;
  const entry = styleEntry(captions);
  if (!entry) {
    frame.hidden = true;
    loaded = null;
    frame.removeAttribute('src');
    return;
  }
  frame.hidden = false;
  if (loaded === entry.id) return;
  loaded = entry.id;
  frame.style.colorScheme = '';
  frame.src = templateUrlFor(entry.id, entry.manifest.entry);
}

/** Draw the captions at this moment of the project, at the size the preview is drawn at. */
export function captionsPreviewDraw(time: number, size: { width: number; height: number }): void {
  const entry = styleEntry(shown);
  if (!frame || frame.hidden || !entry || !shown) return;
  pending = { time, size };
  const win = frame.contentWindow;
  if (!win) return;
  const manifest = entry.manifest;
  const state = frameState(
    manifest,
    Math.max(0, Math.round(time * manifest.fps)),
    defaultParams(manifest),
    size,
    {},
    {},
    undefined,
    captionFrame(shown, time, captionBandFor(size.width, size.height)),
  );
  win.postMessage({ type: 'pulp:render', id: state.frame, state }, '*');
}
