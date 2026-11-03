/**
 * Output defaults per type and the one-click presets per kind of asset
 * (milestone 14): what settings.json holds, read defensively, and which
 * presets a template is offered.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSET_OUTPUT_PRESETS, assetPresetsFor, sanitizeTypeOutputDefault, sanitizeTypeOutputDefaults,
} from '../src/core/output-defaults';
import { OUTPUT_PRESETS } from '../src/core/render-plan';
import { isBuiltInType } from '../src/core/taxonomy';

describe('a type\'s remembered default', () => {
  it('keeps only usable fields: a real preset, a built-in aspect, a paired size, a bounded rate', () => {
    const d = sanitizeTypeOutputDefault({
      presetId: 'h264-mp4', aspect: '9:16', width: 1080, height: 1920, fps: 30, background: '#FFFFFF', matte: true, junk: 1,
    });
    expect(d).toEqual({ presetId: 'h264-mp4', aspect: '9:16', width: 1080, height: 1920, fps: 30, background: '#ffffff', matte: true });
  });

  it('is nothing without a preset it knows, and drops what is out of range field by field', () => {
    expect(sanitizeTypeOutputDefault({ presetId: 'not-a-preset' })).toBeNull();
    expect(sanitizeTypeOutputDefault('h264-mp4')).toBeNull();
    const d = sanitizeTypeOutputDefault({ presetId: 'prores-4444', aspect: '3:7', width: 1080, fps: 999, background: 'red', matte: 'yes' });
    expect(d).toEqual({ presetId: 'prores-4444' });
  });

  it('keeps only built-in types in the settings map', () => {
    const map = sanitizeTypeOutputDefaults({
      'lower-third': { presetId: 'prores-4444' },
      'no-such-type': { presetId: 'h264-mp4' },
      'title': 'broken',
    });
    expect(Object.keys(map)).toEqual(['lower-third']);
  });
});

describe('the one-click presets per kind of asset', () => {
  it('names a real output preset each, with a built-in applies-to', () => {
    for (const preset of ASSET_OUTPUT_PRESETS) {
      expect(preset.choices.presetId in OUTPUT_PRESETS, preset.id).toBe(true);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.tip.length).toBeGreaterThan(0);
    }
    expect(new Set(ASSET_OUTPUT_PRESETS.map((p) => p.id)).size).toBe(ASSET_OUTPUT_PRESETS.length);
  });

  it('offers the alpha presets to what draws on alpha, and the background one to backgrounds', () => {
    const lowerThird = assetPresetsFor({ alpha: true, category: 'lower-third' });
    expect(lowerThird.map((p) => p.id)).toEqual(['transparent-overlay', 'editor-safe', 'web-alpha']);
    const opaqueBackground = assetPresetsFor({ alpha: false, category: 'background' });
    expect(opaqueBackground.map((p) => p.id)).toEqual(['full-screen-background']);
    // A background drawn on alpha can be both things, so it is offered both kinds.
    const alphaBackground = assetPresetsFor({ alpha: true, category: 'background' });
    expect(alphaBackground.map((p) => p.id)).toEqual(['transparent-overlay', 'editor-safe', 'full-screen-background', 'web-alpha']);
    // An opaque title gets no alpha preset and is not a background: nothing fits, the row hides.
    expect(assetPresetsFor({ alpha: false, category: 'title' })).toEqual([]);
  });

  it('remembers under type ids the taxonomy knows, so every badge of the kind can find its default', () => {
    // The guard the settings map leans on: the categories the catalogue names map to built-in types.
    expect(isBuiltInType('lower-third')).toBe(true);
    expect(isBuiltInType('animated-loop')).toBe(true);
  });
});
