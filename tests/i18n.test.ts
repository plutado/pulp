/**
 * Languages and locale (milestone 59): the catalogs, how a language is chosen,
 * how a message is read, the catalog used and nothing in it unused — and the
 * code holding no word of the interface's outside the catalog: every string the
 * scan finds (tests/i18n-scan.ts) is read from src/locales/, or exempt as a
 * command line's, a diagnostic's, library content or technical, by a reason
 * stated in tests/i18n-exempt.json or beside the string.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  catalogFor, directionOf, formatMessage, lengthen, LOCALES, ownCatalog, placeholdersOf, resolveLocale, sanitizeLanguage, SOURCE_LOCALE, translate, translator, type Catalog,
} from '../src/core/i18n';
import { enUS } from '../src/locales/en-US';
import { EXEMPT_REASONS, findWords } from './i18n-scan';
import { enGB } from '../src/locales/en-GB';
import { britishSpelling } from '../src/core/spelling';
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

describe('Chinese and German (milestone 68)', () => {
  it('lists every language in its own language and script, the two not yet checked by a speaker as previews', () => {
    expect(LOCALES.filter((l) => !l.pseudo).map((l) => l.label)).toEqual(['English (US)', 'English (UK)', 'Deutsch', '中文（简体）']);
    expect(LOCALES.filter((l) => l.preview).map((l) => [l.id, l.previewLabel])).toEqual([['de', 'Deutsch (Vorschau)'], ['zh-CN', '中文（简体）（预览）']]);
    for (const l of LOCALES) expect(l.variant && l.preview, `${l.id}: a variant is never a preview`).toBe(false);
  });

  it('never puts a person into a preview they did not choose: the system passes over it, a choice does not', () => {
    expect(resolveLocale('system', ['de-DE'])).toBe('en-US');
    expect(resolveLocale('system', ['zh-CN', 'en-GB'])).toBe('en-GB');
    expect(resolveLocale('de', ['en-US'])).toBe('de');
    expect(resolveLocale('zh-CN', [])).toBe('zh-CN');
  });

  it('once checked, gives German to any German-speaking region and Simplified Chinese only where it is written', () => {
    const once = (tags: string[]) => resolveLocale('system', tags, { previews: true });
    for (const tag of ['de', 'de-DE', 'de-AT', 'de-CH', 'de_LI', 'de-Latn-DE']) expect(once([tag]), tag).toBe('de');
    for (const tag of ['zh', 'zh-CN', 'zh_SG', 'zh-Hans', 'zh-Hans-CN', 'zh-Hans-HK']) expect(once([tag]), tag).toBe('zh-CN');
    // Traditional Chinese gets English until a Traditional catalog exists — or the system's next language.
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-CN']) expect(once([tag]), tag).toBe('en-US');
    expect(once(['zh-TW', 'de-DE'])).toBe('de');
    expect(once(['zh-TW', 'en-AU'])).toBe('en-GB');
  });

  it('writes Chinese as Chinese is written: one plural form, full-width punctuation, no italic or ASCII quotes', () => {
    const zh = ownCatalog('zh-CN');
    const bad: string[] = [];
    for (const [id, m] of Object.entries(zh)) {
      if (typeof m === 'object' && Object.keys(m).some((form) => form !== 'other')) bad.push(`${id}: plural forms`);
      for (const text of typeof m === 'string' ? [m] : Object.values(m)) {
        if (/[\u4e00-\u9fff][,.:;!?](?=\s|$)/.test(text ?? '')) bad.push(`${id}: half-width punctuation after Chinese: ${text}`);
        if (/<em>/.test(text ?? '')) bad.push(`${id}: italic in Chinese`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('addresses the person as "Sie" in German, never "du"', () => {
    const informal = Object.entries(ownCatalog('de')).filter(([, m]) => /\b(du|dich|dir|dein\w*)\b/i.test((typeof m === 'string' ? m : m.other).replace(/\{\w+\}/g, '')));
    expect(informal.map(([id]) => id)).toEqual([]);
  });

  it('keeps the translators\' glossary: Pulp\'s own terms the same everywhere', () => {
    const terms: [string, RegExp, RegExp][] = [
      // [the source's word, its German, its Chinese]
      ['template', /Vorlage/, /模板/],
      ['lower third', /Bauchbinde/, /下方字幕条/],
      ['layer', /Ebene/, /图层/],
      ['safe area', /sicher/, /安全区域/],
    ];
    const de = catalogFor('de'), zh = catalogFor('zh-CN');
    const text = (m: unknown) => (typeof m === 'string' ? m : (m as { other: string }).other);
    const off: string[] = [];
    for (const [id, m] of Object.entries(enUS)) {
      const en = text(m).toLowerCase();
      for (const [word, inDe, inZh] of terms) {
        // Only where the source's word is a word of its own, not part of an id or a longer name.
        if (!new RegExp(`\\b${word}s?\\b`).test(en) || en.includes('{')) continue;
        if (!inDe.test(text(de[id as keyof typeof de]))) off.push(`de ${id}: "${word}"`);
        if (!inZh.test(text(zh[id as keyof typeof zh]))) off.push(`zh-CN ${id}: "${word}"`);
      }
    }
    // A handful may say it another way where the sentence asks for it; the glossary holds the rest.
    expect(off.length, off.join('\n')).toBeLessThanOrEqual(Math.ceil(Object.keys(enUS).length * 0.01));
  });
});

describe('English (lengthened), the pseudo-locale for long words (milestone 59)', () => {
  it('draws every word out by two fifths at its end, and leaves placeholders, tags and numbers alone', () => {
    expect(lengthen('Save')).toBe('Saveøø');
    expect(lengthen('Parameters')).toBe('Parametersøøøø');
    expect(lengthen('a')).toBe('aø');
    expect(lengthen('Saved as {name}.')).toBe('Savedøø asø {name}.');
    expect(lengthen('{count} items')).toBe('{count} itemsøø');
    expect(lengthen('Press <strong>Render</strong> now')).toBe('Pressøø <strong>Render</strong> nowø');
    expect(lengthen('1920 × 1080 · 25 fps')).toBe('1920 × 1080 · 25 fpsø');
    expect(lengthen('favorite:')).toContain('favorite:');
  });

  it('is a complete catalog of its own, made from the source, every message longer than the source says it', () => {
    const mirrored = LOCALES.find((l) => l.id === 'en-XA')!;
    expect(mirrored.pseudo).toBe(true);
    expect(mirrored.variant).toBe(false);
    expect(directionOf('en-XA')).toBe('ltr');
    const own = ownCatalog('en-XA');
    expect(Object.keys(own).sort()).toEqual(Object.keys(enUS).sort());
    const text = (m: unknown) => (typeof m === 'string' ? m : (m as { other: string }).other);
    for (const [id, m] of Object.entries(enUS)) {
      const longer = text(own[id as keyof typeof enUS]);
      expect(longer.length, id).toBeGreaterThanOrEqual(text(m).length);
      expect(placeholdersOf(own[id as keyof typeof enUS]!), id).toEqual(placeholdersOf(m));
      expect(longer.startsWith(text(m).split(/\s+/)[0]!), `${id} begins as the source does`).toBe(true);
    }
    // Never offered, never the system's.
    for (const tags of [['en-XA'], ['en-US'], ['de-DE']]) expect(resolveLocale('system', tags, { previews: true })).not.toBe('en-XA');
    expect(resolveLocale('en-XA', ['en-US'])).toBe('en-XA');
  });
});

describe('right to left (milestone 70)', () => {
  it('every language says which way it is written, and the ones translated so far read left to right', () => {
    for (const l of LOCALES) expect(['ltr', 'rtl']).toContain(l.dir);
    for (const l of LOCALES.filter((x) => !x.pseudo)) expect(directionOf(l.id), l.id).toBe('ltr');
  });

  it('English (mirrored) is a tool: US English read right to left, a variant with nothing of its own, never offered and never the system\'s', () => {
    const mirrored = LOCALES.find((l) => l.id === 'en-XB')!;
    expect(mirrored.pseudo).toBe(true);
    expect(mirrored.variant).toBe(true);
    expect(mirrored.preview).toBe(false);
    expect(directionOf('en-XB')).toBe('rtl');
    expect(ownCatalog('en-XB')).toEqual({});
    expect(catalogFor('en-XB')).toEqual(enUS);
    // Reached by choosing it, as settings.json or a test does; the system's languages never come to it.
    expect(sanitizeLanguage('en-XB')).toBe('en-XB');
    expect(resolveLocale('en-XB', ['en-US'])).toBe('en-XB');
    for (const tags of [['en-XB'], ['ar'], ['he-IL', 'en-US'], ['fa']]) expect(resolveLocale('system', tags, { previews: true }), tags.join()).not.toBe('en-XB');
    expect(LOCALES.filter((l) => l.pseudo).map((l) => l.id)).toEqual(['en-XA', 'en-XB']);
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

  it('give British English exactly the source in British spelling: an entry where the rules change a message, none where they do not', () => {
    // Syntax, not words: the search field's filter keywords are typed as they are in every language.
    const SYNTAX = new Set(['ui.search.data-tip']);
    const wrong: string[] = [];
    for (const [id, us] of Object.entries(enUS) as [keyof typeof enUS, string | Record<string, string>][]) {
      const british = typeof us === 'string' ? britishSpelling(us) : Object.fromEntries(Object.entries(us).map(([form, words]) => [form, britishSpelling(words)]));
      const differs = JSON.stringify(british) !== JSON.stringify(us);
      const has = id in enGB;
      if (SYNTAX.has(id)) {
        if (has) wrong.push(`${id}: syntax, keep it out of en-GB`);
      } else if (differs && !has) wrong.push(`${id}: missing — ${JSON.stringify(british)}`);
      else if (!differs && has) wrong.push(`${id}: says nothing the rules change`);
      else if (differs && JSON.stringify(enGB[id]) !== JSON.stringify(british)) wrong.push(`${id}: ${JSON.stringify(enGB[id])} ≠ ${JSON.stringify(british)}`);
    }
    expect(wrong, 'src/locales/en-GB.ts against src/core/spelling.ts').toEqual([]);
  });

  it('are complete for every language that is not a variant of the source, and hold nothing the source does not', () => {
    // A translator checking one: I18N_LOCALE=de npx vitest run tests/i18n.test.ts -t complete
    const asked = process.env.I18N_LOCALE;
    for (const l of LOCALES.filter((x) => !asked || x.id === asked)) {
      const own = ownCatalog(l.id);
      const extra = Object.keys(own).filter((id) => !(id in enUS));
      expect(extra, `${l.id}: ids the source does not have (unused)`).toEqual([]);
      if (l.id === SOURCE_LOCALE || l.variant) continue;
      const missing = Object.keys(enUS).filter((id) => !(id in own));
      expect(missing, `${l.id}: messages not yet translated`).toEqual([]);
    }
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

const EXEMPT = JSON.parse(readFileSync(join(ROOT, 'tests', 'i18n-exempt.json'), 'utf8')) as { files: Record<string, { reason: string; why: string }> };

/** The interface's words still in the code, by file: none, once every word is in the catalog. */
function wordsInCode(): Record<string, { line: number; text: string }[]> {
  // I18N_ONLY=src/renderer/stage.ts,src/core/ narrows the check while moving one part's words.
  const only = (process.env.I18N_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const found: Record<string, { line: number; text: string }[]> = {};
  for (const file of sources(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (rel.startsWith('src/locales/') || rel in EXEMPT.files) continue;
    if (only.length > 0 && !only.some((prefix) => rel.startsWith(prefix))) continue;
    const words = findWords(rel, readFileSync(file, 'utf8'));
    if (words.length > 0) found[rel] = words;
  }
  return found;
}

describe('words written straight into the code (tests/i18n-scan.ts)', () => {
  it('are none: every word the window or the menus show is in the catalog, or exempt for a stated reason', () => {
    const found = wordsInCode();
    const report = Object.entries(found).flatMap(([file, words]) => words.map((w) => `${file}:${w.line}  ${w.text}`));
    expect(report, 'read these with t()/tr() from a message in src/locales/en-US/, or mark one i18n-exempt(<reason>) — docs/translating.md').toEqual([]);
  });

  it('exempt whole files only for one of the four reasons, each file there and each with something to exempt', () => {
    for (const [file, { reason, why }] of Object.entries(EXEMPT.files)) {
      expect(EXEMPT_REASONS as readonly string[], file).toContain(reason);
      expect(why.length, `${file}: say why`).toBeGreaterThan(10);
      const path = join(ROOT, file);
      expect(existsSync(path), `${file} is gone: take it out of tests/i18n-exempt.json`).toBe(true);
      expect(findWords(file, readFileSync(path, 'utf8')).length, `${file} has nothing left to exempt: take it out of tests/i18n-exempt.json`).toBeGreaterThan(0);
    }
  });

  it('mark a string exempt only for one of the four reasons', () => {
    const bad: string[] = [];
    for (const file of sources(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/i18n-exempt\(([^)]*)\)/g)) if (!(EXEMPT_REASONS as readonly string[]).includes(m[1]!)) bad.push(`${relative(ROOT, file)}: i18n-exempt(${m[1]})`);
    }
    expect(bad).toEqual([]);
  });
});

describe('the scan itself', () => {
  const words = (code: string, file = 'x.ts') => findWords(file, code).map((w) => w.text);

  it('finds a sentence anywhere, and any word where the window reads it — a one-word button too', () => {
    expect(words(`const a = 'Nothing was recorded.';`)).toEqual(['Nothing was recorded.']);
    expect(words(`el.textContent = 'Stop';`)).toEqual(['Stop']);
    expect(words(`const item = { label: 'Save' };`)).toEqual(['Save']);
    expect(words(`button.setAttribute('aria-label', 'Close');`)).toEqual(['Close']);
    expect(words(`sayInTray(\`Recorded \${n} s\`);`)).toEqual(['Recorded ${n} s']);
    expect(words(`const x = ok ? 'Done' : 'Failed';\nel.title = ok ? 'All done' : 'It failed';`)).toEqual(['All done', 'It failed']);
    expect(words(`const v = <span title="Copy path">Looking for cuts…</span>;`, 'x.tsx')).toEqual(['Copy path', 'Looking for cuts…']);
  });

  it('leaves alone what is not words for a person', () => {
    expect(words(`import { x } from './some module';`)).toEqual([]);
    expect(words(`console.warn('Hover-scrub strip failed: no reason');`)).toEqual([]);
    expect(words(`el.className = 'badge tag';\ndocument.querySelector('#a .b');\nif (kind === 'Lower third') {}`)).toEqual([]);
    expect(words(`const t = { 'Big Key': 1 };\ntype K = 'Some Words';`)).toEqual([]);
    expect(words(`const n = t('menu.project.new');`)).toEqual([]);
  });

  it('takes an i18n-exempt comment on the line or the line before', () => {
    expect(words(`const a = 'Usage: pulp render'; // i18n-exempt(terminal)`)).toEqual([]);
    expect(words(`// i18n-exempt(diagnostic): for the template's author\nconst a = 'must be a non-empty string';`)).toEqual([]);
  });
});

describe('the source catalog\'s parts', () => {
  it('define each id once: a second part saying the same id would win silently', () => {
    const dir = join(ROOT, 'src', 'locales', 'en-US');
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const name of readdirSync(dir).filter((n) => n !== 'index.ts')) {
      for (const m of readFileSync(join(dir, name), 'utf8').matchAll(/^ {2}'([^']+)':/gm)) {
        if (seen.has(m[1]!)) twice.push(`${m[1]} in ${seen.get(m[1]!)} and ${name}`);
        else seen.set(m[1]!, name);
      }
    }
    expect(twice).toEqual([]);
    expect(seen.size, 'every part is put together in index.ts').toBe(Object.keys(enUS).length);
  });
});

describe('the catalog has nothing unused', () => {
  it('every id in the source catalog is read somewhere: by the markup, by name in the code, or by a template of ids', () => {
    const corpus = MARKUP + sources(join(ROOT, 'src')).filter((f) => !f.includes(`${join('src', 'locales')}`)).map((f) => readFileSync(f, 'utf8')).join('\n');
    // A type-checked template id, `start.shape.${shape}`, reads every id under its fixed prefix.
    const prefixes = [...corpus.matchAll(/`([a-z][\w-]*(?:\.[\w-]+)*\.)\$\{/g)].map((m) => m[1]!);
    const read = (id: string) => corpus.includes(`'${id}'`) || corpus.includes(`"${id}"`) || corpus.includes(`:${id}`) || prefixes.some((p) => id.startsWith(p));
    expect(Object.keys(enUS).filter((id) => !read(id))).toEqual([]);
    // Every source file read and every id looked for: past vitest's 5 s default under a full parallel run.
  }, 30_000);
});
