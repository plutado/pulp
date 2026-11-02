/**
 * The template's own sound (milestone 16): the manifest field, the choice that
 * rides with the parameters, and the timing that keeps the sound with the
 * picture when a length stretches or scales the template.
 */

import { describe, expect, it } from 'vitest';
import { validateManifest } from '../src/core/manifest';
import { diffFromDefaults, applyPreset } from '../src/core/param-presets';
import { soundIn, SOUND_KEY, splitLayers, withSound } from '../src/core/params';
import {
  resolveTemplateSoundChoice,
  TEMPLATE_SOUND_NONE,
  templateSoundTiming,
  templateSoundValue,
  validateTemplateSound,
  wipeSoundValue,
  type TemplateSound,
} from '../src/core/template-sound';
import { rawManifest } from './fixtures';

const SOUND: TemplateSound = {
  variants: [
    { value: 'soft', label: 'Soft swoosh', file: 'sounds/soft.wav' },
    { value: 'sharp', label: 'Sharp swoosh', file: 'sounds/sharp.wav', gain: 0.8 },
  ],
  default: 'soft',
};

describe('validateTemplateSound', () => {
  const read = (raw: unknown, duration = 2) => {
    const errors: { path: string; message: string }[] = [];
    const sound = validateTemplateSound(raw, duration, errors);
    return { sound, errors };
  };

  it('accepts variants with safe audio files and normalizes them', () => {
    const { sound, errors } = read({ variants: [{ value: 'soft', label: ' Soft ', file: 'sounds/soft.WAV', gain: 0.5 }], default: 'soft', at: 1 });
    expect(errors).toEqual([]);
    expect(sound).toEqual({ variants: [{ value: 'soft', label: 'Soft', file: 'sounds/soft.WAV', gain: 0.5 }], default: 'soft', at: 1 });
  });

  it('refuses a missing or empty variants list', () => {
    expect(read({}).errors[0]!.path).toBe('sound.variants');
    expect(read({ variants: [] }).errors[0]!.path).toBe('sound.variants');
    expect(read('swoosh').errors[0]!.path).toBe('sound');
  });

  it('refuses unsafe paths, wrong extensions, duplicate and reserved values', () => {
    const variant = (over: Record<string, unknown>) => ({ value: 'a', label: 'A', file: 'a.wav', ...over });
    expect(read({ variants: [variant({ file: '../a.wav' })] }).errors[0]!.path).toBe('sound.variants[0].file');
    expect(read({ variants: [variant({ file: '/a.wav' })] }).errors[0]!.path).toBe('sound.variants[0].file');
    expect(read({ variants: [variant({ file: 'a.txt' })] }).errors[0]!.path).toBe('sound.variants[0].file');
    expect(read({ variants: [variant({ value: TEMPLATE_SOUND_NONE })] }).errors[0]!.path).toBe('sound.variants[0].value');
    expect(read({ variants: [variant({}), variant({ label: 'B', file: 'b.wav' })] }).errors[0]!.path).toBe('sound.variants[1].value');
    expect(read({ variants: [variant({ gain: 2 })] }).errors[0]!.path).toBe('sound.variants[0].gain');
  });

  it('holds the default to the variant values or "none", and `at` inside the duration', () => {
    const variants = [{ value: 'a', label: 'A', file: 'a.wav' }];
    expect(read({ variants, default: 'b' }).errors[0]!.path).toBe('sound.default');
    expect(read({ variants, default: TEMPLATE_SOUND_NONE }).sound?.default).toBe(TEMPLATE_SOUND_NONE);
    expect(read({ variants, at: 3 }, 2).errors[0]!.path).toBe('sound.at');
    expect(read({ variants, at: -1 }).errors[0]!.path).toBe('sound.at');
  });

  it('rides through validateManifest as `sound`, counted among the known fields', () => {
    const result = validateManifest({ ...rawManifest(), sound: { variants: SOUND.variants, default: 'soft' } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.sound).toEqual({ variants: SOUND.variants, default: 'soft' });
      expect(result.warnings).toEqual([]);
    }
  });

  it('is refused by validateManifest when broken, with a path under sound', () => {
    const result = validateManifest({ ...rawManifest(), sound: { variants: [{ value: 'a', label: 'A', file: '../x.wav' }] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path === 'sound.variants[0].file')).toBe(true);
  });
});

describe('resolveTemplateSoundChoice', () => {
  it('answers the chosen variant, silence for "none", and the default otherwise', () => {
    expect(resolveTemplateSoundChoice(SOUND, 'sharp')?.value).toBe('sharp');
    expect(resolveTemplateSoundChoice(SOUND, TEMPLATE_SOUND_NONE)).toBeNull();
    expect(resolveTemplateSoundChoice(SOUND, undefined)?.value).toBe('soft');
    expect(resolveTemplateSoundChoice(SOUND, 'no-such')?.value).toBe('soft');
  });

  it('falls back to the first variant without a default, and to silence when the default is "none"', () => {
    expect(resolveTemplateSoundChoice({ variants: SOUND.variants }, undefined)?.value).toBe('soft');
    expect(resolveTemplateSoundChoice({ variants: SOUND.variants, default: TEMPLATE_SOUND_NONE }, undefined)).toBeNull();
    expect(resolveTemplateSoundChoice({ variants: SOUND.variants, default: TEMPLATE_SOUND_NONE }, 'sharp')?.value).toBe('sharp');
  });
});

describe('templateSoundTiming', () => {
  it('is the identity with no structure or at the designed length', () => {
    expect(templateSoundTiming(2, null, 10, 0.5)).toEqual({ delay: 0.5, speed: 1 });
    expect(templateSoundTiming(6, { kind: 'hold', holdFrom: 1, holdTo: 5 }, 6, 2)).toEqual({ delay: 2, speed: 1 });
  });

  it('scales a transition\'s sound with its picture, pitch kept', () => {
    // A 2 s transition asked for 1 s plays twice as fast; a start half way through stays half way.
    expect(templateSoundTiming(2, { kind: 'scale' }, 1, 1)).toEqual({ delay: 0.5, speed: 2 });
    expect(templateSoundTiming(2, { kind: 'scale' }, 4, 0)).toEqual({ delay: 0, speed: 0.5 });
  });

  it('moves a held template\'s sound with the part it sits in', () => {
    const hold = { kind: 'hold', holdFrom: 1, holdTo: 5 } as const;
    // In the entrance: untouched. In the exit: pushed out by the stretch. In the hold: its share.
    expect(templateSoundTiming(6, hold, 10, 0.5)).toEqual({ delay: 0.5, speed: 1 });
    expect(templateSoundTiming(6, hold, 10, 5.5)).toEqual({ delay: 9.5, speed: 1 });
    expect(templateSoundTiming(6, hold, 10, 3)).toEqual({ delay: 5, speed: 1 });
  });

  it('plays a loop\'s sound once, where its first pass would', () => {
    expect(templateSoundTiming(2, { kind: 'loop' }, 9, 0.25)).toEqual({ delay: 0.25, speed: 1 });
  });
});

describe('templateSoundValue and wipeSoundValue', () => {
  it('builds a once-through sound at the variant\'s gain, retimed by the structure', () => {
    const manifest = { duration: 2, structure: { kind: 'scale' } as const };
    const made = templateSoundValue({ variants: SOUND.variants, at: 0.5 }, SOUND.variants[1]!, manifest, 1);
    expect(made.value.id).toBe('sounds/sharp.wav');
    expect(made.value.ending).toBe('once');
    expect(made.value.volume).toBe(0.8);
    expect(made.value.delay).toBe(0.25);
    expect(made.speed).toBe(2);
  });

  it('leaves the speed off when the sound plays as recorded', () => {
    const made = templateSoundValue(SOUND, SOUND.variants[0]!, { duration: 2 }, 2);
    expect(made.speed).toBeUndefined();
    expect(made.value.volume).toBe(1);
  });

  it('spreads a wipe\'s default sound over the transition, centred on the join', () => {
    const made = wipeSoundValue(SOUND, { duration: 1.5 }, { at: 4, seconds: 0.5 });
    expect(made).not.toBeNull();
    expect(made!.value.id).toBe('sounds/soft.wav');
    expect(made!.value.delay).toBe(3.75);
    expect(made!.speed).toBe(3);
  });

  it('answers nothing for a wipe whose template defaults to silence', () => {
    expect(wipeSoundValue({ variants: SOUND.variants, default: TEMPLATE_SOUND_NONE }, { duration: 1.5 }, { at: 4, seconds: 0.5 })).toBeNull();
  });
});

describe('the @sound passenger', () => {
  it('rides in the bag, is read back, and never reaches parameter resolution', () => {
    const raw = withSound({ title: 'Hello' }, 'sharp');
    expect(soundIn(raw)).toBe('sharp');
    expect(splitLayers(raw).params).toEqual({ title: 'Hello' });
    expect(soundIn(withSound(raw, undefined))).toBeUndefined();
  });

  it('is kept by presets, both saved and applied', () => {
    const manifest = validateManifest(rawManifest());
    if (!manifest.ok) throw new Error('fixture manifest should be valid');
    const stored = diffFromDefaults(manifest.manifest, { [SOUND_KEY]: 'sharp' });
    expect(stored[SOUND_KEY]).toBe('sharp');
    expect(applyPreset(manifest.manifest, stored)[SOUND_KEY]).toBe('sharp');
  });
});
