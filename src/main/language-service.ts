/**
 * The interface's language in the main process (milestone 59): the choice
 * kept with the other settings, the locale it comes to against the system's
 * own languages, and the one place a change is announced — every window is
 * told, so each puts its words in place again, and the application menu,
 * which the main process builds, is rebuilt in the new language. No restart.
 *
 * "Same as the system" is read when Pulp starts and whenever it is asked;
 * a system language changed while Pulp runs is followed at the next launch,
 * since Electron says nothing when it changes.
 */

import { app, BrowserWindow } from 'electron';
import { resolveLocale, sanitizeLanguage, SOURCE_LOCALE, translator, type LanguageChoice, type LocaleId, type Translator } from '../core/i18n';
import type { LanguageState } from '../shared/api';
import { loadSettings, updateSettings } from './settings';

let choice: LanguageChoice = 'system';
let locale: LocaleId = SOURCE_LOCALE;
let t: Translator = translator(SOURCE_LOCALE);
let onChange: () => void = () => undefined;

function systemLanguages(): string[] {
  return app.getPreferredSystemLanguages();
}

function apply(next: LanguageChoice): LanguageState {
  choice = next;
  locale = resolveLocale(next, systemLanguages());
  t = translator(locale);
  return { choice, locale, system: systemLanguages() };
}

/** Read the saved choice; before the menu is built and the first window opens, so both are in it. */
export async function loadLanguage(): Promise<LanguageState> {
  return apply((await loadSettings()).language);
}

export function getLanguage(): LanguageState {
  return apply(choice);
}

/** The words the main process says itself — the application menu — in the interface's language. */
export function mainTranslator(): Translator {
  return t;
}

/** Called when the language changes, after every window has been told: the menu rebuilds. */
export function onLanguageChange(fn: () => void): void {
  onChange = fn;
}

export async function setLanguage(raw: unknown): Promise<LanguageState> {
  const next = sanitizeLanguage(raw);
  await updateSettings((s) => ({ ...s, language: next }));
  const state = apply(next);
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('language:changed', state);
  onChange();
  return state;
}
