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

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');

const PLUGIN_ID = 'com.pulp.panel';

/** What a dragged row carries under the pointer: Pulp's strap mark, inlined so the plugin is self-contained. */
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAOCAYAAAA1+Nx+AAAALElEQVR4nGNggIIXi23/UxMzoINRC0YtGLWAgWHWrEX/ScEYBhACoxYMmAUAesOd9/bGGOoAAAAASUVORK5CYII=',
);

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

/** The current project's media pool, or a message saying which link in the chain is missing. */
async function mediaPool() {
  if (!workflow) return { error: 'Resolve’s WorkflowIntegration.node is not beside the plugin; reinstall with the Resolve sample present.' };
  const resolve = await workflow.GetResolve();
  if (!resolve) return { error: 'Resolve did not answer the plugin.' };
  const manager = await resolve.GetProjectManager();
  const project = manager ? await manager.GetCurrentProject() : null;
  if (!project) return { error: 'No project is open in Resolve.' };
  const pool = await project.GetMediaPool();
  if (!pool) return { error: 'Resolve has no media pool to import into.' };
  return { pool };
}

/** Import a file into the media pool's current bin; the items come back for the timeline verb to reuse. */
async function importToPool(file) {
  const found = await mediaPool();
  if (found.error) return { ok: false, message: found.error };
  const items = await found.pool.ImportMedia([file]);
  if (!items || items.length === 0) return { ok: false, message: 'Resolve refused the import.' };
  return { ok: true, items, pool: found.pool };
}

// The panel's three verbs (milestone 54's drop). Import and append speak Resolve's own
// scripting API; the native drag is how a clip lands on the timeline at the playhead,
// since the API appends to the end and a drop lands where the pointer is.
ipcMain.handle('pulp:import', async (_event, file) => {
  try {
    const imported = await importToPool(String(file));
    return imported.ok ? { ok: true } : { ok: false, message: imported.message };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
});

ipcMain.handle('pulp:append', async (_event, file) => {
  try {
    const imported = await importToPool(String(file));
    if (!imported.ok) return { ok: false, message: imported.message };
    const appended = await imported.pool.AppendToTimeline(imported.items);
    if (!appended || appended.length === 0) return { ok: false, message: 'Resolve could not append it; is a timeline open?' };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
});

ipcMain.on('pulp:drag', (event, file) => {
  try {
    event.sender.startDrag({ file: String(file), icon: DRAG_ICON });
  } catch {
    // A drag that cannot start is nothing to crash the host over.
  }
});

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
