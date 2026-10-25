import { describe, expect, it } from 'vitest';
import { detectFfmpeg, nodeRunner } from '../src/core/ffmpeg';
import {
  SAMPLE_MEDIA,
  SAMPLE_MEDIA_LICENSE,
  sampleAudioArgs,
  sampleJpegArgs,
  sampleMediaInferredType,
  sampleMediaKind,
  sampleMediaPath,
  sampleMediaReadme,
} from '../src/core/sample-media';
import { STILL_PAGES, stillPageUrl } from '../src/core/sample-stills';
import { scanLibrary } from '../src/core/library';
import { entryType, typeInfo, TYPE_GROUPS, TYPES } from '../src/core/taxonomy';
import { join } from 'node:path';

// The groups the catalogue fills. The four media groups are its own; milestone 24 added the
// overlay plates, backdrops and design elements that ship as pictures rather than as templates
// (a frame, a vignette, a texture, an icon), which the folder inference types the same way.
const MEDIA_GROUPS = new Set(['video', 'stills', 'music', 'sfx']);
const ASSET_GROUPS = new Set(['backgrounds', 'overlays', 'elements', 'assets']);
const bundled = await scanLibrary([join(__dirname, '..', 'templates')]);
const mediaTypes = TYPES.filter((t) => MEDIA_GROUPS.has(t.group));

describe('the sample-media catalogue', () => {
  it('gives every file the type it means to, through the folder inference the scan uses', () => {
    for (const item of SAMPLE_MEDIA) {
      expect(sampleMediaInferredType(item), sampleMediaPath(item).join('/')).toBe(item.type);
    }
  });

  it('fills every media type at least six deep, and no other type', () => {
    // Milestone 24 raised the floor from three and dropped the ceiling of five
    // (tests/sample-coverage.test.ts): a media type people reach for may run as deep as it likes.
    const counts = new Map<string, number>();
    for (const item of SAMPLE_MEDIA) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    for (const t of mediaTypes) {
      expect(counts.get(t.id) ?? 0, `${t.label} (${t.id})`).toBeGreaterThanOrEqual(6);
    }
    // Every type the catalogue fills is a media type or one of the asset groups above; nothing else.
    const allowed = new Set(TYPES.filter((t) => MEDIA_GROUPS.has(t.group) || ASSET_GROUPS.has(t.group)).map((t) => t.id));
    for (const type of counts.keys()) expect([...allowed], type).toContain(type);
    expect(TYPE_GROUPS.filter((g) => MEDIA_GROUPS.has(g.id)).map((g) => g.id).sort()).toEqual([...MEDIA_GROUPS].sort());
  });

  it('names every file once, with an extension that matches how it is made', () => {
    const paths = SAMPLE_MEDIA.map((i) => sampleMediaPath(i).join('/'));
    expect(new Set(paths).size).toBe(paths.length);
    for (const item of SAMPLE_MEDIA) {
      const ext = item.file.slice(item.file.lastIndexOf('.'));
      const kind = sampleMediaKind(item);
      if (item.recipe.kind === 'audio') expect(ext).toBe('.wav');
      if (item.recipe.kind === 'still') expect(ext).toBe(`.${item.recipe.format}`);
      if (item.recipe.kind === 'clip') expect(ext).toBe('.mp4');
      // An asset is a transparent WebM or a PNG, and its kind follows which (milestone 26).
      if (item.recipe.kind === 'asset') expect(ext).toBe(`.${item.recipe.format}`);
      const wantKind = item.recipe.kind === 'audio' ? 'audio'
        : item.recipe.kind === 'still' ? 'image'
        : item.recipe.kind === 'asset' ? (item.recipe.format === 'png' ? 'image' : 'video')
        : 'video';
      expect(kind).toBe(wantKind);
      // Lowercase, dashes, no spaces: the files are addressed from scripts and tests.
      expect(item.file).toMatch(/^[a-z0-9-]+\.[a-z0-9]+$/);
      expect(item.note.length).toBeGreaterThan(5);
    }
  });

  it('writes expressions that balance and sources that end', () => {
    for (const item of SAMPLE_MEDIA) {
      if (item.recipe.kind !== 'audio') continue;
      const { graph, filters, seconds } = item.recipe;
      const where = sampleMediaPath(item).join('/');
      for (const text of [graph, filters ?? '']) {
        let depth = 0;
        for (const ch of text) {
          if (ch === '(') depth++;
          if (ch === ')') depth--;
          expect(depth, `${where}: a ")" before its "("`).toBeGreaterThanOrEqual(0);
        }
        expect(depth, `${where}: unbalanced parentheses`).toBe(0);
        expect((text.match(/'/g) ?? []).length % 2, `${where}: unbalanced quotes`).toBe(0);
        // Exponent notation would be read as a variable by the expression parser.
        expect(text, where).not.toMatch(/\d[eE][+-]?\d/);
      }
      expect(seconds, where).toBeGreaterThan(0);
      expect(seconds, where).toBeLessThanOrEqual(20);
      const args = sampleAudioArgs(item.recipe, '/out/x.wav');
      expect(args).toContain('-t');
      expect(args.at(-1)).toBe('/out/x.wav');
      expect(args).toContain('pcm_s16le');
    }
    expect(sampleJpegArgs('/out/p.jpg').at(-1)).toBe('/out/p.jpg');
  });

  it('draws stills from pages that are deterministic and size themselves from the state', () => {
    for (const [name, html] of Object.entries(STILL_PAGES)) {
      expect(html, name).toContain('window.pulpRender');
      expect(html, name).not.toMatch(/Date\.now|performance\.now|requestAnimationFrame|Math\.random|setTimeout|setInterval|https?:\/\//);
      expect(html, name).toContain('state.width');
      expect(stillPageUrl(name as keyof typeof STILL_PAGES)).toMatch(/^data:text\/html;charset=utf-8,/);
    }
    for (const item of SAMPLE_MEDIA) {
      if (item.recipe.kind === 'still' || item.recipe.kind === 'asset') expect(Object.keys(STILL_PAGES)).toContain(item.recipe.page);
      // Every variant is one its page really draws. A page picks its variant by name and falls back
      // to a default, so a typo would quietly write the default picture under the new file's name
      // rather than fail — with six variants a page, that is easy to do and hard to see.
      if (item.recipe.kind === 'still' || item.recipe.kind === 'asset') {
        const page = STILL_PAGES[item.recipe.page];
        const variant = item.recipe.variant;
        const drawn = new RegExp(`['"]${variant}['"]|\\b${variant}\\s*[:(]`).test(page);
        expect(drawn, `${item.recipe.page} does not draw "${variant}"`).toBe(true);
      }
      // A clip is rendered from a bundled background, checked against the library rather than by
      // its name: a matched set's background or a standalone one both qualify.
      if (item.recipe.kind === 'clip') {
        const id = item.recipe.templateId;
        const source = bundled.templates.find((t) => t.manifest.id === id);
        expect(source, id).toBeDefined();
        expect(typeInfo(entryType(source!) ?? '')?.group, `${id} is not a background`).toBe('backgrounds');
      }
    }
  });

  it('carries a CC0 license and a README that names every file', () => {
    expect(SAMPLE_MEDIA_LICENSE).toContain('CC0 1.0 Universal');
    const readme = sampleMediaReadme();
    for (const item of SAMPLE_MEDIA) expect(readme).toContain(`\`${item.file}\``);
    expect(readme).toContain('synthesized, not recorded');
  });
});

// ffmpeg parses every sound graph, when it is installed: a typo in an expression
// would otherwise only show up when a whole folder is generated.
const ffmpeg = await detectFfmpeg();
describe.skipIf(!ffmpeg.ok)('ffmpeg accepts every sound recipe', () => {
  const sounds = SAMPLE_MEDIA.filter((i) => i.recipe.kind === 'audio');
  it.each(sounds.map((i) => [sampleMediaPath(i).join('/'), i] as const))('%s', async (_name, item) => {
    if (!ffmpeg.ok || item.recipe.kind !== 'audio') return;
    // A twentieth of a second through the real graph and filters, to a null muxer.
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', item.recipe.graph, ...(item.recipe.filters ? ['-af', item.recipe.filters] : []), '-t', '0.05', '-f', 'null', '-'];
    const result = await nodeRunner(ffmpeg.path, args);
    expect(result.code, result.stderr).toBe(0);
  }, 20_000);
});
