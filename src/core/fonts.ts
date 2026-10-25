/**
 * The bundled fonts (milestone 23, ADR 0014): ten open-licence families a layer
 * can be set in on any machine, shipped in `fonts/` with each one's own licence
 * file, exactly as its upstream published it. This module is the one list: the
 * credits file is checked against it, the test checks the files against it, and
 * both pages that draw type — the app window and every template page — declare
 * their `@font-face` rules from it.
 *
 * Every family here is under the SIL Open Font License 1.1, read from the file
 * beside the font rather than assumed from a package listing. Two carry a
 * Reserved Font Name (Source, Dancing Script): the OFL lets an unmodified font
 * keep its name, so those files are the upstream bytes untouched — no
 * subsetting, no renaming — and the hashes below are how the test knows.
 *
 * Delivery: a template page may load fonts from its own origin only
 * (`font-src 'self'`), so the template protocol serves these files under every
 * template at the reserved path `/__pulp/fonts/`; the app window loads the same
 * files through its own `pulp-font://` scheme. The bridge loads a layer's face
 * before the frame that uses it, since canvas text never triggers a load.
 */

export const FONT_SCHEME = 'pulp-font';
/** The path, inside every template's origin, that the bundled fonts answer at. A template folder cannot use it. */
export const TEMPLATE_FONTS_PATH = '__pulp/fonts';

export interface BundledFontFile {
  /** File name inside the family's folder, exactly as upstream named it. */
  file: string;
  style: 'normal' | 'italic';
  /** A variable font's weight range, or a static font's one weight. */
  weight: [number, number] | number;
  /** SHA-256 of the file, so the test can confirm the shipped bytes are the upstream ones. */
  sha256: string;
}

export interface BundledFont {
  /** Folder under `fonts/`. */
  slug: string;
  /** The family name the font is used by, in CSS and in a layer's `family`. */
  family: string;
  /** What kind of face it is, for the family control. */
  kind: 'sans' | 'serif' | 'display' | 'mono' | 'script';
  files: BundledFontFile[];
  /** The licence file beside the fonts, as upstream ships it. */
  licenseFile: string;
  license: 'OFL-1.1';
  /** A Reserved Font Name the licence declares, when it does: the files are then shipped unmodified. */
  reservedFontName?: string;
  /** Where the files came from, and which release or commit. */
  source: string;
  version: string;
  /** The upstream's own path to the files, so the download can be repeated. */
  upstreamPath: string;
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    slug: 'inter',
    family: 'Inter',
    kind: 'sans',
    files: [
      { file: 'InterVariable.ttf', style: 'normal', weight: [100, 900], sha256: '4989b125924991b90d05b2d16e0e388c48f7d5bb8b30539bbf9c755278d0ccaf' },
      { file: 'InterVariable-Italic.ttf', style: 'italic', weight: [100, 900], sha256: 'd6f1f6a172d9e588438db9f986fd5cfad7b30f644374080a8a9d4d91e344586f' },
    ],
    licenseFile: 'LICENSE.txt',
    license: 'OFL-1.1',
    source: 'https://github.com/rsms/inter',
    version: '4.1 (release v4.1; the files say 4.001)',
    upstreamPath: 'Inter-4.1.zip: InterVariable.ttf, InterVariable-Italic.ttf, LICENSE.txt',
  },
  {
    slug: 'montserrat',
    family: 'Montserrat',
    kind: 'sans',
    files: [
      { file: 'Montserrat[wght].ttf', style: 'normal', weight: [100, 900], sha256: '1e2c44ef8c956ed66998649d8c832d221e22c04eaab63c044f18eb05d1c63b7c' },
      { file: 'Montserrat-Italic[wght].ttf', style: 'italic', weight: [100, 900], sha256: '985bf47b7763a0d81c7defda5ad52771f2b36c2756db644e41b5184f1fab784f' },
    ],
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    source: 'https://github.com/JulietaUla/Montserrat',
    version: '9.000 (master, commit 555facfb2a18, 2026-03-27)',
    upstreamPath: 'fonts/variable/Montserrat[wght].ttf, fonts/variable/Montserrat-Italic[wght].ttf, OFL.txt',
  },
  {
    slug: 'oswald',
    family: 'Oswald',
    kind: 'display',
    files: [{ file: 'Oswald[wght].ttf', style: 'normal', weight: [200, 700], sha256: '5b38c246e255a12f5712d640d56bcced0472466fc68983d2d0410ec0457c2817' }],
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    source: 'https://github.com/googlefonts/OswaldFont',
    version: '4.103 (main, commit 89795261ac9e, 2024-05-29)',
    upstreamPath: 'fonts/variable/Oswald[wght].ttf, OFL.txt',
  },
  {
    slug: 'bebas-neue',
    family: 'Bebas Neue',
    kind: 'display',
    files: [{ file: 'BebasNeue-Regular.ttf', style: 'normal', weight: 400, sha256: '08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73' }],
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    source: 'https://github.com/dharmatype/Bebas-Neue',
    version: '2.000 (master, commit 46e72cec95ee, 2022-07-04)',
    upstreamPath: 'fonts/BebasNeue(2018)ByDhamraType/ttf/BebasNeue-Regular.ttf, OFL.txt',
  },
  {
    slug: 'source-serif-4',
    family: 'Source Serif 4',
    kind: 'serif',
    files: [
      { file: 'SourceSerif4Variable-Roman.ttf', style: 'normal', weight: [200, 900], sha256: '14d360ee1b76655da9276628b229e11671bc1f5d1083636144db6677d452cf55' },
      { file: 'SourceSerif4Variable-Italic.ttf', style: 'italic', weight: [200, 900], sha256: '6a059a64838978d54e8fab71ed86b0d82e948c0e12b2664d0c15166326dcff82' },
    ],
    licenseFile: 'LICENSE.md',
    license: 'OFL-1.1',
    reservedFontName: 'Source',
    source: 'https://github.com/adobe-fonts/source-serif',
    version: '4.005 (release 4.005R)',
    upstreamPath: 'source-serif-4.005_Desktop.zip: VAR/SourceSerif4Variable-Roman.ttf, VAR/SourceSerif4Variable-Italic.ttf, LICENSE.md',
  },
  {
    slug: 'playfair',
    family: 'Playfair',
    kind: 'serif',
    files: [
      { file: 'PlayfairRomanVF.ttf', style: 'normal', weight: [300, 900], sha256: '3afb1b1e1116c1246108679cc2ce017e548697bc3a6ede36d8723b57dc3e4786' },
      { file: 'PlayfairItalicVF.ttf', style: 'italic', weight: [300, 900], sha256: 'ae99633d2cc12fabf6fb245b590cdea2dabdc92113d5a7236e78692347556dbb' },
    ],
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    source: 'https://github.com/clauseggers/Playfair',
    version: '2.202 roman, 2.203 italic (master, commit b869b3a82f71, 2025-05-08)',
    upstreamPath: 'fonts/VF-TTF/PlayfairRomanVF.ttf, fonts/VF-TTF/PlayfairItalicVF.ttf, OFL.txt',
  },
  {
    slug: 'jetbrains-mono',
    family: 'JetBrains Mono',
    kind: 'mono',
    files: [
      { file: 'JetBrainsMono[wght].ttf', style: 'normal', weight: [100, 800], sha256: '662a196d58f1183bf2d77428b6d5283fe3f45161ab021bea4036bc98e5cac016' },
      { file: 'JetBrainsMono-Italic[wght].ttf', style: 'italic', weight: [100, 800], sha256: 'f115aaa12113718c02ce72864fe6823b87241bc23d3e44cf1220155f861063f2' },
    ],
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    source: 'https://github.com/JetBrains/JetBrainsMono',
    version: '2.304 (release v2.304)',
    upstreamPath: 'JetBrainsMono-2.304.zip: fonts/variable/JetBrainsMono[wght].ttf, fonts/variable/JetBrainsMono-Italic[wght].ttf, OFL.txt',
  },
  {
    slug: 'caveat',
    family: 'Caveat',
    kind: 'script',
    files: [{ file: 'Caveat[wght].ttf', style: 'normal', weight: [400, 700], sha256: '0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988' }],
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    source: 'https://github.com/googlefonts/caveat',
    version: '2.000 (main, commit 59745e818ef7, 2020-10-01)',
    upstreamPath: 'fonts/variable/Caveat[wght].ttf, OFL.txt',
  },
  {
    slug: 'dancing-script',
    family: 'Dancing Script',
    kind: 'script',
    files: [
      { file: 'DancingScript-Regular.otf', style: 'normal', weight: 400, sha256: 'd71f864af9c13eeb740230fd67309c2390a902dba2326ae06f2275ca52663c6a' },
      { file: 'DancingScript-Medium.otf', style: 'normal', weight: 500, sha256: 'e2df531bbc38c47815bcaac5a2fef19916db439290765925c490ca788e32a7bf' },
      { file: 'DancingScript-SemiBold.otf', style: 'normal', weight: 600, sha256: 'd11d273c388c59cba202082d494b96566e8715064391b931c0864c80310a9f69' },
      { file: 'DancingScript-Bold.otf', style: 'normal', weight: 700, sha256: 'fedde8985cd22f0ec9ddef61d8bc4adfb4319b9912c3559efb6a173745663804' },
    ],
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    reservedFontName: 'Dancing Script',
    source: 'https://github.com/impallari/DancingScript',
    version: '3.000 (master, commit 09b7abf420f2, 2024-08-12)',
    upstreamPath: 'fonts/DancingScript-Regular.otf, -Medium.otf, -SemiBold.otf, -Bold.otf, OFL.txt',
  },
  {
    slug: 'noto-sans',
    family: 'Noto Sans',
    kind: 'sans',
    files: [
      { file: 'NotoSans[wght].ttf', style: 'normal', weight: [100, 900], sha256: '013c43d9b7aae7d73d52cb08c0eac0748754ff010020b079325d8117c24a9333' },
      { file: 'NotoSans-Italic[wght].ttf', style: 'italic', weight: [100, 900], sha256: 'cc7e7357d1ae42bc5ee5085be00041f91d69bc822e99e2a1a3548b937f52981a' },
    ],
    licenseFile: 'OFL.txt',
    license: 'OFL-1.1',
    source: 'https://github.com/notofonts/latin-greek-cyrillic',
    version: '2.015 (release NotoSans-v2.015)',
    upstreamPath: 'NotoSans-v2.015.zip: NotoSans/full/slim-variable-ttf/NotoSans[wght].ttf, NotoSans-Italic[wght].ttf, OFL.txt',
  },
];

/** The family names, in the order the control offers them. */
export const BUNDLED_FAMILIES: readonly string[] = BUNDLED_FONTS.map((f) => f.family);

export function isBundledFamily(family: string): boolean {
  return BUNDLED_FONTS.some((f) => f.family === family);
}

/** The font file a `<slug>/<file>` path names, or null for anything that is not exactly one of the bundled files. */
export function bundledFontFile(path: string): { font: BundledFont; file: BundledFontFile } | null {
  const [slug, name, ...rest] = path.split('/');
  if (rest.length > 0 || !slug || !name) return null;
  const font = BUNDLED_FONTS.find((f) => f.slug === slug);
  const file = font?.files.find((f) => f.file === name);
  return font && file ? { font, file } : null;
}

export function fontMimeType(file: string): string {
  const lower = file.toLowerCase();
  return lower.endsWith('.otf') ? 'font/otf' : lower.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
}

/**
 * The `@font-face` rules for every bundled file, with their URLs under `base`
 * (`pulp-font://` in the app window, `/__pulp/fonts/` in a template page). A
 * variable font declares its whole weight range in one rule.
 */
export function fontFaceCss(base: string): string {
  const rules: string[] = [];
  for (const font of BUNDLED_FONTS) {
    for (const file of font.files) {
      const weight = typeof file.weight === 'number' ? String(file.weight) : `${file.weight[0]} ${file.weight[1]}`;
      const url = `${base}${font.slug}/${encodeURIComponent(file.file)}`;
      rules.push(`@font-face{font-family:"${font.family}";font-style:${file.style};font-weight:${weight};font-display:block;src:url("${url}")}`);
    }
  }
  return rules.join('\n');
}

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', 'inherit', 'initial']);

/**
 * A family or stack as CSS and canvas accept it: every name quoted unless it is
 * a generic family. "Source Serif 4" is not a valid unquoted name (a word may
 * not start with a digit), and `ctx.font` silently ignores an invalid string,
 * so quoting is what keeps a layer in the face it asked for. Mirrored in the
 * bridge script (cssFamily in BRIDGE_SCRIPT): change both or neither.
 */
export function cssFontFamily(stack: string): string {
  return stack
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter((part) => part.length > 0)
    .map((part) => (GENERIC_FAMILIES.has(part.toLowerCase()) ? part : `"${part.replace(/"/g, '\\"')}"`))
    .join(', ');
}

/**
 * The first family name of a CSS font stack, for showing a stack as one name
 * ("Georgia, Times New Roman, serif" reads as "Georgia").
 */
export function familyLabel(stack: string): string {
  return (stack.split(',')[0] ?? stack).trim().replace(/^["']|["']$/g, '') || stack;
}

// ---------------------------------------------------------------- imported fonts (milestone 23)

/** The folder, under the bundled fonts' reserved path and scheme, that a person's own fonts answer at. */
export const IMPORTED_FONTS_SLUG = 'imported';

/** The file extensions a font may be imported from. WOFF (1) is left out: browsers read it, but it is a web-only wrapper of little use to a person's own files. */
export const IMPORTED_FONT_EXTENSIONS = ['.ttf', '.otf', '.woff2'] as const;

/**
 * A font a person imported: copied into the managed folder, named by what the
 * file calls itself, with the licence note they wrote. The licence is theirs
 * to know; Pulp records what they said and shows it where the family is chosen.
 */
export interface ImportedFont {
  /** The family name read from the file's own name table. */
  family: string;
  /** File name inside the managed folder. */
  file: string;
  style: 'normal' | 'italic';
  /** A variable font's weight range, or a static font's one weight. */
  weight: [number, number] | number;
  /** What the person wrote about the licence; may be empty. */
  note: string;
  importedAt: string;
}

export function isImportedFontFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMPORTED_FONT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * What a font file says about itself, from its `name` and `OS/2` tables:
 * the typographic family (id 16) or the family (id 1), the subfamily, and the
 * weight class. Reads TrueType and CFF OpenType; WOFF2 is compressed and its
 * tables are not readable this way, so a WOFF2 import takes its family from the
 * file name. Returns null when the bytes are not a font.
 */
export function fontFileNames(bytes: Uint8Array): { family: string; subfamily: string; italic: boolean; weight: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) return null;
  const tag = view.getUint32(0);
  // 0x00010000 TrueType, 'OTTO' CFF, 'true' old Mac TrueType.
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
  const tables = view.getUint16(4);
  const find = (name: string): { offset: number; length: number } | null => {
    for (let i = 0; i < tables; i++) {
      const at = 12 + 16 * i;
      if (at + 16 > bytes.byteLength) return null;
      const t = String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
      if (t === name) return { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
    }
    return null;
  };
  const nameTable = find('name');
  if (!nameTable || nameTable.offset + 6 > bytes.byteLength) return null;
  const count = view.getUint16(nameTable.offset + 2);
  const strings = nameTable.offset + view.getUint16(nameTable.offset + 4);
  const names = new Map<number, string>();
  for (let n = 0; n < count; n++) {
    const rec = nameTable.offset + 6 + 12 * n;
    if (rec + 12 > bytes.byteLength) break;
    const platform = view.getUint16(rec);
    const language = view.getUint16(rec + 4);
    const id = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const start = strings + view.getUint16(rec + 10);
    if (start + length > bytes.byteLength) continue;
    // Windows platform, English: UTF-16 big-endian. The Mac platform's Roman strings as a fallback.
    if (platform === 3 && language === 0x409 && !names.has(id)) {
      let out = '';
      for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode((bytes[start + i]! << 8) | bytes[start + i + 1]!);
      names.set(id, out);
    } else if (platform === 1 && language === 0 && !names.has(1000 + id)) {
      names.set(1000 + id, String.fromCharCode(...bytes.subarray(start, start + length)));
    }
  }
  const family = (names.get(16) ?? names.get(1) ?? names.get(1016) ?? names.get(1001) ?? '').trim();
  const subfamily = (names.get(17) ?? names.get(2) ?? names.get(1017) ?? names.get(1002) ?? '').trim();
  if (!family) return null;
  let weight = 400;
  const os2 = find('OS/2');
  if (os2 && os2.offset + 6 <= bytes.byteLength) {
    const w = view.getUint16(os2.offset + 4);
    if (w >= 100 && w <= 900) weight = w;
  }
  return { family, subfamily, italic: /italic|oblique/i.test(subfamily), weight };
}

/** A family name a WOFF2 file is taken to have, from its file name: dashes and underscores to spaces, the style words dropped. */
export function familyFromFileName(file: string): string {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(regular|italic|bold|light|medium|semibold|black|thin|variable|vf|wght|\[.*?\])\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || file;
}

/** Read the managed folder's index, keeping only what is well formed. */
export function sanitizeImportedFonts(value: unknown): ImportedFont[] {
  if (!Array.isArray(value)) return [];
  const out: ImportedFont[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.family !== 'string' || !r.family.trim() || typeof r.file !== 'string' || !isImportedFontFile(r.file) || r.file.includes('/') || r.file.includes('\\')) continue;
    const weight = Array.isArray(r.weight) && r.weight.length === 2 && r.weight.every((n) => typeof n === 'number') ? ([r.weight[0], r.weight[1]] as [number, number]) : typeof r.weight === 'number' ? r.weight : 400;
    out.push({
      family: r.family.trim(),
      file: r.file,
      style: r.style === 'italic' ? 'italic' : 'normal',
      weight,
      note: typeof r.note === 'string' ? r.note : '',
      importedAt: typeof r.importedAt === 'string' ? r.importedAt : '',
    });
  }
  return out;
}

/** The `@font-face` rules for a person's imported fonts, under `base` as the bundled ones are. */
export function importedFontFaceCss(fonts: readonly ImportedFont[], base: string): string {
  return fonts
    .map((font) => {
      const weight = typeof font.weight === 'number' ? String(font.weight) : `${font.weight[0]} ${font.weight[1]}`;
      return `@font-face{font-family:"${font.family.replace(/"/g, '\\"')}";font-style:${font.style};font-weight:${weight};font-display:block;src:url("${base}${IMPORTED_FONTS_SLUG}/${encodeURIComponent(font.file)}")}`;
    })
    .join('\n');
}

/** The imported families, each once, in the order first imported. */
export function importedFamilies(fonts: readonly ImportedFont[]): string[] {
  return [...new Set(fonts.map((f) => f.family))];
}

/**
 * The families a template's blocks set type in — its typography and its
 * layers' — so a pack export can warn about an imported one, and a layer can
 * say when its family is neither bundled nor imported nor the template's own.
 */
export function familiesUsedBy(blocks: readonly { typography: { family: string }; layers: readonly { type: string; family?: string }[] }[]): string[] {
  const out = new Set<string>();
  for (const block of blocks) {
    out.add(block.typography.family);
    for (const layer of block.layers) if (layer.type === 'text' && layer.family) out.add(layer.family);
  }
  return [...out];
}
