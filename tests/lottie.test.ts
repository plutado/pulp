import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemId } from '../src/core/library-scan';
import { SOURCE_TRANSLATOR } from '../src/core/i18n';
import type { LottieNote } from '../src/core/lottie-types';

/** Limits as US English says them: they are kept as messages. */
const said = (notes: readonly LottieNote[]) => notes.map((n) => SOURCE_TRANSLATOR(n.id, n.values));
import { LibraryStore } from '../src/core/library-store';
import { scanLibrary } from '../src/core/library';
import {
  applyLottieParams,
  categoryForType,
  hexComponents,
  humanizeFileName,
  isLottieCandidate,
  lottieAssetPaths,
  lottieEditables,
  lottieLimits,
  lottieManifest,
  lottieManifestId,
  parseLottie,
  prepareLottieData,
  readDotLottie,
  rgbHex,
  sniffLottieJson,
} from '../src/core/lottie';
import { inlineJson, lottiePageHtml } from '../src/core/lottie-page';
import { LOTTIE_PLAYER_PATH } from '../src/core/lottie-types';
import { fileRows, formatRows, lottieRows } from '../src/core/item-info';
import { inferTemplateType } from '../src/core/taxonomy';
import { frameState } from '../src/core/runtime';
import { dotLottieFixture, lottieFixture } from './lottie-fixture';

const text = (doc: Record<string, unknown>) => JSON.stringify(doc);

describe('telling a Lottie from other JSON', () => {
  it('sniffs the head of a Bodymovin file and not a settings file', () => {
    expect(sniffLottieJson(text(lottieFixture()).slice(0, 400))).toBe(true);
    expect(sniffLottieJson('{"formatVersion":1,"id":"x","name":"y","fps":30,"duration":2,"width":1920,"height":1080}')).toBe(false);
    expect(sniffLottieJson('{"name":"pack","templates":["a"]}')).toBe(false);
    expect(sniffLottieJson('')).toBe(false);
  });

  it('names candidates by extension only', () => {
    expect(isLottieCandidate('anim.json')).toBe(true);
    expect(isLottieCandidate('ANIM.LOTTIE')).toBe(true);
    expect(isLottieCandidate('clip.mov')).toBe(false);
  });
});

describe('parseLottie', () => {
  it('reads size, rate, length and markers in seconds', () => {
    const doc = parseLottie(text(lottieFixture({ fps: 30, frames: 60 })));
    expect(doc).toMatchObject({ width: 1920, height: 1080, fps: 30, inPoint: 0, outPoint: 60, name: 'Comp 1', version: '5.12.2' });
    expect(doc.markers).toEqual([
      { name: 'intro', time: 0, duration: 0.5 },
      { name: 'loop', time: 0.5, duration: 1 },
      { name: 'end', time: 1.967, duration: 0 },
    ]);
  });

  it('refuses what is not an animation, with a plain reason', () => {
    expect(() => parseLottie('not json')).toThrow(/not valid JSON/);
    expect(() => parseLottie('{"fr":30}')).toThrow(/no layers/);
    expect(() => parseLottie(text({ ...lottieFixture(), fr: 0 }))).toThrow(/frame rate/);
    expect(() => parseLottie(text({ ...lottieFixture(), op: 0 }))).toThrow(/length/);
    expect(() => parseLottie(text(lottieFixture({ width: 9000 })))).toThrow(/size/);
  });
});

describe('readDotLottie', () => {
  it('reads every animation the manifest lists, each in full, and keeps the images (milestone 35)', () => {
    const zip = dotLottieFixture({ first: lottieFixture({ frames: 30 }), second: lottieFixture({ frames: 90 }) }, { 'img_0.png': Buffer.from('png') }, { author: 'Someone' });
    const read = readDotLottie(zip);
    expect(read.document.outPoint).toBe(30);
    expect(read.animations.map((a) => a.id)).toEqual(['first', 'second']);
    expect(read.animations[1]!.document.outPoint).toBe(90);
    expect(read.author).toBe('Someone');
    expect(read.images.get('img_0.png')?.toString()).toBe('png');
    expect(said(read.limits)).toEqual([]);
  });

  it('finds the animation without a manifest, and refuses an archive without one', () => {
    const zip = dotLottieFixture({ only: lottieFixture() });
    const stripped = readDotLottie(zip);
    expect(stripped.animations.map((a) => a.id)).toEqual(['only']);
    expect(() => readDotLottie(Buffer.from('not a zip at all, really not'))).toThrow(/not a zip/);
  });

  it('skips an animation that cannot be read and names it, and reads the rest', () => {
    const zip = dotLottieFixture({ good: lottieFixture(), bad: { not: 'a lottie' } });
    const read = readDotLottie(zip);
    expect(read.animations.map((a) => a.id)).toEqual(['good']);
    expect(said(read.limits)).toEqual(['animation “bad” could not be read']);
  });

  it('reads themes in full: static values, keyframes, scoped rules and the older map form (milestone 35)', () => {
    const zip = dotLottieFixture({ only: lottieFixture({ withSlots: true }) }, {}, {}, {
      dark: { rules: [
        { id: 'accent', type: 'Color', value: [0, 0, 1] },
        { id: 'size', type: 'Scalar', keyframes: [{ t: 0, s: [10] }, { t: 30, s: [20] }] },
        { id: 'elsewhere', type: 'Color', value: [1, 1, 1], animations: ['another'] },
        { id: 'poster', type: 'Image', value: { id: 'image_0' } },
      ] },
      flat: { accent: { p: { a: 0, k: [0.5, 0.5, 0.5] } } },
      broken: 'not json rules at all',
    });
    const read = readDotLottie(zip);
    expect(read.themes.map((t) => t.id)).toEqual(['dark', 'flat']);
    expect(read.themes[0]!.rules).toEqual([
      { sid: 'accent', p: { a: 0, k: [0, 0, 1] } },
      { sid: 'size', p: { a: 1, k: [{ t: 0, s: [10] }, { t: 30, s: [20] }] } },
      { sid: 'elsewhere', p: { a: 0, k: [1, 1, 1] }, animations: ['another'] },
    ]);
    expect(read.themes[1]!.rules).toEqual([{ sid: 'accent', p: { a: 0, k: [0.5, 0.5, 0.5] } }]);
    // The Image rule cannot become a slot property and is named; the unreadable theme too.
    expect(said(read.limits)).toEqual(['theme “broken” could not be read', 'theme rules the player cannot apply are skipped (dark: poster)']);
  });

  it('flattens a Gradient rule the way Lottie writes gradient stops', () => {
    const zip = dotLottieFixture({ only: lottieFixture() }, {}, {}, {
      grade: { rules: [{ id: 'wash', type: 'Gradient', value: [{ color: [1, 0, 0, 1], offset: 0 }, { color: [0, 0, 1, 0.5], offset: 1 }] }] },
    });
    const read = readDotLottie(zip);
    expect(read.themes[0]!.rules[0]!.p).toEqual({ p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0.5] } });
  });
});

describe('what the file exposes', () => {
  it('finds the text layer, each distinct color once, the solid, and the font the file names but does not carry', () => {
    const { parameters, bindings, limits } = lottieEditables(lottieFixture());
    expect(limits).toEqual([]);
    expect(parameters.map((p) => [p.id, p.type, p.label])).toEqual([
      ['text1', 'text', 'Text'],
      ['color1', 'color', 'Headline text color'],
      ['color2', 'color', 'Square fill'],
      ['color3', 'color', 'Corner solid'],
      ['font1', 'font', 'Font'],
    ]);
    // The font parameter (milestone 35's last item): any family may stand in, so it names no options.
    expect(parameters.at(-1)).toMatchObject({ default: 'Arial', element: 'Fonts' });
    expect((parameters.at(-1) as { options?: string[] }).options).toBeUndefined();
    expect(bindings.find((b) => b.id === 'font1')!.targets).toEqual([{ kind: 'font', path: ['fonts', 'list', 0, 'fFamily'] }]);
    expect(parameters[0]).toMatchObject({ element: 'Headline', default: 'HELLO' });
    expect(parameters[1]).toMatchObject({ default: '#ffffff', element: 'Colors' });
    expect(parameters[2]).toMatchObject({ default: '#ff0000' });
    expect(parameters[3]).toMatchObject({ default: '#0000ff' });
    expect(bindings.find((b) => b.id === 'text1')!.targets).toEqual([{ kind: 'text', path: ['layers', 0, 't', 'd', 'k', 0, 's', 't'] }]);
    expect(bindings.find((b) => b.id === 'color2')!.targets).toEqual([{ kind: 'rgb', path: ['layers', 1, 'shapes', 0, 'it', 1, 'c', 'k'] }]);
    expect(bindings.find((b) => b.id === 'color3')!.targets).toEqual([{ kind: 'hex', path: ['layers', 2, 'sc'] }]);
  });

  it('merges a color used in several places into one parameter that says so', () => {
    const doc = lottieFixture({ fill: [1, 1, 1] }); // the square's fill is the text's white
    const { parameters, bindings } = lottieEditables(doc);
    const white = parameters.find((p) => p.default === '#ffffff')!;
    expect(white.description).toBe('Also used in 1 other place.');
    expect(bindings.find((b) => b.id === white.id)!.targets).toHaveLength(2);
  });

  it('reaches slotted values through the slot, and leaves animated text alone but names it', () => {
    const { parameters, bindings, limits } = lottieEditables(lottieFixture({ withSlots: true, withAnimatedText: true }));
    const slotText = parameters.find((p) => p.element === 'headline');
    expect(slotText).toMatchObject({ type: 'text', default: 'SLOT TEXT' });
    expect(bindings.find((b) => b.id === slotText!.id)!.targets[0]!.path).toEqual(['slots', 'headline', 'p', 'k', 0, 's', 't']);
    const accent = parameters.find((p) => p.label === 'accent fill')!;
    expect(bindings.find((b) => b.id === accent.id)!.targets).toEqual([{ kind: 'rgb', path: ['slots', 'accent', 'p', 'k'] }]);
    // The square's own fill carries `sid` and is not bound twice.
    expect(bindings.flatMap((b) => b.targets).filter((t) => t.path.includes('shapes'))).toEqual([]);
    expect(said(limits)).toEqual(['text that changes over time is not editable: Ticker']);
  });

  it('reads older files whose channels run to 255, and animated colors are not offered', () => {
    const doc = lottieFixture();
    const fill = ((doc.layers as Record<string, unknown>[])[1]!.shapes as Record<string, unknown>[])[0]!.it as Record<string, unknown>[];
    fill[1]!.c = { a: 0, k: [255, 128, 0] };
    expect(lottieEditables(doc).parameters.find((p) => p.label === 'Square fill')).toMatchObject({ default: '#ff8000' });
    fill[1]!.c = { a: 1, k: [{ t: 0, s: [1, 0, 0] }, { t: 10, s: [0, 1, 0] }] };
    expect(lottieEditables(doc).parameters.some((p) => p.label === 'Square fill')).toBe(false);
  });

  it('applies values into a copy, text with Lottie line breaks and colors as components', () => {
    const doc = lottieFixture();
    const { bindings } = lottieEditables(doc);
    const applied = applyLottieParams(doc, bindings, { text1: 'Two\nlines', color2: '#00ff00', color3: '#12345680', color1: 'garbage' });
    const layers = applied.layers as Record<string, unknown>[];
    expect(((layers[0]!.t as Record<string, unknown>).d as { k: { s: { t: string; fc: number[] } }[] }).k[0]!.s.t).toBe('Two\rlines');
    expect(((layers[0]!.t as Record<string, unknown>).d as { k: { s: { fc: number[] } }[] }).k[0]!.s.fc).toEqual([1, 1, 1]); // garbage ignored
    expect((((layers[1]!.shapes as Record<string, unknown>[])[0]!.it as Record<string, unknown>[])[1]!.c as { k: number[] }).k).toEqual([0, 1, 0]);
    expect(layers[2]!.sc).toBe('#123456');
    // The original is untouched.
    expect(((doc.layers as Record<string, unknown>[])[2]!).sc).toBe('#0000ff');
  });

  it('a file that carries its letters as glyphs offers no font to pick', () => {
    const doc = lottieFixture();
    doc.chars = [{ ch: 'H', fFamily: 'Arial', data: {} }];
    expect(lottieEditables(doc).parameters.some((p) => p.type === 'font')).toBe(false);
  });

  it('writes a chosen font into the file\'s font list, where every text set in it reads it', () => {
    const doc = lottieFixture();
    const { bindings } = lottieEditables(doc);
    const applied = applyLottieParams(doc, bindings, { font1: 'Inter' });
    expect(((applied.fonts as Record<string, unknown>).list as Record<string, unknown>[])[0]!.fFamily).toBe('Inter');
    expect(((doc.fonts as Record<string, unknown>).list as Record<string, unknown>[])[0]!.fFamily).toBe('Arial');
  });

  it('applies a chosen theme to the slots, a changed parameter over it, and leaves defaults to the theme', () => {
    const doc = lottieFixture({ withSlots: true });
    const { parameters, bindings } = lottieEditables(doc);
    const defaults = Object.fromEntries(parameters.map((q) => [q.id, q.default]));
    const accent = parameters.find((q) => q.label === 'accent fill')!;
    const themes = [{ id: 'dark', rules: [{ sid: 'accent', p: { a: 0, k: [0, 0, 1] } }] }];
    const slotColor = (d: Record<string, unknown>): unknown => (((d.slots as Record<string, unknown>).accent as Record<string, unknown>).p as Record<string, unknown>).k;
    // At its default, the color is the theme's; changed, the person's choice wins.
    expect(slotColor(applyLottieParams(doc, bindings, { ...defaults, theme: 'dark' }, { themes, defaults }))).toEqual([0, 0, 1]);
    expect(slotColor(applyLottieParams(doc, bindings, { ...defaults, theme: 'dark', [accent.id]: '#00ff00' }, { themes, defaults }))).toEqual([0, 1, 0]);
    // No theme chosen: the file as it is, the parameters as ever.
    expect(slotColor(applyLottieParams(doc, bindings, { ...defaults, theme: '' }, { themes, defaults }))).toEqual([1, 0, 0]);
    // A rule scoped to another animation is left out.
    const scoped = [{ id: 'dark', rules: [{ sid: 'accent', p: { a: 0, k: [0, 0, 1] }, animations: ['other'] }] }];
    expect(slotColor(applyLottieParams(doc, bindings, { ...defaults, theme: 'dark' }, { themes: scoped, defaults, animation: 'this' }))).toEqual([1, 0, 0]);
  });

  it('round-trips colors', () => {
    expect(rgbHex([1, 0.5, 0])).toBe('#ff8000');
    expect(hexComponents('#FF8000')).toMatchObject({ r: 1, b: 0, a: 1, hex: '#ff8000' });
    expect(hexComponents('#ff800080')!.a).toBeCloseTo(0.502, 2);
    expect(hexComponents('red')).toBeNull();
  });
});

describe('limits', () => {
  it('names expressions, effects, 3D, web fonts, and nothing for a plain file', () => {
    expect(lottieLimits(lottieFixture())).toEqual([]);
    const limits = said(lottieLimits(lottieFixture({ withLimits: true })));
    expect(limits).toEqual([
      'expressions on 1 property are not run; those properties keep their keyframed values',
      'layer effects on 1 layer are not drawn',
      '3D layers and cameras are drawn flat',
      'fonts the file would fetch from the web are not loaded (Arial); their text draws in an installed font of that name or the browser\'s fallback',
    ]);
  });

  it('prepares the data so the player does not wait on a web font', () => {
    const prepared = prepareLottieData(lottieFixture({ withLimits: true }));
    const font = ((prepared.fonts as Record<string, unknown>).list as Record<string, unknown>[])[0]!;
    expect(font).toMatchObject({ fPath: '', origin: 0, fFamily: 'Arial' });
  });

  it('lists the pictures the page may ask for', () => {
    expect(lottieAssetPaths(lottieFixture({ withImage: 'pic.png' }))).toEqual(['images/pic.png']);
    expect(lottieAssetPaths(lottieFixture())).toEqual([]);
    const web = lottieFixture({ withImage: 'pic.png' });
    ((web.assets as Record<string, unknown>[])[0]!).u = 'https://example.com/';
    expect(lottieAssetPaths(web)).toEqual([]);
    expect(said(lottieLimits(web))).toContain('1 picture the file would fetch from the web is not drawn');
  });
});

describe('the manifest', () => {
  const doc = parseLottie(text(lottieFixture({ width: 375, height: 667, fps: 25, frames: 50 })));
  const editables = lottieEditables(doc.data);
  const result = lottieManifest(doc, { id: itemId('lottie:/lib/a.json'), name: 'Lower third', format: 'json', type: 'lower-third', themes: ['news'], tags: ['titles'], editables, limits: [{ id: 'lottie.limit.three-d' }] });

  it('is a valid template manifest made from the file', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const m = result.manifest;
    expect(m.id).toBe(lottieManifestId(itemId('lottie:/lib/a.json')));
    expect(m.id).toMatch(/^lottie-[0-9a-f]{24}$/);
    expect(m).toMatchObject({ name: 'Lower third', fps: 25, duration: 2, alpha: true, entry: 'index.html', category: 'lower-third', type: 'lower-third', themes: ['news'], license: 'not stated', version: '5.12.2' });
    // The odd size rounds up to even for the encoders; every built-in aspect follows the file's own.
    expect(m.size).toEqual({ width: 376, height: 668 });
    expect(m.aspects[0]).toBe('9:16'); // 376 × 668 is within a hundredth of 9:16
    expect(m.aspects).toEqual(expect.arrayContaining(['16:9', '9:16', '1:1', '4:5']));
    expect(m.tags).toEqual(['lottie', 'titles']);
    expect(m.parameters.map((p) => p.id)).toEqual(['text1', 'color1', 'color2', 'color3', 'font1', 'fit']);
    expect(m.parameters.at(-1)).toMatchObject({ type: 'select', default: 'fit' });
    expect(m.description).toContain('375 × 667, 50 frames at 25 fps');
    expect(m.description).toContain('Markers: intro, loop, end');
    expect(m.description).toContain('Not drawn: 3D layers and cameras are drawn flat.');
  });

  it('offers a dotLottie\'s themes as a Theme setting, the file as it is first', () => {
    const themed = lottieManifest(doc, { id: itemId('lottie:/lib/b.lottie'), name: 'Badge', format: 'lottie', editables, limits: [], dotLottieThemes: [{ id: 'dark-mode', rules: [{ sid: 'accent', p: { a: 0, k: [0, 0, 1] } }] }] });
    expect(themed.ok).toBe(true);
    if (!themed.ok) return;
    const theme = themed.manifest.parameters.find((q) => q.id === 'theme')!;
    expect(theme).toMatchObject({ type: 'select', label: 'Theme', element: 'Colors', default: '' });
    expect((theme as { options: { value: string; label: string }[] }).options).toEqual([
      { value: '', label: 'As the file is' },
      { value: 'dark-mode', label: 'Dark mode' },
    ]);
  });

  it('maps types to categories, and a file with none is "other"', () => {
    expect(categoryForType('lower-third')).toBe('lower-third');
    expect(categoryForType('opener')).toBe('title');
    expect(categoryForType('glitch')).toBe('transition');
    expect(categoryForType('vignette')).toBe('overlay');
    expect(categoryForType('animated-loop')).toBe('background');
    expect(categoryForType('icons')).toBe('other');
    expect(categoryForType(undefined)).toBe('other');
  });

  it('infers a template type from folders as a clip would, within template groups only', () => {
    expect(inferTemplateType(['lower-thirds'])).toBe('lower-third');
    expect(inferTemplateType(['titles', 'openers'])).toBe('opener');
    expect(inferTemplateType(['transitions'])).toBe('wipe');
    expect(inferTemplateType(['stock', 'footage'])).toBeUndefined();
    expect(inferTemplateType([])).toBeUndefined();
  });

  it('humanizes file names', () => {
    expect(humanizeFileName('my-lower_third.json')).toBe('My lower third');
    expect(humanizeFileName('ICON.lottie')).toBe('ICON');
    expect(humanizeFileName('.json')).toBe('Lottie animation');
  });

  it('steps the file\'s own timeline frame for frame', () => {
    if (!result.ok) return;
    const state = frameState(result.manifest, 25, {}, { width: 376, height: 668 });
    expect(state.time).toBe(1);
    expect(state.totalFrames).toBe(50);
  });
});

describe('the page', () => {
  it('inlines the animation and the bindings safely and loads the player from the reserved path', () => {
    const doc = lottieFixture({ text: '</script><b>' });
    const html = lottiePageHtml({ name: 'A & B <c>', data: doc, bindings: lottieEditables(doc).bindings, width: 1920, height: 1080, fps: 30, totalFrames: 60 });
    expect(html).toContain(`<script src="/${LOTTIE_PLAYER_PATH}"></script>`);
    expect(html).toContain('<title>A &amp; B &lt;c&gt;</title>');
    expect(html).toContain('window.pulpRender = function');
    // The text that would close the script is escaped on the way in.
    expect(html.split('</script>')).toHaveLength(4);
    expect(inlineJson({ s: '</script>\u2028' })).toBe('{"s":"\\u003c/script>\\u2028"}');
  });

  it('carries the themes, the defaults and the animation, and a saved template loads the player beside itself', () => {
    const doc = lottieFixture();
    const html = lottiePageHtml({
      name: 'Badge', data: doc, bindings: [], width: 100, height: 100, fps: 30, totalFrames: 60,
      themes: [{ id: 'dark', rules: [{ sid: 'accent', p: { a: 0, k: [0, 0, 1] } }] }],
      animation: 'first', defaults: { color1: '#ffffff' }, playerSrc: 'player.js',
    });
    expect(html).toContain('<script src="player.js"></script>');
    expect(html).toContain('"themes":[{"id":"dark"');
    expect(html).toContain('"animation":"first"');
    expect(html).toContain('"defaults":{"color1":"#ffffff"}');
  });
});

describe('in the library', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pulp-lottie-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('indexes a Lottie .json as a template with its file, type and themes, and skips other JSON', async () => {
    await mkdir(join(root, 'Lower thirds', 'Sports'), { recursive: true });
    const file = join(root, 'Lower thirds', 'Sports', 'score-tag.json');
    await writeFile(file, text(lottieFixture()));
    await writeFile(join(root, 'notes.json'), '{"a":1}');
    await writeFile(join(root, 'Lower thirds', 'broken.lottie'), 'not a zip');
    const index = await scanLibrary([root]);
    expect(index.templates).toHaveLength(1);
    const entry = index.templates[0]!;
    expect(entry.lottie).toMatchObject({ path: file, format: 'json', width: 1920, height: 1080, fps: 30, outPoint: 60 });
    expect(entry.id).toBe(itemId(`lottie:${file}`));
    expect(entry.manifest.id).toBe(`lottie-${entry.id}`);
    expect(entry.manifest).toMatchObject({ name: 'Score tag', type: 'lower-third', category: 'lower-third' });
    expect(entry.themes).toEqual(['sports']);
    expect(entry.tags).toEqual(expect.arrayContaining(['lottie', 'lower-thirds', 'sports']));
    expect(entry.dir).toBe(join(root, 'Lower thirds', 'Sports'));
    expect(entry.size).toBeGreaterThan(0);
    expect(index.media).toEqual([]);
    expect(index.problems.map((p) => p.message)).toEqual([expect.stringMatching(/could not read the Lottie animation: not a zip/)]);
    expect(fileRows(entry)[0]).toMatchObject({ value: 'Lower thirds/Sports/score-tag.json', tip: file });
  });

  it('indexes a .lottie archive and keeps both kinds without re-reading on an unchanged rescan', async () => {
    await writeFile(join(root, 'icon.lottie'), dotLottieFixture({ a: lottieFixture({ width: 500, height: 500 }) }));
    await writeFile(join(root, 'title.json'), text(lottieFixture()));
    const store = new LibraryStore(':memory:');
    try {
      store.setRoots([root]);
      const first = await store.scanRoots([root]);
      expect(first).toMatchObject({ visited: 2, loaded: 2, kept: 0 });
      const index = store.toIndex();
      expect(index.templates.map((t) => [t.manifest.name, t.lottie?.format])).toEqual([['Icon', 'lottie'], ['Title', 'json']]);
      expect(index.templates[0]!.manifest.size).toEqual({ width: 500, height: 500 });
      expect(index.templates[0]!.manifest.aspects[0]).toBe('1:1');
      const again = await store.scanRoots([root]);
      expect(again).toMatchObject({ visited: 2, loaded: 0, kept: 2, removed: 0 });
      // A change is noticed.
      await writeFile(join(root, 'title.json'), text(lottieFixture({ frames: 90 })));
      const changed = await store.scanRoots([root]);
      expect(changed.loaded).toBe(1);
      expect(store.toIndex().templates.find((t) => t.manifest.name === 'Title')!.manifest.duration).toBe(3);
      // And a file gone is removed.
      await rm(join(root, 'icon.lottie'));
      expect((await store.scanRoots([root])).removed).toBe(1);
    } finally {
      store.close();
    }
  });

  it('lists every animation of an archive as an item of its own, the first under the file\'s key (milestone 35)', async () => {
    const file = join(root, 'stickers.lottie');
    await writeFile(file, dotLottieFixture({ wave: lottieFixture({ frames: 30 }), clap: lottieFixture({ frames: 90 }) }));
    const store = new LibraryStore(':memory:');
    try {
      store.setRoots([root]);
      await store.scanRoots([root]);
      const index = store.toIndex();
      const byName = new Map(index.templates.map((t) => [t.manifest.name, t]));
      expect([...byName.keys()].sort()).toEqual(['Stickers · Clap', 'Stickers · Wave']);
      expect(byName.get('Stickers · Wave')!).toMatchObject({ lottie: { animation: 'wave' }, manifest: { duration: 1 } });
      expect(byName.get('Stickers · Clap')!).toMatchObject({ lottie: { animation: 'clap' }, manifest: { duration: 3 } });
      // The first keeps the file's own key and id, so nothing that named the item before changes.
      expect(byName.get('Stickers · Wave')!.id).toBe(itemId(`lottie:${file}`));
      expect(byName.get('Stickers · Clap')!.id).toBe(itemId(`lottie:${file}#clap`));
      expect(new Set(index.templates.map((t) => t.manifest.id)).size).toBe(2);
      // An unchanged rescan keeps both without re-reading the archive.
      const again = await store.scanRoots([root]);
      expect(again).toMatchObject({ loaded: 0, kept: 1, removed: 0 });
      expect(store.toIndex().templates).toHaveLength(2);
      // The file gone takes both with it.
      await rm(file);
      expect((await store.scanRoots([root])).removed).toBe(2);
    } finally {
      store.close();
    }
  });

  it('says what the Info tab shows for it', async () => {
    await writeFile(join(root, 'odd.json'), text(lottieFixture({ width: 375, height: 667, withLimits: true })));
    const [entry] = (await scanLibrary([root])).templates;
    const rows = formatRows(entry!);
    const value = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(value('Source')).toBe('Lottie animation · JSON');
    expect(value('Own size')).toContain('375 × 667');
    expect(value('Markers')).toBe('intro 0–0.5 s · loop 0.5–1.5 s · end at 1.97 s');
    expect(value('Editable')).toBe('1 text, 3 colors');
    expect(rows.find((r) => r.label === 'Not drawn')).toMatchObject({ tone: 'warn' });
    expect(value('Not drawn')).toMatch(/^Expressions on 1 property/);
    expect(lottieRows({ ...entry!.lottie!, bindings: [], limits: [], markers: [] }).map((r) => r.label)).toEqual(['Source', 'Own size', 'Editable']);
  });
});
