/**
 * Audio layers (milestone 48): which moment of a sound file belongs to a
 * moment of the graphic. The preview and the render both ask this, so a
 * mistake here shows as music that plays at one place on the stage and
 * another in the file that is written — the kind of thing only a test catches.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_SOUND, sanitizeSoundValue, soundAudible, soundIdsInLayers, SOUND_LIMITS, soundPassSeconds,
  soundTimeAt, soundValueFromText, soundValueToText, soundWindow, type SoundSource, type SoundValue,
} from '../src/core/sound-layer';

/** A ten-second file. */
const source: SoundSource = { duration: 10 };
const sound = (over: Partial<SoundValue> = {}): SoundValue => ({ ...EMPTY_SOUND, id: 'abc', ...over });

describe('the window a value selects', () => {
  it('is the whole file until an in or an out point says otherwise', () => {
    expect(soundWindow(sound(), source)).toEqual({ from: 0, to: 10, seconds: 10 });
    expect(soundWindow(sound({ inPoint: 2 }), source)).toEqual({ from: 2, to: 10, seconds: 8 });
    expect(soundWindow(sound({ inPoint: 2, outPoint: 6 }), source)).toEqual({ from: 2, to: 6, seconds: 4 });
  });

  it('is held to what the file holds, and to nothing at all when the points cross', () => {
    expect(soundWindow(sound({ outPoint: 99 }), source)).toEqual({ from: 0, to: 10, seconds: 10 });
    expect(soundWindow(sound({ inPoint: 99 }), source)).toEqual({ from: 10, to: 10, seconds: 0 });
    // In at or past out leaves nothing to play; silence beats guessing what was meant.
    expect(soundWindow(sound({ inPoint: 6, outPoint: 4 }), source).seconds).toBe(0);
    // A file the library has not measured has no window yet.
    expect(soundWindow(sound(), { duration: 0 })).toEqual({ from: 0, to: 0, seconds: 0 });
  });

  it('says how long one pass runs for', () => {
    expect(soundPassSeconds(sound(), source)).toBe(10);
    expect(soundPassSeconds(sound({ inPoint: 1, outPoint: 4 }), source)).toBe(3);
  });
});

describe('where a moment of the graphic lands in the file', () => {
  it('runs from the in point, offset by the start delay', () => {
    expect(soundTimeAt(0, sound(), source)).toBe(0);
    expect(soundTimeAt(2.5, sound(), source)).toBeCloseTo(2.5, 9);
    expect(soundTimeAt(0, sound({ inPoint: 4 }), source)).toBeCloseTo(4, 9);
    expect(soundTimeAt(1, sound({ inPoint: 4 }), source)).toBeCloseTo(5, 9);
    // Before the delay there is nothing to hear.
    expect(soundTimeAt(1, sound({ delay: 3 }), source)).toBeNull();
    expect(soundTimeAt(4, sound({ delay: 3 }), source)).toBeCloseTo(1, 9);
  });

  it('comes round when it loops and stops when it plays once', () => {
    const windowed = sound({ inPoint: 2, outPoint: 4, ending: 'loop' });
    expect(soundTimeAt(0, windowed, source)).toBeCloseTo(2, 9);
    // Two seconds of material: three seconds in is one second into the second pass.
    expect(soundTimeAt(3, windowed, source)).toBeCloseTo(3, 9);
    const once = sound({ inPoint: 2, outPoint: 4, ending: 'once' });
    expect(soundTimeAt(1.5, once, source)).toBeCloseTo(3.5, 9);
    expect(soundTimeAt(2.5, once, source)).toBeNull();
  });

  it('is silent with nothing chosen, hidden, or with an empty window', () => {
    expect(soundTimeAt(1, sound({ id: null }), source)).toBeNull();
    expect(soundTimeAt(1, sound({ hidden: true }), source)).toBeNull();
    expect(soundTimeAt(1, sound({ inPoint: 5, outPoint: 5 }), source)).toBeNull();
    expect(soundTimeAt(Number.NaN, sound(), source)).toBeNull();
  });

  it('says whether the layer asks to be heard at all', () => {
    expect(soundAudible(sound())).toBe(true);
    expect(soundAudible(null)).toBe(false);
    expect(soundAudible({ ...EMPTY_SOUND })).toBe(false); // nothing chosen
    expect(soundAudible(sound({ hidden: true }))).toBe(false);
    expect(soundAudible(sound({ muted: true }))).toBe(false);
    expect(soundAudible(sound({ volume: 0 }))).toBe(false);
  });
});

describe('reading a value from anything at all', () => {
  it('takes a bare id as the whole sound, played once', () => {
    expect(sanitizeSoundValue('abc')).toEqual({ ...EMPTY_SOUND, id: 'abc' });
    expect(sanitizeSoundValue('abc')?.ending).toBe('once');
    expect(sanitizeSoundValue('hidden')).toEqual({ ...EMPTY_SOUND, hidden: true });
    expect(sanitizeSoundValue('')).toBeNull();
    expect(sanitizeSoundValue(null)).toBeNull();
    expect(sanitizeSoundValue(7)).toBeUndefined();
  });

  it('clamps every setting it is given, keeping -1 as "to the end"', () => {
    const value = sanitizeSoundValue({ id: 'x', inPoint: -5, outPoint: -1, delay: 9999, volume: 7, fadeIn: 99, fadeOut: -3, ending: 'nonsense' });
    expect(value).toEqual({
      id: 'x', inPoint: 0, outPoint: -1, ending: 'once', delay: SOUND_LIMITS.delay.max,
      volume: 1, muted: false, fadeIn: SOUND_LIMITS.fade.max, fadeOut: 0, hidden: false,
    });
    // Seconds are kept to the millisecond and volume to the hundredth.
    expect(sanitizeSoundValue({ id: 'x', inPoint: 1.23456 })?.inPoint).toBe(1.235);
    expect(sanitizeSoundValue({ id: 'x', volume: 0.333333 })?.volume).toBe(0.33);
    expect(sanitizeSoundValue({ id: 'x', ending: 'loop' })?.ending).toBe('loop');
    expect(sanitizeSoundValue({ id: 'x', muted: 'yes' })?.muted).toBe(false);
  });

  it('writes a short form and reads it back unchanged', () => {
    const cases: SoundValue[] = [
      sound(),
      sound({ inPoint: 2, outPoint: 8 }),
      sound({ ending: 'loop', delay: 1.5, volume: 0.4 }),
      sound({ fadeIn: 2, fadeOut: 3 }),
      sound({ muted: true }),
      sound({ voice: { treatment: 'clean-voice', amount: 1 } }),
      sound({ voice: { treatment: 'reduce-noise', amount: 0.4 } }),
      { ...EMPTY_SOUND, hidden: true },
    ];
    for (const value of cases) {
      expect(soundValueFromText(soundValueToText(value)), soundValueToText(value)).toEqual(value);
    }
    // Defaults are left out, so the common case stays readable in a CSV cell.
    expect(soundValueToText(sound())).toBe('abc');
    expect(soundValueToText(sound({ ending: 'loop', fadeOut: 2 }))).toBe('abc ending=loop fadeout=2');
    // A treatment travels too (milestone 53), its amount only when it is not the whole of it.
    expect(soundValueToText(sound({ voice: { treatment: 'phone', amount: 0.6 } }))).toBe('abc voice=phone:0.6');
    expect(sanitizeSoundValue({ id: 'x', voice: { treatment: 'warm', amount: 0.5 } })?.voice).toEqual({ treatment: 'warm', amount: 0.5 });
    expect(sanitizeSoundValue({ id: 'x', voice: 'reverb' })?.voice).toBeUndefined();
    expect(soundValueToText(null)).toBe('');
    expect(soundValueFromText('')).toBeNull();
    // Junk between the fields is ignored rather than failing the row.
    expect(soundValueFromText('abc ending=loop what volume=')).toMatchObject({ id: 'abc', ending: 'loop', volume: 1 });
  });
});

describe('the sounds a set of stacks names', () => {
  it('finds every chosen one, ignores the hidden and whatever is not a sound', () => {
    expect(soundIdsInLayers({
      strap: [{ id: 'music', sound: 'zzz' }, { id: 'vo', sound: { id: 'aaa' } }],
      card: [{ id: 'quiet', sound: { id: 'bbb', hidden: true } }, { id: 'text' }, 'not a layer'],
    })).toEqual(['aaa', 'zzz']);
    expect(soundIdsInLayers(null)).toEqual([]);
    expect(soundIdsInLayers({ strap: 'not a stack' })).toEqual([]);
    // The same sound on two layers is named once.
    expect(soundIdsInLayers({ a: [{ sound: 'one' }], b: [{ sound: 'one' }] })).toEqual(['one']);
  });
});
