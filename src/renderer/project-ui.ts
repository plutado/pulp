/**
 * The project's controls in the window (milestone 27): the name in the status
 * bar with its mark for unsaved changes, the dialog holding New, Open, Save,
 * Save As and Open Recent, and the two questions a project asks — what to do
 * about unsaved changes, and whether to recover a session that ended suddenly.
 *
 * The application menu is where these belong and it arrives next; this is one
 * button and one dialog until then, and the menu will call the same functions
 * (./project.ts) rather than growing a second way to do any of it.
 */

import { effect } from '@preact/signals';
import { UNTITLED_PROJECT } from '../core/app-state';
import { appState } from './store';
import { isDirty, newProject, offerRecovery, openProjectFrom, projectDirty, relinkMissing, saveProject, setUnsavedPrompt } from './project';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** The file's own name, for the recent list; the whole path is the tooltip. */
function fileName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.(pulp|pulpcollection)$/i, '');
}

async function fillRecent(): Promise<void> {
  const list = $('project-recent');
  const empty = $('project-recent-empty');
  const paths = await window.pulp.recentProjects();
  list.replaceChildren();
  empty.hidden = paths.length > 0;
  for (const path of paths) {
    const row = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'recent-open';
    open.title = path;
    open.textContent = fileName(path);
    open.addEventListener('click', () => {
      $<HTMLDialogElement>('project-dialog').close();
      void openProjectFrom(path);
    });
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'icon-button';
    forget.setAttribute('aria-label', `Forget ${fileName(path)}`);
    forget.textContent = '×';
    forget.addEventListener('click', () => {
      void window.pulp.forgetProject(path).then(() => fillRecent());
    });
    row.append(open, forget);
    list.append(row);
  }
}

/**
 * Put a question in a modal dialog and answer it from its buttons.
 *
 * The answer is settled **by the button**, never by the dialog's `close`
 * event. `close()` clears `open` at once but fires `close` on a later task, so
 * an answer waiting on that event arrives after the window already looks
 * closed — and worse, the task is delivered to whatever listener exists when
 * it finally runs, so a question asked straight after another is answered by
 * the previous one's event and shuts before it can be read. Esc is the one way
 * out that touches no button, and it fires `cancel` first, which `close()`
 * does not: that is what is listened for, and it answers with the choice that
 * changes nothing.
 */
function ask<T>(dialogId: string, buttons: Record<string, T>, onEscape: T): Promise<T> {
  const dialog = $<HTMLDialogElement>(dialogId);
  return new Promise<T>((resolve) => {
    let settled = false;
    const listeners: { el: HTMLElement; fn: () => void; event: string }[] = [];
    const finish = (answer: T) => {
      if (settled) return;
      settled = true;
      for (const { el, fn, event } of listeners) el.removeEventListener(event, fn);
      resolve(answer);
      dialog.close();
    };
    for (const [id, answer] of Object.entries(buttons)) {
      const el = $(id);
      const fn = () => finish(answer);
      el.addEventListener('click', fn);
      listeners.push({ el, fn, event: 'click' });
    }
    const escaped = () => finish(onEscape);
    dialog.addEventListener('cancel', escaped);
    listeners.push({ el: dialog, fn: escaped, event: 'cancel' });
    dialog.showModal();
  });
}

/** Ask what to do about unsaved changes. Escaping the question changes nothing, so it cancels. */
function askUnsaved(name: string): Promise<'save' | 'discard' | 'cancel'> {
  $('unsaved-text').textContent = `"${name}" has changes that have not been saved. Save them before carrying on?`;
  return ask('unsaved-dialog', { 'unsaved-save': 'save', 'unsaved-discard': 'discard', 'unsaved-cancel': 'cancel' } as const, 'cancel');
}

/** Offer a recovery copy. Declining clears it, so the question is asked once; escaping declines. */
function askRecovery(name: string, savedAt: string): Promise<boolean> {
  const when = savedAt ? new Date(savedAt) : null;
  const stamp = when && !Number.isNaN(when.getTime()) ? ` from ${when.toLocaleString()}` : '';
  $('recovery-text').textContent =
    `Pulp closed with unsaved changes to "${name}"${stamp}. Recover them? Discarding them cannot be undone.`;
  return ask('recovery-dialog', { 'recovery-open': true, 'recovery-discard': false }, false);
}

export function initProjectUi(): void {
  setUnsavedPrompt(askUnsaved);
  const button = $<HTMLButtonElement>('project-button');
  const dialog = $<HTMLDialogElement>('project-dialog');

  // The status bar says what the project is called and whether anything is unsaved; the window
  // title says the same thing (src/main/index.ts), so neither has to be looked for.
  effect(() => {
    const s = appState.value;
    button.querySelector('.label')!.textContent = s.project.name || UNTITLED_PROJECT;
    button.classList.toggle('dirty', projectDirty.value);
    button.title = s.project.path ?? 'Not saved anywhere yet';
  });

  button.addEventListener('click', () => {
    const s = appState.value;
    $('project-where').textContent = s.project.path
      ? `${s.project.name} — ${s.project.path}${isDirty() ? ' (unsaved changes)' : ''}`
      : 'This project has not been saved anywhere yet.';
    void fillRecent();
    dialog.showModal();
  });
  $('project-close').addEventListener('click', () => dialog.close());
  $('project-new').addEventListener('click', () => {
    dialog.close();
    void newProject();
  });
  $('project-open').addEventListener('click', () => {
    dialog.close();
    void openProjectFrom(null);
  });
  $('project-save').addEventListener('click', () => {
    dialog.close();
    void saveProject();
  });
  $('project-save-as').addEventListener('click', () => {
    dialog.close();
    void saveProject({ saveAs: true });
  });

  // For tests and scripting: the project actions by path, without the native dialogs.
  const hooks = window as unknown as {
    pulpOpenProject?: (path: string) => Promise<boolean>;
    pulpSaveProject?: (path: string) => Promise<boolean>;
    pulpRelink?: (uid: string, found: string) => Promise<void>;
  };
  hooks.pulpOpenProject = (path: string) => openProjectFrom(path);
  hooks.pulpSaveProject = (path: string) => saveProject({ path });
  hooks.pulpRelink = (uid: string, found: string) => relinkMissing(uid, found);
}

/** Asked once, at launch, after the library is in: a recovery copy is only useful with a library behind it. */
export async function askAboutRecovery(): Promise<boolean> {
  return offerRecovery(askRecovery);
}
