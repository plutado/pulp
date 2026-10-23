import { describe, expect, it } from 'vitest';
import { inspectPack, licenseWarning, packEntriesFor, parsePackManifest, planInstall, slug } from '../src/core/pack';
import { rawManifest } from './fixtures';

const html = Buffer.from('<!doctype html><html><head></head><body></body></html>');
const pack = (over: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({ formatVersion: 1, name: 'News Pack', author: 'Ada', license: 'CC0-1.0', templates: ['lt', 'title'], ...over }));
const tpl = (over: Record<string, unknown>) => Buffer.from(JSON.stringify(rawManifest(over)));

function files(entries: Record<string, Buffer>): Map<string, Buffer> {
  return new Map(Object.entries(entries));
}

describe('pack manifest and licenses', () => {
  it('parses and validates pack.json', () => {
    const ok = parsePackManifest(pack().toString());
    expect(ok.ok && ok.manifest).toMatchObject({ name: 'News Pack', license: 'CC0-1.0', templates: ['lt', 'title'] });
    const bad = parsePackManifest(JSON.stringify({ formatVersion: 2, name: '', templates: ['a/b'] }));
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.problems).toEqual([
      'formatVersion must be 1',
      'name must be a non-empty string',
      'license must be an SPDX identifier, e.g. CC0-1.0',
      'templates must be a non-empty list of folder names inside the pack',
    ]);
    expect(parsePackManifest('{').ok).toBe(false);
  });

  it('accepts default type, themes and styles for the pack and rejects unknown ones', () => {
    const ok = parsePackManifest(JSON.stringify({ formatVersion: 1, name: 'News Pack', license: 'CC0-1.0', templates: ['strap'], type: 'lower-third', themes: ['News', 'My Show'], styles: ['Clean'] }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.manifest).toMatchObject({ type: 'lower-third', themes: ['news', 'my-show'], styles: ['clean'] });
    const bad = parsePackManifest(JSON.stringify({ formatVersion: 1, name: 'x', license: 'MIT', templates: ['a'], type: 'explosion-of-joy', styles: ['brutalist'] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toEqual(['type must be a type id from the built-in list', '"brutalist" is not a built-in style']);
  });

  it('warns on missing, proprietary and unknown licenses', () => {
    expect(licenseWarning('CC0-1.0')).toBeNull();
    expect(licenseWarning('MIT')).toBeNull();
    expect(licenseWarning('')).toBe('no license given');
    expect(licenseWarning(undefined)).toBe('no license given');
    expect(licenseWarning('UNLICENSED')).toBe('not an open license');
    expect(licenseWarning('Acme-EULA')).toMatch(/not in the known open list/);
    expect(slug('News Pack: Season 2!', 'pack')).toBe('news-pack-season-2');
    expect(slug('***', 'pack')).toBe('pack');
  });
});

describe('inspectPack and planInstall', () => {
  const good = files({
    'pack.json': pack(),
    'lt/template.json': tpl({ id: 'news.lt', name: 'News LT' }),
    'lt/index.html': html,
    'title/template.json': tpl({ id: 'news.title', name: 'News Title', license: 'Acme-EULA' }),
    'title/index.html': html,
  });

  it('previews templates with licenses, sizes and install folders', () => {
    const p = inspectPack(good, []);
    expect(p.problems).toEqual([]);
    expect(p.manifest?.name).toBe('News Pack');
    expect(p.licenseWarning).toBeNull();
    expect(p.installDir).toBe('news-pack');
    expect(p.templates.map((t) => [t.folder, t.manifest?.id, t.licenseWarning, t.installDir, t.fileCount])).toEqual([
      ['lt', 'news.lt', null, 'news-pack/lt', 2],
      ['title', 'news.title', 'license "Acme-EULA" is not in the known open list; check its terms', 'news-pack/title', 2],
    ]);
    expect(planInstall(p)).toEqual([
      { folder: 'lt', action: 'install' },
      { folder: 'title', action: 'install' },
    ]);
  });

  it('accepts a zip that wraps everything in one folder', () => {
    const wrapped = new Map([...good.entries()].map(([k, v]) => [`News Pack/${k}`, v]));
    expect(inspectPack(wrapped, []).templates.map((t) => t.manifest?.id)).toEqual(['news.lt', 'news.title']);
  });

  it('reports missing folders, manifests, entry files and duplicate ids', () => {
    const broken = files({
      'pack.json': pack({ templates: ['lt', 'ghost', 'nomanifest', 'noentry', 'dup'] }),
      'lt/template.json': tpl({ id: 'news.lt' }),
      'lt/index.html': html,
      'nomanifest/readme.txt': Buffer.from('x'),
      'noentry/template.json': tpl({ id: 'news.noentry' }),
      'dup/template.json': tpl({ id: 'news.lt' }),
      'dup/index.html': html,
    });
    const p = inspectPack(broken, []);
    expect(p.templates.map((t) => [t.folder, t.problems[0] ?? null])).toEqual([
      ['lt', null],
      ['ghost', 'folder "ghost" is not in the pack'],
      ['nomanifest', 'folder "nomanifest" has no template.json'],
      ['noentry', 'entry file "index.html" is not in the pack'],
      ['dup', 'duplicate template id "news.lt" (also in "lt")'],
    ]);
    expect(planInstall(p).map((i) => i.action)).toEqual(['install', 'skip', 'skip', 'skip', 'skip']);
    expect(inspectPack(files({ 'x.txt': html }), []).problems).toEqual(['no pack.json at the top of the pack']);
    const badManifest = files({ 'pack.json': pack(), 'lt/template.json': Buffer.from('{ nope'), 'lt/index.html': html, 'title/template.json': tpl({}), 'title/index.html': html });
    expect(inspectPack(badManifest, []).templates[0]?.problems).toEqual(['invalid template manifest']);
  });

  it('handles id collisions: skip library copies, replace pack copies only when asked', () => {
    const existing = [
      { id: 'news.lt', dir: '/Users/me/Library/lt', fromPack: false },
      { id: 'news.title', dir: '/userData/packs/news-pack/title', fromPack: true },
    ];
    const p = inspectPack(good, existing);
    expect(p.templates[0]?.collision).toEqual({ where: 'library', dir: '/Users/me/Library/lt' });
    expect(p.templates[1]?.collision).toEqual({ where: 'pack', dir: '/userData/packs/news-pack/title' });
    const plan = planInstall(p);
    expect(plan[0]).toMatchObject({ action: 'skip' });
    expect(plan[0]?.reason).toMatch(/not from a pack/);
    expect(plan[1]).toMatchObject({ action: 'skip' });
    expect(plan[1]?.reason).toMatch(/choose Replace/);
    expect(planInstall(p, { title: 'replace', lt: 'replace' }).map((i) => i.action)).toEqual(['skip', 'replace']);
  });

  it('builds pack entries for a template folder', () => {
    expect(packEntriesFor('lt', files({ 'template.json': html, 'assets/a.png': html })).map((e) => e.name)).toEqual(['lt/template.json', 'lt/assets/a.png']);
  });
});
