/**
 * Collections in the main process: writing one to a file, reading one back, and
 * sending a whole one through the render queue. What a collection *is* lives in
 * `src/core/collection.ts`; this is the file dialogs and the queue.
 */

import { app, dialog } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { writeFileAtomic } from '../core/atomic-file';
import { parseCollection, serializeCollection, type Collection, type CollectionItem } from '../core/collection';
import { slug } from '../core/pack';
import type { CollectionFileResult, RenderCollectionResult } from '../shared/api';
import { enqueueCollectionItems } from './render-queue-service';

const COLLECTION_EXTENSION = 'pulpcollection';

/** Save dialog, then write the collection atomically like the rest of the app's files. */
export async function saveCollectionTo(collection: Collection, suggested: string): Promise<CollectionFileResult> {
  const save = await dialog.showSaveDialog({
    title: 'Save collection',
    defaultPath: join(app.getPath('documents') || homedir(), `${slug(suggested, 'collection')}.${COLLECTION_EXTENSION}`),
    filters: [{ name: 'Pulp collection', extensions: [COLLECTION_EXTENSION] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, cancelled: true, message: '' };
  try {
    await writeFileAtomic(save.filePath, serializeCollection(collection));
  } catch (err) {
    return { ok: false, message: `Could not save the collection: ${(err as Error).message}` };
  }
  return { ok: true, path: save.filePath, name: basename(save.filePath, `.${COLLECTION_EXTENSION}`) };
}

/** Open dialog, then read a collection back. What the library no longer has is flagged by the window. */
export async function openCollectionFile(): Promise<CollectionFileResult> {
  const pick = await dialog.showOpenDialog({
    title: 'Open collection',
    defaultPath: app.getPath('documents') || homedir(),
    filters: [{ name: 'Pulp collection', extensions: [COLLECTION_EXTENSION] }],
    properties: ['openFile'],
  });
  const path = pick.filePaths[0];
  if (pick.canceled || !path) return { ok: false, cancelled: true, message: '' };
  return readCollectionFile(path);
}

export async function readCollectionFile(path: string): Promise<CollectionFileResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    return { ok: false, message: `Could not read ${basename(path)}: ${(err as Error).message}` };
  }
  const parsed = parseCollection(text);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  return { ok: true, path, name: basename(path, `.${COLLECTION_EXTENSION}`), collection: parsed.collection };
}

/**
 * Render all: one folder for every item, chosen once, then a job each. Items the
 * library cannot reach, and media (converting it arrives with milestone 15), are
 * left to the window to have filtered out already.
 */
export async function renderCollection(items: CollectionItem[], name: string): Promise<RenderCollectionResult> {
  if (items.length === 0) return { ok: false, message: 'Nothing in the collection can be rendered yet.' };
  const pick = await dialog.showOpenDialog({
    title: `Folder for ${items.length} ${items.length === 1 ? 'render' : 'renders'}${name ? ` from ${name}` : ''}`,
    defaultPath: app.getPath('videos') || homedir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  const folder = pick.filePaths[0];
  if (pick.canceled || !folder) return { ok: false, cancelled: true, message: 'Render all cancelled.' };
  return enqueueCollectionItems(items, folder);
}
