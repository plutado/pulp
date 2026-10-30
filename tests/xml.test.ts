import { describe, expect, it } from 'vitest';
import { decodeEntities, findElement, parseXml, XmlError } from '../src/core/xml';

describe('the small XML reader (milestone 33)', () => {
  it('reads elements, attributes, text and nesting, with source offsets', () => {
    const source = `<?xml version="1.0"?>\n<!DOCTYPE svg>\n<root a="1" flag empty="">text<child b='two &amp; three'/><deep><in>x</in></deep></root>`;
    const root = parseXml(source);
    expect(root.name).toBe('root');
    expect(root.attrs).toEqual({ a: '1', flag: '', empty: '' });
    expect(root.text).toBe('text');
    expect(root.children.map((c) => c.name)).toEqual(['child', 'deep']);
    expect(root.children[0]!.attrs.b).toBe('two & three');
    expect(root.children[0]!.selfClosing).toBe(true);
    expect(findElement(root, 'in')!.text).toBe('x');
    // Offsets really address the source: the opening tag and the whole element slice back out.
    expect(source.slice(root.start, root.openEnd)).toBe('<root a="1" flag empty="">');
    const child = root.children[0]!;
    expect(source.slice(child.start, child.end)).toBe(`<child b='two &amp; three'/>`);
  });

  it('skips comments and reads CDATA as text; namespaced names match their suffix', () => {
    const root = parseXml('<a:svg xmlns:a="x"><!-- note --><b><![CDATA[1 < 2]]></b></a:svg>');
    expect(root.name).toBe('a:svg');
    expect(findElement(root, 'svg')).toBe(root);
    expect(root.children[0]!.text).toBe('1 < 2');
  });

  it('decodes the five entities and character references', () => {
    expect(decodeEntities('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&unknown;')).toBe('<>&"\'AB&unknown;');
  });

  it('says what is malformed', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlError);
    expect(() => parseXml('<a')).toThrow(XmlError);
    expect(() => parseXml('<a x=1>')).toThrow(/unquoted/);
  });
});
