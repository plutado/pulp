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
import { TYPE_GROUPS, TYPES } from '../src/core/taxonomy';

const MEDIA_GROUPS = new Set(['video', 'stills', 'music', 'sfx']);
const mediaTypes = TYPES.filter((t) => MEDIA_GROUPS.has(t.group));

describe('the sample-media catalogue', () => {
  it('gives every file the type it means to, through the folder inference the scan uses', () => {
    for (const item of SAMPLE_MEDIA) {
      expect(sampleMediaInferredType(item), sampleMediaPath(item).join('/')).toBe(item.type);
    }
  });

  it('fills every media type with three to five files, and no other type', () => {
    const counts = new Map<string, number>();
    for (const item of SAMPLE_MEDIA) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    for (const t of mediaTypes) {
      const n = counts.get(t.id) ?? 0;
      expect(n, `${t.label} (${t.id})`).toBeGreaterThanOrEqual(3);
      expect(n, `${t.label} (${t.id})`).toBeLessThanOrEqual(5);
    }
    for (const type of counts.keys()) expect(mediaTypes.map((t) => t.id), type).toContain(type);
    // The four media groups are exactly the ones the catalogue fills.
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
      expect(kind).toBe(item.recipe.kind === 'audio' ? 'audio' : item.recipe.kind === 'still' ? 'image' : 'video');
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
      if (item.recipe.kind === 'still') expect(Object.keys(STILL_PAGES)).toContain(item.recipe.page);
      if (item.recipe.kind === 'clip') expect(item.recipe.templateId).toMatch(/^pulp\.samples\.[a-z]+\.background$/);
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
