import { validateManifest, type TemplateManifest } from '../src/core/manifest';

/** A minimal valid manifest as raw JSON-like data. */
export function rawManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'test.basic-title',
    name: 'Basic Title',
    version: '1.0.0',
    license: 'CC0-1.0',
    category: 'title',
    tags: ['Title', 'minimal'],
    duration: 2,
    fps: 30,
    width: 1920,
    height: 1080,
    alpha: true,
    parameters: [
      { id: 'title', type: 'text', label: 'Title', default: 'Hello', maxLength: 10 },
      { id: 'color', type: 'color', label: 'Color', default: '#FF0000' },
      { id: 'size', type: 'number', label: 'Size', default: 50, min: 10, max: 100, step: 5 },
      { id: 'shadow', type: 'boolean', label: 'Shadow', default: false },
      {
        id: 'align',
        type: 'select',
        label: 'Align',
        default: 'left',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
      },
      { id: 'font', type: 'font', label: 'Font', default: 'Georgia, serif', options: ['Georgia, serif', 'Arial, sans-serif'] },
    ],
    ...overrides,
  };
}

/** The timing and shape slice of a manifest: 2 s at 30 fps, a declared 1920 × 1080 (so 16:9). */
/** A validated manifest from `rawManifest`, for tests that need the normalized shape (aspects, size) rather than raw input. */
export function validManifest(overrides: Record<string, unknown> = {}): TemplateManifest {
  const result = validateManifest(rawManifest(overrides));
  if (!result.ok) throw new Error(`fixture manifest is invalid: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return result.manifest;
}

export function timing(overrides: Partial<TemplateManifest> = {}) {
  return { fps: 30, duration: 2, alpha: true, aspects: ['16:9'], size: { width: 1920, height: 1080 }, ...overrides };
}

/** The size `timing()` declares, for frame states built from it. */
export const FIXTURE_SIZE = { width: 1920, height: 1080 };
