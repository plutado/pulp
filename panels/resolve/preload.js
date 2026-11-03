/**
 * The Resolve panel's preload: the one capability the page gets beyond the
 * web — reading `panel-bridge.json` beside Pulp's settings, which holds the
 * loopback port and the token (decision record 0025). The page never sees
 * node, only this one function.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { readFileSync } = require('fs');
const { homedir } = require('os');
const path = require('path');

/** The folders Pulp's settings may live in: "Pulp" packaged, "pulp" in a dev checkout. */
const APP_FOLDERS = ['Pulp', 'pulp'];

function candidates() {
  const home = homedir();
  const roots = [];
  if (process.platform === 'darwin') roots.push(path.join(home, 'Library', 'Application Support'));
  else if (process.platform === 'win32' && process.env.APPDATA) roots.push(process.env.APPDATA);
  else roots.push(process.env.XDG_CONFIG_HOME || path.join(home, '.config'));
  const files = [];
  for (const root of roots) for (const folder of APP_FOLDERS) files.push(path.join(root, folder, 'panel-bridge.json'));
  return files;
}

contextBridge.exposeInMainWorld('pulpPanelHost', {
  readBridge() {
    for (const file of candidates()) {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        continue;
      }
    }
    return null;
  },
  // The drop (milestone 54): the main side speaks Resolve's API; the page only names a file.
  importToBin(file) {
    return ipcRenderer.invoke('pulp:import', String(file));
  },
  appendToTimeline(file) {
    return ipcRenderer.invoke('pulp:append', String(file));
  },
  startDrag(file) {
    ipcRenderer.send('pulp:drag', String(file));
  },
});
