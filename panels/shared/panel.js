/**
 * The Pulp panel (milestone 54): the library and the collection of the Pulp
 * running on this machine, listed inside Premiere Pro or DaVinci Resolve —
 * and from this milestone's second item, handed into the edit: every row has
 * Bin and Timeline, and can be dragged, each rendering on request with the
 * item's own output settings (a collection item's card, a template's saved
 * type default, ProRes 4444 where nothing is saved — alpha kept) through the
 * same cache the app's own Prepare for drag fills, so a second drop of the
 * same thing is instant.
 *
 * And back the other way (the third item): **Open** shows the item in Pulp —
 * or opens the collection card for editing — so it can be changed before the
 * next drop, and Pulp's render queue is shown here as it runs, a finished job
 * dropping like any row.
 *
 * Plain script over connect.js's window.pulpBridge and host.js's
 * window.pulpHost. The search field speaks Pulp's own query syntax.
 */

/* global pulpBridge, pulpHost */

(function () {
  'use strict';

  var session = null;
  /** Object URLs by item id, so a re-render reuses them instead of fetching every thumbnail again. */
  var thumbs = {};
  /** Prepared files by target key, so a row drops twice without rendering twice. */
  var files = {};
  /** Prepares under way by target key, so two clicks are one render. */
  var inFlight = {};

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

  // ---------------------------------------------------------------- preparing a file

  /** A row's target: a library item by id, or a collection item by uid (its own settings). */
  function keyOf(target) {
    if (target.job !== undefined) return 'job:' + target.job;
    return target.uid ? 'uid:' + target.uid : 'id:' + target.id;
  }

  /** The body an ask about a target carries: a library id or a collection uid. */
  function bodyOf(target) {
    return target.uid ? { uid: target.uid } : { id: target.id };
  }

  /** Follow a queued render until it is a file or a reason it is not. */
  function followJob(job, onProgress) {
    return new Promise(function (resolve, reject) {
      var ask = function () {
        pulpBridge.get(session, '/v1/prepare/' + job).then(function (answer) {
          if (answer.state === 'done') return resolve(answer.file);
          if (answer.state === 'failed') return reject(new Error(answer.message));
          if (onProgress && typeof answer.fraction === 'number') onProgress(answer.fraction);
          setTimeout(ask, 600);
        }).catch(reject);
      };
      ask();
    });
  }

  /**
   * The file for a target, rendered on request with the item's own output
   * settings — or already in hand, from this session or from Pulp's render
   * cache, in which case the answer is immediate.
   */
  function prepare(target, onProgress) {
    var key = keyOf(target);
    if (files[key]) return Promise.resolve(files[key]);
    if (inFlight[key]) return inFlight[key];
    var ask = pulpBridge.post(session, '/v1/prepare', bodyOf(target))
      .then(function (answer) {
        return answer.ready ? answer.file : followJob(answer.job, onProgress);
      })
      .then(function (file) {
        files[key] = file;
        delete inFlight[key];
        return file;
      })
      .catch(function (err) {
        delete inFlight[key];
        throw err;
      });
    inFlight[key] = ask;
    return ask;
  }

  /** file:// for a path, both slants of slash, for the hosts that take a dragged URI. */
  function fileUrl(path) {
    var plain = String(path).split('\\').join('/');
    return encodeURI('file://' + (plain.charAt(0) === '/' ? '' : '/') + plain).replace(/#/g, '%23');
  }

  // ---------------------------------------------------------------- the rows

  function say(status, text, bad) {
    status.textContent = text;
    status.className = 'status' + (bad ? ' bad' : '');
  }

  /** Prepare, then hand over: 'importToBin' or 'insertAtPlayhead', with the row saying how it goes. */
  function act(target, status, verb) {
    if (!session || inFlight[keyOf(target)]) return;
    say(status, files[keyOf(target)] ? 'handing over…' : 'rendering…');
    prepare(target, function (fraction) {
      say(status, Math.round(fraction * 100) + '%');
    }).then(function (file) {
      say(status, 'handing over…');
      return pulpHost[verb](file).then(function (outcome) {
        if (outcome && outcome.ok) {
          say(status, verb === 'importToBin' ? 'in the bin' : 'on the timeline');
          setTimeout(function () { say(status, ''); }, 4000);
        } else {
          say(status, (outcome && outcome.message) || 'the editing app refused', true);
        }
      });
    }).catch(function (err) {
      say(status, String(err && err.message ? err.message : err), true);
    });
  }

  function row(item, target, extraBadge) {
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

    var status = document.createElement('span');
    status.className = 'status';
    var usable = pulpHost.name !== null && !(extraBadge && extraBadge.classList.contains('missing'));
    var actions = document.createElement('span');
    actions.className = 'actions';
    var toBin = document.createElement('button');
    toBin.type = 'button';
    toBin.textContent = 'Bin';
    toBin.title = usable ? 'Render if needed, then import into the project bin' : 'No editing app around the panel';
    toBin.disabled = !usable;
    toBin.addEventListener('click', function () { act(target, status, 'importToBin'); });
    var toTimeline = document.createElement('button');
    toTimeline.type = 'button';
    toTimeline.textContent = pulpHost.nativeDrag ? 'Append' : 'Playhead';
    toTimeline.title = usable
      ? (pulpHost.nativeDrag
        ? 'Render if needed, then append to the timeline — drag the row to land at the playhead'
        : 'Render if needed, then insert at the playhead on the first unlocked video track')
      : 'No editing app around the panel';
    toTimeline.disabled = !usable || !pulpHost.canInsert;
    toTimeline.addEventListener('click', function () { act(target, status, 'insertAtPlayhead'); });
    actions.appendChild(toBin);
    actions.appendChild(toTimeline);
    if (target.job === undefined) {
      var open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Open';
      open.title = target.uid ? 'Open this collection card in Pulp to change its settings' : 'Show this item in Pulp to change it';
      open.addEventListener('click', function () {
        if (!session) return;
        say(status, 'opening…');
        pulpBridge.post(session, '/v1/open', bodyOf(target)).then(function () {
          say(status, 'in Pulp');
          setTimeout(function () { say(status, ''); }, 3000);
        }).catch(function (err) {
          say(status, String(err && err.message ? err.message : err), true);
        });
      });
      actions.appendChild(open);
    }
    li.appendChild(actions);
    li.appendChild(status);

    // Dragging hands the rendered file to wherever it is dropped — the timeline at the
    // playhead, a bin, a folder. A row not yet rendered starts its render instead, and
    // says to drag again once the file exists: a native drag must begin with a real file.
    if (usable) {
      li.draggable = true;
      li.addEventListener('dragstart', function (event) {
        var file = files[keyOf(target)];
        if (!file) {
          event.preventDefault();
          say(status, 'rendering…');
          prepare(target, function (fraction) {
            say(status, Math.round(fraction * 100) + '%');
          }).then(function () {
            say(status, 'ready — drag again');
          }).catch(function (err) {
            say(status, String(err && err.message ? err.message : err), true);
          });
          return;
        }
        if (pulpHost.nativeDrag) {
          event.preventDefault();
          pulpHost.startDrag(file);
          return;
        }
        var url = fileUrl(file);
        event.dataTransfer.setData('text/uri-list', url);
        event.dataTransfer.setData('DownloadURL', 'application/octet-stream:' + file.split(/[\\/]/).pop() + ':' + url);
      });
    }
    return li;
  }

  function showLibrary(answer) {
    var list = el('library-list');
    list.replaceChildren();
    for (var i = 0; i < answer.items.length; i += 1) {
      var item = answer.items[i];
      list.appendChild(row(item, { id: item.id }));
    }
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
      list.appendChild(row(item, { uid: item.uid }, badge));
    }
    el('collection-empty').hidden = answer.items.length > 0;
    el('collection-name').textContent = answer.name || '';
  }

  var lastQueue = '';
  var queueActive = false;

  /** Pulp's render queue as it runs: the bar per job, cancel while it can be, and a finished file that drops. */
  function showQueue(answer) {
    var text = JSON.stringify(answer);
    if (text === lastQueue) return;
    lastQueue = text;
    var list = el('queue-list');
    list.replaceChildren();
    queueActive = false;
    for (var i = 0; i < answer.jobs.length; i += 1) {
      var job = answer.jobs[i];
      var li;
      if (job.status === 'done' && job.file) {
        // A finished render is a file in hand: the row drops exactly as an item's does.
        files['job:' + job.id] = job.file;
        li = row({ id: '', name: job.label, kind: job.presetId }, { job: job.id });
      } else {
        li = document.createElement('li');
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = job.label;
        li.appendChild(name);
        var state = document.createElement('span');
        state.className = 'badge ' + job.status;
        state.textContent = job.status === 'running' && typeof job.fraction === 'number'
          ? Math.round(job.fraction * 100) + '%'
          : job.status;
        li.appendChild(state);
        if (job.status === 'queued' || job.status === 'running') {
          queueActive = true;
          var cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = 'Cancel';
          cancel.className = 'cancel';
          cancel.addEventListener('click', (function (id) {
            return function () {
              if (session) pulpBridge.post(session, '/v1/queue/' + id + '/cancel', {}).catch(function () { /* already finished */ });
            };
          })(job.id));
          li.appendChild(cancel);
          var bar = document.createElement('span');
          bar.className = 'progress';
          var fill = document.createElement('span');
          fill.style.width = Math.round((job.fraction || 0) * 100) + '%';
          bar.appendChild(fill);
          li.appendChild(bar);
        }
        if (job.message) {
          var why = document.createElement('span');
          why.className = 'status bad';
          why.textContent = job.message;
          li.appendChild(why);
        }
      }
      list.appendChild(li);
    }
    el('queue-section').hidden = answer.jobs.length === 0;
  }

  function refreshQueue() {
    if (!session) return Promise.resolve();
    return pulpBridge.get(session, '/v1/queue').then(showQueue).catch(function () { /* the next refresh says */ });
  }

  function refresh() {
    if (!session) return Promise.resolve();
    var query = el('search').value;
    return Promise.all([
      pulpBridge.get(session, '/v1/library?q=' + encodeURIComponent(query)),
      pulpBridge.get(session, '/v1/collection'),
      pulpBridge.get(session, '/v1/queue'),
    ]).then(function (answers) {
      showLibrary(answers[0]);
      showCollection(answers[1]);
      showQueue(answers[2]);
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
      // A new session may be a new Pulp: nothing prepared before it is trusted after it.
      files = {};
      inFlight = {};
      lastQueue = '';
      setStatus(true, 'Pulp ' + opened.version + ' on 127.0.0.1:' + opened.port + (pulpHost.name ? ' · in ' + pulpHost.name : ''));
      return refresh();
    }).catch(function (err) {
      session = null;
      setStatus(false, 'Pulp is not reachable.');
      el('connect-message').textContent = String(err && err.message ? err.message : err);
    });
  }

  // The collection changes as the editor works in Pulp, so it is re-read on a slow
  // tick while connected — and a connection is retried on the same tick while not.
  // Not while a render is being followed: the tick rebuilds the rows, and a rebuilt
  // row would drop the very percentage someone is watching.
  function tick() {
    if (session && Object.keys(inFlight).length === 0) void refresh();
    else if (!session) connect();
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
  // The queue moves by the second while something renders — a prepare from here, or a render
  // started in Pulp — so it is re-read that often then, and left alone when nothing is running.
  setInterval(function () {
    if (session && (queueActive || Object.keys(inFlight).length > 0)) void refreshQueue();
  }, 1000);
})();
