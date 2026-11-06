/**
 * The library in the interface's language (src/core/library-words.ts): the bundled templates'
 * words in German and Simplified Chinese, what Pulp writes about a Lottie file said again in
 * either, and search still finding an item by its English words.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { libraryWordsFor, localizeIndex } from '../src/core/library-words';
import { searchLibrary } from '../src/core/search';
import type { LocaleId } from '../src/core/i18n';
import type { TemplateEntry } from '../src/core/library-types';
import { lottieFixture } from './lottie-fixture';

const TEMPLATES = join(__dirname, '..', 'templates');
const index = await scanLibrary([TEMPLATES], { builtInRoot: TEMPLATES });
const LOCALES: LocaleId[] = ['de', 'zh-CN'];

/** Every word a bundled template or matching set shows, as the catalogs key them. */
function bundledWords(): Set<string> {
  const words = new Set<string>();
  const add = (s: unknown) => { if (typeof s === 'string' && s.trim() !== '') words.add(s); };
  for (const t of index.templates) {
    add(t.manifest.name);
    // A Lottie's description and labels are Pulp's own messages (lottie.*), not the library catalog's.
    if (t.lottie) continue;
    add(t.manifest.description);
    add(t.pack?.name);
    for (const p of t.manifest.parameters as unknown as Record<string, unknown>[]) {
      add(p.label); add(p.description); add(p.element); add(p.group);
      for (const o of (p.options as { label: string }[] | undefined) ?? []) add(o.label);
    }
  }
  return words;
}

describe('the bundled library in German and Chinese', () => {
  const words = bundledWords();
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

  for (const locale of LOCALES) {
    it(`has every word the bundled templates show in ${locale}, and none they no longer do`, () => {
      const catalog = libraryWordsFor(locale);
      expect([...words].filter((w) => !(w in catalog)), 'not yet translated').toEqual([]);
      // A pack's description is shown where the pack is described; the rest are the templates'.
      expect(Object.keys(catalog).filter((w) => !words.has(w) && !/\.$/.test(w)), 'no longer used').toEqual([]);
      for (const [en, said] of Object.entries(catalog)) expect(placeholders(said), en).toBe(placeholders(en));
    });
  }

  it('writes Chinese with full-width punctuation', () => {
    const half = Object.values(libraryWordsFor('zh-CN')).filter((s) => /[一-鿿][,.:;!?](?=\s|$)/.test(s));
    expect(half).toEqual([]);
  });

  it('shows a bundled template in the language, its parameters and options too, and keeps its English for search', () => {
    const bar = (i: typeof index) => i.templates.find((t) => t.manifest.id === 'pulp.samples.polished-airliner')!;
    const de = localizeIndex(index, 'de');
    const zh = localizeIndex(index, 'zh-CN');
    expect(bar(de).manifest.name).toBe(libraryWordsFor('de')['Airliner']);
    expect(bar(zh).manifest.name).toBe(libraryWordsFor('zh-CN')['Airliner']);
    expect(bar(de).manifest.name).not.toBe('Airliner');
    const entrance = (e: TemplateEntry) => e.manifest.parameters.find((p) => p.id === 'entrance') as unknown as { label: string; element: string; options: { value: string; label: string }[] };
    expect(entrance(bar(de)).options.map((o) => o.label)).toEqual(['Aufploppen', 'Fallen', 'Aufsteigen', 'Zeichnen', 'Einblenden']);
    // Values and ids are never translated: a project saved in one language opens in another.
    expect(entrance(bar(zh)).options.map((o) => o.value)).toEqual(['pop', 'drop', 'rise', 'draw', 'fade']);
    expect(bar(de).manifest.id).toBe('pulp.samples.polished-airliner');
    expect(bar(de).source).toEqual({ name: 'Airliner', description: bar(index).manifest.description });
    // In the source language nothing is copied.
    expect(localizeIndex(index, 'en-US')).toBe(index);
    const plain = index.templates.findIndex((t) => !t.lottie);
    expect(localizeIndex(index, 'en-GB').templates[plain]!.manifest).toBe(index.templates[plain]!.manifest);
  });

  it('still finds things by a typed English word, and by the language\'s own', () => {
    for (const locale of LOCALES) {
      const shown = localizeIndex(index, locale);
      const ids = (q: string) => searchLibrary(shown, q).map((h) => h.entry.id);
      const english = searchLibrary(index, 'airliner').map((h) => h.entry.id);
      expect(english.length, 'the English search finds it').toBeGreaterThan(0);
      expect(ids('airliner'), `${locale}: an English word`).toEqual(expect.arrayContaining(english));
      expect(ids('lower third').length, `${locale}: an English phrase`).toBeGreaterThan(0);
      // The airliner ranks first by its English name, as it does in English.
      expect(ids('airliner')[0], locale).toBe(english[0]);
      const own = libraryWordsFor(locale)['Airliner']!.toLowerCase();
      expect(ids(own), `${locale}: its own word "${own}"`).toContain(english[0]);
    }
  });

  it('leaves a template that is not bundled as its author wrote it', async () => {
    const elsewhere = { ...index, builtInRoot: '/somewhere/else' };
    const shown = localizeIndex(elsewhere, 'de');
    expect(shown.templates.map((t) => t.manifest.name)).toEqual(index.templates.map((t) => t.manifest.name));
  });
});

describe('what Pulp writes about a Lottie file, in the language', () => {
  let root = '';
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it('says the description, the limits, the labels it gave and the Fit setting again, and keeps the file\'s own names', async () => {
    root = await mkdtemp(join(tmpdir(), 'pulp-lottie-words-'));
    await writeFile(join(root, 'title.json'), JSON.stringify(lottieFixture({ withLimits: true, withAnimatedText: true })));
    const scanned = await scanLibrary([root]);
    const entry = scanned.templates[0]!;
    expect(entry.lottie).toBeDefined();
    // The manifest on disk and in the store is US English.
    expect(entry.manifest.description).toMatch(/^A Lottie animation: /);
    expect(entry.manifest.description).toContain('Not drawn: expressions on 1 property');
    const de = localizeIndex(scanned, 'de').templates[0]!.manifest;
    const zh = localizeIndex(scanned, 'zh-CN').templates[0]!.manifest;
    expect(de.description).toMatch(/^Eine Lottie-Animation: /);
    expect(de.description).toContain('Nicht dargestellt: Expressions an 1 Eigenschaft');
    expect(zh.description).toMatch(/^Lottie 动画：/);
    expect(zh.description).toContain('未绘制：');
    expect(zh.description).not.toMatch(/[A-Za-z]{4,} (?:are|is) /);
    const fit = (m: typeof de) => m.parameters.find((p) => p.id === 'fit') as unknown as { label: string; options: { value: string; label: string }[] };
    expect(fit(de).label).toBe('Einpassen');
    expect(fit(zh).options.map((o) => o.value)).toEqual(['fit', 'fill', 'center']);
    expect(fit(zh).options.map((o) => o.label)).toEqual(['适合画面', '填满画面', '原始尺寸，居中']);
    // A text's label is Pulp's; its card is the layer's own name, which stays the file's.
    const text = (m: typeof de) => m.parameters.find((p) => p.type === 'text')!;
    expect(text(de).label).toBe('Text');
    expect(text(zh).label).toBe('文本');
    expect(text(zh).element).toBe(text(entry.manifest).element);
    const color = (m: typeof de) => m.parameters.find((p) => p.type === 'color') as unknown as { label: string; element: string };
    expect(color(zh).element).toBe('颜色');
    expect(color(de).label).toMatch(/: (Füllung|Kontur|Farbfläche|Textfarbe)$/);
    // Search still finds it by Pulp's English words.
    expect(searchLibrary(localizeIndex(scanned, 'zh-CN'), 'lottie').length).toBe(1);
  });
});
