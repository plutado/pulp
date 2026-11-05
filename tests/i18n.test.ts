/**
 * Languages and locale (milestone 59): the catalogs, how a language is chosen,
 * how a message is read, the catalog used and nothing in it unused — and the
 * ratchet that holds the code to the catalog. Words still written straight into
 * the code are counted per file in tests/i18n-baseline.json: a file may not
 * gain one, and a file that loses some must lower its count, so the list only
 * ever shrinks until every word is in the catalog.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  catalogFor, formatMessage, LOCALES, placeholdersOf, resolveLocale, sanitizeLanguage, SOURCE_LOCALE, translate, translator, type Catalog,
} from '../src/core/i18n';
import { enUS } from '../src/locales/en-US';
import { enGB } from '../src/locales/en-GB';
import { buildMenu, EMPTY_MENU_STATE as MENU_STATE } from '../src/core/menu';

const ROOT = join(__dirname, '..');
const MARKUP = readFileSync(join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

describe('choosing a language', () => {
  it('offers English (US) and English (UK) first, each under its own name, US English the source', () => {
    expect(LOCALES.slice(0, 2).map((l) => l.label)).toEqual(['English (US)', 'English (UK)']);
    expect(SOURCE_LOCALE).toBe('en-US');
  });

  it('keeps a language offered, and makes anything else the system\'s', () => {
    expect(sanitizeLanguage('en-GB')).toBe('en-GB');
    expect(sanitizeLanguage('system')).toBe('system');
    for (const raw of [undefined, null, 'fr-FR', 'EN-GB', 3]) expect(sanitizeLanguage(raw)).toBe('system');
  });

  it('follows the system: the first language offered, in the order the system prefers them', () => {
    expect(resolveLocale('system', ['en-GB', 'en-US'])).toBe('en-GB');
    expect(resolveLocale('system', ['en-US', 'en-GB'])).toBe('en-US');
    expect(resolveLocale('system', ['fr-FR', 'en-GB'])).toBe('en-GB');
  });

  it('shows English from a region that spells as Britain does as English (UK), and English with no region as the source', () => {
    for (const tag of ['en-AU', 'en-NZ', 'en-IE', 'en-CA', 'en-IN', 'en_ZA']) expect(resolveLocale('system', [tag]), tag).toBe('en-GB');
    for (const tag of ['en', 'en-US', 'en-PH']) expect(resolveLocale('system', [tag]), tag).toBe('en-US');
  });

  it('is US English when the system speaks nothing offered, and the choice itself when one is made', () => {
    expect(resolveLocale('system', ['de-DE', 'ja'])).toBe('en-US');
    expect(resolveLocale('system', [])).toBe('en-US');
    expect(resolveLocale('en-GB', ['en-US'])).toBe('en-GB');
  });
});

describe('reading a message', () => {
  it('fills placeholders, and leaves one with no value showing so it is seen', () => {
    expect(formatMessage('Quit {app}', 'en-US', { app: 'Pulp' })).toBe('Quit Pulp');
    expect(formatMessage('Quit {app}', 'en-US')).toBe('Quit {app}');
  });

  it('takes the plural form the locale calls for', () => {
    const message = { one: '{count} item', other: '{count} items' };
    expect(formatMessage(message, 'en-US', { count: 1 })).toBe('1 item');
    expect(formatMessage(message, 'en-US', { count: 0 })).toBe('0 items');
    expect(formatMessage(message, 'en-GB', { count: 12 })).toBe('12 items');
  });

  it('falls back to US English for what a catalog does not say, and shows a missing id as itself', () => {
    const gb = catalogFor('en-GB');
    expect(gb['ui.rescan.aria-label']).toBe(enUS['ui.rescan.aria-label']);
    expect(gb['ui.bg-gray.aria-label']).toBe('Grey background');
    expect(translate({} as Catalog, 'en-US', 'ui.rescan.aria-label')).toBe('ui.rescan.aria-label');
  });
});

describe('the catalogs', () => {
  it('give British English only what differs, every id one the source has, with the same placeholders', () => {
    const entries = Object.entries(enGB) as [keyof typeof enUS, string][];
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, words] of entries) {
      expect(enUS[id], `${id} is not in the source`).toBeDefined();
      expect(words, `${id} says nothing different`).not.toBe(enUS[id]);
      expect(placeholdersOf(words), id).toEqual(placeholdersOf(enUS[id]));
    }
  });

  it('spell the British catalog as Britain does: no US spelling left in what it says', () => {
    for (const [id, words] of Object.entries(enGB)) {
      expect(String(words), id).not.toMatch(/\b(colors?|gray|centers?|favorites?|theater|license|customize)\b/i);
    }
  });

  it('give British English every source message that has a US spelling in it, so a word moved into the catalog is never left American', () => {
    const US_SPELLING = /\b(colors?|recolor|gray|centers?|centered|favorites?|theater|license|customiz\w*|behaviors?|canceled|organiz\w*|recogniz\w*)\b/i;
    // Syntax, not words: the search field's filter keywords are typed as they are in every language.
    const SYNTAX = new Set(['ui.search.data-tip']);
    const text = (words: string | object) => (typeof words === 'string' ? words : Object.values(words).join(' '));
    const missing = Object.entries(enUS).filter(([id, words]) => !SYNTAX.has(id) && US_SPELLING.test(text(words)) && !(id in enGB)).map(([id]) => id);
    expect(missing, 'add these to src/locales/en-GB.ts').toEqual([]);
  });

  it('leave the search field\'s filter keywords alone in every language: they are typed, not read', () => {
    for (const l of LOCALES) expect(translator(l.id)('ui.search.data-tip'), l.id).toContain('favorite:');
  });

  it('name the application menu in the language asked for, and in US English when none is', () => {
    const labels = (t?: ReturnType<typeof translator>) => buildMenu({ mac: true, development: false, appName: 'Pulp', state: { ...MENU_STATE }, ...(t ? { t } : {}) })
      .flatMap((s) => [s.label, ...s.items.map((i) => i.label ?? '')]);
    expect(labels()).toContain('Quit Pulp');
    expect(labels()).toContain('Theater');
    expect(labels(translator('en-GB'))).toContain('Theatre');
    expect(labels(translator('en-GB'))).not.toContain('Theater');
  });
});


/** Every source file the interface's words could be written into. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/**
 * Where a word for the interface is written straight into code: the places a
 * string goes on screen. A heuristic, kept deliberately narrow so it does not
 * cry wolf — a label, a tooltip, a title, a tray line, an element's text, a
 * hint or a detail, each a quoted string with a letter in it.
 */
const USER_FACING = [
  /\b(?:label|hint|detail|description|placeholder|listAs|note|summary|tip):\s*(['"`])(?=[^'"`]*\p{L})/u,
  /\.(?:textContent|title|placeholder|ariaLabel)\s*=\s*(['"`])(?=[^'"`]*\p{L})/u,
  /\.dataset\.tip\s*=\s*(['"`])(?=[^'"`]*\p{L})/u,
  /setAttribute\(\s*'(?:aria-label|title|placeholder|data-tip)'\s*,\s*(['"`])(?=[^'"`]*\p{L})/u,
  /\b(?:sayInTray|say|sayNote)\(\s*(['"`])(?=[^'"`]*\p{L})/u,
];

function countUserFacing(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
    for (const re of USER_FACING) if (re.test(code)) n += 1;
  }
  return n;
}

describe('words written straight into the code', () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, 'tests', 'i18n-baseline.json'), 'utf8')) as { total: number; files: Record<string, number> };
  const counts: Record<string, number> = {};
  for (const file of [...sources(join(ROOT, 'src', 'renderer')), ...sources(join(ROOT, 'src', 'core')), ...sources(join(ROOT, 'src', 'main'))]) {
    const n = countUserFacing(readFileSync(file, 'utf8'));
    if (n > 0) counts[relative(ROOT, file).split('\\').join('/')] = n;
  }

  it('are not added to: a file has no more than tests/i18n-baseline.json says, and a new file has none', () => {
    const grown = Object.entries(counts).filter(([file, n]) => n > (baseline.files[file] ?? 0)).map(([file, n]) => `${file}: ${n}, baseline ${baseline.files[file] ?? 0}`);
    expect(grown, 'put the new words in src/locales/en-US.ts and read them with t()').toEqual([]);
  });

  it('only shrink: a file that has lost some lowers its count in the baseline, so the list stays true', () => {
    const shrunk = Object.entries(baseline.files).filter(([file, n]) => (counts[file] ?? 0) < n).map(([file, n]) => `${file}: ${counts[file] ?? 0}, baseline ${n}`);
    expect(shrunk, 'lower these in tests/i18n-baseline.json').toEqual([]);
  });

  it('keep the baseline\'s total true to its files', () => {
    expect(baseline.total).toBe(Object.values(baseline.files).reduce((a, b) => a + b, 0));
  });

  it('are gone from the application menu, whose every word is in the catalog', () => {
    expect(counts['src/core/menu.ts'] ?? 0).toBe(0);
  });
});

describe('the catalog has nothing unused', () => {
  it('every id in the source catalog is read somewhere: by the markup, or by name in the code', () => {
    const corpus = MARKUP + sources(join(ROOT, 'src')).filter((f) => !f.includes(`${join('src', 'locales')}`)).map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(enUS).filter((id) => !corpus.includes(`'${id}'`) && !corpus.includes(`"${id}"`) && !corpus.includes(`:${id}`) && !corpus.includes(`:${id};`));
    expect(unused).toEqual([]);
  });
});
