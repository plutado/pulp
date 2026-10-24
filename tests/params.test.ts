import { describe, expect, it } from 'vitest';
import { validateManifest, type TemplateManifest } from '../src/core/manifest';
import { defaultParams, resolveParams } from '../src/core/params';
import { rawManifest } from './fixtures';

function manifest(): TemplateManifest {
  const result = validateManifest(rawManifest());
  if (!result.ok) throw new Error('fixture invalid');
  return result.manifest;
}

describe('image parameters', () => {
  const withSlot = () => {
    const raw = rawManifest({ parameters: [{ id: 'name', type: 'text', label: 'Name', default: 'Acme' }, { id: 'logo', type: 'image', label: 'Logo', box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, fallbackText: 'name' }] });
    const result = validateManifest(raw);
    if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    return result.manifest;
  };
  const id = 'abcdefabcdefabcdefabcdef';

  it('default to no image, take a library id or a value object, and refuse anything else', () => {
    const m = withSlot();
    expect(defaultParams(m).logo).toBeNull();
    expect(resolveParams(m, { logo: id }).values.logo).toEqual({ id, treatment: 'original', tint: '#ffffff', effect: 'none' });
    expect(resolveParams(m, { logo: { id, treatment: 'tinted', tint: '#FF8800', effect: 'glow' } }).values.logo).toEqual({ id, treatment: 'tinted', tint: '#ff8800', effect: 'glow' });
    // Unknown treatments and effects fall back on their own; a bad tint falls back to white.
    expect(resolveParams(m, { logo: { id, treatment: 'sepia', tint: 'red', effect: 'blur' } }).values.logo).toEqual({ id, treatment: 'original', tint: '#ffffff', effect: 'none' });
    for (const bad of ['/Users/dana/logo.png', 'nope', 42, { id: '../x' }, { treatment: 'white' }]) {
      const r = resolveParams(m, { logo: bad });
      expect(r.values.logo, String(bad)).toBeNull();
      expect(r.issues.map((i) => i.id)).toContain('logo');
    }
    expect(resolveParams(m, { logo: '' }).values.logo).toBeNull();
    expect(resolveParams(m, { logo: null }).values.logo).toBeNull();
  });
});

describe('resolveParams', () => {
  it('returns defaults when no input is given', () => {
    expect(defaultParams(manifest())).toEqual({
      title: 'Hello',
      color: '#FF0000',
      size: 50,
      shadow: false,
      align: 'left',
      font: 'Georgia, serif',
    });
  });

  it('accepts valid overrides without issues', () => {
    const { values, issues } = resolveParams(manifest(), {
      title: 'Hi',
      color: '#00FF00AA',
      size: 75,
      shadow: true,
      align: 'right',
      font: 'Arial, sans-serif',
    });
    expect(issues).toEqual([]);
    expect(values).toEqual({ title: 'Hi', color: '#00ff00aa', size: 75, shadow: true, align: 'right', font: 'Arial, sans-serif' });
  });

  it('falls back to defaults for wrong types and reports each', () => {
    const { values, issues } = resolveParams(manifest(), {
      title: 42,
      color: 'blue',
      size: 'big',
      shadow: 'yes',
      align: 'center',
      font: 'Comic Sans',
    });
    expect(values).toEqual(defaultParams(manifest()));
    expect(issues.map((i) => i.id).sort()).toEqual(['align', 'color', 'font', 'shadow', 'size', 'title']);
  });

  it('truncates text to maxLength and flattens newlines in single-line text', () => {
    const { values, issues } = resolveParams(manifest(), { title: 'line one\nline two' });
    expect(values.title).toBe('line one l');
    expect(issues).toEqual([{ id: 'title', message: 'truncated to 10 characters' }]);
  });

  it('coerces numeric strings, snaps to step and clamps to range', () => {
    expect(resolveParams(manifest(), { size: '62' }).values.size).toBe(60);
    expect(resolveParams(manifest(), { size: 63 }).values.size).toBe(65);
    expect(resolveParams(manifest(), { size: 500 }).values.size).toBe(100);
    expect(resolveParams(manifest(), { size: -3 }).values.size).toBe(10);
    expect(resolveParams(manifest(), { size: 55 }).issues).toEqual([]);
  });

  it('avoids floating point noise when snapping', () => {
    const m = { parameters: [{ id: 'x', type: 'number' as const, label: 'X', default: 0.1, min: 0, step: 0.1 }] };
    expect(resolveParams(m, { x: 0.30000000000000004 }).values.x).toBe(0.3);
  });

  it('accepts "true"/"false" strings for booleans', () => {
    expect(resolveParams(manifest(), { shadow: 'true' }).values.shadow).toBe(true);
    expect(resolveParams(manifest(), { shadow: 'false' }).values.shadow).toBe(false);
  });

  it('ignores unknown keys but reports them', () => {
    const { values, issues } = resolveParams(manifest(), { nope: 1 });
    expect(values).not.toHaveProperty('nope');
    expect(issues).toEqual([{ id: 'nope', message: 'unknown parameter; ignored' }]);
  });

  it('does not treat inherited object properties as input', () => {
    const input = Object.create({ title: 'inherited' }) as Record<string, unknown>;
    expect(resolveParams(manifest(), input).values.title).toBe('Hello');
  });
});
