/**
 * The editor panel's bridge in the main process (milestone 54, decision
 * record 0025): started when the setting says so, stopped and cleaned up when
 * it goes off or the app quits. What the bridge *answers* lives in
 * `src/core/panel-bridge.ts`; this is the lifecycle, the discovery file and
 * the live data — the library as the library service holds it, the collection
 * as the window last reported it, and thumbnails held to the cache folder the
 * way the app window's own thumb protocol holds them.
 *
 * Off by default. On, it listens on 127.0.0.1 only; the port and the token
 * are in `panel-bridge.json` beside the settings, readable only by the user,
 * written when the bridge starts and removed when it stops.
 */

import { app } from 'electron';
import { open, realpath, rename, rm } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import type { Collection, CollectionItem } from '../core/collection';
import { BRIDGE_FILE_NAME, bridgeFileContents, newBridgeToken, startPanelServer, type PanelServer } from '../core/panel-bridge';
import { getLibrary, lookupThumbnail, thumbnailDir } from './library-service';
import { loadSettings, updateSettings } from './settings';

export interface PanelStatus {
  /** The setting as saved: off by default, nothing listens while it is. */
  enabled: boolean;
  /** True while the bridge is listening. */
  running: boolean;
  /** The port it listens on, while it runs. */
  port?: number;
  /** Where the panels read the port and token from, said so Settings can say it. */
  bridgeFile: string;
}

let server: PanelServer | null = null;

/** The collection as the window last reported it; empty until the window says otherwise. */
let panelCollectionState: { name: string; collection: Collection } = { name: '', collection: { items: [] } };

function bridgeFilePath(): string {
  return join(app.getPath('userData'), BRIDGE_FILE_NAME);
}

/**
 * The window reports its collection whenever it changes, so the bridge can
 * list it. The items arrive over IPC from Pulp's own window, but are held to
 * their shape all the same, the way every IPC argument is.
 */
export function setPanelCollection(collection: unknown, name: unknown): void {
  const items: CollectionItem[] = [];
  const raw = (collection as { items?: unknown })?.items;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const i = entry as Partial<CollectionItem>;
      if (typeof i.uid !== 'string' || typeof i.id !== 'string' || typeof i.presetId !== 'string') continue;
      items.push({
        uid: i.uid,
        id: i.id,
        kind: i.kind === 'media' ? 'media' : 'template',
        name: typeof i.name === 'string' ? i.name : i.id,
        ...(typeof i.templateId === 'string' ? { templateId: i.templateId } : {}),
        presetId: i.presetId,
        options: i.options && typeof i.options === 'object' ? i.options : {},
        params: i.params && typeof i.params === 'object' ? (i.params as Record<string, unknown>) : {},
      });
    }
  }
  panelCollectionState = { name: typeof name === 'string' ? name : '', collection: { items } };
}

/** An item's thumbnail only if the store's file really lies in the cache folder and is a PNG, as protocol.ts holds it. */
async function panelThumbnail(id: string): Promise<string | undefined> {
  const file = lookupThumbnail(id);
  if (!file) return undefined;
  try {
    const [real, dir] = await Promise.all([realpath(file), realpath(thumbnailDir())]);
    if (real.startsWith(dir + sep) && extname(real).toLowerCase() === '.png') return real;
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * The discovery file, written to a temporary name and renamed into place so a
 * panel never reads half of it — and opened 0600, so it is the user's eyes
 * only: the token is the whole fence between the bridge and whatever else can
 * reach 127.0.0.1.
 */
async function writeBridgeFile(port: number, token: string): Promise<void> {
  const path = bridgeFilePath();
  const tmp = `${path}.tmp`;
  const handle = await open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(bridgeFileContents({ version: app.getVersion(), port, token, startedAt: new Date().toISOString() }));
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

async function removeBridgeFile(): Promise<void> {
  await rm(bridgeFilePath(), { force: true }).catch(() => undefined);
}

async function start(): Promise<void> {
  if (server) return;
  const token = newBridgeToken();
  server = await startPanelServer({
    token,
    version: app.getVersion(),
    library: () => getLibrary(),
    collection: () => panelCollectionState,
    thumbnail: panelThumbnail,
  });
  await writeBridgeFile(server.port, token);
}

export async function stopPanelBridge(): Promise<void> {
  const current = server;
  server = null;
  await removeBridgeFile();
  if (current) await current.close();
}

export async function panelStatus(): Promise<PanelStatus> {
  const settings = await loadSettings();
  return {
    enabled: settings.editorPanel,
    running: server !== null,
    ...(server ? { port: server.port } : {}),
    bridgeFile: bridgeFilePath(),
  };
}

/** The toggle in Settings: persist it, then make the world match it. */
export async function setEditorPanel(on: unknown): Promise<PanelStatus> {
  const enabled = on === true;
  await updateSettings((s) => ({ ...s, editorPanel: enabled }));
  if (enabled) await start();
  else await stopPanelBridge();
  return panelStatus();
}

/** At launch: a stale discovery file from a crash says a bridge that is not there, so it goes either way. */
export async function startPanelBridgeIfEnabled(): Promise<void> {
  await removeBridgeFile();
  const settings = await loadSettings();
  if (settings.editorPanel) await start();
}
