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
import { imageSlots, type ImageSlotState } from './image-slot';
import { frameCount, type TemplateManifest, type TemplateParameter } from './manifest';
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
  /** The template's image slots laid out for this frame; the bridge attaches the decoded picture to each chosen one. */
  images: Record<string, ImageSlotState>;
}

/**
 * The state for one frame. `size` is the canvas the template is handed this
 * time — the render's chosen resolution, the preview's, the thumbnail's — not
 * anything the manifest says: a template draws for a shape, and learns the
 * pixel size from here (docs/template-format.md, ADR 0012).
 */
export function frameState(
  manifest: Pick<TemplateManifest, 'duration' | 'fps'> & { parameters?: readonly TemplateParameter[] },
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
    images: manifest.parameters ? imageSlots(manifest.parameters, params, size) : {},
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
  var MAX_SIDE = 4096;
  var pictures = {};
  function requestKey(r) { return r.id + '|' + r.treatment + '|' + (r.treatment === 'tinted' ? r.tint : ''); }
  function loadPicture(r) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Image ' + r.id + ' could not be decoded')); };
      if (!r.src) { reject(new Error('Image ' + r.id + ' was not handed to the template')); return; }
      img.src = r.src;
    }).then(function (img) {
      var w = img.naturalWidth || 1, h = img.naturalHeight || 1;
      var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0, c.width, c.height);
      if (r.treatment !== 'original') {
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = r.treatment === 'white' ? '#ffffff' : r.treatment === 'black' ? '#000000' : r.tint;
        x.fillRect(0, 0, c.width, c.height);
      }
      return c;
    });
  }
  function prepare(requests) {
    return ready.then(function () {
      return Promise.all((requests || []).map(function (r) {
        var key = requestKey(r);
        if (!pictures[key]) pictures[key] = loadPicture(r);
        return pictures[key];
      }));
    }).then(function () { return true; });
  }
  function attachPictures(state) {
    var images = state && state.images ? state.images : {};
    var pending = [];
    Object.keys(images).forEach(function (slotId) {
      var slot = images[slotId];
      if (!slot.id) return;
      var p = pictures[requestKey(slot)];
      if (!p) return;
      pending.push(p.then(function (c) { slot.bitmap = c; }, function () { slot.bitmap = null; }));
    });
    return Promise.all(pending);
  }
  function fitBox(box, iw, ih, fit, align, margin) {
    var inset = Math.max(0, Math.min(0.45, margin || 0)) * Math.min(box.width, box.height);
    var innerW = Math.max(1, box.width - inset * 2), innerH = Math.max(1, box.height - inset * 2);
    var scale = fit === 'cover' ? Math.max(innerW / iw, innerH / ih) : Math.min(innerW / iw, innerH / ih);
    var w = iw * scale, h = ih * scale;
    var a = align || 'center';
    var ax = a === 'left' || /-left$/.test(a) ? 0 : a === 'right' || /-right$/.test(a) ? 1 : 0.5;
    var ay = /^top/.test(a) ? 0 : /^bottom/.test(a) ? 1 : 0.5;
    return { x: box.x + inset + (innerW - w) * ax, y: box.y + inset + (innerH - h) * ay, width: w, height: h };
  }
  function drawImage(ctx, state, slotId, box) {
    var slot = state && state.images ? state.images[slotId] : null;
    if (!slot || !slot.bitmap) return false;
    var target = box || slot.box;
    var at = fitBox(target, slot.bitmap.width, slot.bitmap.height, slot.fit, slot.align, slot.margin);
    ctx.save();
    if (slot.effect === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = Math.max(2, at.height * 0.12); ctx.shadowOffsetY = Math.max(1, at.height * 0.04); }
    else if (slot.effect === 'glow') { ctx.shadowColor = slot.treatment === 'tinted' ? slot.tint : 'rgba(255,255,255,0.85)'; ctx.shadowBlur = Math.max(4, at.height * 0.25); }
    ctx.drawImage(slot.bitmap, at.x, at.y, at.width, at.height);
    ctx.restore();
    return true;
  }
  function render(state) {
    return ready.then(function () {
      if (typeof window.pulpRender !== 'function') {
        throw new Error('Template does not define window.pulpRender(state)');
      }
      return attachPictures(state).then(function () { return window.pulpRender(state); });
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
  window.__pulp = { ready: ready, render: render, prepare: prepare, drawImage: drawImage, fitBox: fitBox };
  window.pulpDrawImage = drawImage;
  window.pulpFitBox = fitBox;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || !event.source) return;
    var reply = event.source;
    if (data.type === 'pulp:prepare') {
      prepare(data.requests).then(function () {
        reply.postMessage({ type: 'pulp:prepared', id: data.id }, '*');
      }, function (err) {
        reply.postMessage({ type: 'pulp:prepared', id: data.id, message: String(err && err.message || err) }, '*');
      });
      return;
    }
    if (data.type !== 'pulp:render') return;
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
