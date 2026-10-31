/**
 * The page a Lottie animation is drawn in (milestone 35). A Lottie item has no
 * folder and no `index.html` of its own, so the template protocol answers its
 * entry with this page: the player script at a reserved path, the animation's
 * JSON inlined, and a `window.pulpRender(state)` that steps the player to the
 * frame the host asks for — never played in real time — so a render is frame
 * accurate at any rate, and the stage scrubs it like any template. The bridge
 * is injected into it by the protocol as into every template page.
 *
 * Pure: a string in, a string out. The script is plain ES2017 like the bridge.
 */

import type { LottieBinding } from './lottie-types';
import { LOTTIE_PLAYER_PATH } from './lottie-types';

export interface LottiePageInput {
  name: string;
  /** The document as the page should load it (src/core/lottie.ts, prepareLottieData). */
  data: Record<string, unknown>;
  bindings: readonly LottieBinding[];
  width: number;
  height: number;
  fps: number;
  /** Frames the animation runs for: out point less in point. */
  totalFrames: number;
}

/**
 * The page script. It keeps one loaded animation and reloads it only when a
 * parameter changes — the player reads text and colours once, at load — then
 * steps to the frame for `state.time`. The Fit setting sizes the container:
 * the SVG fills it, and `preserveAspectRatio` does the fitting or filling;
 * "its own size" places a box of the file's size in the middle of the frame.
 */
export const LOTTIE_PAGE_SCRIPT = `(function () {
  'use strict';
  var cfg = window.__pulpLottie;
  var container = document.getElementById('pulp-lottie');
  var anim = null, loading = null, loadedKey = null;
  function setAt(root, path, value) {
    var o = root;
    for (var i = 0; i < path.length - 1; i++) { if (o === null || typeof o !== 'object') return; o = o[path[i]]; }
    if (o !== null && typeof o === 'object') o[path[path.length - 1]] = value;
  }
  function hexComponents(hex) {
    var m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex === undefined || hex === null ? '' : hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1, hex: '#' + m[1].toLowerCase() };
  }
  /* Mirrors applyLottieParams in src/core/lottie.ts, the copy with unit tests: change both or neither. */
  function applied(params) {
    var data = JSON.parse(cfg.json);
    cfg.bindings.forEach(function (b) {
      var v = params ? params[b.id] : undefined;
      if (v === undefined || v === null) return;
      b.targets.forEach(function (t) {
        if (t.kind === 'text') { setAt(data, t.path, String(v).replace(/\\r\\n|\\n/g, '\\r')); return; }
        var c = hexComponents(v);
        if (!c) return;
        if (t.kind === 'hex') setAt(data, t.path, c.hex);
        else if (t.kind === 'rgb') setAt(data, t.path, [c.r, c.g, c.b]);
        else setAt(data, t.path, [c.r, c.g, c.b, c.a]);
      });
    });
    return data;
  }
  function place(fit, width, height) {
    if (fit === 'center') {
      container.style.width = cfg.width + 'px';
      container.style.height = cfg.height + 'px';
      container.style.left = Math.round((width - cfg.width) / 2) + 'px';
      container.style.top = Math.round((height - cfg.height) / 2) + 'px';
    } else {
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.left = '0';
      container.style.top = '0';
    }
  }
  function load(params, fit) {
    if (anim) { try { anim.destroy(); } catch (e) { /* already gone */ } anim = null; }
    container.innerHTML = '';
    return new Promise(function (resolve, reject) {
      if (!window.lottie || typeof window.lottie.loadAnimation !== 'function') { reject(new Error('the Lottie player did not load')); return; }
      var settled = false;
      var item = window.lottie.loadAnimation({
        container: container,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: applied(params),
        rendererSettings: { preserveAspectRatio: fit === 'fill' ? 'xMidYMid slice' : 'xMidYMid meet', progressiveLoad: false, hideOnTransparent: true }
      });
      anim = item;
      item.addEventListener('DOMLoaded', function () { if (!settled) { settled = true; resolve(item); } });
      item.addEventListener('data_failed', function () { if (!settled) { settled = true; reject(new Error('the animation could not be read by the player')); } });
      item.addEventListener('error', function (e) {
        if (settled) return;
        settled = true;
        reject(new Error('the player reported an error' + (e && e.nativeError && e.nativeError.message ? ': ' + e.nativeError.message : '')));
      });
    });
  }
  window.pulpRender = function (state) {
    var params = state && state.params ? state.params : {};
    var fit = params.fit === 'fill' || params.fit === 'center' ? params.fit : 'fit';
    var key = JSON.stringify(params);
    if (key !== loadedKey || !loading) { loadedKey = key; loading = load(params, fit); }
    var current = loading;
    return current.then(function (item) {
      if (current !== loading) return;
      place(fit, state.width, state.height);
      /* The host's time on the template's timeline is the animation's own: a frame at another
         output rate lands between keyframes and the player interpolates there. */
      var frame = Math.max(0, Math.min(cfg.totalFrames - 0.001, (state.time || 0) * cfg.fps));
      item.goToAndStop(frame, true);
    });
  };
})();`;

/** JSON safe inside a <script>: no closing tag, no line separators the parser would stumble on. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The entry page for a Lottie item. */
export function lottiePageHtml(input: LottiePageInput): string {
  const config = inlineJson({
    // Kept as a string and parsed per load, so every load starts from the file as read.
    json: JSON.stringify(input.data),
    bindings: input.bindings,
    width: input.width,
    height: input.height,
    fps: input.fps,
    totalFrames: input.totalFrames,
  });
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(input.name)}</title>`,
    '<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}',
    '#pulp-lottie{position:absolute;left:0;top:0;width:100%;height:100%}#pulp-lottie svg{display:block}</style>',
    '</head><body><div id="pulp-lottie"></div>',
    `<script src="/${LOTTIE_PLAYER_PATH}"></script>`,
    `<script>window.__pulpLottie = ${config};</script>`,
    `<script>${LOTTIE_PAGE_SCRIPT}</script>`,
    '</body></html>',
  ].join('\n');
}
