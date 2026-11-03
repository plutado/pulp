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
