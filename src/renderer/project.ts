/**
 * The project in the window (milestone 27): New, Open, Open Recent, Save and
 * Save As; the mark on the title while there are unsaved changes and the ask
 * before they are lost; the autosave that survives a crash; and relinking
 * media that moved.
 *
 * The project is **the session as it stands** — the collection with every
 * item's parameters, layers and placements, the library folders and the render
 * folder — so it is assembled from the state rather than held twice. Whether
 * anything is unsaved is decided by comparing what would be written now with
 * what was written last (`sameProject` in src/core/project.ts), so a change
 * that would not survive saving never warns anybody.
 */

import { effect, signal } from '@preact/signals';
import { resolveCollection } from '../core/collection';
import { initialProjectState, openProject as openProjectState, setProject, UNTITLED_PROJECT, type ProjectState } from '../core/app-state';
import { emptyProject, hasUnsavedChanges, missingPaths, relinkItem, type Project } from '../core/project';
import { appState, dispatch } from './store';
import { setCollection } from '../core/app-state';

/** How long after the last change the recovery copy is written. */
const AUTOSAVE_AFTER_MS = 2000;

/** What was written last, which is what "unsaved changes" is measured against. */
let saved: Project = emptyProject;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let say: (text: string, isError?: boolean) => void = () => {};
/** Set while a dialog is deciding what to do about unsaved changes, so two cannot open at once. */
let asking = false;

/**
 * The project as the session stands: what Save would write. The library
 * folders are whatever the library has now rather than what the file said, so
 * a project saved here records the folders it was actually drawing from.
 */
export function currentProject(): Project {
  const s = appState.value;
  return {
    collection: s.collection,
    libraryFolders: s.index ? [...s.index.roots] : s.project.libraryFolders,
    ...(s.project.renderFolder ? { renderFolder: s.project.renderFolder } : {}),
  };
}

/**
 * Whether there is anything unsaved, as a signal: the title, the status bar
 * and the autosave all follow it, and what was last written is a plain value
 * that no region can see. One place decides, and everything that shows it
 * updates when it changes.
 */
export const projectDirty = signal(false);

export function isDirty(): boolean {
  return projectDirty.value;
}

function refreshDirty(): void {
  projectDirty.value = hasUnsavedChanges(currentProject(), saved);
}

/** The project's name and whether it has unsaved changes, which the window title shows. */
function pushTitle(): void {
  const s = appState.value;
  void window.pulp.setProjectTitle(s.project.name || UNTITLED_PROJECT, projectDirty.value);
}

/** Mark what is on screen as what was saved: after a save, a new project and an open. */
function markSaved(project: Project = currentProject()): void {
  saved = JSON.parse(JSON.stringify(project)) as Project;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  void window.pulp.clearRecovery();
  refreshDirty();
  pushTitle();
}

/**
 * A project is written to the recovery copy a moment after it stops changing,
 * not on every keystroke: an autosave is for a session that ends suddenly, and
 * writing the file on every edit would cost more than it saves.
 */
function scheduleAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    if (!projectDirty.value) return;
    void window.pulp.autosaveProject(currentProject(), appState.value.project.path);
  }, AUTOSAVE_AFTER_MS);
}

// ---------------------------------------------------------------- the actions

/**
 * Write the project. Save As asks where; Save asks only the first time. A
 * `path` is for tests and scripting, which cannot answer a native dialog.
 */
export async function saveProject(options: { saveAs?: boolean; path?: string } = {}): Promise<boolean> {
  const s = appState.value;
  const project = currentProject();
  const target = options.path ?? (options.saveAs ? null : s.project.path);
  const result = await window.pulp.saveProject(project, target, s.project.name || 'project');
  if (!result.ok) {
    if (!result.cancelled) say(result.message, true);
    return false;
  }
  dispatch((state) => setProject(state, { ...state.project, path: result.path, name: result.name }));
  markSaved(project);
  say(`Saved as ${result.name}.`);
  return true;
}

/** Everything a freshly opened or recovered project replaces, in one step. */
function adopt(project: Project, where: { path: string | null; name: string }): void {
  const next: ProjectState = {
    path: where.path,
    name: where.name,
    libraryFolders: project.libraryFolders,
    ...(project.renderFolder ? { renderFolder: project.renderFolder } : {}),
  };
  dispatch((s) => openProjectState(s, project.collection, next));
}

async function noteMissingFolders(project: Project): Promise<string> {
  if (project.libraryFolders.length === 0) return '';
  const missing = await window.pulp.missingLibraryFolders(project.libraryFolders);
  if (missing.length === 0) return '';
  return ` This project draws from ${missing.length} ${missing.length === 1 ? 'folder' : 'folders'} this computer does not have: ${missing.join(', ')}.`;
}

/** What a freshly opened project has to say for itself: what is missing, and what moved. */
function openedNote(name: string, project: Project, folders: string, fromCollection: boolean): string {
  const list = resolveCollection(project.collection, appState.value.index);
  const lost = list.filter((r) => r.missing || r.offline).length;
  const lostNote = lost > 0 ? ` ${lost} ${lost === 1 ? 'item is' : 'items are'} not available here.` : '';
  const asProject = fromCollection ? ' Saving will write a project; Save As can write a collection again.' : '';
  return `Opened ${name}.${lostNote}${folders}${asProject}`;
}

export async function openProjectFrom(path: string | null): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  const result = path ? await window.pulp.openProjectPath(path) : await window.pulp.openProject();
  if (!result.ok) {
    if (!result.cancelled) say(result.message, true);
    // A recent entry whose file has gone is taken off the list rather than offered again.
    if (result.missing && path) await window.pulp.forgetProject(path);
    return false;
  }
  const project = result.project ?? emptyProject;
  adopt(project, { path: result.path, name: result.name });
  // A collection opened as a project is not yet a project file: saving should ask where to put one.
  if (result.fromCollection) dispatch((s) => setProject(s, { ...s.project, path: null }));
  markSaved(project);
  say(openedNote(result.name, project, await noteMissingFolders(project), result.fromCollection === true));
  return true;
}

export async function newProject(): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  dispatch((s) => openProjectState(s, { items: [] }, initialProjectState));
  markSaved(emptyProject);
  say('New project.');
  return true;
}

/** Where Render all last wrote, kept with the project so it does not ask twice for the same answer. */
export function rememberRenderFolder(folder: string): void {
  dispatch((s) => setProject(s, { ...s.project, renderFolder: folder }));
}

// ---------------------------------------------------------------- unsaved changes

type Decision = 'save' | 'discard' | 'cancel';

let askUnsaved: (name: string) => Promise<Decision> = async () => 'discard';

/** The window supplies the dialog; this module decides when it is needed. */
export function setUnsavedPrompt(ask: (name: string) => Promise<Decision>): void {
  askUnsaved = ask;
}

/**
 * Ask before unsaved changes are lost. True to go ahead — nothing to lose, or
 * the person said so — false to leave everything as it is.
 */
export async function confirmDiscard(): Promise<boolean> {
  if (!isDirty() || asking) return !isDirty();
  asking = true;
  try {
    const answer = await askUnsaved(appState.value.project.name || UNTITLED_PROJECT);
    if (answer === 'cancel') return false;
    if (answer === 'discard') return true;
    return await saveProject();
  } finally {
    asking = false;
  }
}

// ---------------------------------------------------------------- media that moved

/**
 * Relink a missing item. Where its file is found says where its folder went,
 * so the other missing items that moved the same way are rebound in the same
 * step — otherwise a project off a drive that was remounted elsewhere would be
 * relinked item by item.
 */
export async function relinkMissing(uid: string, answer?: string): Promise<void> {
  const s = appState.value;
  const item = s.collection.items.find((i) => i.uid === uid);
  if (!item?.path) {
    say('That item does not record where it was, so there is nothing to relink from.', true);
    return;
  }
  const resolved = resolveCollection(s.collection, s.index);
  const missing = new Set(resolved.filter((r) => r.missing).map((r) => r.item.uid));
  const others = missingPaths(s.collection.items, missing).filter((m) => m.uid !== uid);
  const result = await window.pulp.relinkItem({ uid, path: item.path, kind: item.kind, name: item.name }, others, answer);
  if (!result.ok) {
    if (!result.cancelled) say(result.message, true);
    return;
  }
  dispatch((state) => {
    let collection = state.collection;
    for (const r of result.relinked) collection = relinkItem(collection, r.uid, { id: r.id, path: r.path });
    return setCollection(state, collection);
  });
  const extra = result.relinked.length - 1;
  say(extra > 0 ? `Relinked ${item.name} and ${extra} more that moved with it.` : `Relinked ${item.name}.`);
}

// ---------------------------------------------------------------- wiring

export function initProject(note: (text: string, isError?: boolean) => void): void {
  say = note;
  // The title and the autosave both follow the state: one place decides what has changed.
  effect(() => {
    void appState.value.collection;
    void appState.value.project;
    refreshDirty();
    pushTitle();
    if (projectDirty.value) scheduleAutosave();
  });
  window.pulp.onCloseRequested(() => {
    void (async () => {
      if (await confirmDiscard()) await window.pulp.allowClose();
      else await window.pulp.cancelClose();
    })();
  });
}

/** A recovery copy left by a session that ended suddenly, offered once at launch. */
export async function offerRecovery(ask: (name: string, savedAt: string) => Promise<boolean>): Promise<void> {
  const recovery = await window.pulp.pendingRecovery();
  if (!recovery) return;
  const name = recovery.name || UNTITLED_PROJECT;
  if (!(await ask(name, recovery.savedAt))) {
    await window.pulp.clearRecovery();
    return;
  }
  adopt(recovery.project, { path: recovery.path, name });
  // Recovered, not saved: the changes are still unsaved, which is the whole point of recovering them.
  saved = emptyProject;
  refreshDirty();
  pushTitle();
  say(`Recovered ${name}. The changes have not been saved yet.`);
}
