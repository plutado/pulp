import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemId } from '../src/core/library-scan';
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
  it('reads the first animation the manifest lists, names the rest, and keeps the images', () => {
    const zip = dotLottieFixture({ first: lottieFixture({ frames: 30 }), second: lottieFixture({ frames: 90 }) }, { 'img_0.png': Buffer.from('png') }, { author: 'Someone' });
    const read = readDotLottie(zip);
    expect(read.document.outPoint).toBe(30);
    expect(read.animations).toEqual(['first', 'second']);
    expect(read.author).toBe('Someone');
    expect(read.images.get('img_0.png')?.toString()).toBe('png');
    expect(read.limits).toEqual(['the archive holds 2 animations; the first (first) is shown']);
  });

  it('finds the animation without a manifest, and refuses an archive without one', () => {
    const zip = dotLottieFixture({ only: lottieFixture() });
    const stripped = readDotLottie(zip);
    expect(stripped.animations).toEqual(['only']);
    expect(() => readDotLottie(Buffer.from('not a zip at all, really not'))).toThrow(/not a zip/);
  });
});

describe('what the file exposes', () => {
  it('finds the text layer, each distinct colour once, and the solid', () => {
    const { parameters, bindings, limits } = lottieEditables(lottieFixture());
    expect(limits).toEqual([]);
    expect(parameters.map((p) => [p.id, p.type, p.label])).toEqual([
      ['text1', 'text', 'Text'],
      ['color1', 'color', 'Headline text colour'],
      ['color2', 'color', 'Square fill'],
      ['color3', 'color', 'Corner solid'],
    ]);
    expect(parameters[0]).toMatchObject({ element: 'Headline', default: 'HELLO' });
    expect(parameters[1]).toMatchObject({ default: '#ffffff', element: 'Colours' });
    expect(parameters[2]).toMatchObject({ default: '#ff0000' });
    expect(parameters[3]).toMatchObject({ default: '#0000ff' });
    expect(bindings.find((b) => b.id === 'text1')!.targets).toEqual([{ kind: 'text', path: ['layers', 0, 't', 'd', 'k', 0, 's', 't'] }]);
    expect(bindings.find((b) => b.id === 'color2')!.targets).toEqual([{ kind: 'rgb', path: ['layers', 1, 'shapes', 0, 'it', 1, 'c', 'k'] }]);
    expect(bindings.find((b) => b.id === 'color3')!.targets).toEqual([{ kind: 'hex', path: ['layers', 2, 'sc'] }]);
  });

  it('merges a colour used in several places into one parameter that says so', () => {
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
    expect(limits).toEqual(['text that changes over time is not editable: Ticker']);
  });

  it('reads older files whose channels run to 255, and animated colours are not offered', () => {
    const doc = lottieFixture();
    const fill = ((doc.layers as Record<string, unknown>[])[1]!.shapes as Record<string, unknown>[])[0]!.it as Record<string, unknown>[];
    fill[1]!.c = { a: 0, k: [255, 128, 0] };
    expect(lottieEditables(doc).parameters.find((p) => p.label === 'Square fill')).toMatchObject({ default: '#ff8000' });
    fill[1]!.c = { a: 1, k: [{ t: 0, s: [1, 0, 0] }, { t: 10, s: [0, 1, 0] }] };
    expect(lottieEditables(doc).parameters.some((p) => p.label === 'Square fill')).toBe(false);
  });

  it('applies values into a copy, text with Lottie line breaks and colours as components', () => {
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

  it('round-trips colours', () => {
    expect(rgbHex([1, 0.5, 0])).toBe('#ff8000');
    expect(hexComponents('#FF8000')).toMatchObject({ r: 1, b: 0, a: 1, hex: '#ff8000' });
    expect(hexComponents('#ff800080')!.a).toBeCloseTo(0.502, 2);
    expect(hexComponents('red')).toBeNull();
  });
});

describe('limits', () => {
  it('names expressions, effects, 3D, web fonts, and nothing for a plain file', () => {
    expect(lottieLimits(lottieFixture())).toEqual([]);
    const limits = lottieLimits(lottieFixture({ withLimits: true }));
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
    expect(lottieLimits(web)).toContain('1 picture the file would fetch from the web is not drawn');
  });
});

describe('the manifest', () => {
  const doc = parseLottie(text(lottieFixture({ width: 375, height: 667, fps: 25, frames: 50 })));
  const editables = lottieEditables(doc.data);
  const result = lottieManifest(doc, { id: itemId('lottie:/lib/a.json'), name: 'Lower third', format: 'json', type: 'lower-third', themes: ['news'], tags: ['titles'], editables, limits: ['x'] });

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
    expect(m.parameters.map((p) => p.id)).toEqual(['text1', 'color1', 'color2', 'color3', 'fit']);
    expect(m.parameters.at(-1)).toMatchObject({ type: 'select', default: 'fit' });
    expect(m.description).toContain('375 × 667, 50 frames at 25 fps');
    expect(m.description).toContain('Markers: intro, loop, end');
    expect(m.description).toContain('Not drawn: x.');
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

  it('says what the Info tab shows for it', async () => {
    await writeFile(join(root, 'odd.json'), text(lottieFixture({ width: 375, height: 667, withLimits: true })));
    const [entry] = (await scanLibrary([root])).templates;
    const rows = formatRows(entry!);
    const value = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(value('Source')).toBe('Lottie animation · JSON');
    expect(value('Own size')).toContain('375 × 667');
    expect(value('Markers')).toBe('intro 0–0.5 s · loop 0.5–1.5 s · end at 1.97 s');
    expect(value('Editable')).toBe('1 text, 3 colours');
    expect(rows.find((r) => r.label === 'Not drawn')).toMatchObject({ tone: 'warn' });
    expect(value('Not drawn')).toMatch(/^Expressions on 1 property/);
    expect(lottieRows({ ...entry!.lottie!, bindings: [], limits: [], markers: [] }).map((r) => r.label)).toEqual(['Source', 'Own size', 'Editable']);
  });
});
