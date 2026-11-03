/**
 * The Pulp panel (milestone 54): the library and the collection of the Pulp
 * running on this machine, listed inside Premiere Pro or DaVinci Resolve.
 * Browsing and search for now; dropping into the edit and rendering from here
 * are the milestone's later items.
 *
 * Plain script over connect.js's window.pulpBridge. The search field speaks
 * Pulp's own query syntax — the very search the app's field runs.
 */

/* global pulpBridge */

(function () {
  'use strict';

  var session = null;
  /** Object URLs by item id, so a re-render reuses them instead of fetching every thumbnail again. */
  var thumbs = {};

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(connected, line) {
    el('status-dot').className = 'dot ' + (connected ? 'on' : 'off');
    el('status-line').textContent = line;
    el('panel-main').hidden = !connected;
    el('connect-help').hidden = connected;
  }

  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !(seconds > 0)) return '';
    if (seconds < 60) return seconds.toFixed(seconds < 10 ? 1 : 0) + 's';
    return Math.floor(seconds / 60) + ':' + ('0' + Math.round(seconds % 60)).slice(-2);
  }

  function thumbFor(item, img) {
    if (!item.thumb || !session) return;
    if (thumbs[item.id]) {
      img.src = thumbs[item.id];
      return;
    }
    pulpBridge.thumb(session, item.id).then(function (url) {
      if (!url) return;
      thumbs[item.id] = url;
      img.src = url;
    });
  }

  function row(item, extraBadge) {
    var li = document.createElement('li');
    var img = document.createElement('img');
    img.className = 'thumb';
    img.alt = '';
    thumbFor(item, img);
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;
    name.title = item.name;
    li.appendChild(img);
    li.appendChild(name);
    if (extraBadge) li.appendChild(extraBadge);
    var kind = document.createElement('span');
    kind.className = 'badge';
    kind.textContent = item.type || item.kind;
    li.appendChild(kind);
    var duration = document.createElement('span');
    duration.className = 'duration';
    duration.textContent = formatDuration(item.duration);
    li.appendChild(duration);
    return li;
  }

  function showLibrary(answer) {
    var list = el('library-list');
    list.replaceChildren();
    for (var i = 0; i < answer.items.length; i += 1) list.appendChild(row(answer.items[i]));
    el('library-empty').hidden = answer.items.length > 0;
    el('library-count').textContent = answer.total > answer.items.length
      ? 'first ' + answer.items.length + ' of ' + answer.total
      : String(answer.total);
  }

  function showCollection(answer) {
    var list = el('collection-list');
    list.replaceChildren();
    for (var i = 0; i < answer.items.length; i += 1) {
      var item = answer.items[i];
      var badge = null;
      if (item.missing || item.offline) {
        badge = document.createElement('span');
        badge.className = 'badge missing';
        badge.textContent = item.missing ? 'missing' : 'offline';
      }
      list.appendChild(row(item, badge));
    }
    el('collection-empty').hidden = answer.items.length > 0;
    el('collection-name').textContent = answer.name || '';
  }

  function refresh() {
    if (!session) return Promise.resolve();
    var query = el('search').value;
    return Promise.all([
      pulpBridge.get(session, '/v1/library?q=' + encodeURIComponent(query)),
      pulpBridge.get(session, '/v1/collection'),
    ]).then(function (answers) {
      showLibrary(answers[0]);
      showCollection(answers[1]);
    }).catch(function (err) {
      session = null;
      setStatus(false, 'Lost Pulp.');
      el('connect-message').textContent = String(err && err.message ? err.message : err);
    });
  }

  function connect() {
    setStatus(false, 'Connecting to Pulp…');
    el('connect-message').textContent = '';
    pulpBridge.connect().then(function (opened) {
      session = opened;
      setStatus(true, 'Pulp ' + opened.version + ' on 127.0.0.1:' + opened.port);
      return refresh();
    }).catch(function (err) {
      session = null;
      setStatus(false, 'Pulp is not reachable.');
      el('connect-message').textContent = String(err && err.message ? err.message : err);
    });
  }

  // The collection changes as the editor works in Pulp, so it is re-read on a slow
  // tick while connected — and a connection is retried on the same tick while not.
  function tick() {
    if (session) void refresh();
    else connect();
  }

  var searchWait = null;
  el('search').addEventListener('input', function () {
    if (searchWait) clearTimeout(searchWait);
    searchWait = setTimeout(function () {
      void refresh();
    }, 200);
  });

  el('reconnect').addEventListener('click', connect);
  window.addEventListener('focus', function () {
    if (session) void refresh();
  });

  connect();
  setInterval(tick, 10000);
})();
