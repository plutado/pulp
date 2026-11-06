/**
 * The library in the interface's language (after milestone 68): the bundled
 * templates' names, descriptions, parameter labels, help, cards and options,
 * and the matching sets' names, in German or Chinese — and what Pulp writes
 * about a Lottie file, said again in whichever language the window is in.
 *
 * - **What is translated.** Only what Pulp ships or writes. A bundled
 *   template's words are looked up by their US English in the language's
 *   library catalog (src/locales/library/), so a string shared by many
 *   templates ("Accent color") is translated once. A template from anywhere
 *   else is its author's and stays as written. A Lottie file's own names
 *   (its layers, its markers, its file name) are the file's; what Pulp says
 *   around them is the interface catalog's (`lottie.*`).
 * - **Where.** Only in the window's copy of the index: the manifests on disk,
 *   the library store, renders and exports keep the US English. A word with
 *   no translation is shown as it is written.
 * - **Search.** A translated entry keeps its English name and description
 *   (`source`), and search reads both, so a typed English word still finds it.
 */

import { translator, SOURCE_LOCALE, type LocaleId, type Translator } from './i18n';
import type { LibraryIndex, TemplateEntry } from './library-types';
import type { TemplateManifest, TemplateParameter } from './manifest';
import { humanizeFileName, lottieDescription, lottieFitParameter } from './lottie';
import { LOTTIE_FIT_PARAM, type LottieInfo } from './lottie-types';
import { de } from '../locales/library/de';
import { zhCN } from '../locales/library/zh-CN';

/** A language's words for the bundled library, by their US English. */
export type LibraryWords = Readonly<Record<string, string>>;

const LIBRARY_WORDS: Partial<Record<LocaleId, LibraryWords>> = { de, 'zh-CN': zhCN };

/** The library catalog a locale brings: for checking one. */
export function libraryWordsFor(locale: LocaleId): LibraryWords {
  return LIBRARY_WORDS[locale] ?? {};
}

/** A bundled template's manifest in a language's words; anything the catalog does not have stays. */
export function localizeManifest(manifest: TemplateManifest, words: LibraryWords): TemplateManifest {
  if (Object.keys(words).length === 0) return manifest;
  const say = (s: string | undefined) => (s === undefined ? undefined : (words[s] ?? s));
  return {
    ...manifest,
    name: say(manifest.name)!,
    ...(manifest.description !== undefined ? { description: say(manifest.description) } : {}),
    parameters: manifest.parameters.map((p) => localizeParameter(p, say)),
  };
}

function localizeParameter(p: TemplateParameter, say: (s: string | undefined) => string | undefined): TemplateParameter {
  const q = { ...p, label: say(p.label)! } as TemplateParameter & { description?: string; element?: string; group?: string; options?: { value: string; label: string }[] };
  const raw = p as typeof q;
  if (raw.description !== undefined) q.description = say(raw.description);
  if (raw.element !== undefined) q.element = say(raw.element);
  if (raw.group !== undefined) q.group = say(raw.group);
  if (Array.isArray(raw.options)) q.options = raw.options.map((o) => ({ ...o, label: say(o.label)! }));
  return q;
}

/** A Lottie's manifest with Pulp's own words said again in a language: the description, the labels Pulp gave, the Fit setting. */
export function localizeLottieManifest(manifest: TemplateManifest, info: LottieInfo, t: Translator): TemplateManifest {
  const byId = new Map(info.bindings.map((b) => [b.id, b]));
  const stem = info.path.split(/[\\/]/).pop() ?? '';
  const untitled = humanizeFileName(stem) === humanizeFileName('');
  return {
    ...manifest,
    ...(untitled && manifest.name === humanizeFileName('') ? { name: t('lottie.name.untitled') } : {}),
    description: lottieDescription(info, info.limits, t),
    parameters: manifest.parameters.map((p) => {
      if (p.id === LOTTIE_FIT_PARAM) return { ...lottieFitParameter(t), default: p.default } as TemplateParameter;
      const b = byId.get(p.id);
      if (!b) return p;
      const q = { ...p } as TemplateParameter & { description?: string; element?: string };
      const values = { ...b.label?.values, ...(b.nameNote ? { name: t(b.nameNote.id, b.nameNote.values) } : {}) };
      if (b.label) q.label = t(b.label.id, values);
      if (b.description) q.description = t(b.description.id, b.description.values);
      if (b.element) q.element = t(b.element.id, b.element.values);
      return q;
    }),
  };
}

/** One entry in a language, keeping its US English name and description for search. */
export function localizeEntry(entry: TemplateEntry, locale: LocaleId, bundled: boolean, t: Translator = translator(locale)): TemplateEntry {
  const words = libraryWordsFor(locale);
  let manifest = entry.manifest;
  if (entry.lottie) {
    manifest = localizeLottieManifest(manifest, entry.lottie, t);
    // A bundled Lottie is named by its file; the name is Pulp's to translate, like any bundled template's.
    if (bundled && words[manifest.name] !== undefined) manifest = { ...manifest, name: words[manifest.name]! };
  } else if (bundled) manifest = localizeManifest(manifest, words);
  const pack = entry.pack && bundled ? { ...entry.pack, name: words[entry.pack.name] ?? entry.pack.name } : entry.pack;
  if (manifest === entry.manifest && pack === entry.pack) return entry;
  return {
    ...entry,
    manifest,
    ...(pack ? { pack } : {}),
    source: entry.source ?? { name: entry.manifest.name, description: entry.manifest.description ?? '' },
  };
}

/**
 * The window's index in a language: every template entry's words in it, the media untouched. In
 * the source language the index is returned as it is. The same entries come back for the same
 * index and language, so the results keep their identity across a repaint.
 */
export function localizeIndex(index: LibraryIndex, locale: LocaleId): LibraryIndex {
  if (locale === SOURCE_LOCALE) return index;
  const t = translator(locale);
  return { ...index, templates: index.templates.map((e) => localizeEntry(e, locale, index.builtInRoot !== undefined && e.root === index.builtInRoot, t)) };
}
