/**
 * The user guide (milestone 8): `docs/user-guide.md` shown in the window,
 * from Help → User Guide and from the start screen's Learn section — the two
 * places milestones 27 and 31 left waiting for it.
 *
 * The file is inlined at build time and read by `src/core/doc-page.ts`, so
 * the dialog **is** the guide: there is one copy of the words, in the
 * repository, where they are reviewed with the change that needs them. A
 * contents strip across the top jumps to a section, since a guide is long and
 * a dialog is a small window onto it.
 */

import guideText from '../../docs/user-guide.md?raw';
import { docSections, isDocList, isDocTable, type DocSection } from '../core/doc-page';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** A section's own id in the dialog, for the contents strip to scroll to. */
const sectionId = (title: string): string => `guide-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

function renderSection(section: DocSection, body: HTMLElement): void {
  const head = document.createElement(section.level === 1 ? 'h3' : 'h4');
  head.id = sectionId(section.title);
  head.textContent = section.title;
  body.append(head);
  for (const block of section.blocks) {
    if (typeof block === 'string') {
      const p = document.createElement('p');
      p.textContent = block;
      body.append(p);
      continue;
    }
    if (isDocList(block)) {
      const list = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        li.textContent = item;
        list.append(li);
      }
      body.append(list);
      continue;
    }
    if (!isDocTable(block)) continue;
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const cell of block.header) {
      const th = document.createElement('th');
      th.textContent = cell;
      headRow.append(th);
    }
    thead.append(headRow);
    const tbody = document.createElement('tbody');
    for (const row of block.rows) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    body.append(table);
  }
}

let built = false;

export function showUserGuide(): void {
  const body = $('guide-body');
  if (!built) {
    const sections = docSections(guideText);
    const contents = $('guide-contents');
    contents.replaceChildren();
    // The first section is the page's own title, which the dialog already wears.
    for (const section of sections.slice(1).filter((s) => s.level === 1)) {
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'ghost';
      jump.textContent = section.title;
      jump.addEventListener('click', () => $(sectionId(section.title)).scrollIntoView({ block: 'start' }));
      contents.append(jump);
    }
    body.replaceChildren();
    for (const section of sections) {
      // The title section's own words are the opening paragraphs; its heading is the dialog's.
      if (section === sections[0]) {
        for (const block of section.blocks) {
          if (typeof block !== 'string') continue;
          const p = document.createElement('p');
          p.textContent = block;
          body.append(p);
        }
        continue;
      }
      renderSection(section, body);
    }
    built = true;
  }
  body.scrollTop = 0;
  $<HTMLDialogElement>('guide-dialog').showModal();
}

export function initUserGuide(): void {
  $('guide-close').addEventListener('click', () => $<HTMLDialogElement>('guide-dialog').close());
}
