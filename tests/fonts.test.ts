import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_FAMILIES, BUNDLED_FONTS, bundledFontFile, cssFontFamily, familyLabel, fontFaceCss, fontMimeType, TEMPLATE_FONTS_PATH } from '../src/core/fonts';

const FONTS_DIR = join(__dirname, '..', 'fonts');
const CREDITS = join(__dirname, '..', 'docs', 'font-credits.md');

/** Read with CRLF normalized, so a Windows checkout cannot change what a line says (docs/platform-notes.md). */
const read = async (path: string) => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');

/**
 * The family name of a TrueType or CFF font, from its `name` table: the typographic
 * family (id 16) when there is one, else the family (id 1). What the file calls
 * itself, which is what the credits must match.
 */
function fontFamilyName(buffer: Buffer): string {
  const tables = buffer.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const at = 12 + 16 * i;
    if (buffer.toString('latin1', at, at + 4) !== 'name') continue;
    const offset = buffer.readUInt32BE(at + 8);
    const count = buffer.readUInt16BE(offset + 2);
    const strings = offset + buffer.readUInt16BE(offset + 4);
    const names = new Map<number, string>();
    for (let n = 0; n < count; n++) {
      const rec = offset + 6 + 12 * n;
      const platform = buffer.readUInt16BE(rec);
      const language = buffer.readUInt16BE(rec + 4);
      const id = buffer.readUInt16BE(rec + 6);
      const length = buffer.readUInt16BE(rec + 8);
      const start = strings + buffer.readUInt16BE(rec + 10);
      // Windows platform, English: UTF-16 big-endian, which Node reads after a byte swap.
      if (platform === 3 && language === 0x409 && !names.has(id)) names.set(id, Buffer.from(buffer.subarray(start, start + length)).swap16().toString('utf16le'));
    }
    return names.get(16) ?? names.get(1) ?? '';
  }
  return '';
}

describe('the bundled fonts', () => {
  it('names the ten families of the roadmap, Playfair standing where Playfair Display now lives', () => {
    expect(BUNDLED_FAMILIES).toEqual(['Inter', 'Montserrat', 'Oswald', 'Bebas Neue', 'Source Serif 4', 'Playfair', 'JetBrains Mono', 'Caveat', 'Dancing Script', 'Noto Sans']);
  });

  it.each(BUNDLED_FONTS.map((f) => [f.family, f] as const))('%s: ships exactly the files listed, byte for byte as upstream published them', async (_family, font) => {
    const folder = join(FONTS_DIR, font.slug);
    const present = (await readdir(folder)).sort();
    expect(present).toEqual([...font.files.map((f) => f.file), font.licenseFile].sort());
    for (const file of font.files) {
      const bytes = await readFile(join(folder, file.file));
      expect(createHash('sha256').update(bytes).digest('hex'), `${font.slug}/${file.file}`).toBe(file.sha256);
    }
  });

  it.each(BUNDLED_FONTS.map((f) => [f.family, f] as const))('%s: its own licence file says SIL Open Font License 1.1, and declares the Reserved Font Name the list records', async (_family, font) => {
    const text = await read(join(FONTS_DIR, font.slug, font.licenseFile));
    // The grant sentence upstream puts above the licence text, and the licence's own title.
    expect(text, font.slug).toMatch(/licensed under the SIL Open Font License, Version 1\.1/);
    expect(text, font.slug).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    // The copyright line is where a Reserved Font Name is declared; the licence body only defines the term.
    const header = text.split('\n').slice(0, 3).join('\n');
    if (font.reservedFontName) {
      expect(header, font.slug).toMatch(new RegExp(`Reserved Font Name[s]? [‘'"]?${font.reservedFontName}`));
    } else {
      expect(header, `${font.slug} declares a Reserved Font Name the list does not record`).not.toMatch(/Reserved Font Name/);
    }
  });

  it.each(BUNDLED_FONTS.map((f) => [f.family, f] as const))('%s: the files call themselves by the family they are offered as', async (family, font) => {
    for (const file of font.files) {
      const name = fontFamilyName(await readFile(join(FONTS_DIR, font.slug, file.file)));
      // A variable font may append "Variable" to its typographic family; the family is the part before it.
      expect(name.replace(/ Variable$/, ''), `${font.slug}/${file.file} says "${name}"`).toBe(family);
    }
  });

  it('every family is credited with its version, licence and source in docs/font-credits.md', async () => {
    const credits = await read(CREDITS);
    for (const font of BUNDLED_FONTS) {
      const row = credits.split('\n').find((line) => line.startsWith(`| ${font.family} |`));
      expect(row, `${font.family} has a row`).toBeDefined();
      expect(row).toContain(font.version.split(' ')[0]!);
      expect(row).toContain(font.source);
      expect(row).toContain('OFL 1.1');
      if (font.reservedFontName) expect(row).toContain(font.reservedFontName);
    }
  });

  it('declares one @font-face per file, with the weight range and the file under the base given', () => {
    const css = fontFaceCss('pulp-font://');
    expect(css.split('\n')).toHaveLength(BUNDLED_FONTS.reduce((n, f) => n + f.files.length, 0));
    expect(css).toContain('@font-face{font-family:"Inter";font-style:italic;font-weight:100 900;font-display:block;src:url("pulp-font://inter/InterVariable-Italic.ttf")}');
    expect(css).toContain('font-family:"Dancing Script";font-style:normal;font-weight:700;');
    // Brackets in upstream file names are encoded for the URL.
    expect(fontFaceCss(`/${TEMPLATE_FONTS_PATH}/`)).toContain('src:url("/__pulp/fonts/oswald/Oswald%5Bwght%5D.ttf")');
  });

  it('serves exactly the listed files and nothing else under the fonts folder', () => {
    expect(bundledFontFile('oswald/Oswald[wght].ttf')?.font.family).toBe('Oswald');
    expect(bundledFontFile('oswald/OFL.txt')).toBeNull();
    expect(bundledFontFile('oswald')).toBeNull();
    expect(bundledFontFile('oswald/../inter/InterVariable.ttf')).toBeNull();
    expect(bundledFontFile('../package.json')).toBeNull();
    expect(fontMimeType('DancingScript-Bold.otf')).toBe('font/otf');
    expect(fontMimeType('Oswald[wght].ttf')).toBe('font/ttf');
  });

  it('quotes every family name but the generic ones, so canvas and CSS accept "Source Serif 4"', () => {
    expect(cssFontFamily('Source Serif 4')).toBe('"Source Serif 4"');
    expect(cssFontFamily('Georgia, Times New Roman, serif')).toBe('"Georgia", "Times New Roman", serif');
    expect(cssFontFamily('"Helvetica Neue", Arial, sans-serif')).toBe('"Helvetica Neue", "Arial", sans-serif');
    expect(cssFontFamily('monospace')).toBe('monospace');
  });

  it('labels a font stack by its first family', () => {
    expect(familyLabel('Georgia, Times New Roman, serif')).toBe('Georgia');
    expect(familyLabel('"Helvetica Neue", Arial, sans-serif')).toBe('Helvetica Neue');
    expect(familyLabel('Oswald')).toBe('Oswald');
  });
});
