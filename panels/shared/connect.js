/**
 * Finding the running Pulp from inside an editing app (milestone 54, decision
 * record 0025). Pulp writes `panel-bridge.json` beside its settings — the
 * loopback port and the token — while Settings → "Serve the editor panel" is
 * on. This file is the host-specific part of reading it: Premiere's CEP gives
 * a panel `window.cep.fs` and the user-data root; the Resolve plugin's preload
 * exposes `window.pulpPanelHost.readBridge()`. Everything after the file is
 * the same fetch to 127.0.0.1 in both hosts, the token in a header on every
 * request, and nothing leaving the machine.
 *
 * Plain script, no modules: both hosts load it with a <script> tag before
 * panel.js. Mirrors src/core/panel-bridge.ts's parseBridgeFile.
 */

/* global cep */

(function () {
  'use strict';

  var TOKEN_HEADER = 'x-pulp-token';
  var BRIDGE_VERSION = 1;

  /** The folders Pulp's settings may live in: "Pulp" packaged, "pulp" in a dev checkout. */
  var APP_FOLDERS = ['Pulp', 'pulp'];

  function parseBridge(text) {
    var raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    if (raw.app !== 'pulp' || typeof raw.bridge !== 'number') return null;
    if (typeof raw.token !== 'string' || !/^[0-9a-f]{64}$/.test(raw.token)) return null;
    if (typeof raw.port !== 'number' || raw.port < 1 || raw.port > 65535) return null;
    return raw;
  }

  /** The user-data roots to look under, per host; each gets "/<app folder>/panel-bridge.json" appended. */
  function cepUserDataRoot() {
    // CEP SystemPath.USER_DATA: ".../Application Support" on macOS, "...\AppData\Roaming" on Windows.
    var path = window.__adobe_cep__.getSystemPath('userData');
    return path.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1');
  }

  function readBridgeText() {
    if (window.pulpPanelHost && typeof window.pulpPanelHost.readBridge === 'function') {
      return window.pulpPanelHost.readBridge();
    }
    if (window.__adobe_cep__ && window.cep && window.cep.fs) {
      var root = cepUserDataRoot();
      for (var i = 0; i < APP_FOLDERS.length; i += 1) {
        var result = cep.fs.readFile(root + '/' + APP_FOLDERS[i] + '/panel-bridge.json');
        if (result.err === 0 && result.data) return result.data;
      }
    }
    return null;
  }

  /** GET a bridge route as parsed JSON; throws with a plain-words message when it cannot. */
  function bridgeGet(session, path) {
    return fetch('http://127.0.0.1:' + session.port + path, {
      headers: (function () {
        var h = {};
        h[TOKEN_HEADER] = session.token;
        return h;
      })(),
    }).then(function (response) {
      if (response.status === 401) throw new Error('Pulp refused the token; turn the panel setting off and on in Pulp, then reconnect.');
      if (!response.ok) throw new Error('Pulp answered ' + response.status + '.');
      return response.json();
    });
  }

  /** GET a thumbnail as an object URL, since an <img> cannot carry the token header. Null when there is none. */
  function bridgeThumb(session, id) {
    return fetch('http://127.0.0.1:' + session.port + '/v1/thumb/' + id, {
      headers: (function () {
        var h = {};
        h[TOKEN_HEADER] = session.token;
        return h;
      })(),
    }).then(function (response) {
      if (!response.ok) return null;
      return response.blob().then(function (blob) {
        return URL.createObjectURL(blob);
      });
    }).catch(function () {
      return null;
    });
  }

  /**
   * Read the discovery file and prove the bridge is the Pulp it names. Resolves
   * to a session { port, token, version } or rejects with what to do about it.
   */
  function connect(manual) {
    var bridge = manual || null;
    if (!bridge) {
      var text = readBridgeText();
      if (text === null) {
        return Promise.reject(new Error('Pulp is not serving the panel. In Pulp: Settings → "Serve the editor panel (local)".'));
      }
      bridge = parseBridge(text);
      if (!bridge) return Promise.reject(new Error('The bridge file beside Pulp’s settings is not readable; restart Pulp.'));
    }
    var session = { port: bridge.port, token: bridge.token };
    return bridgeGet(session, '/v1/hello').then(function (hello) {
      if (hello.bridge !== BRIDGE_VERSION) {
        throw new Error('This Pulp speaks bridge version ' + hello.bridge + '; the panel speaks ' + BRIDGE_VERSION + '. Update the panel.');
      }
      session.version = hello.version;
      return session;
    }).catch(function (err) {
      if (err instanceof TypeError) {
        // fetch's word for "nothing answered": Pulp quit, or the file is from an earlier run.
        throw new Error('Pulp is not answering on 127.0.0.1:' + session.port + '. Is Pulp running with the panel setting on?');
      }
      throw err;
    });
  }

  window.pulpBridge = { connect: connect, get: bridgeGet, thumb: bridgeThumb, parse: parseBridge };
})();
