/**
 * Motion presets (milestone 55's third piece): built from nothing new — a
 * transition and keyframes — written whole onto a layer and read back to the
 * preset they match.
 */

import { describe, expect, it } from 'vitest';
import { sanitizeKeys } from '../src/core/layer-keys';
import { LAYER_TRANSITIONS, TRANSITION_DIRECTIONS } from '../src/core/layer-time';
import { DEFAULT_TYPOGRAPHY, newLayer, type Layer, type TextLayer } from '../src/core/layers';
import {
  applyMotionPreset, DRIFT_DISTANCE, MOTION_PRESET_IDS, MOTION_PRESETS, motionPresetOf, presetKeys, PRESET_TRANSITIONS, PULSE_SCALE,
} from '../src/core/motion-presets';

const block = { typography: DEFAULT_TYPOGRAPHY, align: 'left' as const };
const line = (): Layer => ({ ...(newLayer('text', block, 'who') as TextLayer), text: 'Ada' });
const window = { start: 1, end: 5 };

describe('what a preset writes', () => {
  it('is a transition the format knows, and keys that survive sanitizing as they are', () => {
    for (const id of MOTION_PRESET_IDS) {
      const t = PRESET_TRANSITIONS[id];
      for (const end of [t.in, t.out]) {
        expect(LAYER_TRANSITIONS).toContain(end.type);
        expect(TRANSITION_DIRECTIONS).toContain(end.direction);
      }
      const keys = presetKeys(id, window);
      expect(sanitizeKeys(keys)).toEqual(keys);
      for (const k of keys) {
        expect(k.at).toBeGreaterThanOrEqual(window.start);
        expect(k.at).toBeLessThanOrEqual(window.end);
      }
    }
  });

  it('drifts across the window, pulses in its middle, and spins in over its first beat', () => {
    const drift = presetKeys('drift', window);
    expect(drift.map((k) => [k.at, k.dx])).toEqual([[1, -DRIFT_DISTANCE / 2], [5, DRIFT_DISTANCE / 2]]);
    expect(drift.every((k) => k.easing === 'linear')).toBe(true);
    const pulse = presetKeys('pulse', window);
    expect(pulse.map((k) => [k.at, k.scale])).toEqual([[1, 1], [3, PULSE_SCALE], [5, 1]]);
    const spin = presetKeys('spin-in', window);
    expect(spin[0]).toMatchObject({ at: 1, rotate: -90, scale: 0.6, opacity: 0, easing: 'ease-out' });
    expect(spin[1]).toMatchObject({ at: 1.6, rotate: 0, scale: 1, opacity: 1 });
    // A short window still lands: the spin settles by half way.
    expect(presetKeys('spin-in', { start: 0, end: 0.4 })[1]!.at).toBe(0.2);
    // The entrance-and-exit presets write no keys.
    for (const id of ['still', 'fade', 'slide-left', 'slide-right', 'rise', 'pop', 'wipe'] as const) expect(presetKeys(id, window)).toEqual([]);
  });
});

describe('applying one', () => {
  it('replaces the transition and the keys whole, and folds a faded look into keyed opacity', () => {
    const shaped: Layer = { ...line(), transition: { in: { type: 'wipe', seconds: 2, direction: 'top' }, out: { type: 'none', seconds: 0.5, direction: 'auto' } }, keys: presetKeys('pulse', window), look: { ...(applyMotionPreset(line(), 'fade', window).look ?? {}), opacity: 0.5 } as Layer['look'] };
    const drifting = applyMotionPreset(shaped, 'drift', window);
    expect(drifting.transition).toEqual(PRESET_TRANSITIONS.drift);
    expect(drifting.keys).toEqual(presetKeys('drift', window));
    const popped = applyMotionPreset(drifting, 'pop', window);
    expect(popped.transition).toEqual(PRESET_TRANSITIONS.pop);
    expect(popped.keys).toBeUndefined();
    expect((popped as TextLayer).text).toBe('Ada');
  });

  it('leaves a sound alone: it has no motion to give', () => {
    const sound = newLayer('audio', block, 'music');
    expect(applyMotionPreset(sound, 'drift', window)).toBe(sound);
    expect(motionPresetOf(sound, window)).toBe('custom');
  });
});

describe('reading a layer back', () => {
  it('names the preset it carries, the template while it rides it, and custom for a hand-shaped motion', () => {
    expect(motionPresetOf(line(), window)).toBe('template');
    for (const preset of MOTION_PRESETS) expect(motionPresetOf(applyMotionPreset(line(), preset.id, window), window), preset.id).toBe(preset.id);
    const slower = applyMotionPreset(line(), 'fade', window);
    slower.transition = { ...slower.transition!, in: { ...slower.transition!.in, seconds: 2 } };
    expect(motionPresetOf(slower, window)).toBe('custom');
    const moved = applyMotionPreset(line(), 'drift', window);
    expect(motionPresetOf(moved, { start: 0, end: 5 })).toBe('custom');
    const keyedOnly: Layer = { ...line(), keys: presetKeys('pulse', window) };
    expect(motionPresetOf(keyedOnly, window)).toBe('custom');
  });
});
