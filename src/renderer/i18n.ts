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

import { signal } from '@preact/signals';
import { catalogFor, directionOf, SOURCE_LOCALE, translate, type Catalog, type LanguageChoice, type LocaleId, type MessageId, type MessageValues } from '../core/i18n';
import type { LanguageState } from '../shared/api';

export const locale = signal<LocaleId>(SOURCE_LOCALE);
/** What Settings → Language shows: the choice, and the system's languages it follows when it is the system's. */
export const languageState = signal<LanguageState | null>(null);
let catalog: Catalog = catalogFor(SOURCE_LOCALE);

/** A message in the interface's language now. Read inside an effect, it follows a change of language. */
export function t(id: MessageId, values?: MessageValues): string {
  const current = locale.value;
  return translate(catalog, current, id, values);
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

/** Every element under `root` that names a message, given its words in the current language. */
export function applyTranslations(root: Document | Element = document): void {
  const current = locale.value;
  const say = (id: string) => translate(catalog, current, id as MessageId);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const at = el.dataset.i18nAt;
    if (at === 'start' || at === 'end') placeText(el, say(el.dataset.i18n!), at);
    else el.textContent = say(el.dataset.i18n!);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-rich]')) {
    el.replaceChildren(...richNodes(el.ownerDocument, say(el.dataset.i18nRich!)));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [name, id] = pair.split(':');
      if (name && id) el.setAttribute(name.trim(), say(id.trim()));
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

/** Show the interface in a language: the catalog swapped, every element of the markup put in place again. */
export function setLocale(next: LocaleId): void {
  catalog = catalogFor(next);
  locale.value = next;
  applyTranslations(document);
  for (const doc of others) applyTranslations(doc);
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
