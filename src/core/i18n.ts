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

import { enUS, type MessageId } from '../locales/en-US';
import { enGB } from '../locales/en-GB';

export type { MessageId } from '../locales/en-US';

/** One form of a message, or its plural forms by `Intl.PluralRules` category. */
export type Message = string | Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export type Catalog = Partial<Record<MessageId, Message>>;

/** The languages offered, in the order Settings → Language lists them: English first. */
export const LOCALES = [
  { id: 'en-US', label: 'English (US)', dir: 'ltr' },
  { id: 'en-GB', label: 'English (UK)', dir: 'ltr' },
] as const;

export type LocaleId = (typeof LOCALES)[number]['id'];

/** The source: what every other catalog falls back to, and the one used when nothing else matches. */
export const SOURCE_LOCALE: LocaleId = 'en-US';

const CATALOGS: Record<LocaleId, Catalog> = { 'en-US': enUS, 'en-GB': enGB };

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
 */
export function resolveLocale(choice: LanguageChoice, systemLanguages: readonly string[]): LocaleId {
  if (choice !== 'system') return choice;
  for (const raw of systemLanguages) {
    const tag = raw.replace('_', '-');
    const exact = LOCALES.find((l) => l.id.toLowerCase() === tag.toLowerCase());
    if (exact) return exact.id;
    const [language, ...rest] = tag.split('-');
    if (language?.toLowerCase() === 'en') {
      const region = rest.find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
      return region && BRITISH_SPELLING_REGIONS.has(region) ? 'en-GB' : 'en-US';
    }
  }
  return SOURCE_LOCALE;
}

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
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
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

/** The placeholders a message uses, across all its forms: a translation must use the same ones. */
export function placeholdersOf(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const text of texts) for (const m of (text ?? '').matchAll(/\{(\w+)\}/g)) names.add(m[1]!);
  return [...names].sort();
}
