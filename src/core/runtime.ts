/**
 * The host side of the template runtime contract (see docs/template-format.md,
 * "Runtime contract").
 *
 * A template page defines `window.pulpRender(state)`. The host injects a small
 * bridge script into the template's HTML entry point; the bridge exposes
 * `window.__pulp` for direct calls (offscreen rendering via
 * executeJavaScript) and answers `postMessage` requests (the preview iframe).
 */

import type { Size } from './aspect';
import { frameCount, type TemplateManifest } from './manifest';
import type { ResolvedParams } from './params';

export interface FrameState {
  /** Zero-based frame index. */
  frame: number;
  /** Time in seconds at the start of this frame: frame / fps. */
  time: number;
  /** time / duration, clamped to [0, 1]. */
  progress: number;
  fps: number;
  duration: number;
  totalFrames: number;
  width: number;
  height: number;
  params: ResolvedParams;
}

/**
 * The state for one frame. `size` is the canvas the template is handed this
 * time — the render's chosen resolution, the preview's, the thumbnail's — not
 * anything the manifest says: a template draws for a shape, and learns the
 * pixel size from here (docs/template-format.md, ADR 0012).
 */
export function frameState(
  manifest: Pick<TemplateManifest, 'duration' | 'fps'>,
  frame: number,
  params: ResolvedParams,
  size: Size,
): FrameState {
  const totalFrames = frameCount(manifest);
  const f = Math.min(Math.max(0, Math.floor(frame)), totalFrames - 1);
  const time = f / manifest.fps;
  return {
    frame: f,
    time,
    progress: Math.min(1, Math.max(0, time / manifest.duration)),
    fps: manifest.fps,
    duration: manifest.duration,
    totalFrames,
    width: size.width,
    height: size.height,
    params,
  };
}

/**
 * Content-Security-Policy applied to every template response. Templates are
 * offline documents: they may load files from their own folder and use inline
 * scripts and styles, but cannot reach the network.
 */
export const TEMPLATE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Source of the bridge script. Kept as plain ES2017 so it runs in any Chromium.
 * No line comments: it is injected on a single line (see injectBridge).
 */
export const BRIDGE_SCRIPT = `(function () {
  'use strict';
  var ready = new Promise(function (resolve) {
    function done() {
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      fonts.then(function () { resolve(true); });
    }
    if (document.readyState === 'complete') done();
    else window.addEventListener('load', done, { once: true });
  });
  function render(state) {
    return ready.then(function () {
      if (typeof window.pulpRender !== 'function') {
        throw new Error('Template does not define window.pulpRender(state)');
      }
      return window.pulpRender(state);
    }).then(function () {
      /* Two animation frames: the first callback runs before the frame holding the draw is
         committed to the compositor, so resolving there can let a capture see the previous frame
         (observed on Windows CI as a blank or one-frame-stale first capture). The second callback
         runs after that commit. */
      return new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); });
      });
    });
  }
  window.__pulp = { ready: ready, render: render };
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'pulp:render' || !event.source) return;
    var reply = event.source;
    render(data.state).then(function () {
      reply.postMessage({ type: 'pulp:rendered', id: data.id }, '*');
    }, function (err) {
      reply.postMessage({ type: 'pulp:error', id: data.id, message: String(err && err.message || err) }, '*');
    });
  });
  ready.then(function () {
    if (window.parent !== window) window.parent.postMessage({ type: 'pulp:ready' }, '*');
  });
})();`;

/** The bridge on one line, so injecting it does not shift line numbers in template error locations. */
export const BRIDGE_SCRIPT_INLINE = BRIDGE_SCRIPT.replace(/\s*\n\s*/g, ' ');

/** Insert the bridge as the first script of the document so it runs before template code. */
export function injectBridge(html: string): string {
  const tag = `<script data-pulp-bridge>${BRIDGE_SCRIPT_INLINE}</script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const htmlTag = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + `<head>${tag}</head>` + html.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype[0].length) + tag + html.slice(doctype[0].length);
  return tag + html;
}
