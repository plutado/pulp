/**
 * Voice treatments (milestone 53): each named treatment is a fixed recipe of
 * ffmpeg filters scaled by its amount, and the preview, the meter and the
 * render all build the same chain from it — so these tests pin the recipes
 * string for string. A drifted number here is a treatment that sounds
 * different from what was shipped, the kind of thing only a test catches.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_AMOUNT, sanitizeVoice, VOICE_DESCRIPTIONS, VOICE_LABELS, VOICE_TREATMENTS,
  voiceFromText, voiceSteps, voiceToText,
} from '../src/core/voice-treatment';

describe('the recipes', () => {
  it('builds the filter graph each treatment says, at full amount', () => {
    expect(voiceSteps({ treatment: 'clean-voice', amount: 1 })).toEqual([
      'highpass=f=80',
      'afftdn=nr=12:nf=-30',
      'acompressor=threshold=0.125:ratio=2:attack=20:release=250:makeup=1.4',
      'equalizer=f=3000:t=q:w=1:g=2.5',
      'deesser=i=0.35',
    ]);
    expect(voiceSteps({ treatment: 'podcast', amount: 1 })).toEqual([
      'highpass=f=90',
      'afftdn=nr=10:nf=-30',
      'acompressor=threshold=0.1:ratio=3:attack=15:release=200:makeup=1.6',
      'bass=g=1.5:f=130',
      'equalizer=f=3500:t=q:w=1:g=3',
      'deesser=i=0.4',
    ]);
    expect(voiceSteps({ treatment: 'reduce-noise', amount: 1 })).toEqual([
      'highpass=f=60',
      'afftdn=nr=30:nf=-25',
    ]);
    expect(voiceSteps({ treatment: 'phone', amount: 1 })).toEqual([
      'highpass=f=310',
      'lowpass=f=3400',
      'acompressor=threshold=0.0625:ratio=4:attack=10:release=150:makeup=1.8',
    ]);
    expect(voiceSteps({ treatment: 'radio', amount: 1 })).toEqual([
      'highpass=f=120',
      'lowpass=f=9000',
      'afftdn=nr=8:nf=-30',
      'acompressor=threshold=0.09:ratio=4:attack=5:release=150:makeup=1.8',
      'equalizer=f=3200:t=q:w=1:g=4',
      'deesser=i=0.3',
    ]);
    expect(voiceSteps({ treatment: 'warm', amount: 1 })).toEqual([
      'highpass=f=50',
      'bass=g=4:f=150',
      'treble=g=-2.5:f=8000',
      'acompressor=threshold=0.125:ratio=2:attack=25:release=300:makeup=1.2',
    ]);
  });

  it('scales every parameter toward untouched as the amount falls, and emits nothing at zero', () => {
    expect(voiceSteps({ treatment: 'clean-voice', amount: 0.5 })).toEqual([
      'highpass=f=50',
      'afftdn=nr=6:nf=-40',
      'acompressor=threshold=0.125:ratio=1.5:attack=20:release=250:makeup=1.2',
      'equalizer=f=3000:t=q:w=1:g=1.25',
      'deesser=i=0.18',
    ]);
    // A phone at a tenth barely narrows the band: the limits head home, not to silence.
    expect(voiceSteps({ treatment: 'phone', amount: 0.1 })).toEqual([
      'highpass=f=49',
      'lowpass=f=18340',
      'acompressor=threshold=0.0625:ratio=1.3:attack=10:release=150:makeup=1.08',
    ]);
    expect(voiceSteps({ treatment: 'clean-voice', amount: 0 })).toEqual([]);
    expect(voiceSteps(undefined)).toEqual([]);
  });

  it('has a label and a one-line description for every treatment, which is where it is chosen', () => {
    for (const t of VOICE_TREATMENTS) {
      expect(VOICE_LABELS[t].length).toBeGreaterThan(2);
      expect(VOICE_DESCRIPTIONS[t].length).toBeGreaterThan(20);
    }
  });

  it('never needs quoting: fixed numbers and names only', () => {
    for (const t of VOICE_TREATMENTS) {
      for (const step of voiceSteps({ treatment: t, amount: 0.37 })) {
        expect(step, step).toMatch(/^[a-z]+=[a-z0-9=.:_-]+$/i);
      }
    }
  });
});

describe('the value', () => {
  it('sanitizes from anything at all: a bare name, a clamped amount, nothing from nonsense', () => {
    expect(sanitizeVoice('podcast')).toEqual({ treatment: 'podcast', amount: DEFAULT_VOICE_AMOUNT });
    expect(sanitizeVoice({ treatment: 'warm', amount: 0.333 })).toEqual({ treatment: 'warm', amount: 0.33 });
    expect(sanitizeVoice({ treatment: 'warm', amount: 7 })).toEqual({ treatment: 'warm', amount: 1 });
    expect(sanitizeVoice({ treatment: 'warm', amount: -1 })).toEqual({ treatment: 'warm', amount: 0 });
    expect(sanitizeVoice({ treatment: 'reverb' })).toBeUndefined();
    expect(sanitizeVoice(null)).toBeUndefined();
    expect(sanitizeVoice(42)).toBeUndefined();
  });

  it('writes the text form short and reads it back', () => {
    expect(voiceToText({ treatment: 'reduce-noise', amount: 1 })).toBe('reduce-noise');
    expect(voiceToText({ treatment: 'phone', amount: 0.6 })).toBe('phone:0.6');
    expect(voiceFromText('reduce-noise')).toEqual({ treatment: 'reduce-noise', amount: 1 });
    expect(voiceFromText('phone:0.6')).toEqual({ treatment: 'phone', amount: 0.6 });
    expect(voiceFromText('nonsense')).toBeUndefined();
    expect(voiceFromText('phone:nonsense')).toEqual({ treatment: 'phone', amount: 1 });
  });
});
