import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/core/manifest';
import { applyPreset, diffFromDefaults, presetFileName, sanitizePresetFile } from '../src/core/param-presets';
import { rawManifest } from './fixtures';

const manifest = (() => {
  const r = parseManifest(JSON.stringify(rawManifest()));
  if (!r.ok) throw new Error('fixture manifest invalid');
  return r.manifest;
})();

describe('parameter presets', () => {
  it('stores only values that differ from the defaults', () => {
    expect(diffFromDefaults(manifest, {})).toEqual({});
    expect(diffFromDefaults(manifest, { title: 'Hello' })).toEqual({}); // equals the default
    expect(diffFromDefaults(manifest, { title: 'Bye', size: '50', color: '#FF0000' })).toEqual({ title: 'Bye' });
    expect(diffFromDefaults(manifest, { size: 75, shadow: true, nope: 1 })).toEqual({ size: 75, shadow: true });
  });

  it('applies a preset, dropping parameters the template no longer has', () => {
    expect(applyPreset(manifest, { title: 'Bye', removedParam: 'x', size: 75 })).toEqual({ title: 'Bye', size: 75 });
  });

  it('keeps a chosen length, and drops it for a template that no longer declares one', () => {
    // A length is not a parameter, but it rides with them so a preset carries it (milestone 30).
    const kept = diffFromDefaults(manifest, { '@length': 20 });
    expect(kept['@length']).toBe(20);
    expect(applyPreset(manifest, { '@length': 20, nonsense: 1 })).toEqual({ '@length': 20 });
    // Nothing chosen, nothing stored.
    expect(diffFromDefaults(manifest, {})['@length']).toBeUndefined();
  });

  it('keeps the layer stacks, an audio layer\'s sound among them (milestone 48)', () => {
    // Layers ride with the parameters, so a preset keeps the music the person placed.
    const stacks = { strap: [{ id: 'music', type: 'audio', sound: { id: 'snd1', ending: 'loop', volume: 0.4, fadeOut: 2 } }] };
    const stored = diffFromDefaults(manifest, { '@layers': stacks });
    expect(stored['@layers']).toEqual(stacks);
    expect(applyPreset(manifest, { '@layers': stacks, nonsense: 1 })).toEqual({ '@layers': stacks });
  });

  it('keeps a layer\'s keyframes, since they ride on the layer (milestone 51)', () => {
    const stacks = { strap: [{ id: 'title', type: 'text', keys: [{ at: 0, dx: -0.2, dy: 0, scale: 1, rotate: 0, opacity: 1, easing: 'linear' }, { at: 2, dx: 0.2, dy: 0, scale: 2, rotate: 90, opacity: 0.5, easing: 'hold' }] }] };
    expect(diffFromDefaults(manifest, { '@layers': stacks })['@layers']).toEqual(stacks);
    expect(applyPreset(manifest, { '@layers': stacks })).toEqual({ '@layers': stacks });
  });

  it('sanitizes a preset file', () => {
    expect(sanitizePresetFile(null, 't')).toEqual({ templateId: 't', presets: {} });
    expect(sanitizePresetFile({ presets: { ' Show A ': { title: 'A' }, '': { title: 'x' }, bad: 3, list: [1] } }, 't')).toEqual({
      templateId: 't',
      presets: { 'Show A': { title: 'A' } },
    });
    expect(presetFileName('pulp.samples.lower-third-bar')).toBe('pulp.samples.lower-third-bar.json');
    expect(presetFileName('weird/id')).toBe('weird_id.json');
  });
});
