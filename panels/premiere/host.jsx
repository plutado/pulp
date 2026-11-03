/**
 * The Premiere Pro side of the Pulp panel (milestone 54's drop): ExtendScript
 * the panel calls through evalScript. Two verbs, each answering the one string
 * the panel reads — 'ok', or 'error: ' and why in plain words.
 *
 * ExtendScript is ES3: no const, no arrow functions, and every answer a string.
 */

/* global app */

/** Paths as comparable strings: one slash, one case — Premiere reports them as the OS wrote them. */
function pulpSamePath(a, b) {
  function plain(p) {
    return String(p).replace(/\\/g, '/').toLowerCase();
  }
  return plain(a) === plain(b);
}

/** The imported file's project item, found in the bin it was imported into. */
function pulpFindImported(bin, path) {
  for (var i = 0; i < bin.children.numItems; i += 1) {
    var child = bin.children[i];
    try {
      if (child.getMediaPath && pulpSamePath(child.getMediaPath(), path)) return child;
    } catch (e) {
      // A bin or a sequence has no media path; keep looking.
    }
  }
  return null;
}

/** Import a file into the insertion bin — the bin a person last touched, where Premiere's own imports land. */
function pulpImportToBin(path) {
  try {
    if (!app.project) return 'error: no project is open';
    var bin = app.project.getInsertionBin() || app.project.rootItem;
    var imported = app.project.importFiles([path], true, bin, false);
    if (!imported) return 'error: Premiere refused the import';
    return 'ok';
  } catch (e) {
    return 'error: ' + e;
  }
}

/** Import, then insert on the first unlocked video track at the playhead of the active sequence. */
function pulpInsertAtPlayhead(path) {
  try {
    if (!app.project) return 'error: no project is open';
    var seq = app.project.activeSequence;
    if (!seq) return 'error: no sequence is open';
    var bin = app.project.getInsertionBin() || app.project.rootItem;
    // Already imported is already there: a second insert must not fill the bin with copies.
    var item = pulpFindImported(bin, path);
    if (!item) {
      if (!app.project.importFiles([path], true, bin, false)) return 'error: Premiere refused the import';
      item = pulpFindImported(bin, path);
    }
    if (!item) return 'error: the imported clip could not be found in the bin';
    var track = null;
    for (var i = 0; i < seq.videoTracks.numTracks; i += 1) {
      if (!seq.videoTracks[i].isLocked()) {
        track = seq.videoTracks[i];
        break;
      }
    }
    if (!track) return 'error: every video track is locked';
    track.insertClip(item, seq.getPlayerPosition());
    return 'ok';
  } catch (e) {
    return 'error: ' + e;
  }
}
