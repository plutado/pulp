/**
 * A small XML reader (milestone 33): enough for the files the layered formats
 * carry — OpenRaster's stack.xml, Krita's maindoc.xml, an SVG's structure.
 * Elements with attributes, children and source offsets; comments, CDATA,
 * processing instructions and doctypes skipped; the five standard entities.
 * Not a validator: a malformed file throws with what was wrong. Pure.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Direct text content, entity-decoded, whitespace kept. */
  text: string;
  /** Where the element sits in the source: `start` at its `<`, `end` just past its closing `>`. */
  start: number;
  end: number;
  /** Just past the opening tag's `>`, so the tag alone is source.slice(start, openEnd). */
  openEnd: number;
  selfClosing: boolean;
}

export class XmlError extends Error {
  override name = 'XmlError';
}

export function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (whole, body: string) => {
    switch (body) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const code = body.startsWith('#x') || body.startsWith('#X') ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
    }
  });
}

const NAME = /[^\s/>=]+/y;
const SPACE = /\s*/y;

/** Parse a document and answer its root element. */
export function parseXml(source: string): XmlElement {
  let at = 0;
  const skipMisc = (): void => {
    for (;;) {
      SPACE.lastIndex = at;
      at = SPACE.exec(source) ? SPACE.lastIndex : at;
      if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at + 4);
        if (end === -1) throw new XmlError('an unclosed comment');
        at = end + 3;
      } else if (source.startsWith('<?', at)) {
        const end = source.indexOf('?>', at + 2);
        if (end === -1) throw new XmlError('an unclosed processing instruction');
        at = end + 2;
      } else if (source.startsWith('<!DOCTYPE', at) || source.startsWith('<!doctype', at)) {
        // A doctype may hold an internal subset in brackets; skip to the > past any [].
        let depth = 0;
        let i = at;
        for (; i < source.length; i += 1) {
          const ch = source[i];
          if (ch === '[') depth += 1;
          else if (ch === ']') depth -= 1;
          else if (ch === '>' && depth === 0) break;
        }
        if (i >= source.length) throw new XmlError('an unclosed doctype');
        at = i + 1;
      } else return;
    }
  };

  const readAttrs = (): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (;;) {
      SPACE.lastIndex = at;
      at = SPACE.exec(source) ? SPACE.lastIndex : at;
      const ch = source[at];
      if (ch === '>' || ch === '/' || ch === undefined) return attrs;
      NAME.lastIndex = at;
      const name = NAME.exec(source)?.[0];
      if (!name) throw new XmlError(`a tag with an unreadable attribute at ${at}`);
      at += name.length;
      SPACE.lastIndex = at;
      at = SPACE.exec(source) ? SPACE.lastIndex : at;
      if (source[at] !== '=') {
        attrs[name] = '';
        continue;
      }
      at += 1;
      SPACE.lastIndex = at;
      at = SPACE.exec(source) ? SPACE.lastIndex : at;
      const quote = source[at];
      if (quote !== '"' && quote !== "'") throw new XmlError(`attribute "${name}" has an unquoted value`);
      const end = source.indexOf(quote, at + 1);
      if (end === -1) throw new XmlError(`attribute "${name}" never closes its quote`);
      attrs[name] = decodeEntities(source.slice(at + 1, end));
      at = end + 1;
    }
  };

  const readElement = (): XmlElement => {
    const start = at;
    if (source[at] !== '<') throw new XmlError(`expected an element at ${at}`);
    at += 1;
    NAME.lastIndex = at;
    const name = NAME.exec(source)?.[0];
    if (!name) throw new XmlError(`a tag with no name at ${start}`);
    at += name.length;
    const attrs = readAttrs();
    const selfClosing = source[at] === '/';
    if (selfClosing) at += 1;
    if (source[at] !== '>') throw new XmlError(`the tag <${name}> never closes`);
    at += 1;
    const openEnd = at;
    const element: XmlElement = { name, attrs, children: [], text: '', start, end: at, openEnd, selfClosing };
    if (selfClosing) return element;
    for (;;) {
      const lt = source.indexOf('<', at);
      if (lt === -1) throw new XmlError(`<${name}> is never closed`);
      element.text += decodeEntities(source.slice(at, lt));
      at = lt;
      if (source.startsWith('</', at)) {
        const end = source.indexOf('>', at);
        if (end === -1) throw new XmlError(`</${name} never closes`);
        const closing = source.slice(at + 2, end).trim();
        if (closing !== name) throw new XmlError(`<${name}> is closed by </${closing}>`);
        at = end + 1;
        element.end = at;
        return element;
      }
      if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at + 4);
        if (end === -1) throw new XmlError('an unclosed comment');
        at = end + 3;
        continue;
      }
      if (source.startsWith('<![CDATA[', at)) {
        const end = source.indexOf(']]>', at + 9);
        if (end === -1) throw new XmlError('an unclosed CDATA section');
        element.text += source.slice(at + 9, end);
        at = end + 3;
        continue;
      }
      element.children.push(readElement());
    }
  };

  skipMisc();
  const root = readElement();
  return root;
}

/** The first descendant with this name (the element itself counts), or null. */
export function findElement(root: XmlElement, name: string): XmlElement | null {
  if (root.name === name || root.name.endsWith(`:${name}`)) return root;
  for (const child of root.children) {
    const found = findElement(child, name);
    if (found) return found;
  }
  return null;
}
