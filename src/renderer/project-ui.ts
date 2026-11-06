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
import { formatDateTime } from '../core/locale-format';
import { appState } from './store';
import { isDirty, newProject, offerRecovery, openProjectFrom, projectDirty, relinkMissing, saveProject, setUnsavedPrompt, shownProjectName } from './project';
import { bindAttr, bindText, t } from './i18n';

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
    bindAttr(forget, 'aria-label', 'project.recent.forget', { name: fileName(path) });
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
  bindText($('unsaved-text'), 'project.unsaved.text', { name });
  return ask('unsaved-dialog', { 'unsaved-save': 'save', 'unsaved-discard': 'discard', 'unsaved-cancel': 'cancel' } as const, 'cancel');
}

/** Offer a recovery copy. Declining clears it, so the question is asked once; escaping declines. */
function askRecovery(name: string, savedAt: string): Promise<boolean> {
  const when = savedAt ? new Date(savedAt) : null;
  const text = $('recovery-text');
  if (when && !Number.isNaN(when.getTime())) bindText(text, 'recover.text.dated', { name, when: formatDateTime(when.getTime()) });
  else bindText(text, 'recover.text', { name });
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
    // The name is the project's own, not the markup's Untitled: its stamp goes, and the effect
    // itself follows a change of language (`t` reads the locale), Untitled included (milestone 59).
    const label = button.querySelector<HTMLElement>('.label')!;
    delete label.dataset.i18n;
    label.textContent = shownProjectName(s.project.name, s.project.path);
    button.classList.toggle('dirty', projectDirty.value);
    button.title = s.project.path ?? t('project.button.not-saved');
  });

  button.addEventListener('click', () => {
    const s = appState.value;
    const where = $('project-where');
    if (!s.project.path) bindText(where, 'project.where.not-saved');
    else bindText(where, isDirty() ? 'project.where.unsaved' : 'project.where', { name: s.project.name, path: s.project.path });
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

/**
 * Renders the last session was in the middle of (milestone 58): their partial files are gone
 * already, and a yes queues them again to the outputs the save dialog had answered. Asked once,
 * after the recovery question, since a recovered project is what some of them were rendering.
 */
export async function offerInterruptedRenders(): Promise<void> {
  const jobs = await window.pulp.interruptedRenders();
  if (jobs.length === 0) return;
  const names = jobs.slice(0, 3).map((j) => t('recover.renders.name', { name: j.label })).join(', ');
  const text = $('interrupted-text');
  if (jobs.length > 3) bindText(text, 'recover.renders.text.more', { count: jobs.length, names, more: jobs.length - 3 });
  else bindText(text, 'recover.renders.text', { count: jobs.length, names });
  if (await ask('interrupted-dialog', { 'interrupted-render': true, 'interrupted-skip': false }, false)) await window.pulp.renderAgain();
}
