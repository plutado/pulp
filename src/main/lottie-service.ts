/**
 * Lottie animations in the main process (milestone 35): the file behind a
 * Lottie template entry, read once per change and held for a while, and what
 * the template protocol serves for it — the generated page, the player script,
 * and the pictures the animation names (beside a `.json`, or inside a
 * `.lottie`). The reading is pure (src/core/lottie.ts); this is the door.
 */

import { app } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { lottieAssetPaths, parseLottie, prepareLottieData, readDotLottie, type LottieDocument } from '../core/lottie';
import { lottiePageHtml } from '../core/lottie-page';
import type { TemplateEntry } from '../core/library-types';
import { MEDIA_MIME } from '../core/media-serve';

/** The player: lottie-web's light build, read from node_modules in a checkout; packaging (milestone 17) must carry it. */
export function lottiePlayerFile(): string {
  return join(app.getAppPath(), 'node_modules', 'lottie-web', 'build', 'player', 'lottie_light.min.js');
}

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

async function makeHandle(entry: TemplateEntry): Promise<LottieHandle> {
  const info = entry.lottie!;
  let document: LottieDocument;
  let images: Map<string, Buffer> | null = null;
  if (info.format === 'lottie') {
    const archive = readDotLottie(await readFile(info.path));
    document = archive.document;
    images = archive.images;
  } else {
    document = parseLottie(await readFile(info.path, 'utf8'));
  }
  const data = prepareLottieData(document.data);
  const html = lottiePageHtml({
    name: entry.manifest.name,
    data,
    bindings: info.bindings,
    width: document.width,
    height: document.height,
    fps: document.fps,
    totalFrames: Math.max(1, Math.round(document.outPoint - document.inPoint)),
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
  if (!entry.lottie) return { ok: false, message: `${entry.manifest.name} is not a Lottie animation` };
  const path = entry.lottie.path;
  let signature: string;
  try {
    signature = await signatureOf(path);
  } catch (err) {
    return { ok: false, message: `could not read the file: ${(err as Error).message}` };
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
