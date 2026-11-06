/**
 * The interface's language in the window (milestone 59): the locale, held as a
 * signal so whatever builds words from code can follow a change, `t()` for
 * those words, and the markup's own words put in place from the catalog.
 *
 * The markup (src/renderer/index.html) carries no words of its own. An element
 * says which message is its text and which are its attributes:
 *
 * - `data-i18n="id"` — the element's text. With `data-i18n-at="start"` or
 *   `"end"` it is the text before or after the controls inside it (a label's
 *   words beside its input), and the controls are left alone.
 * - `data-i18n-attr="aria-label:id;data-tip:id"` — attributes, by name.
 * - `data-i18n-rich="id"` — text with inline emphasis: the message may carry
 *   `<strong>`, `<em>` and `<code>`, built as elements (never as HTML).
 *
 * Switching language puts every one of them in place again, in this window and
 * in the popped-out stage, whose elements are this page's own moved there.
 */

import { batch, effect, signal } from '@preact/signals';
import { currentLocale, directionOf, setCurrentLocale, tr, type LanguageChoice, type LocaleId, type MessageId, type MessageValues } from '../core/i18n';
import type { LanguageState } from '../shared/api';

/** The interface's language in this window: core's own signal, so a word read through `tr` in core follows it too. */
export const locale = currentLocale;
/** What Settings → Language shows: the choice, and the system's languages it follows when it is the system's. */
export const languageState = signal<LanguageState | null>(null);
/** A message in the interface's language now. Read inside an effect or a component, it follows a change of language. */
export function t(id: MessageId, values?: MessageValues): string {
  return tr(id, values);
}

const RICH_TAGS = new Set(['strong', 'em', 'code']);

/** A rich message's words and its few inline tags, as nodes: nothing from a catalog is ever parsed as HTML. */
function richNodes(doc: Document, text: string): Node[] {
  const nodes: Node[] = [];
  const re = /<(strong|em|code)>([\s\S]*?)<\/\1>/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) nodes.push(doc.createTextNode(text.slice(at, m.index)));
    if (RICH_TAGS.has(m[1]!)) {
      const el = doc.createElement(m[1]!);
      el.textContent = m[2]!;
      nodes.push(el);
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) nodes.push(doc.createTextNode(text.slice(at)));
  return nodes;
}

/** Put an element's own text in place beside its controls, leaving them and the space between as they are. */
function placeText(el: Element, text: string, at: 'start' | 'end'): void {
  const doc = el.ownerDocument;
  const marker = 'i18nText';
  const own = [...el.childNodes].find((n) => n.nodeType === 3 && (n as Text & { [marker]?: true })[marker]) as Text | undefined;
  if (own) {
    own.data = text;
    return;
  }
  const node = doc.createTextNode(text) as Text & { [marker]?: true };
  node[marker] = true;
  if (at === 'start') el.prepend(node);
  else el.append(node);
}

/** The values an element's message is filled with, as `bindText` and `bindAttr` keep them: `{}` for none. */
function valuesOf(raw: string | undefined): Record<string, MessageValues> | MessageValues {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, MessageValues>;
  } catch {
    return {};
  }
}

/** Every element under `root` that names a message, given its words in the current language. */
export function applyTranslations(root: Document | Element = document): void {
  const current = locale.value;
  const say = (id: string, values?: MessageValues) => tr(id as MessageId, values);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const at = el.dataset.i18nAt;
    const text = say(el.dataset.i18n!, valuesOf(el.dataset.i18nValues) as MessageValues);
    if (at === 'start' || at === 'end') placeText(el, text, at);
    else el.textContent = text;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-rich]')) {
    el.replaceChildren(...richNodes(el.ownerDocument, say(el.dataset.i18nRich!, valuesOf(el.dataset.i18nValues) as MessageValues)));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    const values = valuesOf(el.dataset.i18nAttrValues) as Record<string, MessageValues>;
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [name, id] = pair.split(':');
      if (name && id) el.setAttribute(name.trim(), say(id.trim(), values[name.trim()]));
    }
  }
  const doc = 'documentElement' in root ? root : root.ownerDocument;
  doc.documentElement.lang = current;
  doc.documentElement.dir = directionOf(current);
  // A window's own title, where it says which message it is (the popped-out stage's).
  const titled = doc.documentElement.dataset.i18nTitle;
  if (titled) doc.title = say(titled);
}

/** Other documents showing this page's elements: the popped-out stage registers its own while it is open. */
const others = new Set<Document>();

export function translateAlso(doc: Document, title?: MessageId): () => void {
  if (title) doc.documentElement.dataset.i18nTitle = title;
  others.add(doc);
  applyTranslations(doc);
  return () => others.delete(doc);
}

/**
 * An element built in code, given its words and told which message they are, so a change of
 * language puts them in place again with the rest: the code-built equivalent of the markup's
 * `data-i18n`. `values` are kept with it, so a message with placeholders follows too.
 */
export function bindText(el: HTMLElement, id: MessageId, values?: MessageValues): void {
  el.dataset.i18n = id;
  if (values && Object.keys(values).length > 0) el.dataset.i18nValues = JSON.stringify(values);
  else delete el.dataset.i18nValues;
  el.textContent = tr(id, values);
}

/** `bindText` for an attribute — a tooltip, an accessible name — beside any the element already names. */
export function bindAttr(el: HTMLElement, name: string, id: MessageId, values?: MessageValues): void {
  const pairs = (el.dataset.i18nAttr ?? '').split(';').filter((p) => p && p.split(':')[0] !== name);
  pairs.push(`${name}:${id}`);
  el.dataset.i18nAttr = pairs.join(';');
  const all = valuesOf(el.dataset.i18nAttrValues) as Record<string, MessageValues>;
  if (values && Object.keys(values).length > 0) all[name] = values;
  else delete all[name];
  if (Object.keys(all).length > 0) el.dataset.i18nAttrValues = JSON.stringify(all);
  else delete el.dataset.i18nAttrValues;
  el.setAttribute(name, tr(id, values));
}

/**
 * Run `paint` again whenever the language changes (not now): for code that writes words when its
 * own state changes rather than inside an effect, so the words on screen do not wait for the next
 * change of that state to come into the new language.
 */
export function whenLocaleChanges(paint: () => void): () => void {
  let first = true;
  return effect(() => {
    void locale.value;
    if (first) {
      first = false;
      return;
    }
    paint();
  });
}

/** Show the interface in a language: every element that names a message put in place again, here and in the stage's window. */
export function setLocale(next: LocaleId): void {
  // In one batch: the markup's words go in first, and the effects that write words from code run
  // after it — so a line an effect writes over a markup default (the tray's summary) is the one
  // left showing, not the default the markup names.
  batch(() => {
    setCurrentLocale(next);
    applyTranslations(document);
    for (const doc of others) applyTranslations(doc);
  });
}

export function initI18n(): void {
  // Before anything is drawn from code: the window's words in US English at once, then the
  // chosen language as soon as the main process says which it is.
  applyTranslations(document);
  const take = (state: LanguageState) => {
    languageState.value = state;
    setLocale(state.locale);
  };
  void window.pulp.getLanguage().then(take);
  window.pulp.onLanguageChanged(take);
}

/** Choose a language: saved and applied in every window by the main process, which says so back. */
export async function chooseLanguage(choice: LanguageChoice): Promise<void> {
  const state = await window.pulp.setLanguage(choice);
  languageState.value = state;
  setLocale(state.locale);
}
