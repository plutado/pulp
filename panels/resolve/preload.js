/**
 * The Resolve panel's preload: the one capability the page gets beyond the
 * web — reading `panel-bridge.json` beside Pulp's settings, which holds the
 * loopback port and the token (decision record 0025). The page never sees
 * node, only this one function.
 */

'use strict';

const { contextBridge } = require('electron');
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
});
