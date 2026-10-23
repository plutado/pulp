import { describe, expect, it } from 'vitest';
import { cacheFileName, cacheKey, DEFAULT_CACHE_MAX_MB, formatMB, planEviction, sanitizeCacheMaxMB } from '../src/core/render-cache';
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
    expect(cacheFileName(k, 'pulp.samples.lower-third-bar', '.mov')).toBe(`${k}-lower-third-bar.mov`);
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
    expect(formatMB(0)).toBe('0.0 MB');
    expect(formatMB(1536 * 1024)).toBe('1.5 MB');
    expect(formatMB(300 * 1024 * 1024)).toBe('300 MB');
  });
});
