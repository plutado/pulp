/**
 * Projects in the main process (milestone 27): the file dialogs, the file
 * itself, the recently-opened list, the recovery copy an autosave writes, and
 * relinking media that moved. What a project *is* lives in
 * `src/core/project.ts`; nothing here decides that.
 *
 * Both file types open through one door. A `.pulp` is a project; a
 * `.pulpcollection` is read as a project with items and nothing else, so an
 * older file is never a dead end — and a project can be saved back out as a
 * collection for anyone on a build that does not know projects yet.
 */

import { app, dialog } from 'electron';
import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { writeFileAtomic } from '../core/atomic-file';
import { parseCollection, serializeCollection, type CollectionItem } from '../core/collection';
import { itemId } from '../core/library-scan';
import { slug } from '../core/pack';
import {
  parseProject, pathShift, projectFromCollection, serializeProject, shiftPath, type Project,
} from '../core/project';
import type { LibraryIndex } from '../core/library-types';
import type { RecentProjectRow } from '../core/start-screen';
import type { ProjectFileResult, ProjectRecovery, RelinkResult } from '../shared/api';
import { addLibraryFolder, getLibrary } from './library-service';
import { loadSettings, updateSettings } from './settings';

const PROJECT_EXTENSION = 'pulp';
const COLLECTION_EXTENSION = 'pulpcollection';
const OPEN_FILTERS = [
  { name: 'Pulp project or collection', extensions: [PROJECT_EXTENSION, COLLECTION_EXTENSION] },
  { name: 'Pulp project', extensions: [PROJECT_EXTENSION] },
  { name: 'Pulp collection', extensions: [COLLECTION_EXTENSION] },
];

/** How many recently-opened projects are remembered. */
export const RECENT_PROJECTS_KEPT = 10;

/** The name a project is shown by: its file name without the extension. */
function projectName(path: string): string {
  return basename(path, extname(path));
}

async function remember(path: string): Promise<string[]> {
  const settings = await updateSettings((s) => {
    const recentProjects = [path, ...s.recentProjects.filter((p) => p !== path)].slice(0, RECENT_PROJECTS_KEPT);
    const kept = new Set(recentProjects);
    return {
      ...s,
      recentProjects,
      // The start screen's "last opened" and pins follow the list: an entry that fell off takes its facts with it.
      recentProjectTimes: Object.fromEntries([...Object.entries(s.recentProjectTimes), [path, new Date().toISOString()]].filter(([p]) => kept.has(p!))),
      pinnedProjects: s.pinnedProjects.filter((p) => kept.has(p)),
    };
  });
  return settings.recentProjects;
}

/** The recently-opened projects, newest first, as settings has them. */
export async function recentProjects(): Promise<string[]> {
  return (await loadSettings()).recentProjects;
}

/** Take a project off the recent list — what a file that has gone deserves. */
export async function forgetProject(path: string): Promise<string[]> {
  return (await updateSettings((s) => ({
    ...s,
    recentProjects: s.recentProjects.filter((p) => p !== path),
    pinnedProjects: s.pinnedProjects.filter((p) => p !== path),
    recentProjectTimes: Object.fromEntries(Object.entries(s.recentProjectTimes).filter(([p]) => p !== path)),
  }))).recentProjects;
}

// ---------------------------------------------------------------- the start screen's recent list (milestone 31)

/** The first template an item list names, whose thumbnail stands for the whole project. */
function firstTemplateId(items: readonly CollectionItem[]): string | undefined {
  return items.find((i) => i.kind === 'template' && i.templateId)?.templateId;
}

/**
 * The recent projects with what the start screen says about each: pinned,
 * when it was last opened, whether the file is still there, and the template
 * whose thumbnail stands for it. Each file is read here — they are small JSON
 * files, and reading is also how "missing" is found out rather than guessed.
 */
export async function recentProjectsDetailed(): Promise<RecentProjectRow[]> {
  const settings = await loadSettings();
  const pinned = new Set(settings.pinnedProjects);
  return Promise.all(settings.recentProjects.map(async (path): Promise<RecentProjectRow> => {
    const row: RecentProjectRow = {
      path,
      name: projectName(path),
      pinned: pinned.has(path),
      lastOpened: settings.recentProjectTimes[path] ?? '',
      missing: false,
    };
    try {
      const parsed = parseProject(await readFile(path, 'utf8'));
      const thumb = parsed.ok ? firstTemplateId(parsed.project.collection.items) : undefined;
      return thumb ? { ...row, thumbTemplateId: thumb } : row;
    } catch {
      return { ...row, missing: true };
    }
  }));
}

/** Pin or unpin a recent project; resolves to the pinned paths. */
export async function setProjectPinned(path: string, pinned: boolean): Promise<string[]> {
  return (await updateSettings((s) => ({
    ...s,
    pinnedProjects: pinned
      ? (s.pinnedProjects.includes(path) ? s.pinnedProjects : [...s.pinnedProjects, path])
      : s.pinnedProjects.filter((p) => p !== path),
  }))).pinnedProjects;
}

/**
 * A recent project whose file has gone: ask where it is now and point the
 * entry there, keeping its pin. The file itself is untouched — this relinks
 * the list, where relinkProjectItem below relinks a project's media.
 */
export async function relinkRecentProject(oldPath: string, answer?: string): Promise<{ ok: boolean; path?: string }> {
  let chosen = answer;
  if (!chosen) {
    const pick = await dialog.showOpenDialog({
      title: `Where is "${projectName(oldPath)}" now?`,
      defaultPath: dirname(oldPath) || homedir(),
      filters: OPEN_FILTERS,
      properties: ['openFile'],
    });
    chosen = pick.filePaths[0];
    if (pick.canceled || !chosen) return { ok: false };
  }
  const to = chosen;
  await updateSettings((s) => ({
    ...s,
    recentProjects: s.recentProjects.map((p) => (p === oldPath ? to : p)),
    pinnedProjects: s.pinnedProjects.map((p) => (p === oldPath ? to : p)),
    recentProjectTimes: Object.fromEntries(Object.entries(s.recentProjectTimes).map(([p, t]) => [p === oldPath ? to : p, t])),
  }));
  return { ok: true, path: to };
}

/**
 * Write a project. With a path it saves in place; without one it asks, which
 * is Save As and the first Save of a project that has never been written. The
 * extension chooses the format, so "Save as collection" is a matter of naming
 * the file `.pulpcollection`.
 */
export async function saveProjectTo(project: Project, path: string | null, suggested: string): Promise<ProjectFileResult> {
  let target = path;
  if (!target) {
    const save = await dialog.showSaveDialog({
      title: 'Save project',
      defaultPath: join(app.getPath('documents') || homedir(), `${slug(suggested, 'project')}.${PROJECT_EXTENSION}`),
      filters: [
        { name: 'Pulp project', extensions: [PROJECT_EXTENSION] },
        { name: 'Pulp collection', extensions: [COLLECTION_EXTENSION] },
      ],
    });
    if (save.canceled || !save.filePath) return { ok: false, cancelled: true, message: '' };
    target = save.filePath;
  }
  const asCollection = extname(target).toLowerCase() === `.${COLLECTION_EXTENSION}`;
  try {
    await writeFileAtomic(target, asCollection ? serializeCollection(project.collection) : serializeProject(project));
  } catch (err) {
    return { ok: false, message: `Could not save the project: ${(err as Error).message}` };
  }
  // Saved is saved: the recovery copy has nothing left to recover.
  await clearRecovery();
  return { ok: true, path: target, name: projectName(target), recent: await remember(target) };
}

export async function openProjectDialog(): Promise<ProjectFileResult> {
  const pick = await dialog.showOpenDialog({
    title: 'Open project',
    defaultPath: app.getPath('documents') || homedir(),
    filters: OPEN_FILTERS,
    properties: ['openFile'],
  });
  const path = pick.filePaths[0];
  if (pick.canceled || !path) return { ok: false, cancelled: true, message: '' };
  return readProjectFile(path);
}

/**
 * Read a project or a collection from a path. A collection becomes a project
 * holding its items; which it was is said, so the window can offer to save it
 * on as a project rather than back over the older file.
 */
export async function readProjectFile(path: string): Promise<ProjectFileResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    return { ok: false, message: `Could not read ${basename(path)}: ${(err as Error).message}`, missing: true };
  }
  const asCollection = extname(path).toLowerCase() === `.${COLLECTION_EXTENSION}`;
  if (asCollection) {
    const parsed = parseCollection(text);
    if (!parsed.ok) return { ok: false, message: parsed.error };
    return { ok: true, path, name: projectName(path), project: projectFromCollection(parsed.collection), fromCollection: true, recent: await remember(path) };
  }
  const parsed = parseProject(text);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  return { ok: true, path, name: projectName(path), project: parsed.project, recent: await remember(path) };
}

// ---------------------------------------------------------------- autosave and recovery

function recoveryPath(): string {
  return join(app.getPath('userData'), 'recovery.pulp');
}

/**
 * The project as it stands, written beside the settings while it has unsaved
 * changes. The file the changes belong to is written into the recovery copy
 * itself, so one file is enough: a recovery with no path is a project that was
 * never saved anywhere.
 */
export async function writeRecovery(project: Project, path: string | null): Promise<void> {
  const body = JSON.parse(serializeProject(project)) as Record<string, unknown>;
  body.recoveredFrom = path ?? '';
  body.savedAt = new Date().toISOString();
  await writeFileAtomic(recoveryPath(), `${JSON.stringify(body, null, 2)}\n`);
}

/** Nothing left to recover: after a save, and after a clean quit. */
export async function clearRecovery(): Promise<void> {
  await rm(recoveryPath(), { force: true });
}

/**
 * A recovery copy left behind by a session that did not end cleanly, if there
 * is one. Read and checked like any other project file: a recovery that cannot
 * be read is simply no recovery, since there is nothing to be gained by
 * stopping a launch over it.
 */
export async function readRecovery(): Promise<ProjectRecovery | null> {
  let text: string;
  try {
    text = await readFile(recoveryPath(), 'utf8');
  } catch {
    return null;
  }
  const parsed = parseProject(text);
  if (!parsed.ok) {
    await clearRecovery();
    return null;
  }
  let from = '';
  let savedAt = '';
  try {
    const raw = JSON.parse(text) as { recoveredFrom?: unknown; savedAt?: unknown };
    from = typeof raw.recoveredFrom === 'string' ? raw.recoveredFrom : '';
    savedAt = typeof raw.savedAt === 'string' ? raw.savedAt : '';
  } catch {
    // Already parsed once; nothing more to learn.
  }
  return { project: parsed.project, path: from || null, name: from ? projectName(from) : '', savedAt };
}

// ---------------------------------------------------------------- media that moved

/** Every path the library can currently answer for, to the id it answers with. */
function idsByPath(index: LibraryIndex): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of index.templates) out.set(t.lottie?.path ?? t.dir, t.id);
  for (const m of index.media) out.set(m.path, m.id);
  return out;
}

/**
 * Relink a missing item: ask where it is now, bring its folder into the
 * library, and rebind it. Where the file was found says where its **folder**
 * went, so every other missing item that moved the same way is rebound in the
 * same step — which is the difference between relinking a project and
 * relinking an item forty times.
 */
export async function relinkProjectItem(
  target: { uid: string; path: string; kind: 'template' | 'media'; name: string },
  others: readonly { uid: string; path: string }[],
  /** Where it is, for tests and scripting; without one the dialog asks, as `previewPack` does. */
  answer?: string,
): Promise<RelinkResult> {
  const folder = target.kind === 'template';
  let chosen = answer;
  if (!chosen) {
    const pick = await dialog.showOpenDialog({
      title: folder ? `Where is the template folder for "${target.name}"?` : `Where is "${target.name}" now?`,
      defaultPath: dirname(target.path) || homedir(),
      properties: [folder ? 'openDirectory' : 'openFile'],
    });
    chosen = pick.filePaths[0];
    if (pick.canceled || !chosen) return { ok: false, cancelled: true, message: '' };
  }

  // The folder that moved, if this file says so; otherwise the chosen file's own folder, which
  // brings it into the library without claiming to know anything about its neighbours.
  const shift = pathShift(target.path, chosen);
  const root = shift ? shift.to : (folder ? chosen : dirname(chosen));
  let index: LibraryIndex;
  try {
    index = await addLibraryFolder(root);
  } catch (err) {
    return { ok: false, message: `Could not add ${basename(root)} to the library: ${(err as Error).message}` };
  }
  const known = idsByPath(index);
  const relinked: { uid: string; id: string; path: string }[] = [];
  const chosenId = known.get(chosen) ?? itemId(`${folder ? 'template' : 'media'}:${chosen}`);
  relinked.push({ uid: target.uid, id: chosenId, path: chosen });
  if (shift) {
    for (const other of others) {
      if (other.uid === target.uid) continue;
      const moved = shiftPath(other.path, shift);
      // Only what the library can now answer for: a guess that matches nothing would rebind an
      // item to an id that does not exist, which is the same as missing but harder to understand.
      const id = moved ? known.get(moved) : undefined;
      if (moved && id) relinked.push({ uid: other.uid, id, path: moved });
    }
  }
  return { ok: true, relinked, index };
}

/** The folders a project wants that the library does not have, for the note when one opens. */
export async function missingLibraryFolders(folders: readonly string[]): Promise<string[]> {
  const index = await getLibrary();
  const have = new Set(index.roots);
  return folders.filter((f) => !have.has(f));
}

/** Items a project holds, for the main process to look paths up by uid; the window sends them. */
export type ProjectItems = readonly CollectionItem[];
