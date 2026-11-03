/**
 * Saving the canvas as a template folder, on disk (milestone 55's fifth
 * piece). What the files *are* lives in `src/core/canvas-template.ts`; this is
 * the dialog, the folder, and the library learning about it — the saved folder
 * is added as a library folder of its own (the scanner reads a root that is a
 * template folder as that template), so the new template appears in the
 * results at once and reopens for editing like any other.
 */

import { app, dialog } from 'electron';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { canvasTemplateFiles, type CanvasSaveInput } from '../core/canvas-template';
import { sanitizeExpose } from '../core/expose';
import { resolveLayers } from '../core/layers';
import { BLANK_CANVAS_ID } from '../core/menu';
import { slug } from '../core/pack';
import type { SaveCanvasResult } from '../shared/api';
import { addLibraryFolder, findTemplate } from './library-service';
import { loadSettings } from './settings';

export interface SaveCanvasRequest {
  /** The composed stacks and the picked parameters, as the window holds them. */
  layers: unknown;
  expose: unknown;
  /** How long the graphic runs now, from the window's own resolution. */
  length: unknown;
  /** Tests name the folder outright; without it the dialog asks. The folder's name is the template's. */
  dir?: unknown;
}

export async function saveCanvasTemplate(request: SaveCanvasRequest): Promise<SaveCanvasResult> {
  const canvas = await findTemplate(BLANK_CANVAS_ID);
  if (!canvas) return { ok: false, message: 'The blank canvas is not in the library, so there is nothing to save from.' };

  // The stacks arrive over IPC from Pulp's own window, and are held to their shape all the same:
  // resolved against the canvas as any stored stack is, wrong fields reported by falling back.
  const rawLayers = request.layers && typeof request.layers === 'object' ? (request.layers as Record<string, unknown>) : {};
  const { values: layers } = resolveLayers(canvas.manifest, rawLayers as never);
  const expose = sanitizeExpose(request.expose);
  const length = typeof request.length === 'number' && Number.isFinite(request.length) && request.length > 0 ? request.length : canvas.manifest.duration;

  let target: string;
  if (typeof request.dir === 'string' && request.dir.trim() !== '') {
    target = request.dir;
  } else {
    const save = await dialog.showSaveDialog({
      title: 'Save as a template folder',
      defaultPath: join(app.getPath('documents') || homedir(), 'Pulp Templates', 'My Template'),
      buttonLabel: 'Save Template',
      nameFieldLabel: 'Template name',
    });
    if (save.canceled || !save.filePath) return { ok: false, cancelled: true, message: '' };
    target = save.filePath;
  }

  const made = canvasTemplateFiles({ name: basename(target), layers, expose, length, canvas: canvas.manifest } as CanvasSaveInput);
  if (!made.ok) return { ok: false, message: made.message };

  try {
    await mkdir(target, { recursive: true });
    const holds = await readdir(target);
    if (holds.length > 0) return { ok: false, message: `${basename(target)} already holds files; a template is saved into a folder of its own.` };
    await writeFile(join(target, 'template.json'), made.files.manifest);
    await writeFile(join(target, 'index.html'), made.files.page);
  } catch (err) {
    return { ok: false, message: `Could not write the template: ${(err as Error).message}` };
  }

  // The library learns about it: the folder itself becomes a root — the scanner reads a root that
  // is a template folder as that template — unless a root already reaches it, when a rescan does.
  const settings = await loadSettings();
  const covered = settings.libraryFolders.some((root) => target === root || target.startsWith(root + sep));
  await addLibraryFolder(covered ? settings.libraryFolders.find((root) => target === root || target.startsWith(root + sep))! : target);
  return { ok: true, path: target, templateId: made.files.templateId, notes: made.files.notes };
}

/** The slug a name would save under, for the window to suggest paths with. */
export function templateFolderName(name: string): string {
  return slug(name, 'template');
}
