/**
 * Languages and locale (milestone 59), the pure part: which languages the
 * interface can be shown in, how a choice in Settings and the system's own
 * languages come to one of them, and how a message is read out of a catalog.
 * The window and the main process both translate through here, so the menu
 * the main process builds and the markup the window shows say the same thing.
 *
 * A catalog maps a message id to its words (src/locales/). US English is the
 * source: every id is in it, and every other catalog holds only what differs,
 * falling back to US English for the rest — British English is a few dozen
 * spellings, not a second copy. docs/translating.md is for translators.
 *
 * A message may carry placeholders, `{name}`, filled from the values passed,
 * and may have plural forms, `{ one: "…", other: "…" }`, chosen by
 * `Intl.PluralRules` for the locale from the `count` value — so a language
 * with more than two forms (few, many) needs nothing but the forms.
 */

import { signal } from '@preact/signals-core';
import { enUS, type MessageId } from '../locales/en-US';
import { enGB } from '../locales/en-GB';
import { de } from '../locales/de';
import { zhCN } from '../locales/zh-CN';

export type { MessageId } from '../locales/en-US';

/** One form of a message, or its plural forms by `Intl.PluralRules` category. */
export type Message = string | Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export type Catalog = Partial<Record<MessageId, Message>>;

/**
 * The languages offered, in the order Settings → Language lists them: English first. Each is
 * labeled in its own language — "Deutsch", not "German" — and never translated, so a person can
 * find theirs whatever language the window is in now.
 *
 * A `variant` of the source (British English) holds only what it says differently and falls back
 * for the rest by design. Any other language holds every message: one that fell back would show
 * the window half in English, so the tests refuse a catalog with a message missing.
 *
 * A `preview` language (milestone 68) is complete but not yet read through by a fluent speaker:
 * Settings offers it under a heading that says so, with `previewLabel` — "preview" in its own
 * language — and the system's language never comes to it, so nobody is put into an unchecked
 * translation they did not choose. A speaker's check is what turns `preview` off; docs/translating.md.
 *
 * A `pseudo` locale is a tool, not a language. English (lengthened) (milestone 59) is US English
 * with every word drawn out by two fifths, so a layout that clips a long word is caught by a test
 * before a language with long words is translated. English (mirrored) (milestone 70) is US English
 * declared right to left, so the mirrored window can be looked at and tested before any
 * right-to-left language is. Settings never offers either and the system never comes to them; one
 * is reached by `window.pulp.setLanguage('en-XA')` or by `"language": "en-XA"` in settings.json.
 * (XA and XB are the private-use regions pseudo-locales conventionally take.)
 */
export const LOCALES = [
  { id: 'en-US', label: 'English (US)', dir: 'ltr', variant: false, preview: false, previewLabel: '', pseudo: false }, // i18n-exempt(content): a language's own name for itself
  { id: 'en-GB', label: 'English (UK)', dir: 'ltr', variant: true, preview: false, previewLabel: '', pseudo: false }, // i18n-exempt(content): a language's own name for itself
  { id: 'de', label: 'Deutsch', dir: 'ltr', variant: false, preview: true, previewLabel: 'Deutsch (Vorschau)', pseudo: false }, // i18n-exempt(content): a language's own name for itself
  { id: 'zh-CN', label: '中文（简体）', dir: 'ltr', variant: false, preview: true, previewLabel: '中文（简体）（预览）', pseudo: false }, // i18n-exempt(content): a language's own name for itself
  { id: 'en-XA', label: 'English (lengthened)', dir: 'ltr', variant: false, preview: false, previewLabel: '', pseudo: true }, // i18n-exempt(content): a developer's tool, named as the language it draws out
  { id: 'en-XB', label: 'English (mirrored)', dir: 'rtl', variant: true, preview: false, previewLabel: '', pseudo: true }, // i18n-exempt(content): a developer's tool, named as the language it mirrors
] as const;

/** The catalog a locale brings, before the source fills in what it does not say: for checking one. */
export function ownCatalog(locale: LocaleId): Catalog {
  return CATALOGS[locale];
}

export type LocaleId = (typeof LOCALES)[number]['id'];

/** The source: what every other catalog falls back to, and the one used when nothing else matches. */
export const SOURCE_LOCALE: LocaleId = 'en-US';

/** How much longer English (lengthened) makes a word: two fifths, about what German adds to English. */
const LENGTHEN_BY = 0.4;
/** What a lengthened word grows by: a letter the window has no words in, so the padding is seen for what it is. */
const FILLER = 'ø'; // i18n-exempt(technical): a pseudo-locale's padding, not a word

/**
 * A message as English (lengthened) says it: every word two fifths longer, grown at its end so the
 * word itself is still in it (the search field's `favorite:` is still typed and still found).
 * Placeholders, the inline tags of a rich message, and tokens with no letters are left alone, so
 * the message still fills, still builds and still reads.
 */
export function lengthen(text: string): string {
  return text.replace(/\S+/g, (word) => {
    if (/[{}<>]/.test(word)) return word;
    const letters = (word.match(/\p{L}/gu) ?? []).length;
    return letters === 0 ? word : word + FILLER.repeat(Math.max(1, Math.round(letters * LENGTHEN_BY)));
  });
}

function lengthenMessage(message: Message): Message {
  if (typeof message === 'string') return lengthen(message);
  const out: Record<string, string> = {};
  for (const [form, text] of Object.entries(message)) if (text !== undefined) out[form] = lengthen(text);
  return out as Message;
}

/** The source, every message drawn out: made once at load, from the source itself, so it can never be behind it. */
function lengthenedCatalog(): Catalog {
  const out: Catalog = {};
  for (const [id, message] of Object.entries(enUS) as [MessageId, Message][]) out[id] = lengthenMessage(message);
  return out;
}

const CATALOGS: Record<LocaleId, Catalog> = { 'en-US': enUS, 'en-GB': enGB, de, 'zh-CN': zhCN, 'en-XA': lengthenedCatalog(), 'en-XB': {} };

/** What Settings → Language holds: the system's language, or one chosen. */
export type LanguageChoice = 'system' | LocaleId;

export const DEFAULT_LANGUAGE: LanguageChoice = 'system';

export function isLocaleId(raw: unknown): raw is LocaleId {
  return LOCALES.some((l) => l.id === raw);
}

/** As read back from settings.json or sent by the window: anything that is not a language offered is the system's. */
export function sanitizeLanguage(raw: unknown): LanguageChoice {
  return isLocaleId(raw) ? raw : DEFAULT_LANGUAGE;
}

/**
 * English as a region writes it that is not the US: these follow British
 * spelling — colour, centre, licence — so they are shown English (UK).
 * Canada is among them: it spells colour and centre as Britain does.
 */
const BRITISH_SPELLING_REGIONS = new Set(['GB', 'UK', 'IE', 'AU', 'NZ', 'ZA', 'IN', 'CA', 'SG', 'HK', 'MT', 'JM']);

/**
 * The language a choice comes to. "System" walks the system's preferred
 * languages in order (Electron's `app.getPreferredSystemLanguages()`) and takes
 * the first one offered: an exact match, else the language's own family — English
 * from Australia is shown English (UK), English with no region or from the US
 * English (US). Nothing offered is US English, the source.
 *
 * German from any region — Germany, Austria, Switzerland — is Deutsch: German has one standard
 * written form. Chinese is Simplified only where Simplified is written: `zh-Hans`, or a mainland
 * China or Singapore region. Traditional Chinese (`zh-Hant`, Taiwan, Hong Kong, Macau) is passed
 * over — whoever reads Traditional may not want Simplified chosen for them — and the walk goes on
 * to the system's next language, or English. A bare `zh` is taken as Simplified, as systems mean it.
 *
 * A language still in preview is never the system's: only a person choosing it gets it. The
 * `previews` option is for tests, to check the rules a language will follow once it is checked.
 */
export function resolveLocale(choice: LanguageChoice, systemLanguages: readonly string[], options: { previews?: boolean } = {}): LocaleId {
  if (choice !== 'system') return choice;
  const offered = (id: LocaleId) => options.previews === true || !LOCALES.find((l) => l.id === id)!.preview;
  for (const raw of systemLanguages) {
    const [language, ...rest] = raw.replace(/_/g, '-').split('-');
    const lang = language?.toLowerCase();
    const region = rest.find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
    const script = rest.find((part) => /^[A-Za-z]{4}$/.test(part))?.toLowerCase();
    if (lang === 'en') return region && BRITISH_SPELLING_REGIONS.has(region) ? 'en-GB' : 'en-US';
    if (lang === 'de' && offered('de')) return 'de';
    if (lang === 'zh' && offered('zh-CN') && (script ? script === 'hans' : !region || SIMPLIFIED_CHINESE_REGIONS.has(region))) return 'zh-CN';
  }
  return SOURCE_LOCALE;
}

/** Where Chinese is written in Simplified characters: mainland China and Singapore. */
const SIMPLIFIED_CHINESE_REGIONS = new Set(['CN', 'SG']);

/** The catalog of a locale, with the source's words for whatever it does not say. */
export function catalogFor(locale: LocaleId): Catalog {
  return locale === SOURCE_LOCALE ? enUS : { ...enUS, ...CATALOGS[locale] };
}

/** The direction a locale is written in: what `<html dir>` takes. */
export function directionOf(locale: LocaleId): 'ltr' | 'rtl' {
  return LOCALES.find((l) => l.id === locale)?.dir ?? 'ltr';
}

export type MessageValues = Record<string, string | number>;

/** A message's words for these values: the plural form `count` calls for, then every `{name}` filled. */
export function formatMessage(message: Message, locale: LocaleId, values: MessageValues = {}): string {
  let text: string;
  if (typeof message === 'string') {
    text = message;
  } else {
    const count = Number(values.count ?? 0);
    const form = new Intl.PluralRules(locale).select(count);
    text = message[form] ?? message.other;
  }
  // A count is a number a reader reads: written as the locale writes numbers ("1,234", "1.234").
  // Other values are filled as given — a resolution, a frame rate or a timecode is the same everywhere.
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in values)) return whole;
    const value = values[name]!;
    return name === 'count' && typeof value === 'number' ? countFormat(locale).format(value) : String(value);
  });
}

const counts = new Map<LocaleId, Intl.NumberFormat>();
function countFormat(locale: LocaleId): Intl.NumberFormat {
  let f = counts.get(locale);
  if (!f) counts.set(locale, (f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })));
  return f;
}

/** Read a message out of a catalog. An id that is not in it at all is shown as itself, so a missing one is seen, not hidden. */
export function translate(catalog: Catalog, locale: LocaleId, id: MessageId, values?: MessageValues): string {
  const message = catalog[id];
  return message === undefined ? id : formatMessage(message, locale, values);
}

export type Translator = (id: MessageId, values?: MessageValues) => string;

export function translator(locale: LocaleId): Translator {
  const catalog = catalogFor(locale);
  return (id, values) => translate(catalog, locale, id, values);
}

/** US English: what a caller that has no language of its own yet — a test, a headless render — reads. */
export const SOURCE_TRANSLATOR: Translator = translator(SOURCE_LOCALE);

// ---------------------------------------------------------------- the language now

/**
 * The language the interface is in now, in this process: the window sets it from Settings →
 * Language (src/renderer/i18n.ts), the main process from the same setting (src/main/language-service.ts),
 * and a test or a headless render leaves it at the source. A signal, so anything that reads a word
 * through `tr` inside an effect or a component is drawn again when the language changes.
 */
export const currentLocale = signal<LocaleId>(SOURCE_LOCALE);

const catalogs = new Map<LocaleId, Catalog>();

function cachedCatalog(locale: LocaleId): Catalog {
  let catalog = catalogs.get(locale);
  if (!catalog) catalogs.set(locale, (catalog = catalogFor(locale)));
  return catalog;
}

export function setCurrentLocale(locale: LocaleId): void {
  currentLocale.value = locale;
}

/**
 * A message in the language the interface is in now: what every word built in code reads. A table
 * of names (the taxonomy, the presets, the categories) reads through it in a getter, so its `label`
 * is always the current language's and its callers need not know — while whatever a module works out
 * from a label once, at load (search's aliases), is the source's, which a typed English word still finds.
 */
export function tr(id: MessageId, values?: MessageValues): string {
  const locale = currentLocale.value;
  return translate(cachedCatalog(locale), locale, id, values);
}

/** The placeholders a message uses, across all its forms: a translation must use the same ones. */
export function placeholdersOf(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const text of texts) for (const m of (text ?? '').matchAll(/\{(\w+)\}/g)) names.add(m[1]!);
  return [...names].sort();
}
