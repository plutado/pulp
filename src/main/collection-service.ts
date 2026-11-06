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
import { tr } from '../core/i18n';
import { slug } from '../core/pack';
import type { CollectionFileResult, RenderCollectionResult } from '../shared/api';
import { enqueueCollectionItems } from './render-queue-service';

const COLLECTION_EXTENSION = 'pulpcollection';

/** Save dialog, then write the collection atomically like the rest of the app's files. */
export async function saveCollectionTo(collection: Collection, suggested: string): Promise<CollectionFileResult> {
  const save = await dialog.showSaveDialog({
    title: tr('dialog.collection.save.title'),
    defaultPath: join(app.getPath('documents') || homedir(), `${slug(suggested, 'collection')}.${COLLECTION_EXTENSION}`),
    filters: [{ name: tr('dialog.collection.filter'), extensions: [COLLECTION_EXTENSION] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, cancelled: true, message: '' };
  try {
    await writeFileAtomic(save.filePath, serializeCollection(collection));
  } catch (err) {
    return { ok: false, message: tr('dialog.collection.save.failed', { reason: (err as Error).message }) };
  }
  return { ok: true, path: save.filePath, name: basename(save.filePath, `.${COLLECTION_EXTENSION}`) };
}

/** Open dialog, then read a collection back. What the library no longer has is flagged by the window. */
export async function openCollectionFile(): Promise<CollectionFileResult> {
  const pick = await dialog.showOpenDialog({
    title: tr('dialog.collection.open.title'),
    defaultPath: app.getPath('documents') || homedir(),
    filters: [{ name: tr('dialog.collection.filter'), extensions: [COLLECTION_EXTENSION] }],
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
    return { ok: false, message: tr('dialog.collection.open.failed', { file: basename(path), reason: (err as Error).message }) };
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
  if (items.length === 0) return { ok: false, message: tr('queue.collection.nothing') };
  const pick = await dialog.showOpenDialog({
    title: name ? tr('dialog.collection.render.title-named', { count: items.length, name }) : tr('dialog.collection.render.title', { count: items.length }),
    defaultPath: app.getPath('videos') || homedir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  const folder = pick.filePaths[0];
  if (pick.canceled || !folder) return { ok: false, cancelled: true, message: tr('queue.collection.canceled') };
  return enqueueCollectionItems(items, folder);
}
