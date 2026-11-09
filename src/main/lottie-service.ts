/**
 * Lottie animations in the main process (milestone 35): the file behind a
 * Lottie template entry, read once per change and held for a while, and what
 * the template protocol serves for it — the generated page, the player script,
 * and the pictures the animation names (beside a `.json`, or inside a
 * `.lottie`). The reading is pure (src/core/lottie.ts); this is the door.
 */

import { app, dialog } from 'electron';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { lottieAssetPaths, parseLottie, prepareLottieData, readDotLottie, type LottieDocument } from '../core/lottie';
import { lottiePageHtml } from '../core/lottie-page';
import { LOTTIE_TEMPLATE_PLAYER, lottieTemplateFiles } from '../core/lottie-template';
import type { TemplateEntry } from '../core/library-types';
import { MEDIA_MIME } from '../core/media-serve';
import { tr } from '../core/i18n';
import type { SaveCanvasResult } from '../shared/api';
import { addLibraryFolder, findTemplate } from './library-service';
import { loadSettings } from './settings';
import { lottiePlayerFile } from './resources';

export { lottiePlayerFile };

export interface LottieHandle {
  document: LottieDocument;
  /** The entry page, before the bridge is injected. */
  html: string;
  /** A picture the animation names, by the path the page asks for; null when it names none such. */
  asset(relPath: string): Promise<{ bytes: Buffer; mime: string } | null>;
}

export type LottieResult = { ok: true; handle: LottieHandle } | { ok: false; message: string };

const HELD = 4;
const held = new Map<string, { signature: string; handle: LottieHandle }>();

async function signatureOf(path: string): Promise<string> {
  const info = await stat(path);
  return `${info.size}:${info.mtimeMs}`;
}

const mimeOf = (name: string): string | undefined => MEDIA_MIME[(/\.[^.]+$/.exec(name)?.[0] ?? '').toLowerCase()];

/** The animation this entry shows: an archive's by its id (each is an item of its own, milestone 35), a `.json`'s only one. */
async function readEntryDocument(info: TemplateEntry['lottie'] & object): Promise<{ document: LottieDocument; images: Map<string, Buffer> | null }> {
  if (info.format === 'lottie') {
    const archive = readDotLottie(await readFile(info.path));
    const own = info.animation !== undefined ? archive.animations.find((a) => a.id === info.animation) : undefined;
    return { document: own?.document ?? archive.document, images: archive.images };
  }
  return { document: parseLottie(await readFile(info.path, 'utf8')), images: null };
}

async function makeHandle(entry: TemplateEntry): Promise<LottieHandle> {
  const info = entry.lottie!;
  const { document, images } = await readEntryDocument(info);
  const data = prepareLottieData(document.data);
  const html = lottiePageHtml({
    name: entry.manifest.name,
    data,
    bindings: info.bindings,
    width: document.width,
    height: document.height,
    fps: document.fps,
    totalFrames: Math.max(1, Math.round(document.outPoint - document.inPoint)),
    ...(info.themes ? { themes: info.themes } : {}),
    ...(info.animation !== undefined ? { animation: info.animation } : {}),
    // Each parameter's default, so a value still at it is left to a chosen theme.
    defaults: Object.fromEntries(entry.manifest.parameters.map((parameter) => [parameter.id, parameter.default])),
  });
  // Only the pictures the animation names are reachable, and for a `.json` only from its own folder.
  const named = new Set(lottieAssetPaths(document.data));
  const folder = resolve(dirname(info.path));
  const asset = async (relPath: string): Promise<{ bytes: Buffer; mime: string } | null> => {
    const clean = relPath.replace(/^\/+/, '');
    if (!named.has(clean)) return null;
    const mime = mimeOf(clean);
    if (!mime || !mime.startsWith('image/')) return null;
    if (images) {
      const bytes = images.get(clean.split('/').pop() ?? clean);
      return bytes ? { bytes, mime } : null;
    }
    const file = resolve(folder, clean);
    if (file !== folder && !file.startsWith(folder + sep)) return null;
    try {
      return { bytes: await readFile(file), mime };
    } catch {
      return null;
    }
  };
  return { document, html, asset };
}

/** The handle for a Lottie template entry, read once per change of the file. */
export async function lottieFileFor(entry: TemplateEntry): Promise<LottieResult> {
  if (!entry.lottie) return { ok: false, message: `${entry.manifest.name} is not a Lottie animation` }; // i18n-exempt(diagnostic): the template page's 404
  const path = `${entry.lottie.path}#${entry.lottie.animation ?? ''}`;
  let signature: string;
  try {
    signature = await signatureOf(entry.lottie.path);
  } catch (err) {
    return { ok: false, message: `could not read the file: ${(err as Error).message}` }; // i18n-exempt(diagnostic)
  }
  const kept = held.get(path);
  if (kept && kept.signature === signature) {
    held.delete(path);
    held.set(path, kept);
    return { ok: true, handle: kept.handle };
  }
  let handle: LottieHandle;
  try {
    handle = await makeHandle(entry);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  held.set(path, { signature, handle });
  while (held.size > HELD) {
    const oldest = held.keys().next().value;
    if (oldest === undefined) break;
    held.delete(oldest);
  }
  return { ok: true, handle };
}

// ---------------------------------------------------------------- saving as a template (milestone 35)

export interface SaveLottieRequest {
  /** The library item to save from: a Lottie template entry's manifest id. */
  id: unknown;
  /** Tests name the folder outright; without it the dialog asks. The folder's name is the template's. */
  dir?: unknown;
}

/**
 * Save a Lottie item as a template folder: the manifest and the generated page
 * (src/core/lottie-template.ts), the player script beside them, and the
 * pictures the animation names, copied in. The folder then joins the library
 * as the canvas's saved templates do, and the new template is a folder of
 * ordinary files a person can edit.
 */
export async function saveLottieTemplate(request: SaveLottieRequest): Promise<SaveCanvasResult> {
  const entry = typeof request.id === 'string' ? await findTemplate(request.id) : null;
  if (!entry || !entry.lottie) return { ok: false, message: tr('dialog.save-lottie.no-item') };
  const info = entry.lottie;

  let document: LottieDocument;
  let archiveImages: Map<string, Buffer> | null;
  try {
    ({ document, images: archiveImages } = await readEntryDocument(info));
  } catch (err) {
    return { ok: false, message: tr('dialog.save-lottie.read-failed', { reason: (err as Error).message }) };
  }

  let target: string;
  if (typeof request.dir === 'string' && request.dir.trim() !== '') {
    target = request.dir;
  } else {
    const save = await dialog.showSaveDialog({
      title: tr('dialog.save-lottie.title'),
      defaultPath: join(app.getPath('documents') || homedir(), 'Pulp Templates', entry.manifest.name), // i18n-exempt(content)
      buttonLabel: tr('dialog.save-canvas.button'),
      nameFieldLabel: tr('dialog.save-canvas.name-field'),
    });
    if (save.canceled || !save.filePath) return { ok: false, cancelled: true, message: '' };
    target = save.filePath;
  }

  const data = prepareLottieData(document.data);
  const made = lottieTemplateFiles({ name: basename(target), manifest: entry.manifest, info, data });

  // The pictures the animation names, from beside the file or inside the archive; one that
  // cannot be read is said, and the page then draws without it as the library item would.
  const notes: string[] = [];
  const pictures: { at: string; bytes: Buffer }[] = [];
  const folder = resolve(dirname(info.path));
  for (const relPath of lottieAssetPaths(data)) {
    let bytes: Buffer | undefined;
    if (archiveImages) {
      bytes = archiveImages.get(relPath.split('/').pop() ?? relPath);
    } else {
      const file = resolve(folder, relPath);
      if (file === folder || file.startsWith(folder + sep)) bytes = await readFile(file).catch(() => undefined);
    }
    if (bytes) pictures.push({ at: relPath, bytes });
    else notes.push(tr('dialog.save-lottie.note.image', { name: relPath }));
  }

  try {
    await mkdir(target, { recursive: true });
    const holds = await readdir(target);
    if (holds.length > 0) return { ok: false, message: tr('dialog.save-canvas.folder-not-empty', { folder: basename(target) }) };
    await writeFile(join(target, 'template.json'), made.manifest);
    await writeFile(join(target, 'index.html'), made.page);
    await writeFile(join(target, LOTTIE_TEMPLATE_PLAYER), await readFile(lottiePlayerFile()));
    for (const picture of pictures) {
      const at = join(target, ...picture.at.split('/'));
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, picture.bytes);
    }
  } catch (err) {
    return { ok: false, message: tr('dialog.save-canvas.write-failed', { reason: (err as Error).message }) };
  }

  // The library learns about it, exactly as a saved canvas does.
  const settings = await loadSettings();
  const covered = settings.libraryFolders.find((root) => target === root || target.startsWith(root + sep));
  await addLibraryFolder(covered ?? target);
  return { ok: true, path: target, templateId: made.templateId, notes };
}
