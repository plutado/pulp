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
  return file.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf';
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
