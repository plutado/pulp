/**
 * Template packs: a folder or .zip holding `pack.json` and one folder per
 * template. Pure rules: validate the pack manifest, inspect each template,
 * flag licenses, decide what an install would do given the templates already
 * in the library. Reading archives and writing folders happens in the main
 * process.
 */

import { tr } from './i18n';
import { MANIFEST_FILENAME, parseManifest, type TemplateManifest, type ValidationIssue } from './manifest';
import { isBuiltInStyle, isBuiltInType, normalizeTheme } from './taxonomy';
import { validateTemplateSound, type TemplateSound } from './template-sound';

export const PACK_FILENAME = 'pack.json';

export interface PackManifest {
  formatVersion: 1;
  name: string;
  version?: string;
  author?: string;
  /** SPDX identifier for the pack as a whole; templates carry their own. */
  license: string;
  description?: string;
  homepage?: string;
  /** Folder names inside the pack, one per template. */
  templates: string[];
  /** Defaults for the pack's templates: a template that declares its own type keeps it; themes and styles are added to its own. */
  type?: string;
  themes?: string[];
  styles?: string[];
  /**
   * Sound variations for the pack's templates (milestone 16): the
   * same `sound` a template manifest declares, stated once for the whole pack.
   * A template that declares its own keeps it; for the rest, each variant's
   * file is looked for **inside the template's own folder**, and only the
   * variants whose files are there apply — so one declaration serves thirty
   * templates, and a template without the files simply stays silent.
   */
  sound?: TemplateSound;
}

/** Licenses that permit redistribution without further terms. Anything else gets a warning, not a block. */
export const OPEN_LICENSES = new Set([
  'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-3.0', 'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'Unlicense', 'OFL-1.1', 'Zlib', 'MPL-2.0',
]);

/** Null when the license is fine; otherwise a short reason to show. */
export function licenseWarning(license: string | undefined): string | null {
  if (!license || license.trim() === '') return tr('pack.license.none');
  if (license.toUpperCase() === 'UNLICENSED' || license.toLowerCase() === 'proprietary') return tr('pack.license.not-open');
  if (!OPEN_LICENSES.has(license)) return tr('pack.license.unknown', { license });
  return null;
}

export interface PackTemplatePreview {
  folder: string;
  manifest?: TemplateManifest;
  /** Why the template cannot be installed, if it cannot. */
  problems: string[];
  issues?: ValidationIssue[];
  licenseWarning: string | null;
  /** A template with this id exists in the library already. */
  collision?: { where: 'pack' | 'library'; dir: string };
  /** The folder it would be installed into, relative to the packs folder. */
  installDir: string;
  fileCount: number;
  bytes: number;
}

export interface PackPreview {
  manifest?: PackManifest;
  problems: string[];
  licenseWarning: string | null;
  templates: PackTemplatePreview[];
  /** Pack folder name inside the packs folder. */
  installDir: string;
}

export interface ExistingTemplate {
  id: string;
  dir: string;
  /** True if the template was installed from a pack (lives under the packs folder) and may be replaced. */
  fromPack: boolean;
}

/** Folder name for a pack or template: lowercase, dashes, bounded. */
export function slug(text: string, fallback: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}

export function parsePackManifest(text: string): { ok: true; manifest: PackManifest } | { ok: false; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, problems: [`pack.json is not valid JSON: ${(err as Error).message}`] }; // i18n-exempt(diagnostic)
  }
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problems: ['pack.json must be an object'] }; // i18n-exempt(diagnostic)
  const r = raw as Record<string, unknown>;
  if (r.formatVersion !== 1) problems.push('formatVersion must be 1'); // i18n-exempt(diagnostic)
  if (typeof r.name !== 'string' || r.name.trim() === '') problems.push('name must be a non-empty string'); // i18n-exempt(diagnostic)
  if (typeof r.license !== 'string' || r.license.trim() === '') problems.push('license must be an SPDX identifier, e.g. CC0-1.0'); // i18n-exempt(diagnostic)
  if (!Array.isArray(r.templates) || r.templates.length === 0 || !r.templates.every((t) => typeof t === 'string' && /^[^/\\]+$/.test(t) && t !== '.' && t !== '..')) {
    problems.push('templates must be a non-empty list of folder names inside the pack'); // i18n-exempt(diagnostic)
  }
  for (const key of ['version', 'author', 'description', 'homepage'] as const) {
    if (r[key] !== undefined && typeof r[key] !== 'string') problems.push(`${key} must be a string`); // i18n-exempt(diagnostic)
  }
  if (r.type !== undefined && (typeof r.type !== 'string' || !isBuiltInType(r.type))) problems.push('type must be a type id from the built-in list'); // i18n-exempt(diagnostic)
  let themes: string[] | undefined;
  if (r.themes !== undefined) {
    if (!Array.isArray(r.themes) || !r.themes.every((t) => typeof t === 'string' && t.trim() !== '')) problems.push('themes must be a list of non-empty strings'); // i18n-exempt(diagnostic)
    else themes = [...new Set((r.themes as string[]).map(normalizeTheme))].filter((t) => t.length > 0);
  }
  let styles: string[] | undefined;
  if (r.styles !== undefined) {
    if (!Array.isArray(r.styles) || !r.styles.every((v) => typeof v === 'string')) problems.push('styles must be a list of strings'); // i18n-exempt(diagnostic)
    else {
      styles = [...new Set((r.styles as string[]).map((v) => v.trim().toLowerCase()))];
      for (const style of styles) if (!isBuiltInStyle(style)) problems.push(`"${style}" is not a built-in style`); // i18n-exempt(diagnostic)
    }
  }
  let sound: TemplateSound | null = null;
  if (r.sound !== undefined) {
    // The duration bound is each template's own business; here only the shape is checked.
    const issues: { path: string; message: string }[] = [];
    sound = validateTemplateSound(r.sound, Number.MAX_SAFE_INTEGER, issues);
    problems.push(...issues.map((i) => `${i.path}: ${i.message}`));
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    manifest: {
      formatVersion: 1,
      name: (r.name as string).trim(),
      license: (r.license as string).trim(),
      templates: [...new Set(r.templates as string[])],
      ...(r.version !== undefined ? { version: r.version as string } : {}),
      ...(r.author !== undefined ? { author: r.author as string } : {}),
      ...(r.description !== undefined ? { description: r.description as string } : {}),
      ...(r.homepage !== undefined ? { homepage: r.homepage as string } : {}),
      ...(typeof r.type === 'string' ? { type: r.type } : {}),
      ...(themes !== undefined ? { themes } : {}),
      ...(styles !== undefined ? { styles } : {}),
      ...(sound ? { sound } : {}),
    },
  };
}

/**
 * What a pack contains and what installing it would do. `files` maps relative
 * paths (forward slashes) to contents; `existing` are the library's templates.
 * Templates whose id is already in the library are marked: replaceable when
 * the existing copy came from a pack, otherwise to be skipped.
 */
export function inspectPack(files: ReadonlyMap<string, Uint8Array>, existing: readonly ExistingTemplate[]): PackPreview {
  const preview: PackPreview = { problems: [], licenseWarning: null, templates: [], installDir: 'pack' };
  // pack.json at the root, or one level down when the zip wraps everything in a folder.
  let prefix = '';
  if (!files.has(PACK_FILENAME)) {
    const nested = [...files.keys()].find((k) => k.endsWith(`/${PACK_FILENAME}`) && k.split('/').length === 2);
    if (nested) prefix = nested.slice(0, -PACK_FILENAME.length);
  }
  const packBytes = files.get(`${prefix}${PACK_FILENAME}`);
  if (!packBytes) {
    preview.problems.push(tr('pack.problem.no-pack-file', { file: PACK_FILENAME }));
    return preview;
  }
  const parsed = parsePackManifest(new TextDecoder().decode(packBytes));
  if (!parsed.ok) {
    preview.problems.push(...parsed.problems);
    return preview;
  }
  preview.manifest = parsed.manifest;
  preview.licenseWarning = licenseWarning(parsed.manifest.license);
  preview.installDir = slug(parsed.manifest.name, 'pack');
  const byId = new Map(existing.map((e) => [e.id, e]));
  const seenIds = new Map<string, string>();

  for (const folder of parsed.manifest.templates) {
    const base = `${prefix}${folder}/`;
    const inFolder = [...files.entries()].filter(([k]) => k.startsWith(base));
    const t: PackTemplatePreview = {
      folder,
      problems: [],
      licenseWarning: null,
      installDir: `${preview.installDir}/${slug(folder, 'template')}`,
      fileCount: inFolder.length,
      bytes: inFolder.reduce((n, [, d]) => n + d.length, 0),
    };
    const manifestBytes = files.get(`${base}${MANIFEST_FILENAME}`);
    if (inFolder.length === 0) t.problems.push(tr('pack.problem.folder-missing', { folder }));
    else if (!manifestBytes) t.problems.push(tr('pack.problem.no-manifest', { folder, file: MANIFEST_FILENAME }));
    else {
      const m = parseManifest(new TextDecoder().decode(manifestBytes));
      if (!m.ok) {
        t.problems.push(tr('pack.problem.manifest-invalid'));
        t.issues = m.errors;
      } else {
        t.manifest = m.manifest;
        t.licenseWarning = licenseWarning(m.manifest.license);
        if (!files.has(`${base}${m.manifest.entry}`)) t.problems.push(tr('pack.problem.entry-missing', { entry: m.manifest.entry }));
        const dup = seenIds.get(m.manifest.id);
        if (dup) t.problems.push(tr('pack.problem.duplicate-id', { id: m.manifest.id, folder: dup }));
        seenIds.set(m.manifest.id, folder);
        const hit = byId.get(m.manifest.id);
        if (hit) t.collision = { where: hit.fromPack ? 'pack' : 'library', dir: hit.dir };
      }
    }
    preview.templates.push(t);
  }
  return preview;
}

export type CollisionChoice = 'skip' | 'replace';

export interface InstallPlanItem {
  folder: string;
  action: 'install' | 'replace' | 'skip';
  reason?: string;
}

/** Decide per template, given the preview and the user's choices for collisions. */
export function planInstall(preview: PackPreview, choices: Record<string, CollisionChoice> = {}): InstallPlanItem[] {
  return preview.templates.map((t) => {
    if (t.problems.length > 0 || !t.manifest) return { folder: t.folder, action: 'skip', reason: t.problems[0] ?? tr('pack.skip.invalid') }; // i18n-exempt(technical)
    if (!t.collision) return { folder: t.folder, action: 'install' }; // i18n-exempt(technical)
    if (t.collision.where === 'library') return { folder: t.folder, action: 'skip', reason: tr('pack.skip.in-library', { id: t.manifest.id, dir: t.collision.dir }) }; // i18n-exempt(technical)
    return choices[t.folder] === 'replace'
      ? { folder: t.folder, action: 'replace' } // i18n-exempt(technical)
      : { folder: t.folder, action: 'skip', reason: tr('pack.skip.installed', { id: t.manifest.id }) }; // i18n-exempt(technical)
  });
}

/** Files of a template folder as pack entries under `folder/`. */
export function packEntriesFor(folder: string, files: ReadonlyMap<string, Uint8Array>): { name: string; data: Uint8Array }[] {
  return [...files.entries()].map(([rel, data]) => ({ name: `${folder}/${rel}`, data }));
}
