/**
 * What's new (milestone 31): the latest release's notes from the changelog,
 * inlined at build time so the dialog shows exactly what this build shipped
 * with. The reading itself is pure (src/core/changelog.ts).
 */

import changelogText from '../../CHANGELOG.md?raw';
import { latestRelease } from '../core/changelog';

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
    title.textContent = "What's new";
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Nothing to tell yet.';
    body.append(p);
  } else {
    title.textContent = notes.version.toLowerCase() === 'unreleased'
      ? "What's new"
      : `What's new in ${notes.version}${notes.date ? ` — ${notes.date}` : ''}`;
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
