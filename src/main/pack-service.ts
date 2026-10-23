/**
 * Template packs in the app: read a .zip or a folder, preview it against the
 * library, install into the packs folder of user data (never into library
 * folders), export templates as a pack. Rules are in core/pack.ts and
 * core/zip.ts; this file does the file system and dialog work.
 */

import { app, dialog } from 'electron';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { writeFileAtomic } from '../core/atomic-file';
import type { TemplateEntry } from '../core/library-types';
import { inspectPack, PACK_FILENAME, planInstall, slug, type CollisionChoice, type ExistingTemplate, type PackManifest, type PackPreview } from '../core/pack';
import { readZip, writeZip, ZipError, type ZipEntry } from '../core/zip';
import { getLibrary, rescan } from './library-service';

/** Installed packs live here; it is an implicit library root. */
export function packsDir(): string {
  return join(app.getPath('userData'), 'packs');
}

/** All files under a folder as relative forward-slash paths. Symlinks are skipped. */
async function readFolder(root: string, limitBytes = 512 * 1024 * 1024): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const data = await readFile(full);
        total += data.length;
        if (total > limitBytes) throw new Error('pack folder is larger than 512 MiB');
        out.set(relative(root, full).split(sep).join('/'), data);
      }
    }
  };
  await walk(root);
  return out;
}

/** Files of a pack given as a .zip file or a folder. */
export async function readPackSource(path: string): Promise<Map<string, Buffer>> {
  const info = await stat(path);
  if (info.isDirectory()) return readFolder(path);
  const entries = readZip(await readFile(path));
  return new Map(entries.map((e) => [e.name, e.data]));
}

async function existingTemplates(): Promise<ExistingTemplate[]> {
  const index = await getLibrary();
  const packs = resolve(packsDir());
  return index.templates.map((t) => ({ id: t.manifest.id, dir: t.dir, fromPack: resolve(t.dir).startsWith(packs + sep) }));
}

export interface PackPreviewResult {
  path: string;
  preview: PackPreview;
}

/** Open dialog for a pack, or null when cancelled. */
export async function choosePackFile(): Promise<string | null> {
  const pick = await dialog.showOpenDialog({
    title: 'Import template pack',
    properties: ['openFile'],
    filters: [{ name: 'Template pack', extensions: ['zip'] }],
  });
  return pick.canceled ? null : (pick.filePaths[0] ?? null);
}

export async function previewPack(path: string): Promise<PackPreviewResult | { error: string }> {
  try {
    const files = await readPackSource(path);
    return { path, preview: inspectPack(files, await existingTemplates()) };
  } catch (err) {
    const message = err instanceof ZipError ? `Not a usable pack: ${err.message}` : `Could not read the pack: ${(err as Error).message}`;
    return { error: message };
  }
}

export interface InstallResult {
  installed: string[];
  replaced: string[];
  skipped: { folder: string; reason: string }[];
  packDir: string;
}

/** Write the chosen templates into the packs folder and rescan. Everything installs under one folder per pack. */
export async function installPack(path: string, choices: Record<string, CollisionChoice>): Promise<InstallResult | { error: string }> {
  const read = await previewPack(path);
  if ('error' in read) return read;
  const { preview } = read;
  if (!preview.manifest || preview.problems.length > 0) return { error: preview.problems[0] ?? 'invalid pack' };
  const files = await readPackSource(path);
  const prefix = files.has(PACK_FILENAME) ? '' : ([...files.keys()].find((k) => k.endsWith(`/${PACK_FILENAME}`)) ?? PACK_FILENAME).slice(0, -PACK_FILENAME.length);
  const plan = planInstall(preview, choices);
  const result: InstallResult = { installed: [], replaced: [], skipped: [], packDir: join(packsDir(), preview.installDir) };
  const packRoot = resolve(result.packDir);

  for (const item of plan) {
    const t = preview.templates.find((x) => x.folder === item.folder)!;
    if (item.action === 'skip') {
      result.skipped.push({ folder: item.folder, reason: item.reason ?? 'skipped' });
      continue;
    }
    const dest = resolve(packsDir(), t.installDir);
    if (!dest.startsWith(packRoot + sep)) {
      result.skipped.push({ folder: item.folder, reason: 'unsafe install folder' });
      continue;
    }
    if (item.action === 'replace') {
      // The existing copy is under the packs folder (planInstall guarantees it); remove it wherever it is there.
      const old = resolve(t.collision!.dir);
      if (old.startsWith(resolve(packsDir()) + sep)) await rm(old, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    await rm(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    const base = `${prefix}${item.folder}/`;
    for (const [name, data] of files) {
      if (!name.startsWith(base)) continue;
      const target = resolve(dest, name.slice(base.length));
      if (!target.startsWith(dest + sep)) continue;
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, data);
    }
    (item.action === 'replace' ? result.replaced : result.installed).push(item.folder);
  }
  // The pack's own manifest, for the license and author display later.
  await mkdir(result.packDir, { recursive: true });
  await writeFileAtomic(join(result.packDir, PACK_FILENAME), JSON.stringify(preview.manifest, null, 2) + '\n');
  await rescan();
  return result;
}

/** Packs installed in the packs folder, with their manifests, for the license and author display. */
export async function listInstalledPacks(): Promise<{ dir: string; manifest: PackManifest }[]> {
  const out: { dir: string; manifest: PackManifest }[] = [];
  let names: string[];
  try {
    names = await readdir(packsDir());
  } catch {
    return out;
  }
  for (const name of names) {
    try {
      const text = await readFile(join(packsDir(), name, PACK_FILENAME), 'utf8');
      const manifest = JSON.parse(text) as PackManifest;
      if (manifest && manifest.name) out.push({ dir: join(packsDir(), name), manifest });
    } catch {
      // not a pack folder
    }
  }
  return out;
}

export interface ExportMeta {
  name: string;
  author?: string;
  license: string;
  description?: string;
}

/** Zip the given templates with a pack.json. The folder names inside the pack are the templates' own folder names. */
export async function exportPackTo(destination: string, templates: TemplateEntry[], meta: ExportMeta): Promise<{ bytes: number; templates: number }> {
  const entries: ZipEntry[] = [];
  const folders: string[] = [];
  const used = new Set<string>();
  for (const t of templates) {
    let folder = slug(basename(t.dir), 'template');
    let n = 2;
    while (used.has(folder)) folder = `${slug(basename(t.dir), 'template')}-${n++}`;
    used.add(folder);
    folders.push(folder);
    for (const [rel, data] of await readFolder(t.dir)) entries.push({ name: `${folder}/${rel}`, data });
  }
  const manifest: PackManifest = {
    formatVersion: 1,
    name: meta.name,
    license: meta.license,
    templates: folders,
    ...(meta.author ? { author: meta.author } : {}),
    ...(meta.description ? { description: meta.description } : {}),
  };
  entries.unshift({ name: PACK_FILENAME, data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  const zip = writeZip(entries);
  await writeFileAtomic(destination, zip);
  return { bytes: zip.length, templates: templates.length };
}

/** Save dialog for an exported pack, or null when cancelled. */
export async function chooseExportFile(suggested: string): Promise<string | null> {
  const save = await dialog.showSaveDialog({
    title: 'Export template pack',
    defaultPath: join(app.getPath('documents') || app.getPath('home'), `${slug(suggested, 'pack')}.zip`),
    filters: [{ name: 'Template pack', extensions: ['zip'] }],
  });
  return save.canceled || !save.filePath ? null : save.filePath;
}
