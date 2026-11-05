/**
 * The user guide (milestone 8) held to the window it describes: every key it
 * lists is one the menu really registers, every search term it documents is
 * one the parser really reads, and every region it names is really in the
 * markup. A guide that drifts is worse than none, and these are the three
 * ways it would.
 */

import { shownMarkup } from './markup';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMenu, EMPTY_MENU_STATE, type MenuItemSpec } from '../src/core/menu';
import { parseQuery } from '../src/core/search';
import { docSections } from '../src/core/doc-page';

const ROOT = join(__dirname, '..');
const guide = await readFile(join(ROOT, 'docs', 'user-guide.md'), 'utf8');
// As the window shows it: the markup's words are in the catalog (milestone 59; tests/markup.ts).
const html = shownMarkup();

/** Every accelerator the menu registers, on either platform's wording. */
function menuAccelerators(): Set<string> {
  const out = new Set<string>();
  for (const mac of [false, true]) {
    const walk = (items: MenuItemSpec[]): void => {
      for (const item of items) {
        if (item.accelerator) out.add(item.accelerator);
        if (item.submenu) walk(item.submenu);
      }
    };
    walk(buildMenu({ mac, development: false, appName: 'Pulp', state: EMPTY_MENU_STATE }).flatMap((s) => s.items));
  }
  return out;
}

describe('the keys it lists', () => {
  /**
   * Keys the **window** owns rather than the menu, which is why they are not
   * in the accelerator list: a menu accelerator fires inside a text field, and
   * these must not (the note at the top of src/core/menu.ts). Their own
   * regions test them.
   */
  const windowOwned = new Set(['Cmd/Ctrl+B']);

  it('names only keys the menu really registers, or the few the window owns', () => {
    const written = [...guide.matchAll(/`(Cmd\/Ctrl\+[^`]+)`/g)].map((m) => m[1]!);
    expect(written.length).toBeGreaterThan(5);
    const accelerators = menuAccelerators();
    const unknown = written.filter((key) => {
      if (windowOwned.has(key)) return false;
      // The guide writes what a person reads; the menu writes CmdOrCtrl.
      const normalized = key.replace('Cmd/Ctrl', 'CmdOrCtrl');
      return !accelerators.has(normalized);
    });
    expect(unknown).toEqual([]);
  });

  it('points at the live list rather than promising to be it', () => {
    expect(guide).toContain('Help → Keyboard Shortcuts');
  });
});

describe('the search terms it documents', () => {
  it('documents only terms the parser reads, and reads them as terms rather than as words', () => {
    // The table's first cell, for every row of the searching section.
    const terms = [...guide.matchAll(/^\| `([a-z]+):([^`]*)`/gm)].map((m) => ({ key: m[1]!, example: `${m[1]!}:${m[2]!}` }));
    expect(terms.length).toBeGreaterThanOrEqual(12);
    for (const { key, example } of terms) {
      const parsed = parseQuery(example);
      // A term the parser does not know falls through to free text, which is how drift would show.
      expect(parsed.terms, `${example} is read as a filter, not as words`).toEqual([]);
      expect(key).toMatch(/^[a-z]+$/);
    }
  });

  it('covers every filter the search module documents, so nothing searchable is left unsaid', async () => {
    // The query language's own list is the comment at the top of src/core/search.ts, kept beside
    // the parser; a filter added there and left out of the guide fails here.
    const source = await readFile(join(ROOT, 'src', 'core', 'search.ts'), 'utf8');
    const syntax = source.slice(source.indexOf('Query syntax'), source.indexOf('*/'));
    const keys = [...new Set([...syntax.matchAll(/^\s*\*\s{3}([a-z]+):/gm)].map((m) => m[1]!))];
    expect(keys.length).toBeGreaterThanOrEqual(15);
    const searching = guide.slice(guide.indexOf('## Searching'));
    for (const key of keys) expect(searching, `${key}: is documented`).toContain(`\`${key}:`);
  });
});

describe('the window it describes', () => {
  it('names regions that are really there', () => {
    const labels = new Set([...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!));
    for (const region of ['Browse', 'Search', 'Results', 'Inspector', 'Transport']) {
      expect(labels.has(region), `the ${region} region`).toBe(true);
      expect(guide, `the guide names ${region}`).toMatch(new RegExp(`\\*\\*${region}`, 'i'));
    }
  });

  it('reads into the sections the dialog shows, with the ones a reader jumps to', () => {
    const sections = docSections(guide);
    expect(sections[0]!.title).toBe('Using Pulp');
    const titles = sections.filter((s) => s.level === 1).map((s) => s.title);
    expect(titles).toEqual(['Using Pulp', 'The window', 'Making something', 'Keys worth knowing', 'Searching', 'Where your things are', 'More']);
    // The two tables are read as tables, so the dialog sets them as tables.
    const tables = sections.flatMap((s) => s.blocks).filter((b) => typeof b !== 'string' && 'header' in b);
    expect(tables).toHaveLength(2);
  });
});
