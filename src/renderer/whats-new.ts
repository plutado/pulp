/**
 * What's new (milestone 31): the latest release's notes from the changelog,
 * inlined at build time so the dialog shows exactly what this build shipped
 * with. The reading itself is pure (src/core/changelog.ts).
 */

import changelogText from '../../CHANGELOG.md?raw';
import { latestRelease } from '../core/changelog';
import { bindText } from './i18n';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export function showWhatsNew(): void {
  const notes = latestRelease(changelogText);
  const title = $('whats-new-title');
  const body = $('whats-new-body');
  body.replaceChildren();
  if (!notes) {
    bindText(title, 'whats-new.title');
    const p = document.createElement('p');
    p.className = 'note';
    bindText(p, 'whats-new.empty');
    body.append(p);
  } else {
    // The dialog's own words follow the language; the notes are the changelog's, a document as it was written.
    if (notes.version.toLowerCase() === 'unreleased') bindText(title, 'whats-new.title');
    else if (notes.date) bindText(title, 'whats-new.title.version-date', { version: notes.version, date: notes.date });
    else bindText(title, 'whats-new.title.version', { version: notes.version });
    for (const section of notes.sections) {
      const head = document.createElement('h3');
      head.textContent = section.title;
      const list = document.createElement('ul');
      for (const item of section.items) {
        const li = document.createElement('li');
        li.textContent = item;
        list.append(li);
      }
      body.append(head, list);
    }
  }
  $<HTMLDialogElement>('whats-new-dialog').showModal();
}

export function initWhatsNew(): void {
  $('whats-new-close').addEventListener('click', () => $<HTMLDialogElement>('whats-new-dialog').close());
}
