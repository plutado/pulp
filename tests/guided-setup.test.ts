/**
 * Guided setup (milestone 14): the wizard's pure model — the steps, the
 * purposes a template is offered, how an answer seeds the rest, what the
 * preview shows, the sentences the summary says and the result the Output tab
 * applies.
 */

import { describe, expect, it } from 'vitest';
import {
  aspectName, defaultGuidedChoices, GUIDED_STEPS, guidedPlatforms, guidedPreviewBackdrop, guidedPurposes,
  guidedSize, guidedSoundLines, guidedSummary, withPurpose,
} from '../src/core/guided-setup';
import { ASSET_OUTPUT_PRESETS } from '../src/core/output-defaults';
import { PLATFORM_PRESETS } from '../src/core/platform-presets';
import { validManifest } from './fixtures';

const manifest = () => validManifest(); // alpha, 1920 × 1080, category title → 16:9 only
const wide = () => validManifest({ category: 'lower-third', aspects: ['16:9', '9:16'], width: undefined, height: undefined });

describe('the walk', () => {
  it('is five steps: purpose, shape, format, sound, summary', () => {
    expect(GUIDED_STEPS.map((s) => s.id)).toEqual(['purpose', 'shape', 'format', 'sound', 'summary']);
    for (const step of GUIDED_STEPS) expect(step.title.length).toBeGreaterThan(0);
  });

  it('offers the kind presets that fit, then a social post, then by hand', () => {
    const purposes = guidedPurposes(wide());
    expect(purposes.map((p) => p.id)).toEqual(['transparent-overlay', 'editor-safe', 'web-alpha', 'social', 'custom']);
    // An opaque title fits no kind preset; the walk still offers the other two answers.
    expect(guidedPurposes(validManifest({ alpha: false })).map((p) => p.id)).toEqual(['social', 'custom']);
  });

  it('starts from the template: its shape, alpha deciding the format, the mix and no matte', () => {
    const choices = defaultGuidedChoices(manifest());
    expect(choices).toMatchObject({ purpose: 'custom', presetId: 'prores-4444', aspect: '16:9', matte: false, stems: 'mix' });
    expect(defaultGuidedChoices(validManifest({ alpha: false })).presetId).toBe('h264-mp4');
  });
});

describe('an answer seeds the rest', () => {
  it('a kind preset brings its format, background and matte', () => {
    const seeded = withPurpose(defaultGuidedChoices(manifest()), manifest(), 'editor-safe');
    expect(seeded).toMatchObject({ purpose: 'editor-safe', presetId: 'h264-mp4', background: '#000000', matte: true });
    expect(ASSET_OUTPUT_PRESETS.some((p) => p.id === 'editor-safe')).toBe(true);
  });

  it('a platform brings its shape, size, rate and format — held to a shape the template draws', () => {
    const m = wide();
    const tiktok = withPurpose(defaultGuidedChoices(m), m, 'social', 'tiktok');
    expect(tiktok).toMatchObject({ purpose: 'social', platform: 'tiktok', presetId: 'h264-mp4', aspect: '9:16', width: 1080, height: 1920, fps: 30 });
    // A template that does not draw the platform's shape keeps its own.
    const narrow = withPurpose(defaultGuidedChoices(manifest()), manifest(), 'social', 'tiktok');
    expect(narrow.aspect).toBe('16:9');
    expect(narrow.width).toBeUndefined();
    expect(guidedPlatforms().map((p) => p.id)).toEqual(PLATFORM_PRESETS.map((p) => p.id));
  });

  it('choosing by hand clears a platform but keeps the rest', () => {
    const m = wide();
    const social = withPurpose(defaultGuidedChoices(m), m, 'social', 'tiktok');
    const custom = withPurpose(social, m, 'custom');
    expect(custom.platform).toBeUndefined();
    expect(custom.presetId).toBe('h264-mp4');
  });
});

describe('the live preview and the sizes', () => {
  it('resolves the chosen size as the render would, and falls back to the aspect when the size is wrong', () => {
    const m = wide();
    expect(guidedSize(m, { ...defaultGuidedChoices(m), aspect: '9:16' })).toEqual({ aspect: '9:16', width: 1080, height: 1920 });
    expect(guidedSize(m, { ...defaultGuidedChoices(m), width: 17, height: 9 })).toEqual({ aspect: '16:9', width: 1920, height: 1080 });
  });

  it('shows the checkerboard while the transparency is kept, the flatten color once it is dropped', () => {
    const m = manifest();
    expect(guidedPreviewBackdrop(m, defaultGuidedChoices(m))).toBe('checker');
    expect(guidedPreviewBackdrop(m, { ...defaultGuidedChoices(m), presetId: 'h264-mp4' })).toBe('color');
    const opaque = validManifest({ alpha: false });
    expect(guidedPreviewBackdrop(opaque, defaultGuidedChoices(opaque))).toBe('opaque');
  });
});

describe('what the walk says', () => {
  it('the sound step reports the template, the layers and the stems, and never asks what the Parameters tab owns', () => {
    const silent = guidedSoundLines({ sound: undefined }, { hasStems: false, hasLayerSound: false });
    expect(silent[0]).toContain('Nothing here makes sound yet');
    const full = guidedSoundLines(
      { sound: { variants: [{ value: 'a', label: 'A', file: 'a.wav' }, { value: 'b', label: 'B', file: 'b.wav' }] } },
      { hasStems: true, hasLayerSound: true },
    );
    expect(full[0]).toContain('2 variations');
    expect(full.some((l) => l.includes('stems'))).toBe(true);
    expect(full[full.length - 1]).toContain('.wav');
  });

  it('the summary says the format, the size and rate, the transparency, the matte, the platform and the stems', () => {
    const m = wide();
    const choices = { ...withPurpose(defaultGuidedChoices(m), m, 'social', 'tiktok'), matte: true, stems: 'files' as const };
    const lines = guidedSummary(m, choices, { hasStems: true });
    expect(lines[0]).toContain('H.264 MP4');
    expect(lines[1]).toContain('1080 × 1920');
    expect(lines[1]).toContain('30 fps');
    expect(lines.some((l) => l.includes('flattened over #000000'))).toBe(true);
    expect(lines.some((l) => l.includes('matte'))).toBe(true);
    expect(lines.some((l) => l.includes('TikTok'))).toBe(true);
    expect(lines.some((l) => l.includes('one file each beside it'))).toBe(true);
    // Keeping alpha is said as what it is for.
    const kept = guidedSummary(m, defaultGuidedChoices(m));
    expect(kept.some((l) => l.includes('transparency is kept'))).toBe(true);
  });
});

describe('the names the walk says', () => {
  it('names the shapes as a person says them', () => {
    expect(aspectName('16:9')).toBe('Wide');
    expect(aspectName('9:16')).toBe('Vertical');
    expect(aspectName('1:1')).toBe('Square');
    expect(aspectName('4:5')).toBe('Portrait');
  });
});
