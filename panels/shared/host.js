/**
 * What the editing app around the panel can do with a file (milestone 54's
 * drop): import it into the bin, put it on the timeline at the playhead, or
 * carry it in a native drag. One object, `window.pulpHost`, filled in for
 * whichever host is around:
 *
 * - Premiere Pro (CEP): ExtendScript in host.jsx, called through
 *   `__adobe_cep__.evalScript` — import into the active bin, insert on the
 *   first unlocked video track at the playhead. No native drag-out API, so
 *   dragging offers the file as a URI and lets Chromium do what it can.
 * - DaVinci Resolve (Workflow Integration): the plugin's preload exposes the
 *   Resolve API calls — import into the media pool, append to the timeline
 *   (the scripting API has no insert-at-playhead; the native drag is how a
 *   clip lands at the playhead, dropped where the pointer is).
 * - Neither (a plain browser): everything disabled, said rather than broken.
 *
 * Plain script, loaded after connect.js and before panel.js.
 */

/**
 * The panel's appearance follows the host's own (milestone 62), not Pulp's: a
 * panel is part of the editing app's window. Premiere says its panel color
 * through CEP — a dark gray by default, lighter at its brighter settings — and
 * says again when it is changed, so the panel takes the light or dark palette
 * that color calls for. Not the color itself: the brightness is a slider, and
 * on a mid gray no secondary text reads at AA, where both palettes are held to
 * it. Resolve's own window is dark only, and a plain browser has the system's
 * preference.
 * The palette is `data-palette` on the page; panel.css has both.
 */
(function () {
  'use strict';

  var root = document.documentElement;

  /** A light panel color wants dark text: the perceived lightness, on 0 to 255. */
  function paletteFor(color) {
    return 0.299 * color.red + 0.587 * color.green + 0.114 * color.blue > 128 ? 'light' : 'dark';
  }

  function premiereSkin() {
    try {
      var env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
      var color = env.appSkinInfo.panelBackgroundColor.color;
      if (typeof color.red !== 'number' || typeof color.green !== 'number' || typeof color.blue !== 'number') return null;
      return color;
    } catch {
      return null;
    }
  }

  function applyPremiere() {
    var color = premiereSkin();
    if (!color) {
      root.dataset.palette = 'dark';
      return;
    }
    root.dataset.palette = paletteFor(color);
  }

  if (window.__adobe_cep__) {
    applyPremiere();
    if (typeof window.__adobe_cep__.addEventListener === 'function') {
      window.__adobe_cep__.addEventListener('com.adobe.csxs.events.ThemeColorChanged', applyPremiere);
    }
    return;
  }
  if (window.pulpPanelHost) {
    root.dataset.palette = 'dark';
    return;
  }
  var light = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var follow = function () {
    root.dataset.palette = light && light.matches ? 'light' : 'dark';
  };
  follow();
  if (light && typeof light.addEventListener === 'function') light.addEventListener('change', follow);
})();

(function () {
  'use strict';

  /** Premiere's evalScript, promisified; the ExtendScript side answers 'ok' or 'error: …'. */
  function evalScript(code) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(code, function (answer) {
        resolve(typeof answer === 'string' ? answer : String(answer));
      });
    });
  }

  /** A path into an ExtendScript string literal: backslashes first, then quotes. */
  function quoted(path) {
    return "'" + String(path).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }

  function outcome(answer) {
    if (answer === 'ok') return { ok: true };
    return { ok: false, message: answer && answer.indexOf('error: ') === 0 ? answer.slice(7) : answer || 'The editing app refused.' };
  }

  if (window.__adobe_cep__) {
    window.pulpHost = {
      name: 'Premiere Pro',
      canInsert: true,
      nativeDrag: false,
      importToBin: function (file) {
        return evalScript('pulpImportToBin(' + quoted(file) + ')').then(outcome);
      },
      insertAtPlayhead: function (file) {
        return evalScript('pulpInsertAtPlayhead(' + quoted(file) + ')').then(outcome);
      },
      startDrag: function () {
        return false;
      },
    };
    return;
  }

  if (window.pulpPanelHost && typeof window.pulpPanelHost.importToBin === 'function') {
    window.pulpHost = {
      name: 'DaVinci Resolve',
      canInsert: true,
      nativeDrag: true,
      importToBin: function (file) {
        return window.pulpPanelHost.importToBin(file);
      },
      // Resolve's scripting appends to the timeline's end; landing at the playhead is the drag's job.
      insertAtPlayhead: function (file) {
        return window.pulpPanelHost.appendToTimeline(file);
      },
      startDrag: function (file) {
        window.pulpPanelHost.startDrag(file);
        return true;
      },
    };
    return;
  }

  window.pulpHost = {
    name: null,
    canInsert: false,
    nativeDrag: false,
    importToBin: function () {
      return Promise.resolve({ ok: false, message: 'No editing app around the panel.' });
    },
    insertAtPlayhead: function () {
      return Promise.resolve({ ok: false, message: 'No editing app around the panel.' });
    },
    startDrag: function () {
      return false;
    },
  };
})();
