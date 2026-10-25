/**
 * A person's own fonts (milestone 23, ADR 0014): TTF, OTF or WOFF2 files copied
 * into a managed folder under user data, named by what each file calls itself,
 * with the licence note they wrote. They are served to template pages and the
 * app window exactly as the bundled fonts are, under the reserved path and
 * scheme, from this folder instead. The licence is the person's to know: Pulp
 * records what they said and shows it where the family is chosen, and never
 * puts an imported font into an exported pack.
 */

import { app, BrowserWindow, dialog } from 'electron';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { writeFileAtomic } from '../core/atomic-file';
import { familyFromFileName, fontFileNames, IMPORTED_FONT_EXTENSIONS, isImportedFontFile, sanitizeImportedFonts, type ImportedFont } from '../core/fonts';

/** A font file over this is refused: a text face has no business being bigger. */
const MAX_FONT_FILE_BYTES = 32 * 1024 * 1024;

const INDEX_FILE = 'fonts.json';

export function importedFontsDir(): string {
  return join(app.getPath('userData'), 'fonts');
}

/** What is in the managed folder, as its index records it; an unreadable index is an empty one. */
export async function listImportedFonts(): Promise<ImportedFont[]> {
  try {
    return sanitizeImportedFonts(JSON.parse(await readFile(join(importedFontsDir(), INDEX_FILE), 'utf8')));
  } catch {
    return [];
  }
}

/** The file behind an imported font's name, or null when the index does not know it. */
export async function importedFontPath(file: string): Promise<string | null> {
  const fonts = await listImportedFonts();
  return fonts.some((f) => f.file === file) ? join(importedFontsDir(), file) : null;
}

/** A file dialog for a font; what it names is read for its family so the person can be asked about the licence. */
export async function chooseFontFile(): Promise<{ path: string; family: string; file: string } | { error: string } | null> {
  const result = await dialog.showOpenDialog({
    title: 'Import a font',
    properties: ['openFile'],
    filters: [{ name: 'Fonts', extensions: IMPORTED_FONT_EXTENSIONS.map((e) => e.slice(1)) }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const path = result.filePaths[0]!;
  const read = await readFontFile(path);
  if ('error' in read) return read;
  return { path, family: read.family, file: basename(path) };
}

async function readFontFile(source: string): Promise<{ family: string; style: 'normal' | 'italic'; weight: number } | { error: string }> {
  if (!isImportedFontFile(source)) return { error: `Only ${IMPORTED_FONT_EXTENSIONS.map((e) => e.slice(1).toUpperCase()).join(', ')} fonts can be imported.` };
  let info;
  try {
    info = await stat(source);
  } catch {
    return { error: 'That file could not be read.' };
  }
  if (!info.isFile()) return { error: 'That is not a file.' };
  if (info.size > MAX_FONT_FILE_BYTES) return { error: `Fonts over ${MAX_FONT_FILE_BYTES / 1048576} MB are not imported.` };
  const bytes = new Uint8Array(await readFile(source));
  if (source.toLowerCase().endsWith('.woff2')) {
    // Compressed: its tables cannot be read here, so the family is taken from the file name.
    return { family: familyFromFileName(basename(source)), style: /italic|oblique/i.test(basename(source)) ? 'italic' : 'normal', weight: 400 };
  }
  const names = fontFileNames(bytes);
  if (!names) return { error: 'That file is not a TrueType or OpenType font.' };
  return { family: names.family, style: names.italic ? 'italic' : 'normal', weight: names.weight };
}

/**
 * Copy a font into the managed folder and record it with the person's licence
 * note. The family comes from the file, never from the note or the file name
 * for a readable font, so a layer set in it finds it by the name the font has.
 */
export async function importFontFile(source: string, note: string): Promise<ImportedFont | { error: string }> {
  const read = await readFontFile(source);
  if ('error' in read) return read;
  await mkdir(importedFontsDir(), { recursive: true });
  const ext = extname(source);
  const stem = basename(source, ext).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
  let file = `${stem}${ext}`;
  for (let n = 2; existsSync(join(importedFontsDir(), file)); n++) file = `${stem}-${n}${ext}`;
  await copyFile(source, join(importedFontsDir(), file));
  const font: ImportedFont = { family: read.family, file, style: read.style, weight: read.weight, note: note.trim(), importedAt: new Date().toISOString() };
  const fonts = [...(await listImportedFonts()), font];
  await writeFileAtomic(join(importedFontsDir(), INDEX_FILE), JSON.stringify(fonts, null, 2));
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('fonts:changed', fonts);
  }
  return font;
}
