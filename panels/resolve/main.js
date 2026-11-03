/**
 * The Pulp panel for DaVinci Resolve Studio (milestone 54): the entry Resolve
 * runs when the plugin is opened from Workspace → Workflow Integrations. It
 * opens one window on panels/shared's page; preload.js hands that page the
 * bridge file beside Pulp's settings and nothing else.
 *
 * WorkflowIntegration.node is Resolve's own native module, shipped with its
 * developer sample and not with Pulp; the install script copies it in where it
 * finds one. Listing the library needs none of it, so the panel works without
 * it — it is initialized when present so the milestone's later items (dropping
 * into the timeline at the playhead) have the Resolve API to build on.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

const PLUGIN_ID = 'com.pulp.panel';

let workflow = null;
try {
  workflow = require('./WorkflowIntegration.node');
} catch {
  workflow = null;
}
if (workflow) {
  try {
    workflow.Initialize(PLUGIN_ID);
  } catch {
    workflow = null;
  }
}

let window = null;

function createWindow() {
  if (window && !window.isDestroyed()) {
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 400,
    height: 680,
    minWidth: 280,
    minHeight: 380,
    title: 'Pulp',
    backgroundColor: '#1d1d20',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload reads one file with node:fs, which the default sandbox does not allow.
      sandbox: false,
    },
  });
  window.removeMenu?.();
  void window.loadFile(path.join(__dirname, 'panel.html'));
  window.on('closed', () => {
    window = null;
  });
}

void app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (workflow) {
    try {
      workflow.CleanUp();
    } catch {
      // Nothing to clean is nothing to report.
    }
  }
  app.quit();
});
