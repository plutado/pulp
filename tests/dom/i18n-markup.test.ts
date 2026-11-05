// @vitest-environment happy-dom
/**
 * Languages and locale (milestone 59), the window's markup: it holds no words
 * of its own, names only ids the catalog has, and reads in whichever language
 * is put in place — a label's words beside its control, emphasis built as
 * elements. The catalogs themselves are tests/i18n.test.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enUS } from '../../src/locales/en-US';
import { applyTranslations, locale, setLocale } from '../../src/renderer/i18n';
import { shownMarkup } from '../markup';

const MARKUP = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8');

describe('the markup', () => {
  const doc = () => new DOMParser().parseFromString(MARKUP, 'text/html');
  const ATTRS = ['aria-label', 'data-tip', 'title', 'placeholder', 'alt'];

  it('holds no words of its own: every word it shows comes from the catalog', () => {
    const d = doc();
    const loose: string[] = [];
    for (const el of d.body.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      for (const n of el.childNodes) if (n.nodeType === 3 && /\p{L}/u.test(n.textContent ?? '')) loose.push(`<${el.tagName.toLowerCase()} id="${el.id}">: "${n.textContent!.trim().slice(0, 50)}"`);
      for (const a of ATTRS) if (/\p{L}/u.test(el.getAttribute(a) ?? '')) loose.push(`<${el.tagName.toLowerCase()} id="${el.id}"> ${a}="${el.getAttribute(a)!.slice(0, 50)}"`);
    }
    expect(loose, 'words written into src/renderer/index.html: give each a data-i18n id in src/locales/en-US.ts').toEqual([]);
  });

  it('names only ids the catalog has', () => {
    const ids = [...MARKUP.matchAll(/data-i18n(?:-rich)?="([^"]+)"/g)].map((m) => m[1]!);
    for (const m of MARKUP.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1]!.split(';')) ids.push(pair.split(':')[1]!);
    expect(ids.length).toBeGreaterThan(400);
    expect(ids.filter((id) => !(id in enUS))).toEqual([]);
  });

  it('reads in the chosen language once put in place, and back again', () => {
    const d = doc();
    setLocale('en-GB');
    applyTranslations(d);
    expect(d.documentElement.lang).toBe('en-GB');
    expect(d.getElementById('bg-gray')!.getAttribute('aria-label')).toBe('Grey background');
    expect(d.querySelector('[data-i18n="ui.chip-favorites.favorites"]')!.textContent).toBe('Favourites');
    setLocale('en-US');
    applyTranslations(d);
    expect(d.getElementById('bg-gray')!.getAttribute('aria-label')).toBe('Gray background');
    expect(locale.value).toBe('en-US');
  });

  it('puts a label\'s words beside its control, the control left where it was', () => {
    const d = doc();
    applyTranslations(d);
    const label = d.querySelector('[data-i18n-at="start"]')!;
    const control = label.querySelector('input, select')!;
    expect(label.firstChild!.nodeType).toBe(3);
    expect(label.textContent!.trim().length).toBeGreaterThan(0);
    expect(control.parentElement).toBe(label);
    // Twice is the same as once: the words are replaced, not added again.
    applyTranslations(d);
    expect([...label.childNodes].filter((n) => n.nodeType === 3 && /\p{L}/u.test(n.textContent ?? ''))).toHaveLength(1);
  });

  it('builds inline emphasis as elements, never as markup from the catalog', () => {
    const d = doc();
    applyTranslations(d);
    const invite = d.getElementById('start-invite')!;
    expect(invite.querySelector('strong')!.textContent).toBe('New project');
    expect(invite.innerHTML).not.toContain('&lt;');
  });
});

describe('the markup as the tests read it (tests/markup.ts)', () => {
  const ATTRS = ['aria-label', 'data-tip', 'title', 'placeholder', 'alt'];
  const norm = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').trim();
  const read = (d: Document) => [...d.body.querySelectorAll('*')].map((el) => [el.tagName, el.id, norm(el.textContent), ...ATTRS.map((a) => norm(el.getAttribute(a)))].join(' | '));

  it.each(['en-US', 'en-GB'] as const)('is what the window shows in %s, element by element', (id) => {
    setLocale(id);
    const live = new DOMParser().parseFromString(MARKUP, 'text/html');
    applyTranslations(live);
    const written = new DOMParser().parseFromString(shownMarkup(id), 'text/html');
    expect(read(written)).toEqual(read(live));
    setLocale('en-US');
  });
});

