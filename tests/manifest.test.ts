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
