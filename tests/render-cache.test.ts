import { describe, expect, it } from 'vitest';
import { cacheFileName, cacheKey, DEFAULT_CACHE_MAX_MB, planEviction, sanitizeCacheIndex, sanitizeCacheMaxMB } from '../src/core/render-cache';
import { parseManifest } from '../src/core/manifest';
import { rawManifest } from './fixtures';

const manifest = (() => {
  const r = parseManifest(JSON.stringify(rawManifest()));
  if (!r.ok) throw new Error('fixture');
  return r.manifest;
})();

describe('render cache', () => {
  it('keys the same inputs the same and different inputs differently', () => {
    const base = { templateId: 't.a', manifest, params: { title: 'Hi', size: 50 }, presetId: 'prores-4444' as const };
    const k = cacheKey(base);
    expect(k).toMatch(/^[0-9a-f]{24}$/);
    expect(cacheKey({ ...base, params: { size: 50, title: 'Hi' } })).toBe(k); // parameter order does not matter
    expect(cacheKey({ ...base, params: { title: 'Bye', size: 50 } })).not.toBe(k);
    expect(cacheKey({ ...base, presetId: 'h264-mp4' })).not.toBe(k);
    expect(cacheKey({ ...base, options: { fps: 60 } })).not.toBe(k);
    expect(cacheKey({ ...base, manifest: { ...manifest, duration: 3 } })).not.toBe(k);
  });

  it('keys a chosen image by its id, size and modification time, so a replaced logo is a new render', () => {
    const manifest = (() => { const r = parseManifest(JSON.stringify(rawManifest())); if (!r.ok) throw new Error('fixture'); return r.manifest; })();
    const base = { templateId: 't', manifest, params: { logo: 'abcdefabcdefabcdefabcdef' }, presetId: 'prores-4444' as const };
    const stamp = { id: 'abcdefabcdefabcdefabcdef', size: 1024, mtimeMs: 1_700_000_000_000 };
    const k = cacheKey({ ...base, images: [stamp] });
    expect(cacheKey({ ...base, images: [stamp] })).toBe(k);
    expect(cacheKey({ ...base, images: [{ ...stamp, size: 2048 }] })).not.toBe(k);
    expect(cacheKey({ ...base, images: [{ ...stamp, mtimeMs: stamp.mtimeMs + 1 }] })).not.toBe(k);
    expect(cacheKey({ ...base })).not.toBe(k);
    // Order of the stamps does not matter.
    const two = [stamp, { id: '0123456789abcdef01234567', size: 9, mtimeMs: 9 }];
    expect(cacheKey({ ...base, images: two })).toBe(cacheKey({ ...base, images: [...two].reverse() }));
  });

  it('names cached files after the template, without a hash, and avoids names already in use', () => {
    expect(cacheFileName('Lower Third Bar', '.mov')).toBe('lower-third-bar.mov');
    expect(cacheFileName('Lower Third Bar', '.mov', new Set(['lower-third-bar.mov']))).toBe('lower-third-bar-2.mov');
    expect(cacheFileName('Lower Third Bar', '.mov', new Set(['lower-third-bar.mov', 'lower-third-bar-2.mov']))).toBe('lower-third-bar-3.mov');
    expect(cacheFileName('***', '.png')).toBe('render.png');
    expect(sanitizeCacheIndex({ ['a'.repeat(24)]: 'x.mov', bad: 'y', ['b'.repeat(24)]: '../z', ['c'.repeat(24)]: 3 })).toEqual({ ['a'.repeat(24)]: 'x.mov' });
    expect(sanitizeCacheIndex(null)).toEqual({});
  });

  it('evicts the oldest files until under the limit, keeping protected ones', () => {
    const files = [
      { path: 'a', bytes: 400, mtimeMs: 1 },
      { path: 'b', bytes: 300, mtimeMs: 2 },
      { path: 'c', bytes: 300, mtimeMs: 3 },
    ];
    expect(planEviction(files, 1000)).toEqual([]);
    expect(planEviction(files, 600)).toEqual(['a']);
    expect(planEviction(files, 300)).toEqual(['a', 'b']);
    expect(planEviction(files, 300, new Set(['a']))).toEqual(['b', 'c']);
  });

  it('sanitizes the limit and formats sizes', () => {
    expect(sanitizeCacheMaxMB(undefined)).toBe(DEFAULT_CACHE_MAX_MB);
    expect(sanitizeCacheMaxMB('512')).toBe(512);
    expect(sanitizeCacheMaxMB(10)).toBe(DEFAULT_CACHE_MAX_MB); // below the floor
  });
});
