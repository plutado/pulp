import { describe, expect, it } from 'vitest';
import { frameCount, isSafeRelativePath, parseManifest, validateManifest } from '../src/core/manifest';
import { rawManifest } from './fixtures';

function errorPaths(raw: unknown): string[] {
  const result = validateManifest(raw);
  return result.ok ? [] : result.errors.map((e) => e.path);
}

describe('validateManifest', () => {
  it('accepts a valid manifest and fills defaults', () => {
    const result = validateManifest(rawManifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.entry).toBe('index.html');
    expect(result.manifest.tags).toEqual(['title', 'minimal']);
    expect(result.manifest.parameters).toHaveLength(6);
    expect(result.warnings).toEqual([]);
  });

  it('defaults alpha to false when omitted', () => {
    const raw = rawManifest();
    delete raw.alpha;
    const result = validateManifest(raw);
    expect(result.ok && result.manifest.alpha).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
    expect(validateManifest('x').ok).toBe(false);
  });

  it('reports every invalid top-level field', () => {
    const paths = errorPaths(
      rawManifest({
        formatVersion: 2,
        id: 'Bad ID',
        name: '',
        version: '1',
        license: '',
        category: 'explosion',
        duration: 0,
        fps: 0,
        width: 10,
        height: 1.5,
      }),
    );
    expect(paths).toEqual(
      expect.arrayContaining(['formatVersion', 'id', 'name', 'version', 'license', 'category', 'duration', 'fps', 'width', 'height']),
    );
  });

  it('accepts type, themes and styles; normalizes themes; rejects unknown types and styles', () => {
    const ok = validateManifest(rawManifest({ type: 'wipe', themes: ['News', 'My Show'], styles: ['Grunge'] }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.manifest.type).toBe('wipe');
      expect(ok.manifest.themes).toEqual(['news', 'my-show']);
      expect(ok.manifest.styles).toEqual(['grunge']);
      expect(ok.warnings).toEqual([]);
    }
    const bare = validateManifest(rawManifest());
    expect(bare.ok && bare.manifest.type === undefined && bare.manifest.themes === undefined).toBe(true);
    expect(errorPaths(rawManifest({ type: 'explosion-of-joy' }))).toContain('type');
    expect(errorPaths(rawManifest({ styles: ['brutalist'] }))).toContain('styles');
    expect(errorPaths(rawManifest({ themes: ['ok', 7] }))).toContain('themes');
  });

  it('rejects entry and thumbnail paths that escape the template folder', () => {
    expect(errorPaths(rawManifest({ entry: '../evil.html' }))).toContain('entry');
    expect(errorPaths(rawManifest({ entry: '/etc/index.html' }))).toContain('entry');
    expect(errorPaths(rawManifest({ entry: 'main.js' }))).toContain('entry');
    expect(errorPaths(rawManifest({ thumbnail: 'C:\\x.png' }))).toContain('thumbnail');
    expect(errorPaths(rawManifest({ entry: 'src/index.html', thumbnail: 'poster.png' }))).toEqual([]);
  });

  it('warns about odd dimensions, unusual fps and unknown fields but still accepts', () => {
    const result = validateManifest(rawManifest({ width: 1921, fps: 12.5, colour: 'red', 'x-studio': { a: 1 } }));
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.path).sort()).toEqual(['colour', 'fps', 'width']);
  });

  describe('shape', () => {
    it('infers the aspect from a declared size and keeps the size as the default resolution', () => {
      const result = validateManifest(rawManifest());
      expect(result.ok && result.manifest.aspects).toEqual(['16:9']);
      expect(result.ok && result.manifest.size).toEqual({ width: 1920, height: 1080 });
      const tall = validateManifest(rawManifest({ width: 1080, height: 1920 }));
      expect(tall.ok && tall.manifest.aspects).toEqual(['9:16']);
      // An unusual size is still a shape: the reduced ratio, so the template renders at that one size.
      const odd = validateManifest(rawManifest({ width: 640, height: 480 }));
      expect(odd.ok && odd.manifest.aspects).toEqual(['4:3']);
    });

    it('accepts declared aspects without a size, de-duplicated and trimmed', () => {
      const raw = rawManifest({ aspects: ['16:9', ' 9:16', '16:9'] });
      delete raw.width;
      delete raw.height;
      const result = validateManifest(raw);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.manifest.aspects).toEqual(['16:9', '9:16']);
      expect(result.manifest.size).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });

    it('accepts aspects together with a size when the size is one of them', () => {
      const ok = validateManifest(rawManifest({ aspects: ['9:16', '16:9'], width: 1920, height: 1080 }));
      expect(ok.ok && ok.manifest.aspects).toEqual(['9:16', '16:9']);
      expect(ok.ok && ok.manifest.size).toEqual({ width: 1920, height: 1080 });
      expect(errorPaths(rawManifest({ aspects: ['9:16'], width: 1920, height: 1080 }))).toEqual(['width']);
    });

    it('requires a shape one way or the other, and only the built-in aspects', () => {
      const none = rawManifest();
      delete none.width;
      delete none.height;
      expect(errorPaths(none)).toEqual(['aspects']);
      const result = validateManifest(none);
      expect(!result.ok && result.errors[0]!.message).toMatch(/16:9, 9:16, 1:1, 4:5/);
      expect(errorPaths(rawManifest({ aspects: [] }))).toEqual(['aspects']);
      expect(errorPaths(rawManifest({ aspects: ['4:3'] }))).toEqual(['aspects']);
      expect(errorPaths(rawManifest({ aspects: 'wide' }))).toEqual(['aspects']);
      // Half a size is an error on the missing side, not a silent fallback.
      const half = rawManifest();
      delete half.height;
      expect(errorPaths(half)).toEqual(['height']);
    });
  });

  it('accepts NTSC frame rates without warnings', () => {
    const result = validateManifest(rawManifest({ fps: 29.97 }));
    expect(result.ok && result.warnings).toEqual([]);
  });

  describe('parameters', () => {
    const withParam = (param: Record<string, unknown>) => errorPaths(rawManifest({ parameters: [param] }));

    it('requires id, label and a known type', () => {
      expect(withParam({ id: '1bad', label: 'X', type: 'text', default: '' })).toContain('parameters[0].id');
      expect(withParam({ id: 'ok', label: '', type: 'text', default: '' })).toContain('parameters[0].label');
      expect(withParam({ id: 'ok', label: 'X', type: 'video', default: '' })).toContain('parameters[0].type');
    });

    it('checks defaults against the declared type', () => {
      expect(withParam({ id: 'a', label: 'A', type: 'text', default: 3 })).toContain('parameters[0].default');
      expect(withParam({ id: 'a', label: 'A', type: 'text', default: 'toolong', maxLength: 3 })).toContain('parameters[0].default');
      expect(withParam({ id: 'a', label: 'A', type: 'color', default: 'red' })).toContain('parameters[0].default');
      expect(withParam({ id: 'a', label: 'A', type: 'color', default: '#12345' })).toContain('parameters[0].default');
      expect(withParam({ id: 'a', label: 'A', type: 'color', default: '#11223344' })).toEqual([]);
      expect(withParam({ id: 'a', label: 'A', type: 'boolean', default: 'true' })).toContain('parameters[0].default');
      expect(withParam({ id: 'a', label: 'A', type: 'font', default: '' })).toContain('parameters[0].default');
    });

    it('checks number ranges', () => {
      expect(withParam({ id: 'a', label: 'A', type: 'number', default: 5, min: 10, max: 1 })).toContain('parameters[0].min');
      expect(withParam({ id: 'a', label: 'A', type: 'number', default: 5, min: 10 })).toContain('parameters[0].default');
      expect(withParam({ id: 'a', label: 'A', type: 'number', default: 5, max: 1 })).toContain('parameters[0].default');
      expect(withParam({ id: 'a', label: 'A', type: 'number', default: 5, step: 0 })).toContain('parameters[0].step');
      expect(withParam({ id: 'a', label: 'A', type: 'number', default: Number.NaN })).toContain('parameters[0].default');
    });

    it('checks select options', () => {
      expect(withParam({ id: 'a', label: 'A', type: 'select', default: 'x', options: [] })).toContain('parameters[0].options');
      expect(
        withParam({ id: 'a', label: 'A', type: 'select', default: 'z', options: [{ value: 'x', label: 'X' }] }),
      ).toContain('parameters[0].default');
      expect(
        withParam({
          id: 'a',
          label: 'A',
          type: 'select',
          default: 'x',
          options: [
            { value: 'x', label: 'X' },
            { value: 'x', label: 'Again' },
          ],
        }),
      ).toContain('parameters[0].options[1].value');
    });

    it('validates image slots: a box inside the frame, fit, align, margin and a text fallback; no default', () => {
      const slot = (over: Record<string, unknown> = {}) => ({ id: 'logo', type: 'image', label: 'Logo', box: { x: 0.1, y: 0.7, width: 0.2, height: 0.2 }, ...over });
      const name = { id: 'name', type: 'text', label: 'Name', default: 'Acme' };
      const ok = validateManifest(rawManifest({ parameters: [name, slot({ fallbackText: 'name' })] }));
      expect(ok.ok).toBe(true);
      if (!ok.ok) return;
      const logo = ok.manifest.parameters[1]!;
      // Defaults filled, so every reader sees a complete slot.
      expect(logo).toMatchObject({ type: 'image', default: null, fit: 'contain', align: 'center', margin: 0, fallbackText: 'name' });
      // Per-aspect boxes, with a "default".
      expect(errorPaths(rawManifest({ parameters: [slot({ box: { '16:9': { x: 0, y: 0, width: 0.5, height: 0.5 }, '9:16': { x: 0, y: 0, width: 1, height: 0.3 }, default: { x: 0, y: 0, width: 1, height: 1 } } })] }))).toEqual([]);
      // What is refused.
      expect(withParam(slot({ default: 'abcdefabcdefabcdefabcdef' }))).toContain('parameters[0].default');
      expect(withParam(slot({ box: { x: 0.9, y: 0, width: 0.2, height: 0.2 } }))).toContain('parameters[0].box');
      expect(withParam(slot({ box: { wide: { x: 0, y: 0, width: 1, height: 1 } } }))).toContain('parameters[0].box.wide');
      expect(withParam(slot({ box: undefined }))).toContain('parameters[0].box');
      expect(withParam(slot({ fit: 'stretch' }))).toContain('parameters[0].fit');
      expect(withParam(slot({ align: 'middle' }))).toContain('parameters[0].align');
      expect(withParam(slot({ margin: 0.6 }))).toContain('parameters[0].margin');
      // The fallback must name a text parameter of this template.
      expect(errorPaths(rawManifest({ parameters: [slot({ fallbackText: 'nope' })] }))).toContain('parameters[0].fallbackText');
      expect(errorPaths(rawManifest({ parameters: [{ id: 'n', type: 'number', label: 'N', default: 1 }, slot({ fallbackText: 'n' })] }))).toContain('parameters[1].fallbackText');
    });

    it('rejects duplicate parameter ids', () => {
      const p = { id: 'a', label: 'A', type: 'boolean', default: true };
      expect(errorPaths(rawManifest({ parameters: [p, p] }))).toContain('parameters[1].id');
    });
  });
});

describe('parseManifest', () => {
  it('reports JSON syntax errors as validation errors', () => {
    const result = parseManifest('{ "formatVersion": 1, ');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.message).toMatch(/invalid JSON/);
  });

  it('parses valid JSON text', () => {
    expect(parseManifest(JSON.stringify(rawManifest())).ok).toBe(true);
  });
});

describe('helpers', () => {
  it('frameCount rounds duration to whole frames, minimum 1', () => {
    expect(frameCount({ duration: 2, fps: 30 })).toBe(60);
    expect(frameCount({ duration: 1.5, fps: 29.97 })).toBe(45);
    expect(frameCount({ duration: 0.001, fps: 30 })).toBe(1);
  });

  it('isSafeRelativePath', () => {
    expect(isSafeRelativePath('a/b.html')).toBe(true);
    expect(isSafeRelativePath('a/../../b.html')).toBe(false);
    expect(isSafeRelativePath('..\\b.html')).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
  });
});
