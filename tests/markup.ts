/**
 * The window's markup as the window shows it (milestone 59): src/renderer/index.html
 * with the catalog's words written in where it names them, for the tests that
 * read the markup as text — its names, its labels, its headings. The markup
 * itself holds no words, so a test reading the raw file would pass for having
 * nothing to check. tests/dom/i18n-markup.test.ts holds this to exactly what
 * the window's own `applyTranslations` puts in place.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translator, type LocaleId, type MessageId } from '../src/core/i18n';

const MARKUP = readFileSync(join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

/** Where the element opened at `from` closes: its own close tag, counting any of the same name inside it. */
function closeOf(html: string, tag: string, from: number): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = from;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1] === '/') {
      if (depth === 0) return m.index;
      depth -= 1;
    } else if (!m[0].endsWith('/>')) depth += 1;
  }
  throw new Error(`<${tag}> at ${from} does not close`);
}

export function shownMarkup(locale: LocaleId = 'en-US'): string {
  const t = translator(locale);
  let html = MARKUP.replace(/ data-i18n-attr="([^"]+)"/g, (_whole, pairs: string) => pairs.split(';').map((pair) => {
    const [name, id] = pair.split(':');
    return ` ${name}="${escapeAttr(t(id as MessageId))}"`;
  }).join(''));
  // Each element's text, last first so the positions found are not moved by what is written in.
  const opens = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*?)\sdata-i18n(-rich)?="([^"]+)"([^>]*)>/g)].reverse();
  for (const m of opens) {
    const [open, tag, before, rich, id, after] = m as unknown as [string, string, string, string | undefined, string, string];
    const at = /data-i18n-at="(start|end)"/.exec(before + after)?.[1];
    const words = rich ? t(id as MessageId) : escapeText(t(id as MessageId));
    const openEnd = m.index! + open.length;
    const where = at === 'end' ? closeOf(html, tag, openEnd) : openEnd;
    html = html.slice(0, where) + words + html.slice(where);
  }
  return html;
}
