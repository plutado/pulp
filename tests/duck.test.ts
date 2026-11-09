/**
 * Music that dips under a voice (milestone 80): the setting as it is stored,
 * the voice's levels, where it speaks, the gain curve the preview plays and
 * the `volume` expression the render writes — held to agree with each other,
 * since what is heard while playing must be what renders.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUCK, DUCK_HOLD_SECONDS, DUCK_RELEASE_FACTOR, duckFloor, duckFromText, duckGainAt, duckPoints, duckToText, duckVolumeFilter,
  LEVEL_RATE, LEVEL_STEP_SECONDS, levelArgs, levelsFromPcm, sanitizeDuck, speakingAt, voiceThreshold, VOICE_FLOOR, type ResolvedDuck,
} from '../src/core/duck';
import { applyDucks, layerAudioChain, layerGainAt, resolveDuck, voiceSpans, type SoundAudioLayer } from '../src/core/layer-audio';
import { EMPTY_SOUND, sanitizeSoundValue, soundValueFromText, soundValueToText, type SoundValue } from '../src/core/sound-layer';

/** Levels for `seconds` of a voice that speaks (at 200 of 255) over the given stretches of its file. */
function levels(seconds: number, speaks: [number, number][], quiet = 0): Uint8Array {
  const out = new Uint8Array(Math.round(seconds / LEVEL_STEP_SECONDS)).fill(quiet);
  for (const [from, to] of speaks) {
    for (let i = Math.round(from / LEVEL_STEP_SECONDS); i < Math.round(to / LEVEL_STEP_SECONDS); i++) out[i] = 200;
  }
  return out;
}

const sound = (over: Partial<SoundValue> = {}): SoundValue => ({ ...EMPTY_SOUND, id: 'snd', ...over });
const layer = (over: Partial<SoundValue> = {}, duration = 10, path = '/lib/a.wav'): SoundAudioLayer => ({ kind: 'sound', path, value: sound(over), source: { duration } });

/**
 * The render's expression evaluated the way ffmpeg would, for the few
 * functions it uses — so the test reads the number the filter computes rather
 * than trusting that it was built from the same points.
 */
function evalVolume(filter: string, t: number): number {
  const expr = /^volume='(.*)':eval=frame$/.exec(filter)![1]!;
  const fn = new Function('t', 'if_', 'lt', 'clip', `return ${expr.replace(/\bif\(/g, 'if_(')};`) as (
    t: number, if_: (c: number, a: number, b: number) => number, lt: (a: number, b: number) => number, clip: (v: number, lo: number, hi: number) => number,
  ) => number;
  return fn(t, (c, a, b) => (c ? a : b), (a, b) => (a < b ? 1 : 0), (v, lo, hi) => Math.min(hi, Math.max(lo, v)));
}

describe('the setting', () => {
  it('is read from anything, held to its range, and needs a layer to dip under', () => {
    expect(sanitizeDuck({ under: 'stack.voice' })).toEqual({ under: 'stack.voice', ...DEFAULT_DUCK });
    expect(sanitizeDuck({ under: 'stack.voice', depth: 90, speed: 0 })).toEqual({ under: 'stack.voice', depth: 40, speed: 0.05 });
    expect(sanitizeDuck({ under: '' })).toBeUndefined();
    expect(sanitizeDuck({ under: 'a b' })).toBeUndefined();
    expect(sanitizeDuck({ depth: 6 })).toBeUndefined();
    expect(sanitizeDuck('stack.voice')).toBeUndefined();
  });

  it('travels with a sound value, in its object form and its short text form', () => {
    const duck = { under: 'stack.voice', depth: 9, speed: 0.4 };
    expect(sanitizeSoundValue({ id: 'm', duck })?.duck).toEqual(duck);
    expect(sanitizeSoundValue({ id: 'm' })).not.toHaveProperty('duck');
    expect(duckFromText(duckToText(duck))).toEqual(duck);
    const text = soundValueToText(sound({ duck }));
    expect(text).toBe('snd duck=stack.voice|9|0.4');
    expect(soundValueFromText(text)?.duck).toEqual(duck);
  });
});

describe('a voice\'s levels', () => {
  it('are the loudest sample in every fiftieth of a second, as a byte', () => {
    const per = LEVEL_RATE * LEVEL_STEP_SECONDS;
    const pcm = new Uint8Array(per * 3 * 2);
    const view = new DataView(pcm.buffer);
    view.setInt16(10 * 2, 16384, true); // half scale in the first step
    view.setInt16((per * 2 + 5) * 2, -32768, true); // full scale, negative, in the third
    expect([...levelsFromPcm(pcm)]).toEqual([128, 0, 255]);
    expect(levelArgs('/v.wav')).toEqual(['-v', 'error', '-i', '/v.wav', '-vn', '-ac', '1', '-ar', String(LEVEL_RATE), '-f', 's16le', '-']);
  });

  it('count as speech a tenth under the voice\'s own loudest, never under the floor', () => {
    expect(voiceThreshold(levels(1, [[0, 0.5]]))).toBe(20);
    expect(voiceThreshold(new Uint8Array(10).fill(10))).toBe(VOICE_FLOOR);
    const l = levels(2, [[0.5, 1]], 5);
    expect(speakingAt(l, 20, 0.2)).toBe(false);
    expect(speakingAt(l, 20, 0.7)).toBe(true);
    expect(speakingAt(l, 20, 5)).toBe(false);
  });
});

describe('where the voice speaks', () => {
  it('is found on the graphic\'s clock: through the voice\'s delay and its in point', () => {
    const voice = layer({ id: 'v', inPoint: 1, delay: 2 });
    const spans = voiceSpans([{ layer: voice, levels: levels(10, [[1.5, 2.5]]) }], 8);
    // File 1.5-2.5 s, played from 1 s in after a 2 s delay: the graphic's 2.5-3.5 s.
    expect(spans).toHaveLength(1);
    expect(spans[0]!.from).toBeCloseTo(2.5, 5);
    expect(spans[0]!.to).toBeCloseTo(3.5, 5);
  });

  it('is nowhere when the voice is muted, or outside its span', () => {
    const l = levels(10, [[1, 2]]);
    expect(voiceSpans([{ layer: layer({ id: 'v', muted: true }), levels: l }], 8)).toEqual([]);
    expect(voiceSpans([{ layer: { ...layer({ id: 'v' }), span: { start: 3, end: null } }, levels: l }], 8)).toEqual([]);
  });

  it('dips each music layer naming a voice, and never one under itself', () => {
    const music = layer({ id: 'm', duck: { under: 'stack.voice', depth: 12, speed: 0.25 } }, 10, '/m.wav');
    const self = layer({ id: 'm2', duck: { under: 'stack.self', depth: 12, speed: 0.25 } }, 10, '/m2.wav');
    const voice = layer({ id: 'v' }, 10, '/v.wav');
    applyDucks(
      [{ key: 'stack.music', layer: music }, { key: 'stack.self', layer: self }, { key: 'stack.voice', layer: voice }],
      (l) => (l.path === '/v.wav' ? levels(10, [[1, 2]]) : levels(10, [[0, 10]])),
      6,
    );
    expect(music.duck?.spans.map((s) => [Math.round(s.from * 100) / 100, Math.round(s.to * 100) / 100])).toEqual([[1, 2]]);
    expect(self.duck).toBeUndefined();
    expect(voice.duck).toBeUndefined();
  });

  it('a voice that cannot be measured dips nothing', () => {
    const music = layer({ id: 'm', duck: { under: 'stack.voice', depth: 12, speed: 0.25 } });
    applyDucks([{ key: 'stack.music', layer: music }, { key: 'stack.voice', layer: layer({ id: 'v' }) }], () => null, 6);
    expect(music.duck?.spans).toEqual([]);
    expect(duckVolumeFilter(music.duck)).toBeNull();
  });
});

describe('the dip', () => {
  const duck: ResolvedDuck = { depth: 12, speed: 0.2, spans: [{ from: 1, to: 2 }] };
  const floor = duckFloor(12);

  it('goes down just before the voice, holds while it speaks, and comes back after at half the pace', () => {
    expect(floor).toBeCloseTo(0.2512, 3);
    expect(duckGainAt(duck, 0.5)).toBe(1);
    expect(duckGainAt(duck, 0.9)).toBeCloseTo((1 + floor) / 2, 5);
    expect(duckGainAt(duck, 1)).toBeCloseTo(floor, 5);
    expect(duckGainAt(duck, 1.5)).toBeCloseTo(floor, 5);
    const release = 0.2 * DUCK_RELEASE_FACTOR;
    expect(duckGainAt(duck, 2 + release / 2)).toBeCloseTo((1 + floor) / 2, 5);
    expect(duckGainAt(duck, 2 + release)).toBe(1);
    expect(duckGainAt(duck, 5)).toBe(1);
    expect(duckGainAt(undefined, 1.5)).toBe(1);
  });

  it('stays down through a pause too short to come back from, and comes back between long ones', () => {
    const gap = 0.2 + 0.2 * DUCK_RELEASE_FACTOR + DUCK_HOLD_SECONDS;
    const short = { ...duck, spans: [{ from: 1, to: 2 }, { from: 2 + gap - 0.05, to: 4 }] };
    expect(duckPoints(short)).toHaveLength(4);
    expect(duckGainAt(short, 2 + gap / 2)).toBeCloseTo(floor, 5);
    const long = { ...duck, spans: [{ from: 1, to: 2 }, { from: 2 + gap + 0.5, to: 4 }] };
    expect(duckPoints(long)).toHaveLength(8);
    expect(duckGainAt(long, 2 + 0.2 * DUCK_RELEASE_FACTOR + 0.1)).toBe(1);
  });

  it('is the same number in the render\'s expression as in the preview, everywhere', () => {
    const many: ResolvedDuck = { depth: 18, speed: 0.1, spans: [{ from: 0.05, to: 0.6 }, { from: 2, to: 2.4 }, { from: 4, to: 6.5 }] };
    const filter = duckVolumeFilter(many)!;
    expect(filter).toMatch(/^volume='.*':eval=frame$/);
    for (let t = 0; t <= 8; t += 0.037) expect(evalVolume(filter, t), `at ${t}`).toBeCloseTo(duckGainAt(many, t), 6);
  });
});

describe('in the mix', () => {
  it('rides on the layer\'s volume and fades, in the preview\'s gain and in the render\'s chain', () => {
    const voice = layer({ id: 'v' });
    const music: SoundAudioLayer = layer({ id: 'm', volume: 0.5, duck: { under: 'stack.voice', depth: 12, speed: 0.2 } });
    music.duck = resolveDuck(music.value.duck!, [{ layer: voice, levels: levels(10, [[1, 2]]) }], 6);
    expect(layerGainAt(music, 0.5, 6)).toBeCloseTo(0.5, 5);
    expect(layerGainAt(music, 1.5, 6)).toBeCloseTo(0.5 * duckFloor(12), 5);
    const chain = layerAudioChain(1, music, 'la0', 6);
    // After the volume and the fades, on the graphic's clock.
    expect(chain).toMatch(/volume=0\.5,.*volume='if\(/);
    expect(chain.endsWith(`:eval=frame[la0]`)).toBe(true);
    // A layer with no dip writes no such step.
    expect(layerAudioChain(1, layer({ id: 'm', volume: 0.5 }), 'la0', 6)).not.toContain('eval=frame');
  });
});
