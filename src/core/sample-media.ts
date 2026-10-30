/**
 * The sample-media catalogue (milestone 21): original CC0 media files that a
 * library can be filled with on demand, so the browse tree's media types —
 * video clips, stills, music, sound effects — and the picture-friendly types
 * among the backgrounds, overlays and design elements are each at least six
 * deep (milestone 24), without a single binary file in the repository.
 *
 * Every item says where it goes (folders whose names give the file its type
 * through the same inference the library scan uses), what it is called, which
 * type it is meant to be, and how it is made:
 *
 * - **audio**: an ffmpeg `lavfi` source graph (aevalsrc expressions, anoisesrc)
 *   and an optional filter chain, written as 48 kHz 16-bit WAV. Everything is
 *   synthesized from tones, noise and envelopes; nothing is recorded.
 * - **still**: a canvas page (`sample-stills.ts`) drawn by the offscreen
 *   renderer, written as PNG or JPEG.
 * - **clip**: one of the bundled background templates rendered to H.264.
 *
 * This module is pure. The main-process service runs the recipes; the tests
 * check the catalogue against the type inference and the six-deep floor.
 */

import { STILL_PAGES } from './sample-stills';
import { normalizeTag } from './tags';
import { inferMediaType } from './taxonomy';
import type { MediaKind } from './library-types';

export const SAMPLE_MEDIA_FOLDER_NAME = 'Sample media';

export type SampleRecipe =
  | { kind: 'audio'; graph: string; filters?: string; seconds: number; channels?: 1 | 2 }
  | { kind: 'still'; page: keyof typeof STILL_PAGES; variant: string; format: 'png' | 'jpg'; width: number; height: number }
  | { kind: 'clip'; templateId: string; seconds: number; width: number; height: number }
  /**
   * An asset (milestone 26): an isolated element drawn on transparency by a canvas page over
   * the clip's own time, written as a transparent WebM or a PNG still. `loop` says the last
   * frame meets the first, which is what makes a flame or a wisp of steam usable on a long shot.
   */
  | { kind: 'asset'; page: keyof typeof STILL_PAGES; variant: string; format: 'webm' | 'png'; width: number; height: number; seconds: number; fps: number; loop: boolean };

export interface SampleMediaItem {
  /** Folder segments under the sample-media root, as shown ("Sound effects", "Whooshes"). */
  folder: readonly string[];
  /** File name with extension. */
  file: string;
  /** The taxonomy type the folders are meant to give the file. */
  type: string;
  /** One line about what it is, for the README. */
  note: string;
  recipe: SampleRecipe;
}

// ---------------------------------------------------------------------------
// Expression helpers. ffmpeg's expression language: sin, exp, pow, mod, between,
// min, max, if, lt, gt, st/ld (variables 0-9) and random(i) (a deterministic
// pseudo-random stream seeded from variable i). Everything below builds strings
// of it; `t` is the time in seconds within the source.

const SR = 48000;

/** Assets are generated at this rate: smooth enough to read, cheap enough to make on demand. */
const ASSET_FPS = 24;
const NOISE = '(random(0)-0.5)*2';
const NOISE2 = '(random(1)-0.5)*2';

function num(x: number): string {
  // Plain decimals only: the expression parser does not take exponent notation.
  return Number.isInteger(x) ? String(x) : x.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/** 1 between start and start+len, with an attack ramp and an exponential decay from the start. */
function env(start: number, len: number, attack: number, decay: number, time = 't'): string {
  const s = num(start);
  return `between(${time},${s},${num(start + len)})*min(1,(${time}-${s})/${num(Math.max(attack, 0.0005))})*exp(-${num(decay)}*(${time}-${s}))`;
}

/** A sine, optionally with the first harmonics, at `f` Hz. */
function tone(f: number, harmonics = 1, time = 't'): string {
  const parts: string[] = [];
  for (let h = 1; h <= harmonics; h++) parts.push(`sin(2*PI*${num(f * h)}*${time})/${h}`);
  return `(${parts.join('+')})`;
}

/** A bell-shaped loudness curve centred at `c` with width `w` seconds. */
function bell(c: number, w: number): string {
  return `exp(-pow((t-${num(c)})/${num(w)},2))`;
}

function midi(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** aevalsrc source graph for one or two channel expressions. */
function evalSrc(exprs: string | [string, string], seconds: number): string {
  const e = Array.isArray(exprs) ? exprs.join('|') : exprs;
  return `aevalsrc='${e}':s=${SR}:d=${num(seconds)}`;
}

function audio(graph: string, seconds: number, filters?: string, channels: 1 | 2 = 1): SampleRecipe {
  return { kind: 'audio', graph, seconds, channels, ...(filters ? { filters } : {}) };
}

// ---------------------------------------------------------------------------
// Music: one small sequencer that writes kick, hat, bass, pad and lead as
// expressions over a looping bar count, so a full mix and its stems come from
// the same material.

interface Song {
  bpm: number;
  /** Bass notes (MIDI), one per beat, looped. */
  bass: number[];
  /** Pad chord (MIDI). */
  chord: number[];
  /** Lead notes (MIDI, 0 for a rest), one per half beat, looped. */
  lead: number[];
  seconds: number;
}

function songParts(song: Song, padTime = 't'): { kick: string; hat: string; bass: string; pad: string; lead: string; master: string } {
  const beat = 60 / song.bpm;
  const loop = beat * song.bass.length;
  // st(5): position in the beat; st(6): position in the half beat; st(7): position in the loop.
  const setup = `st(5,mod(t,${num(beat)}))*0+st(6,mod(t,${num(beat / 2)}))*0+st(7,mod(t,${num(loop)}))*0`;
  const kick = `${setup}+sin(2*PI*(48+110*exp(-35*ld(5)))*ld(5))*exp(-8*ld(5))`;
  const hat = `${setup}+${NOISE}*exp(-70*ld(6))*(0.5+0.5*gt(mod(t,${num(beat)}),${num(beat / 2 - 0.01)}))`;
  const bassTerms = song.bass.map((m, i) => {
    const start = i * beat;
    return `${env(start, beat, 0.01, 2.5, 'ld(7)')}*${tone(midi(m), 3, 't')}`;
  });
  const bass = `${setup}+(${bassTerms.join('+')})`;
  const padTones = song.chord.map((m) => `sin(2*PI*${num(midi(m))}*${padTime})`).join('+');
  const pad = `(${padTones})/${song.chord.length}*(0.65+0.35*sin(2*PI*0.2*t))*min(1,t/1.5)`;
  const half = beat / 2;
  const leadLoop = half * song.lead.length;
  const leadTerms = song.lead
    .map((m, i) => (m === 0 ? null : `${env(i * half, half * 0.9, 0.005, 6, `mod(t,${num(leadLoop)})`)}*${tone(midi(m), 2)}`))
    .filter((x): x is string => x !== null);
  const lead = `(${leadTerms.join('+')})`;
  const master = `*min(1,t*4)*min(1,(${num(song.seconds)}-t)*1.5)`;
  return { kick, hat, bass, pad, lead, master };
}

function fullMix(song: Song): SampleRecipe {
  // Stereo: the pad is a few milliseconds apart between the channels, which widens it without a second voice.
  const mix = (padTime: string) => {
    const p = songParts(song, padTime);
    return `(0.32*(${p.kick})+0.1*(${p.hat})+0.24*(${p.bass})+0.16*(${p.pad})+0.14*(${p.lead}))${p.master}`;
  };
  return audio(evalSrc([mix('t'), mix('(t+0.003)')], song.seconds), song.seconds, undefined, 2);
}

function stem(song: Song, part: 'drums' | 'bass' | 'pad' | 'lead'): SampleRecipe {
  const p = songParts(song);
  const expr =
    part === 'drums' ? `(0.32*(${p.kick})+0.1*(${p.hat}))` : part === 'bass' ? `0.24*(${p.bass})` : part === 'lead' ? `0.14*(${p.lead})` : `0.16*(${p.pad})`;
  return audio(evalSrc(`${expr}${p.master}`, song.seconds), song.seconds);
}

const NIGHT_DRIVE: Song = { bpm: 120, bass: [45, 45, 48, 43, 45, 45, 50, 48], chord: [57, 60, 64, 67], lead: [69, 0, 72, 0, 76, 0, 72, 69, 0, 0, 67, 0, 69, 0, 0, 0], seconds: 16 };
const BOARDROOM_CALM: Song = { bpm: 84, bass: [41, 41, 48, 48, 46, 46, 43, 43], chord: [53, 57, 60, 65], lead: [72, 0, 0, 76, 0, 0, 77, 0, 0, 0, 76, 0, 72, 0, 0, 0], seconds: 16 };
const MATCHDAY_PULSE: Song = { bpm: 140, bass: [40, 40, 40, 43, 40, 40, 47, 46], chord: [52, 55, 59, 62], lead: [76, 76, 0, 79, 0, 76, 0, 74, 76, 76, 0, 79, 0, 81, 0, 0], seconds: 16 };
// Milestone 24: three more pieces, so Full mix and Stems both reach six.
const FESTIVAL_LIGHTS: Song = { bpm: 104, bass: [43, 43, 50, 48, 45, 45, 52, 50], chord: [55, 59, 62, 66], lead: [74, 0, 78, 0, 81, 0, 78, 74, 0, 71, 0, 74, 0, 0, 0, 0], seconds: 16 };
const QUIET_STUDY: Song = { bpm: 72, bass: [36, 36, 43, 43, 41, 41, 38, 38], chord: [48, 52, 55, 59], lead: [67, 0, 0, 0, 71, 0, 0, 0, 72, 0, 0, 71, 0, 0, 67, 0], seconds: 16 };
const CITY_RUSH: Song = { bpm: 128, bass: [38, 38, 45, 38, 41, 41, 43, 45], chord: [50, 53, 57, 60], lead: [72, 0, 74, 75, 0, 72, 0, 70, 72, 0, 77, 0, 75, 0, 72, 0], seconds: 16 };

// ---------------------------------------------------------------------------
// Sound effects.

function whoosh(center: number, seconds: number, shape: 'sym' | 'reverse'): SampleRecipe {
  const curve = shape === 'sym' ? `pow(sin(PI*t/${num(seconds)}),2)` : `pow(t/${num(seconds)},3)*min(1,(${num(seconds)}-t)*30)`;
  return audio(evalSrc(`${NOISE}*${curve}`, seconds), seconds, `bandpass=f=${center}:width_type=o:w=1.6,volume=0.9`);
}

const SFX: SampleMediaItem[] = [
  // Whooshes: band-passed noise under a shaped envelope, four weights.
  { folder: ['Sound effects', 'Whooshes'], file: 'whoosh-soft.wav', type: 'whoosh', note: 'A soft mid whoosh, one second.', recipe: whoosh(700, 1.0, 'sym') },
  { folder: ['Sound effects', 'Whooshes'], file: 'whoosh-bright.wav', type: 'whoosh', note: 'A bright, quick whoosh.', recipe: whoosh(1800, 0.7, 'sym') },
  { folder: ['Sound effects', 'Whooshes'], file: 'whoosh-low.wav', type: 'whoosh', note: 'A low, slow whoosh.', recipe: whoosh(260, 1.5, 'sym') },
  { folder: ['Sound effects', 'Whooshes'], file: 'whoosh-reverse.wav', type: 'whoosh', note: 'A reverse whoosh that builds to a cut.', recipe: whoosh(900, 1.2, 'reverse') },
  // Impacts: a pitched thud with a noise transient.
  {
    folder: ['Sound effects', 'Impacts'], file: 'impact-deep-hit.wav', type: 'impact', note: 'A deep hit with a short transient.',
    recipe: audio(evalSrc(`sin(2*PI*(52+60*exp(-30*t))*t)*exp(-4*t)*0.6+${NOISE}*exp(-28*t)*0.3`, 1.6), 1.6, 'lowpass=f=1800'),
  },
  {
    folder: ['Sound effects', 'Impacts'], file: 'impact-snap.wav', type: 'impact', note: 'A dry snap.',
    recipe: audio(evalSrc(`${NOISE}*exp(-55*t)*0.5+sin(2*PI*190*t)*exp(-22*t)*0.4`, 0.6), 0.6),
  },
  {
    folder: ['Sound effects', 'Impacts'], file: 'impact-boom.wav', type: 'impact', note: 'A long boom with a slow tail.',
    recipe: audio(evalSrc(`sin(2*PI*(44+30*exp(-10*t))*t)*exp(-2.2*t)*0.65+${NOISE}*exp(-6*t)*0.25`, 3), 3, 'lowpass=f=400'),
  },
  // UI / tech: short tones and clicks.
  { folder: ['Sound effects', 'UI tech'], file: 'ui-click.wav', type: 'ui-tech', note: 'A click.', recipe: audio(evalSrc(`${NOISE}*exp(-180*t)*0.55`, 0.12), 0.12, 'highpass=f=1500') },
  { folder: ['Sound effects', 'UI tech'], file: 'ui-beep.wav', type: 'ui-tech', note: 'A single beep at 880 Hz.', recipe: audio(evalSrc(`${env(0, 0.14, 0.004, 8)}*sin(2*PI*880*t)*0.7`, 0.3), 0.3) },
  {
    folder: ['Sound effects', 'UI tech'], file: 'ui-confirm.wav', type: 'ui-tech', note: 'A rising two-tone confirmation.',
    recipe: audio(evalSrc(`${env(0, 0.12, 0.004, 10)}*sin(2*PI*660*t)*0.7+${env(0.11, 0.2, 0.004, 9)}*sin(2*PI*990*t)*0.7`, 0.45), 0.45),
  },
  {
    folder: ['Sound effects', 'UI tech'], file: 'ui-error.wav', type: 'ui-tech', note: 'A short low error buzz.',
    recipe: audio(evalSrc(`${env(0, 0.3, 0.004, 4)}*${tone(220, 5)}*0.3`, 0.45), 0.45),
  },
  // Alarms.
  {
    folder: ['Sound effects', 'Alarms'], file: 'alarm-two-tone.wav', type: 'alarm', note: 'A two-tone alarm alternating twice a second.',
    recipe: audio(evalSrc(`if(lt(mod(t,0.5),0.25),sin(2*PI*800*t),sin(2*PI*1000*t))*0.6`, 3), 3, 'highpass=f=300'),
  },
  {
    folder: ['Sound effects', 'Alarms'], file: 'alarm-beeper.wav', type: 'alarm', note: 'Eight short beeps.',
    recipe: audio(evalSrc(`lt(mod(t,0.25),0.1)*min(1,mod(t,0.25)*200)*sin(2*PI*1200*t)*0.6`, 2), 2),
  },
  {
    folder: ['Sound effects', 'Alarms'], file: 'alarm-buzzer.wav', type: 'alarm', note: 'A harsh buzzer in half-second bursts.',
    recipe: audio(evalSrc(`lt(mod(t,1),0.5)*${tone(150, 7)}*0.28`, 3), 3),
  },
  // Ambience: shaped noise beds.
  { folder: ['Sound effects', 'Ambience'], file: 'ambience-room-tone.wav', type: 'ambience', note: 'A quiet room tone, eight seconds.', recipe: audio(evalSrc(`${NOISE}*0.2`, 8), 8, 'lowpass=f=240,volume=0.8') },
  {
    folder: ['Sound effects', 'Ambience'], file: 'ambience-wind.wav', type: 'ambience', note: 'Wind rising and falling.',
    recipe: audio(evalSrc(`${NOISE}*(0.5+0.5*sin(2*PI*t/3.7))*(0.6+0.4*sin(2*PI*t/1.3+1))`, 8), 8, 'lowpass=f=420,volume=0.9'),
  },
  { folder: ['Sound effects', 'Ambience'], file: 'ambience-rain.wav', type: 'ambience', note: 'Steady rain.', recipe: audio(evalSrc(`${NOISE}*0.5`, 8), 8, 'highpass=f=1800,lowpass=f=9000,volume=0.9') },
  // Nature / weather.
  { folder: ['Sound effects', 'Nature weather'], file: 'thunder.wav', type: 'nature-weather', note: 'A thunder roll.', recipe: audio(evalSrc(`${NOISE}*${env(0, 5, 0.12, 0.8)}*(0.7+0.3*sin(2*PI*2.3*t))`, 5), 5, 'lowpass=f=130,volume=0.95') },
  { folder: ['Sound effects', 'Nature weather'], file: 'gust.wav', type: 'nature-weather', note: 'A single gust of wind.', recipe: audio(evalSrc(`${NOISE}*${bell(1.5, 0.7)}`, 3), 3, 'lowpass=f=500,volume=0.9') },
  {
    folder: ['Sound effects', 'Nature weather'], file: 'stream.wav', type: 'nature-weather', note: 'Running water.',
    recipe: audio(evalSrc(`${NOISE}*(0.7+0.3*sin(2*PI*13*t)*sin(2*PI*7.3*t))*0.6`, 6), 6, 'bandpass=f=1800:width_type=o:w=2.5,volume=0.9'),
  },
  // Animals: synthesized calls, named as such in the README.
  {
    folder: ['Sound effects', 'Animals'], file: 'cricket-synth.wav', type: 'animals', note: 'A synthesized cricket: trains of 4.2 kHz pulses.',
    recipe: audio(evalSrc(`between(mod(t,1.2),0,0.55)*gt(sin(2*PI*28*t),0)*sin(2*PI*4200*t)*0.35`, 4), 4),
  },
  {
    folder: ['Sound effects', 'Animals'], file: 'bird-chirp-synth.wav', type: 'animals', note: 'A synthesized bird: three sweeping chirps.',
    recipe: audio(evalSrc(`between(mod(t,0.9),0,0.22)*min(1,mod(t,0.9)*80)*sin(2*PI*(2300+900*sin(2*PI*6*t))*t)*0.5`, 2.7), 2.7),
  },
  {
    folder: ['Sound effects', 'Animals'], file: 'frog-synth.wav', type: 'animals', note: 'A synthesized frog: pulsed low croaks.',
    recipe: audio(evalSrc(`between(mod(t,1),0,0.4)*gt(sin(2*PI*30*t),0)*${tone(92, 4)}*0.35`, 3), 3, 'lowpass=f=900'),
  },
  // Vehicles.
  {
    folder: ['Sound effects', 'Vehicles'], file: 'engine-idle.wav', type: 'vehicles', note: 'An idling engine.',
    recipe: audio(evalSrc(`${tone(38, 8)}*(0.8+0.2*sin(2*PI*1.7*t))*0.28+${NOISE}*0.08`, 4), 4, 'lowpass=f=700'),
  },
  {
    folder: ['Sound effects', 'Vehicles'], file: 'pass-by.wav', type: 'vehicles', note: 'A vehicle passing left to right.',
    recipe: audio(
      evalSrc([`${bell(2, 0.9)}*(${NOISE}*0.6+sin(2*PI*(125-18*t)*t)*0.4)*min(1,max(0,(2.6-t)/2))`, `${bell(2, 0.9)}*(${NOISE2}*0.6+sin(2*PI*(125-18*t)*t)*0.4)*min(1,max(0,(t-1.4)/2))`], 4),
      4, 'lowpass=f=900', 2,
    ),
  },
  { folder: ['Sound effects', 'Vehicles'], file: 'siren.wav', type: 'vehicles', note: 'A siren rising and falling.', recipe: audio(evalSrc(`sin(2*PI*(720+200*sin(2*PI*0.7*t))*t)*${bell(2, 1.6)}*0.6`, 4), 4) },
  // Crowd / human.
  { folder: ['Sound effects', 'Crowd'], file: 'crowd-murmur.wav', type: 'crowd', note: 'A room of voices, from shaped noise.', recipe: audio(evalSrc(`${NOISE}*(0.7+0.3*sin(2*PI*0.9*t)*sin(2*PI*2.1*t))*0.5`, 6), 6, 'bandpass=f=700:width_type=o:w=2.2,volume=0.9') },
  {
    folder: ['Sound effects', 'Crowd'], file: 'applause.wav', type: 'crowd', note: 'Applause: dense clicks that swell and thin out.',
    recipe: audio(evalSrc(`${NOISE}*gt(random(1),0.97)*min(1,t*2)*min(1,max(0,(4.5-t)))*0.9`, 4.5), 4.5, 'bandpass=f=1600:width_type=o:w=2,volume=1.2'),
  },
  { folder: ['Sound effects', 'Crowd'], file: 'cheer.wav', type: 'crowd', note: 'A crowd swell.', recipe: audio(evalSrc(`${NOISE}*${bell(1.4, 1)}*0.7`, 3), 3, 'bandpass=f=900:width_type=o:w=1.5,volume=1.1') },
  // Foley / household.
  {
    folder: ['Sound effects', 'Foley'], file: 'knock.wav', type: 'foley', note: 'Three knocks on a door.',
    recipe: audio(evalSrc([0, 0.35, 0.7].map((s) => `${env(s, 0.25, 0.002, 30)}*(${NOISE}*0.4+sin(2*PI*150*t)*0.5)`).join('+'), 1.3), 1.3, 'lowpass=f=600'),
  },
  {
    folder: ['Sound effects', 'Foley'], file: 'footsteps.wav', type: 'foley', note: 'Four footsteps.',
    recipe: audio(evalSrc(`lt(mod(t,0.55),0.06)*exp(-60*mod(t,0.55))*${NOISE}*0.8`, 2.2), 2.2, 'lowpass=f=500'),
  },
  {
    folder: ['Sound effects', 'Foley'], file: 'clock-tick.wav', type: 'foley', note: 'A clock ticking once a second.',
    recipe: audio(evalSrc(`lt(mod(t,1),0.004)*${NOISE}*0.45+${env(0, 0.03, 0.001, 150, 'mod(t,1)')}*sin(2*PI*2100*t)*0.3`, 4), 4, 'highpass=f=800'),
  },
  // Explosion / weapons.
  { folder: ['Sound effects', 'Explosions'], file: 'blast.wav', type: 'explosion', note: 'A blast with a sub tail.', recipe: audio(evalSrc(`${NOISE}*${env(0, 4, 0.01, 1.6)}*0.5+sin(2*PI*40*t)*exp(-1.8*t)*0.45`, 4), 4, 'lowpass=f=260') },
  { folder: ['Sound effects', 'Explosions'], file: 'distant-boom.wav', type: 'explosion', note: 'A boom from far away.', recipe: audio(evalSrc(`${NOISE}*${env(0, 3, 0.2, 1.1)}*0.8`, 3), 3, 'lowpass=f=90,volume=1.3') },
  {
    folder: ['Sound effects', 'Explosions'], file: 'debris.wav', type: 'explosion', note: 'A hit followed by falling debris.',
    recipe: audio(evalSrc(`${NOISE}*exp(-12*t)*0.8+${NOISE2}*gt(random(1),0.985)*${env(0.1, 2.4, 0.05, 1.5)}*0.9`, 2.5), 2.5, 'lowpass=f=3500'),
  },
  // Sci-fi.
  { folder: ['Sound effects', 'Sci-fi'], file: 'laser.wav', type: 'sci-fi', note: 'A descending laser zap.', recipe: audio(evalSrc(`${env(0, 0.3, 0.002, 7)}*sin(2*PI*(2400-3600*t)*t)*0.7`, 0.35), 0.35) },
  {
    folder: ['Sound effects', 'Sci-fi'], file: 'drone.wav', type: 'sci-fi', note: 'A detuned drone.',
    recipe: audio(evalSrc(`(sin(2*PI*55*t)+sin(2*PI*55.6*t)+0.5*sin(2*PI*110.3*t)+0.3*sin(2*PI*164.5*t))/2.3*(0.7+0.3*sin(2*PI*0.15*t))*min(1,t)*min(1,6-t)*0.7`, 6), 6),
  },
  {
    folder: ['Sound effects', 'Sci-fi'], file: 'computer.wav', type: 'sci-fi', note: 'Computer bleeps in a fixed sequence.',
    recipe: audio(
      evalSrc(`st(8,floor(mod(t*8,8)))*0+lt(mod(t*8,1),0.6)*sin(2*PI*if(eq(ld(8),0),1320,if(eq(ld(8),1),990,if(eq(ld(8),2),1760,if(eq(ld(8),3),1175,if(eq(ld(8),4),1480,if(eq(ld(8),5),880,if(eq(ld(8),6),1980,1320)))))))*t)*0.4`, 2),
      2,
    ),
  },
  // Musical phrases.
  {
    folder: ['Sound effects', 'Musical phrases'], file: 'rising-arpeggio.wav', type: 'musical-phrase', note: 'A rising major arpeggio.',
    recipe: audio(evalSrc([60, 64, 67, 72].map((m, i) => `${env(i * 0.18, 1.2, 0.005, 3)}*${tone(midi(m), 2)}*0.3`).join('+'), 2), 2),
  },
  {
    folder: ['Sound effects', 'Musical phrases'], file: 'falling-minor.wav', type: 'musical-phrase', note: 'A falling minor phrase.',
    recipe: audio(evalSrc([72, 70, 67, 63].map((m, i) => `${env(i * 0.26, 1.4, 0.005, 2.5)}*${tone(midi(m), 3)}*0.26`).join('+'), 2.6), 2.6),
  },
  {
    folder: ['Sound effects', 'Musical phrases'], file: 'three-note-ident.wav', type: 'musical-phrase', note: 'A three-note ident with long tails.',
    recipe: audio(evalSrc([76, 72, 67].map((m, i) => `${env(i * 0.4, 2.5, 0.01, 1.4)}*${tone(midi(m), 2)}*0.3`).join('+'), 3.5), 3.5),
  },

  // ---- Milestone 24: three more of each, to take every sound type to six.

  { folder: ['Sound effects', 'Whooshes'], file: 'whoosh-long-sweep.wav', type: 'whoosh', note: 'A long sweep that passes and fades.', recipe: whoosh(1100, 2.2, 'sym') },
  { folder: ['Sound effects', 'Whooshes'], file: 'whoosh-tight.wav', type: 'whoosh', note: 'A tight, close whoosh for a fast cut.', recipe: whoosh(2600, 0.45, 'sym') },
  {
    folder: ['Sound effects', 'Impacts'], file: 'impact-metal-clang.wav', type: 'impact', note: 'A metal clang with a ringing tail.',
    recipe: audio(evalSrc(`(${[523, 784, 1174, 1568].map((f) => tone(f, 2)).join('+')})*exp(-6*t)*0.12+${NOISE}*exp(-60*t)*0.25`, 2.2), 2.2, 'highpass=f=300'),
  },
  {
    folder: ['Sound effects', 'Impacts'], file: 'impact-wood-knock.wav', type: 'impact', note: 'A dry wooden knock.',
    recipe: audio(evalSrc(`sin(2*PI*(240+180*exp(-60*t))*t)*exp(-30*t)*0.5+${NOISE}*exp(-90*t)*0.2`, 0.5), 0.5, 'lowpass=f=4000'),
  },
  {
    folder: ['Sound effects', 'Impacts'], file: 'impact-soft-thud.wav', type: 'impact', note: 'A soft padded thud, no ring.',
    recipe: audio(evalSrc(`sin(2*PI*(70+40*exp(-25*t))*t)*exp(-12*t)*0.55`, 1.0), 1.0, 'lowpass=f=700'),
  },
  {
    folder: ['Sound effects', 'Alarms'], file: 'alarm-klaxon-cycle.wav', type: 'alarm', note: 'A two-tone alarm, four cycles.',
    recipe: audio(evalSrc(`(gt(mod(t,0.8),0.4)*${tone(740)}+lt(mod(t,0.8),0.4)*${tone(590)})*min(1,mod(t,0.4)*40)*0.35`, 3.2), 3.2),
  },
  {
    folder: ['Sound effects', 'Alarms'], file: 'alarm-soft-chime.wav', type: 'alarm', note: 'A gentle three-note attention chime.',
    recipe: audio(evalSrc([72, 76, 79].map((m, i) => `${env(i * 0.28, 2, 0.005, 3)}*${tone(midi(m), 3)}*0.3`).join('+'), 2.6), 2.6),
  },
  {
    folder: ['Sound effects', 'Alarms'], file: 'alarm-warning-pulse.wav', type: 'alarm', note: 'A low warning pulse, urgent and even.',
    recipe: audio(evalSrc(`${tone(220, 2)}*lt(mod(t,0.5),0.25)*min(1,mod(t,0.25)*50)*0.4`, 3), 3, 'lowpass=f=2000'),
  },
  {
    folder: ['Sound effects', 'Ambience'], file: 'ambience-office-hum.wav', type: 'ambience', note: 'A quiet indoor room tone.',
    recipe: audio(evalSrc(`${NOISE}*0.06`, 8), 8, 'lowpass=f=900,highpass=f=60'),
  },
  {
    folder: ['Sound effects', 'Ambience'], file: 'ambience-air-handling.wav', type: 'ambience', note: 'A steady air-handling hum.',
    recipe: audio(evalSrc(`${NOISE}*0.08+${tone(60, 2)}*0.03`, 8), 8, 'lowpass=f=600'),
  },
  {
    folder: ['Sound effects', 'Ambience'], file: 'ambience-distant-traffic.wav', type: 'ambience', note: 'Distant traffic behind a window.',
    recipe: audio(evalSrc(`${NOISE}*(0.07+0.03*sin(2*PI*0.08*t))`, 10), 10, 'lowpass=f=450,highpass=f=40'),
  },
  {
    folder: ['Sound effects', 'Nature weather'], file: 'weather-steady-rain.wav', type: 'nature-weather', note: 'Steady rain with no thunder.',
    recipe: audio(evalSrc(`${NOISE}*0.22`, 10), 10, 'highpass=f=700,lowpass=f=9000'),
  },
  {
    folder: ['Sound effects', 'Nature weather'], file: 'weather-wind-gusts.wav', type: 'nature-weather', note: 'Wind rising and falling in gusts.',
    recipe: audio(evalSrc(`${NOISE}*(0.1+0.14*pow(sin(2*PI*0.09*t),2))`, 10), 10, 'bandpass=f=500:width_type=o:w=2.2'),
  },
  {
    folder: ['Sound effects', 'Nature weather'], file: 'weather-stream.wav', type: 'nature-weather', note: 'A small stream over stones.',
    recipe: audio(evalSrc(`${NOISE}*0.18+${NOISE2}*0.08`, 9), 9, 'highpass=f=900,lowpass=f=7000'),
  },
  {
    folder: ['Sound effects', 'Animals'], file: 'animal-owl-hoot.wav', type: 'animals', note: 'Two owl hoots, night-time.',
    recipe: audio(evalSrc(`(${env(0.1, 0.5, 0.06, 6)}+${env(0.9, 0.5, 0.06, 6)})*${tone(330, 2)}*0.35`, 2), 2, 'lowpass=f=1200'),
  },
  {
    folder: ['Sound effects', 'Animals'], file: 'animal-cricket-field.wav', type: 'animals', note: 'A field of crickets at night.',
    recipe: audio(evalSrc(`${NOISE}*gt(mod(t,0.22),0.17)*0.3`, 8), 8, 'bandpass=f=4200:width_type=o:w=0.5'),
  },
  {
    folder: ['Sound effects', 'Animals'], file: 'animal-frog-chorus.wav', type: 'animals', note: 'A slow frog chorus by water.',
    recipe: audio(evalSrc(`${tone(180, 3)}*gt(mod(t,0.9),0.62)*min(1,mod(t,0.9)*20)*0.3`, 7), 7, 'lowpass=f=1600'),
  },
  {
    folder: ['Sound effects', 'Vehicles'], file: 'vehicle-engine-idle.wav', type: 'vehicles', note: 'An engine idling.',
    recipe: audio(evalSrc(`${tone(55, 4)}*(0.3+0.05*sin(2*PI*7*t))+${NOISE}*0.06`, 6), 6, 'lowpass=f=1100'),
  },
  {
    folder: ['Sound effects', 'Vehicles'], file: 'vehicle-pass-by.wav', type: 'vehicles', note: 'A car passing the microphone.',
    recipe: audio(evalSrc(`(${NOISE}*0.5+${tone(120, 3)}*0.25)*${bell(2, 0.9)}`, 4), 4, 'lowpass=f=3000'),
  },
  {
    folder: ['Sound effects', 'Vehicles'], file: 'vehicle-train-rumble.wav', type: 'vehicles', note: 'A train rumbling past on rails.',
    recipe: audio(evalSrc(`(${NOISE}*0.35+${tone(45, 3)}*0.2)*${bell(3, 1.6)}+${NOISE2}*gt(mod(t,0.5),0.44)*0.12`, 6), 6, 'lowpass=f=2200'),
  },
  {
    folder: ['Sound effects', 'Crowd'], file: 'crowd-small-room.wav', type: 'crowd', note: 'A small room of people talking.',
    recipe: audio(evalSrc(`${NOISE}*(0.12+0.05*sin(2*PI*0.3*t))+${NOISE2}*0.06`, 8), 8, 'bandpass=f=900:width_type=o:w=2.4'),
  },
  {
    folder: ['Sound effects', 'Crowd'], file: 'crowd-stadium-roar.wav', type: 'crowd', note: 'A stadium roar that swells and settles.',
    recipe: audio(evalSrc(`${NOISE}*(0.2+0.3*${bell(3, 1.4)})`, 8), 8, 'bandpass=f=700:width_type=o:w=3'),
  },
  {
    folder: ['Sound effects', 'Crowd'], file: 'crowd-applause-short.wav', type: 'crowd', note: 'A short round of applause.',
    recipe: audio(evalSrc(`${NOISE}*gt(random(2),0.55)*min(1,t*6)*min(1,(4-t)*1.2)*0.4`, 4), 4, 'highpass=f=1200,lowpass=f=8000'),
  },
  {
    folder: ['Sound effects', 'Foley'], file: 'foley-paper-rustle.wav', type: 'foley', note: 'Paper handled and set down.',
    recipe: audio(evalSrc(`${NOISE}*gt(random(3),0.6)*${bell(0.7, 0.45)}*0.4`, 1.6), 1.6, 'highpass=f=1800'),
  },
  {
    folder: ['Sound effects', 'Foley'], file: 'foley-cloth-movement.wav', type: 'foley', note: 'Cloth moving, a single pass.',
    recipe: audio(evalSrc(`${NOISE}*${bell(0.5, 0.3)}*0.35`, 1.2), 1.2, 'bandpass=f=1600:width_type=o:w=1.8'),
  },
  {
    folder: ['Sound effects', 'Foley'], file: 'foley-footstep-wood.wav', type: 'foley', note: 'Four footsteps on a wooden floor.',
    recipe: audio(evalSrc(`${[0, 0.55, 1.1, 1.65].map((s) => `${env(s, 0.25, 0.002, 40)}`).join('+')}*(${NOISE}*0.4+sin(2*PI*160*t)*0.25)`, 2.4), 2.4, 'lowpass=f=3500'),
  },
  {
    folder: ['Sound effects', 'Explosions'], file: 'explosion-distant-boom.wav', type: 'explosion', note: 'A distant boom with a long roll.',
    recipe: audio(evalSrc(`${NOISE}*exp(-2.2*t)*0.5+${tone(42, 2)}*exp(-3*t)*0.3`, 3.5), 3.5, 'lowpass=f=600'),
  },
  {
    folder: ['Sound effects', 'Explosions'], file: 'explosion-debris.wav', type: 'explosion', note: 'A blast with debris falling after it.',
    recipe: audio(evalSrc(`${NOISE}*exp(-6*t)*0.55+${NOISE2}*gt(random(4),0.8)*exp(-1.1*t)*0.3`, 3), 3, 'lowpass=f=5000'),
  },
  {
    folder: ['Sound effects', 'Explosions'], file: 'explosion-crack.wav', type: 'explosion', note: 'A sharp crack, close by.',
    recipe: audio(evalSrc(`${NOISE}*exp(-35*t)*0.5+${tone(90, 2)}*exp(-14*t)*0.2`, 1.4), 1.4),
  },
  {
    folder: ['Sound effects', 'Sci-fi'], file: 'sci-fi-power-down.wav', type: 'sci-fi', note: 'A system powering down.',
    recipe: audio(evalSrc(`sin(2*PI*(900*exp(-0.9*t)+60)*t)*min(1,(2.6-t)*2)*0.35`, 2.6), 2.6, 'lowpass=f=4000'),
  },
  {
    folder: ['Sound effects', 'Sci-fi'], file: 'sci-fi-teleport.wav', type: 'sci-fi', note: 'A shimmering teleport.',
    recipe: audio(evalSrc(`(${tone(880, 3)}+${tone(1320, 2)})*${bell(0.8, 0.5)}*0.2+${NOISE}*${bell(0.8, 0.35)}*0.2`, 2), 2, 'highpass=f=500'),
  },
  {
    folder: ['Sound effects', 'Sci-fi'], file: 'sci-fi-force-field.wav', type: 'sci-fi', note: 'A force field holding and humming.',
    recipe: audio(evalSrc(`(${tone(180, 5)})*(0.25+0.1*sin(2*PI*6*t))+${NOISE}*0.08`, 5), 5, 'bandpass=f=1200:width_type=o:w=2'),
  },
  {
    folder: ['Sound effects', 'UI tech'], file: 'ui-toggle.wav', type: 'ui-tech', note: 'A small toggle click.',
    recipe: audio(evalSrc(`${env(0, 0.1, 0.002, 60)}*${tone(1200, 2)}*0.35`, 0.3), 0.3),
  },
  {
    folder: ['Sound effects', 'UI tech'], file: 'ui-error-two-note.wav', type: 'ui-tech', note: 'A short two-note error.',
    recipe: audio(evalSrc(`${env(0, 0.18, 0.004, 14)}*${tone(330, 2)}*0.4+${env(0.16, 0.3, 0.004, 10)}*${tone(247, 2)}*0.4`, 0.8), 0.8),
  },
  {
    folder: ['Sound effects', 'Musical phrases'], file: 'rising-major.wav', type: 'musical-phrase', note: 'A rising major phrase.',
    recipe: audio(evalSrc([60, 64, 67, 72].map((m, i) => `${env(i * 0.22, 2, 0.008, 2.2)}*${tone(midi(m), 2)}*0.25`).join('+'), 2.6), 2.6),
  },
  {
    folder: ['Sound effects', 'Musical phrases'], file: 'question-phrase.wav', type: 'musical-phrase', note: 'A short phrase that ends unresolved.',
    recipe: audio(evalSrc([65, 69, 71].map((m, i) => `${env(i * 0.26, 1.8, 0.008, 2)}*${tone(midi(m), 2)}*0.28`).join('+'), 2.4), 2.4),
  },
  {
    folder: ['Sound effects', 'Musical phrases'], file: 'resolve-phrase.wav', type: 'musical-phrase', note: 'A phrase that settles onto its root.',
    recipe: audio(evalSrc(`${env(0, 0.6, 0.008, 4)}*${tone(midi(71), 2)}*0.3+${env(0.3, 0.6, 0.008, 4)}*${tone(midi(74), 2)}*0.3+${env(0.6, 2.4, 0.008, 1.2)}*(${[48, 55, 60, 64].map((m) => tone(midi(m), 3)).join('+')})*0.1`, 3.2), 3.2),
  },


  // ---- Milestone 24: themed sounds, in theme folders inside their type folders, so every
  // theme in the tree is at least six deep. The folder gives the file its theme the same way
  // the type folder above it gives it its type.

  // Medical.
  {
    folder: ['Sound effects', 'UI tech', 'Medical'], file: 'monitor-beeps.wav', type: 'ui-tech', note: 'A patient monitor beeping steadily.',
    recipe: audio(evalSrc(`${tone(880, 2)}*lt(mod(t,1),0.09)*min(1,mod(t,1)*80)*0.3`, 6), 6, 'lowpass=f=4000'),
  },
  {
    folder: ['Sound effects', 'Vehicles', 'Medical'], file: 'ambulance-pass.wav', type: 'vehicles', note: 'A two-tone siren passing by.',
    recipe: audio(evalSrc(`(gt(mod(t,1.1),0.55)*${tone(960)}+lt(mod(t,1.1),0.55)*${tone(720)})*${bell(3, 1.5)}*0.4+${NOISE}*${bell(3, 1.2)}*0.1`, 6), 6, 'lowpass=f=5000'),
  },
  {
    folder: ['Sound effects', 'Ambience', 'Medical'], file: 'waiting-room.wav', type: 'ambience', note: 'A quiet waiting room: air, a distant page tone.',
    recipe: audio(evalSrc(`${NOISE}*0.07+${env(3.2, 0.4, 0.01, 6)}*${tone(660, 2)}*0.08`, 8), 8, 'lowpass=f=1400'),
  },

  // Legal.
  {
    folder: ['Sound effects', 'Impacts', 'Legal'], file: 'gavel-raps.wav', type: 'impact', note: 'Three gavel raps on the block.',
    recipe: audio(evalSrc(`${[0, 0.5, 1].map((s) => `${env(s, 0.3, 0.002, 30)}`).join('+')}*(sin(2*PI*(300+220*exp(-50*t))*t)*0.4+${NOISE}*0.35)`, 2), 2, 'lowpass=f=5000'),
  },
  {
    folder: ['Sound effects', 'Crowd', 'Legal'], file: 'courtroom-murmur.wav', type: 'crowd', note: 'A gallery murmuring, then settling.',
    recipe: audio(evalSrc(`${NOISE}*(0.14+0.05*sin(2*PI*0.25*t))*min(1,max(0.3,(6-t)*0.5))`, 7), 7, 'bandpass=f=850:width_type=o:w=2.2'),
  },
  {
    folder: ['Music', 'Stings', 'Legal'], file: 'verdict.wav', type: 'sting', note: 'Two low chords, stated and answered.',
    recipe: audio(evalSrc(`${env(0, 1.1, 0.01, 2.2)}*(${[41, 48, 53].map((m) => tone(midi(m), 3)).join('+')})*0.1+${env(1, 2.2, 0.01, 1.2)}*(${[36, 43, 48, 55].map((m) => tone(midi(m), 3)).join('+')})*0.09`, 3.4), 3.4),
  },

  // Faith.
  {
    folder: ['Sound effects', 'Musical phrases', 'Faith'], file: 'church-bells.wav', type: 'musical-phrase', note: 'Two church bells in a slow peal.',
    recipe: audio(evalSrc(`${[0, 1.4, 2.8, 4.2].map((s, i) => `${env(s, 3, 0.004, 1)}*${tone(i % 2 ? 311 : 233, 4)}*0.14`).join('+')}`, 7), 7, 'lowpass=f=5000'),
  },
  {
    folder: ['Music', 'Stings', 'Faith'], file: 'choir-swell.wav', type: 'sting', note: 'A voiced chord swelling and settling.',
    recipe: audio(evalSrc(`min(1,t/1.6)*min(1,max(0,(4-t)*0.8))*(${[48, 55, 60, 64, 67].map((m) => tone(midi(m), 5)).join('+')})*0.05`, 4), 4, 'lowpass=f=2200'),
  },
  {
    folder: ['Sound effects', 'Crowd', 'Faith'], file: 'congregation.wav', type: 'crowd', note: 'A congregation rising to speak together.',
    recipe: audio(evalSrc(`${NOISE}*(0.08+0.1*min(1,t/2))`, 6), 6, 'bandpass=f=700:width_type=o:w=2'),
  },
  {
    folder: ['Sound effects', 'Ambience', 'Faith'], file: 'sanctuary.wav', type: 'ambience', note: 'A large stone room: air and a long hush.',
    recipe: audio(evalSrc(`${NOISE}*0.05+${NOISE2}*0.04`, 9), 9, 'lowpass=f=900,highpass=f=70'),
  },

  // Memorial.
  {
    folder: ['Sound effects', 'Musical phrases', 'Memorial'], file: 'single-bell-toll.wav', type: 'musical-phrase', note: 'One bell, tolling three times, far apart.',
    recipe: audio(evalSrc(`${[0, 2.2, 4.4].map((s) => `${env(s, 2.6, 0.004, 0.9)}*${tone(196, 4)}*0.15`).join('+')}`, 7), 7, 'lowpass=f=3200'),
  },
  {
    folder: ['Music', 'Stings', 'Memorial'], file: 'farewell-strings.wav', type: 'sting', note: 'A minor swell that releases into quiet.',
    recipe: audio(evalSrc(`min(1,t/2)*min(1,max(0,(4.5-t)*0.7))*(${[45, 52, 57, 60, 64].map((m) => tone(midi(m), 6)).join('+')})*0.04`, 4.5), 4.5, 'lowpass=f=1800'),
  },

  // Nonprofit.
  {
    folder: ['Sound effects', 'Crowd', 'Nonprofit'], file: 'community-applause.wav', type: 'crowd', note: 'A warm room of applause, close and kind.',
    recipe: audio(evalSrc(`${NOISE}*gt(random(2),0.5)*min(1,t*4)*min(1,(5-t)*1.1)*0.35`, 5), 5, 'highpass=f=900,lowpass=f=7000'),
  },

  // Space.
  {
    folder: ['Sound effects', 'Ambience', 'Space'], file: 'deep-drone.wav', type: 'ambience', note: 'A deep ship-hull drone with a slow sweep.',
    recipe: audio(evalSrc(`${tone(55, 3)}*0.18+${tone(82.5, 2)}*(0.08+0.05*sin(2*PI*0.07*t))+${NOISE}*0.03`, 10), 10, 'lowpass=f=800'),
  },

  // Baseball.
  {
    folder: ['Sound effects', 'Impacts', 'Baseball'], file: 'bat-crack.wav', type: 'impact', note: 'A bat meeting the ball, with the park behind it.',
    recipe: audio(evalSrc(`${NOISE}*exp(-60*t)*0.6+sin(2*PI*(1200*exp(-40*t)+180)*t)*exp(-30*t)*0.3+${NOISE2}*exp(-1.5*t)*0.05`, 2), 2, 'highpass=f=250'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Baseball'], file: 'glove-catch.wav', type: 'foley', note: 'A ball snapping into a leather glove.',
    recipe: audio(evalSrc(`${NOISE}*exp(-45*t)*0.5+sin(2*PI*140*t)*exp(-25*t)*0.3`, 0.8), 0.8, 'lowpass=f=3000'),
  },
  {
    folder: ['Sound effects', 'Musical phrases', 'Baseball'], file: 'ballpark-organ.wav', type: 'musical-phrase', note: 'The charge call on a ballpark organ.',
    recipe: audio(evalSrc(`${[60, 64, 67, 72, 69, 72].map((m, i) => `${env(i * 0.22, 0.26, 0.005, 6)}*${tone(midi(m), 4)}*0.12`).join('+')}+${env(1.32, 1.2, 0.005, 2)}*(${[60, 67, 72].map((m) => tone(midi(m), 4)).join('+')})*0.1`, 2.8), 2.8),
  },
  {
    folder: ['Sound effects', 'Crowd', 'Baseball'], file: 'ballpark-crowd.wav', type: 'crowd', note: 'A ballpark swell after the hit.',
    recipe: audio(evalSrc(`${NOISE}*(0.12+0.3*${bell(1.5, 1.2)})`, 6), 6, 'bandpass=f=750:width_type=o:w=2.8'),
  },

  // Hockey.
  {
    folder: ['Sound effects', 'Impacts', 'Hockey'], file: 'puck-slap.wav', type: 'impact', note: 'A slap shot off the stick.',
    recipe: audio(evalSrc(`${NOISE}*exp(-70*t)*0.55+sin(2*PI*(320*exp(-60*t)+90)*t)*exp(-35*t)*0.3`, 0.7), 0.7, 'highpass=f=180'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Hockey'], file: 'skate-carve.wav', type: 'foley', note: 'Skates carving ice, two strides and a stop.',
    recipe: audio(evalSrc(`${NOISE}*(${env(0, 0.5, 0.05, 4)}+${env(0.7, 0.5, 0.05, 4)}+${env(1.4, 0.7, 0.02, 7)}*1.4)*0.4`, 2.4), 2.4, 'highpass=f=1500,lowpass=f=9000'),
  },
  {
    folder: ['Sound effects', 'Alarms', 'Hockey'], file: 'goal-horn.wav', type: 'alarm', note: 'The goal horn, long and proud.',
    recipe: audio(evalSrc(`(${tone(233, 5)})*min(1,t*30)*min(1,max(0,(2.4-t)*3))*0.3`, 2.6), 2.6, 'lowpass=f=3200'),
  },
  {
    folder: ['Sound effects', 'Crowd', 'Hockey'], file: 'rink-roar.wav', type: 'crowd', note: 'An arena roar off the glass.',
    recipe: audio(evalSrc(`${NOISE}*(0.14+0.26*${bell(1.2, 1)})`, 5), 5, 'bandpass=f=900:width_type=o:w=2.6'),
  },

  // Golf.
  {
    folder: ['Sound effects', 'Whooshes', 'Golf'], file: 'drive-swing.wav', type: 'whoosh', note: 'A driver through the ball: swish, then click.',
    recipe: audio(evalSrc(`${NOISE}*pow(sin(PI*min(t,0.5)/0.5),4)*0.5+${env(0.42, 0.1, 0.001, 70)}*(${NOISE2}*0.5+${tone(2400, 1)}*0.2)`, 1.2), 1.2, 'highpass=f=600'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Golf'], file: 'ball-in-cup.wav', type: 'foley', note: 'The ball rattling into the cup.',
    recipe: audio(evalSrc(`${[0, 0.09, 0.2, 0.34].map((s, i) => `${env(s, 0.1, 0.001, 50)}*${tone(1500 - i * 220, 2)}*0.2`).join('+')}`, 0.9), 0.9, 'highpass=f=500'),
  },
  {
    folder: ['Sound effects', 'Crowd', 'Golf'], file: 'polite-applause.wav', type: 'crowd', note: 'Gallery applause, brief and polite.',
    recipe: audio(evalSrc(`${NOISE}*gt(random(2),0.62)*min(1,t*8)*min(1,(2.6-t)*1.6)*0.3`, 2.6), 2.6, 'highpass=f=1100,lowpass=f=6500'),
  },
  {
    folder: ['Music', 'Stings', 'Golf'], file: 'birdie.wav', type: 'sting', note: 'A small rising figure for a made putt.',
    recipe: audio(evalSrc(`${[67, 71, 74].map((m, i) => `${env(i * 0.16, 1.4, 0.006, 3)}*${tone(midi(m), 3)}*0.14`).join('+')}`, 2.2), 2.2),
  },

  // Tennis.
  {
    folder: ['Sound effects', 'Impacts', 'Tennis'], file: 'serve-pop.wav', type: 'impact', note: 'A first serve off the strings.',
    recipe: audio(evalSrc(`${NOISE}*exp(-80*t)*0.5+${tone(420, 2)}*exp(-45*t)*0.35`, 0.6), 0.6, 'highpass=f=300'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Tennis'], file: 'rally.wav', type: 'foley', note: 'Four strokes of a baseline rally.',
    recipe: audio(evalSrc(`${[0, 0.8, 1.6, 2.4].map((s, i) => `${env(s, 0.12, 0.001, 55)}*(${NOISE}*0.35+${tone(i % 2 ? 380 : 440, 2)}*0.3)`).join('+')}`, 3.2), 3.2, 'highpass=f=250'),
  },
  {
    folder: ['Sound effects', 'Crowd', 'Tennis'], file: 'point-won.wav', type: 'crowd', note: 'A held hush breaking into applause.',
    recipe: audio(evalSrc(`${NOISE}*0.04*lt(t,1.2)+${NOISE2}*gt(random(3),0.55)*gt(t,1.2)*min(1,(t-1.2)*6)*min(1,(4-t)*1.4)*0.35`, 4), 4, 'highpass=f=800,lowpass=f=7000'),
  },
  {
    folder: ['Music', 'Stings', 'Tennis'], file: 'match-point.wav', type: 'sting', note: 'A taut two-note call and its answer.',
    recipe: audio(evalSrc(`${env(0, 0.5, 0.005, 5)}*${tone(midi(69), 3)}*0.3+${env(0.3, 0.5, 0.005, 5)}*${tone(midi(64), 3)}*0.3+${env(0.7, 1.6, 0.005, 1.6)}*(${[57, 61, 64].map((m) => tone(midi(m), 3)).join('+')})*0.1`, 2.6), 2.6),
  },

  // Motorsport.
  {
    folder: ['Sound effects', 'Vehicles', 'Motorsport'], file: 'grid-revs.wav', type: 'vehicles', note: 'Engines blipping on the grid.',
    recipe: audio(evalSrc(`${tone(95, 5)}*(0.2+0.25*(${bell(0.6, 0.18)}+${bell(1.4, 0.2)}+${bell(2.3, 0.25)}))+${NOISE}*0.05`, 4), 4, 'lowpass=f=2600'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Motorsport'], file: 'pit-gun.wav', type: 'foley', note: 'A wheel gun: on, off, and the drop.',
    recipe: audio(evalSrc(`(${env(0, 0.4, 0.004, 9)}+${env(0.7, 0.4, 0.004, 9)})*${NOISE}*0.5+${env(1.3, 0.3, 0.002, 25)}*(${NOISE2}*0.4+${tone(120, 2)}*0.3)`, 2), 2, 'highpass=f=400'),
  },

  // Fitness.
  {
    folder: ['Sound effects', 'Impacts', 'Fitness'], file: 'weight-rack.wav', type: 'impact', note: 'Plates set back on the rack, twice.',
    recipe: audio(evalSrc(`(${env(0, 0.4, 0.002, 18)}+${env(0.9, 0.4, 0.002, 18)})*(${NOISE}*0.35+${tone(180, 3)}*0.3)`, 1.8), 1.8, 'lowpass=f=4200'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Fitness'], file: 'treadmill-run.wav', type: 'foley', note: 'A steady run on a treadmill belt.',
    recipe: audio(evalSrc(`${NOISE}*0.1+${NOISE2}*gt(mod(t,0.36),0.3)*0.3`, 6), 6, 'lowpass=f=2200'),
  },
  {
    folder: ['Sound effects', 'Ambience', 'Fitness'], file: 'gym-floor.wav', type: 'ambience', note: 'A gym floor: hum, clinks far off.',
    recipe: audio(evalSrc(`${NOISE}*0.08+${env(2.2, 0.2, 0.004, 20)}*${tone(900, 2)}*0.06+${env(4.6, 0.2, 0.004, 20)}*${tone(760, 2)}*0.06`, 7), 7, 'lowpass=f=3000'),
  },

  // Easter.
  {
    folder: ['Sound effects', 'Nature weather', 'Easter'], file: 'spring-dawn.wav', type: 'nature-weather', note: 'A spring dawn: light air, bright chirps.',
    recipe: audio(evalSrc(`${NOISE}*0.05+${[0.6, 1.7, 2.9, 4.2, 5.1].map((s, i) => `${env(s, 0.18, 0.01, 18)}*${tone(2600 + i * 300, 1)}*0.12`).join('+')}`, 6.5), 6.5, 'highpass=f=300'),
  },
  {
    folder: ['Music', 'Stings', 'Easter'], file: 'egg-hunt.wav', type: 'sting', note: 'A bright little bell figure, found-it happy.',
    recipe: audio(evalSrc(`${[72, 76, 79, 84].map((m, i) => `${env(i * 0.14, 1.2, 0.004, 4)}*${tone(midi(m), 2)}*0.14`).join('+')}`, 2.2), 2.2),
  },
  {
    folder: ['Sound effects', 'Ambience', 'Easter'], file: 'meadow-morning.wav', type: 'ambience', note: 'A meadow: soft wind, a bee passing once.',
    recipe: audio(evalSrc(`${NOISE}*(0.06+0.03*sin(2*PI*0.11*t))+${tone(190, 3)}*${bell(3.4, 0.5)}*0.05`, 7), 7, 'lowpass=f=4000'),
  },

  // Halloween.
  {
    folder: ['Sound effects', 'Nature weather', 'Halloween'], file: 'night-wind-howl.wav', type: 'nature-weather', note: 'Wind howling past a cold house.',
    recipe: audio(evalSrc(`${NOISE}*(0.12+0.16*pow(sin(2*PI*0.13*t+1),2))`, 8), 8, 'bandpass=f=420:width_type=o:w=1.4'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Halloween'], file: 'creaking-door.wav', type: 'foley', note: 'A door creaking open, slowly.',
    recipe: audio(evalSrc(`sin(2*PI*(170+60*sin(2*PI*0.8*t))*t)*(0.12+0.08*sin(2*PI*2.4*t))*min(1,t*2)*min(1,(2.6-t))`, 2.8), 2.8, 'lowpass=f=1600'),
  },
  {
    folder: ['Music', 'Stings', 'Halloween'], file: 'something-stirs.wav', type: 'sting', note: 'A wavering minor line over a low pedal.',
    recipe: audio(evalSrc(`sin(2*PI*(440+18*sin(2*PI*5*t))*t)*min(1,t/1.2)*min(1,max(0,(3.4-t)))*0.14+${tone(55, 2)}*0.12`, 3.6), 3.6, 'lowpass=f=2600'),
  },

  // Thanksgiving.
  {
    folder: ['Sound effects', 'Crowd', 'Thanksgiving'], file: 'dinner-table.wav', type: 'crowd', note: 'A full table: talk, a laugh, cutlery.',
    recipe: audio(evalSrc(`${NOISE}*(0.11+0.04*sin(2*PI*0.3*t))+${[1.1, 2.8, 4.6].map((s) => `${env(s, 0.08, 0.002, 40)}*${tone(2100, 1)}*0.08`).join('+')}`, 6.5), 6.5, 'bandpass=f=1000:width_type=o:w=2.4'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Thanksgiving'], file: 'carving-board.wav', type: 'foley', note: 'Carving at the board, six strokes.',
    recipe: audio(evalSrc(`${[0, 0.5, 1, 1.5, 2, 2.5].map((s) => `${env(s, 0.22, 0.02, 10)}`).join('+')}*${NOISE}*0.3`, 3.2), 3.2, 'bandpass=f=1900:width_type=o:w=1.6'),
  },
  {
    folder: ['Music', 'Stings', 'Thanksgiving'], file: 'harvest-home.wav', type: 'sting', note: 'A warm plagal figure, home for the holiday.',
    recipe: audio(evalSrc(`${env(0, 1.4, 0.01, 1.6)}*(${[53, 57, 60].map((m) => tone(midi(m), 4)).join('+')})*0.08+${env(1.1, 2.4, 0.01, 1.1)}*(${[48, 52, 55, 60].map((m) => tone(midi(m), 4)).join('+')})*0.08`, 3.6), 3.6, 'lowpass=f=2400'),
  },

  // Patriotic.
  {
    folder: ['Sound effects', 'Explosions', 'Patriotic'], file: 'fireworks-volley.wav', type: 'explosion', note: 'Three shells: whistle up, burst, crackle.',
    recipe: audio(evalSrc(`${[0, 1.1, 2.1].map((s, i) => `sin(2*PI*(900+500*min(1,max(0,(t-${num(s)})*2)))*t)*${env(s, 0.5, 0.02, 4)}*0.08+${env(s + 0.55, 0.5, 0.001, 9)}*${NOISE}*0.45+gt(random(${i + 4}),0.75)*${env(s + 0.7, 0.9, 0.01, 4)}*${NOISE2}*0.2`).join('+')}`, 4), 4, 'lowpass=f=7000'),
  },
  {
    folder: ['Sound effects', 'Musical phrases', 'Patriotic'], file: 'parade-snares.wav', type: 'musical-phrase', note: 'Parade snares: a roll into two accents.',
    recipe: audio(evalSrc(`${NOISE}*gt(mod(t,0.125),0.095)*lt(t,1.5)*0.3+(${env(1.6, 0.3, 0.002, 22)}+${env(2, 0.5, 0.002, 16)})*${NOISE2}*0.5`, 2.8), 2.8, 'bandpass=f=3200:width_type=o:w=1.6'),
  },
  {
    folder: ['Music', 'Stings', 'Patriotic'], file: 'fanfare.wav', type: 'sting', note: 'A brass fanfare in two calls.',
    recipe: audio(evalSrc(`${([[60, 0], [67, 0.3], [72, 0.6]] as const).map(([note, start]) => `${env(start, 0.9, 0.01, 3)}*${tone(midi(note), 5)}*0.08`).join('+')}+${env(1.1, 2, 0.01, 1.4)}*(${[55, 60, 64, 67].map((m) => tone(midi(m), 5)).join('+')})*0.06`, 3.2), 3.2, 'lowpass=f=4500'),
  },

  // Ocean.
  {
    folder: ['Sound effects', 'Nature weather', 'Ocean'], file: 'shore-waves.wav', type: 'nature-weather', note: 'Waves breaking and drawing back, three sets.',
    recipe: audio(evalSrc(`${NOISE}*(0.08+0.22*(${bell(1.2, 0.7)}+${bell(4, 0.8)}+${bell(6.8, 0.7)}))`, 8.5), 8.5, 'lowpass=f=5000,highpass=f=120'),
  },
  {
    folder: ['Sound effects', 'Animals', 'Ocean'], file: 'gulls.wav', type: 'animals', note: 'Gulls calling over the water.',
    recipe: audio(evalSrc(`${[0.4, 1.3, 2.6, 3.2, 4.8].map((s, i) => `${env(s, 0.5, 0.03, 6)}*sin(2*PI*(${num(1500 + (i % 3) * 180)}-500*min(1,max(0,(t-${num(s)})*3)))*t)*0.12`).join('+')}`, 6), 6, 'highpass=f=700'),
  },
  {
    folder: ['Sound effects', 'Ambience', 'Ocean'], file: 'harbor-morning.wav', type: 'ambience', note: 'A harbor: low water, a far bell buoy.',
    recipe: audio(evalSrc(`${NOISE}*0.08+(${env(2, 2.4, 0.004, 1.2)}+${env(6, 2.4, 0.004, 1.2)})*${tone(415, 3)}*0.06`, 9), 9, 'lowpass=f=2400'),
  },

  // Weather.
  {
    folder: ['Sound effects', 'Nature weather', 'Weather'], file: 'thunder-roll.wav', type: 'nature-weather', note: 'A near strike and the roll that follows.',
    recipe: audio(evalSrc(`${env(0.2, 0.4, 0.002, 10)}*${NOISE}*0.6+${NOISE2}*(0.3*exp(-0.8*(t-0.4))*gt(t,0.4))`, 6), 6, 'lowpass=f=900'),
  },
  {
    folder: ['Sound effects', 'Nature weather', 'Weather'], file: 'hail-on-roof.wav', type: 'nature-weather', note: 'Hail rattling a tin roof.',
    recipe: audio(evalSrc(`${NOISE}*gt(random(5),0.6)*0.35+${NOISE2}*0.05`, 6), 6, 'highpass=f=1200,lowpass=f=9000'),
  },
  {
    folder: ['Sound effects', 'Nature weather', 'Weather'], file: 'squall-front.wav', type: 'nature-weather', note: 'A squall arriving: wind up, rain in.',
    recipe: audio(evalSrc(`${NOISE}*(0.08+0.2*min(1,t/3))`, 7), 7, 'bandpass=f=600:width_type=o:w=2.6'),
  },

  // City.
  {
    folder: ['Sound effects', 'Vehicles', 'City'], file: 'subway-pass.wav', type: 'vehicles', note: 'A subway pulling through below the grate.',
    recipe: audio(evalSrc(`(${NOISE}*0.3+${tone(60, 3)}*0.22)*${bell(2.6, 1.3)}+${NOISE2}*gt(mod(t,0.4),0.36)*${bell(2.6, 1.3)}*0.18`, 6), 6, 'lowpass=f=2000'),
  },
  {
    folder: ['Sound effects', 'UI tech', 'City'], file: 'crosswalk-signal.wav', type: 'ui-tech', note: 'A crosswalk signal ticking to walk.',
    recipe: audio(evalSrc(`${tone(1050, 1)}*lt(mod(t,0.55),0.05)*lt(t,3.3)*0.3+${tone(1400, 1)}*lt(mod(t,0.14),0.05)*gt(t,3.3)*0.25`, 5.5), 5.5),
  },
  {
    folder: ['Sound effects', 'Ambience', 'City'], file: 'night-street.wav', type: 'ambience', note: 'A city street at night: hum, one far horn.',
    recipe: audio(evalSrc(`${NOISE}*0.1+${tone(72, 2)}*0.05+${env(4.1, 0.5, 0.02, 4)}*(${tone(392, 2)}+${tone(466, 2)})*0.05`, 8), 8, 'lowpass=f=1500'),
  },

  // Food.
  {
    folder: ['Sound effects', 'Foley', 'Food'], file: 'chopping-board.wav', type: 'foley', note: 'A knife on the board, eight quick cuts.',
    recipe: audio(evalSrc(`${[0, 0.28, 0.56, 0.84, 1.12, 1.4, 1.68, 1.96].map((s) => `${env(s, 0.1, 0.001, 45)}`).join('+')}*(${NOISE}*0.4+${tone(260, 2)}*0.2)`, 2.6), 2.6, 'lowpass=f=5000'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Food'], file: 'pan-sizzle.wav', type: 'foley', note: 'A pan sizzling as something lands in it.',
    recipe: audio(evalSrc(`${NOISE}*(0.08+0.3*min(1,max(0,(t-0.4)*3))*exp(-0.25*(t-0.4)))`, 5), 5, 'highpass=f=1800'),
  },

  // Celebration sounds, in theme folders inside their type folders, so each occasion stands on
  // its own rather than on every piece of the Festival pack carrying every holiday.
  {
    folder: ['Sound effects', 'Musical phrases', 'Christmas'], file: 'sleigh-bells.wav', type: 'musical-phrase', note: 'Sleigh bells shaken in time.',
    recipe: audio(evalSrc(`${NOISE}*gt(mod(t,0.25),0.17)*0.3`, 4), 4, 'highpass=f=2600,lowpass=f=11000'),
  },
  {
    folder: ['Sound effects', 'Musical phrases', 'Christmas'], file: 'carol-chord.wav', type: 'musical-phrase', note: 'A warm chord, carol-like, with a long tail.',
    recipe: audio(evalSrc(`${env(0, 3.2, 0.02, 1)}*(${[55, 59, 62, 67, 71].map((m) => tone(midi(m), 4)).join('+')})*0.06`, 3.6), 3.6, 'lowpass=f=3000'),
  },
  {
    folder: ['Sound effects', 'Impacts', 'Christmas'], file: 'bauble-tap.wav', type: 'impact', note: 'A glass bauble tapped once.',
    recipe: audio(evalSrc(`(${[1760, 2640, 3520].map((f) => tone(f, 1)).join('+')})*exp(-9*t)*0.12`, 1.6), 1.6, 'highpass=f=900'),
  },
  {
    folder: ['Sound effects', 'Crowd', 'New year'], file: 'midnight-cheer.wav', type: 'crowd', note: 'A room cheering at midnight.',
    recipe: audio(evalSrc(`${NOISE}*(0.1+0.32*${bell(1.4, 1.1)})`, 6), 6, 'bandpass=f=800:width_type=o:w=2.8'),
  },
  {
    folder: ['Sound effects', 'Impacts', 'New year'], file: 'cork-pop.wav', type: 'impact', note: 'A cork leaving the bottle, and the fizz after.',
    recipe: audio(evalSrc(`${env(0, 0.08, 0.001, 70)}*(${tone(420, 2)}*0.5+${NOISE}*0.3)+${NOISE2}*gt(t,0.1)*exp(-1.6*(t-0.1))*0.12`, 2.4), 2.4),
  },
  {
    folder: ['Sound effects', 'UI tech', 'New year'], file: 'countdown-pips.wav', type: 'ui-tech', note: 'Five pips and a long tone, as a countdown ends.',
    recipe: audio(evalSrc(`${tone(1000, 1)}*lt(mod(t,1),0.1)*lt(t,5)*0.3+${tone(1500, 1)}*gt(t,5)*lt(t,6)*0.3`, 6.4), 6.4),
  },
  {
    folder: ['Sound effects', 'Musical phrases', 'Valentines'], file: 'harp-gliss.wav', type: 'musical-phrase', note: 'A harp glissando upward.',
    recipe: audio(evalSrc(`${[60, 62, 64, 67, 69, 72, 74, 76].map((m, i) => `${env(i * 0.07, 2, 0.004, 2.2)}*${tone(midi(m), 2)}*0.1`).join('+')}`, 2.6), 2.6),
  },
  {
    folder: ['Sound effects', 'Musical phrases', 'Valentines'], file: 'soft-chime.wav', type: 'musical-phrase', note: 'A tender two-note chime.',
    recipe: audio(evalSrc(`${env(0, 2, 0.006, 1.6)}*${tone(midi(76), 3)}*0.18+${env(0.35, 2.2, 0.006, 1.4)}*${tone(midi(81), 3)}*0.16`, 2.8), 2.8),
  },
  {
    folder: ['Sound effects', 'Ambience', 'Valentines'], file: 'heartbeat.wav', type: 'ambience', note: 'A slow, close heartbeat.',
    recipe: audio(evalSrc(`(${env(0, 0.3, 0.01, 14)}+${env(0.33, 0.3, 0.01, 16)})*${tone(52, 2)}*0.5`, 6), 6, 'lowpass=f=320'),
  },
  {
    folder: ['Sound effects', 'Musical phrases', 'Birthday'], file: 'party-horn.wav', type: 'musical-phrase', note: 'A party horn, twice.',
    recipe: audio(evalSrc(`(${env(0, 0.4, 0.01, 7)}+${env(0.7, 0.5, 0.01, 6)})*(${tone(520, 4)})*0.14+${NOISE}*(${env(0, 0.4, 0.01, 9)})*0.06`, 1.8), 1.8, 'bandpass=f=1200:width_type=o:w=2'),
  },
  {
    folder: ['Sound effects', 'Musical phrases', 'Birthday'], file: 'music-box.wav', type: 'musical-phrase', note: 'A music-box phrase, five notes.',
    recipe: audio(evalSrc(`${[84, 86, 88, 84, 91].map((m, i) => `${env(i * 0.3, 1.6, 0.003, 3)}*${tone(midi(m), 2)}*0.12`).join('+')}`, 3), 3, 'highpass=f=500'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Birthday'], file: 'candle-blow.wav', type: 'foley', note: 'Candles blown out in one breath.',
    recipe: audio(evalSrc(`${NOISE}*${bell(0.5, 0.26)}*0.45`, 1.4), 1.4, 'bandpass=f=900:width_type=o:w=2.4'),
  },
  {
    folder: ['Sound effects', 'Crowd', 'Birthday'], file: 'party-cheer.wav', type: 'crowd', note: 'A small room cheering.',
    recipe: audio(evalSrc(`${NOISE}*(0.1+0.26*${bell(1, 0.8)})`, 4), 4, 'bandpass=f=950:width_type=o:w=2.4'),
  },
  {
    folder: ['Music', 'Stings', 'Graduation'], file: 'pomp-fanfare.wav', type: 'sting', note: 'A processional fanfare in two calls.',
    recipe: audio(evalSrc(`${env(0, 1, 0.01, 2.6)}*(${[53, 60, 65].map((m) => tone(midi(m), 5)).join('+')})*0.07+${env(0.9, 2.4, 0.01, 1.2)}*(${[48, 55, 60, 64].map((m) => tone(midi(m), 5)).join('+')})*0.07`, 3.6), 3.6, 'lowpass=f=4200'),
  },
  {
    folder: ['Sound effects', 'Crowd', 'Graduation'], file: 'ceremony-applause.wav', type: 'crowd', note: 'A hall applauding as a name is read.',
    recipe: audio(evalSrc(`${NOISE}*gt(random(6),0.52)*min(1,t*3)*min(1,(5-t)*1.1)*0.36`, 5), 5, 'highpass=f=1000,lowpass=f=7500'),
  },
  {
    folder: ['Sound effects', 'Whooshes', 'Graduation'], file: 'cap-toss.wav', type: 'whoosh', note: 'A cap thrown up and caught by the cheer.',
    recipe: audio(evalSrc(`${NOISE}*pow(sin(PI*min(t,0.8)/0.8),3)*0.4`, 1.2), 1.2, 'bandpass=f=1400:width_type=o:w=1.8'),
  },
  {
    folder: ['Sound effects', 'Ambience', 'Christmas'], file: 'hearth-crackle.wav', type: 'ambience', note: 'A fire crackling in a quiet room.',
    recipe: audio(evalSrc(`${NOISE}*0.07+${NOISE2}*gt(random(7),0.86)*0.3`, 8), 8, 'lowpass=f=3200'),
  },
  {
    folder: ['Sound effects', 'Foley', 'New year'], file: 'glasses-clink.wav', type: 'foley', note: 'Two glasses touched in a toast.',
    recipe: audio(evalSrc(`(${[2100, 3150].map((f) => tone(f, 1)).join('+')})*exp(-11*t)*0.14`, 1.4), 1.4, 'highpass=f=1200'),
  },
  {
    folder: ['Sound effects', 'Foley', 'Valentines'], file: 'paper-heart-fold.wav', type: 'foley', note: 'A card taken from its envelope.',
    recipe: audio(evalSrc(`${NOISE}*(${bell(0.35, 0.22)}+${bell(0.95, 0.18)})*0.35`, 1.6), 1.6, 'highpass=f=2000'),
  },
  {
    folder: ['Sound effects', 'Impacts', 'Graduation'], file: 'diploma-stamp.wav', type: 'impact', note: 'A seal pressed onto a diploma.',
    recipe: audio(evalSrc(`${env(0, 0.3, 0.002, 26)}*(${NOISE}*0.35+${tone(150, 2)}*0.35)`, 1), 1, 'lowpass=f=3000'),
  },
  {
    folder: ['Sound effects', 'Musical phrases', 'Wedding'], file: 'chapel-bells.wav', type: 'musical-phrase', note: 'Chapel bells ringing a change.',
    recipe: audio(evalSrc(`${([[262, 0], [330, 0.55], [392, 1.1], [262, 1.75]] as const).map(([hz, st]) => `${env(st, 2.6, 0.004, 1.1)}*${tone(hz, 4)}*0.12`).join('+')}`, 4.4), 4.4, 'lowpass=f=4500'),
  },
];

const MUSIC: SampleMediaItem[] = [
  { folder: ['Music', 'Full mix'], file: 'night-drive.wav', type: 'full-mix', note: 'A sixteen-second synth piece at 120 bpm: kick, hat, bass, pad and lead.', recipe: fullMix(NIGHT_DRIVE) },
  { folder: ['Music', 'Full mix'], file: 'boardroom-calm.wav', type: 'full-mix', note: 'A calm piece at 84 bpm.', recipe: fullMix(BOARDROOM_CALM) },
  { folder: ['Music', 'Full mix'], file: 'matchday-pulse.wav', type: 'full-mix', note: 'A driving piece at 140 bpm.', recipe: fullMix(MATCHDAY_PULSE) },
  { folder: ['Music', 'Stems', 'Night drive'], file: 'drums.wav', type: 'stems', note: 'The drums of Night drive.', recipe: stem(NIGHT_DRIVE, 'drums') },
  { folder: ['Music', 'Stems', 'Night drive'], file: 'bass.wav', type: 'stems', note: 'The bass of Night drive.', recipe: stem(NIGHT_DRIVE, 'bass') },
  { folder: ['Music', 'Stems', 'Night drive'], file: 'pad.wav', type: 'stems', note: 'The pad of Night drive.', recipe: stem(NIGHT_DRIVE, 'pad') },
  {
    folder: ['Music', 'Stings'], file: 'major-hit.wav', type: 'sting', note: 'A major chord hit with a long decay.',
    recipe: audio(evalSrc(`${env(0, 3, 0.005, 1.3)}*(${[48, 55, 60, 64, 72].map((m) => tone(midi(m), 3)).join('+')})*0.1`, 3), 3),
  },
  {
    folder: ['Music', 'Stings'], file: 'minor-swell.wav', type: 'sting', note: 'A minor swell into a hit.',
    recipe: audio(evalSrc(`min(1,t/1.2)*min(1,max(0,(2.8-t)))*(${[45, 52, 57, 60].map((m) => tone(midi(m), 6)).join('+')})*0.08`, 2.8), 2.8, 'lowpass=f=2500'),
  },
  {
    folder: ['Music', 'Stings'], file: 'news-ident.wav', type: 'sting', note: 'Two quick notes and a chord, broadcast style.',
    recipe: audio(evalSrc(`${env(0, 0.5, 0.005, 5)}*${tone(midi(67), 3)}*0.4+${env(0.18, 0.5, 0.005, 5)}*${tone(midi(71), 3)}*0.4+${env(0.36, 2.2, 0.005, 1.5)}*(${[55, 62, 67, 74].map((m) => tone(midi(m), 3)).join('+')})*0.1`, 2.6), 2.6),
  },

  // ---- Milestone 24: three more of each, to take every music type to six.
  { folder: ['Music', 'Full mix'], file: 'festival-lights.wav', type: 'full-mix', note: 'A warm piece at 104 bpm.', recipe: fullMix(FESTIVAL_LIGHTS) },
  { folder: ['Music', 'Full mix'], file: 'quiet-study.wav', type: 'full-mix', note: 'A slow, spare piece at 72 bpm.', recipe: fullMix(QUIET_STUDY) },
  { folder: ['Music', 'Full mix'], file: 'city-rush.wav', type: 'full-mix', note: 'A busy piece at 128 bpm.', recipe: fullMix(CITY_RUSH) },
  { folder: ['Music', 'Stems', 'Night drive'], file: 'lead.wav', type: 'stems', note: 'The lead of Night drive.', recipe: stem(NIGHT_DRIVE, 'lead') },
  { folder: ['Music', 'Stems', 'City rush'], file: 'drums.wav', type: 'stems', note: 'The drums of City rush.', recipe: stem(CITY_RUSH, 'drums') },
  { folder: ['Music', 'Stems', 'City rush'], file: 'bass.wav', type: 'stems', note: 'The bass of City rush.', recipe: stem(CITY_RUSH, 'bass') },
  {
    folder: ['Music', 'Stings'], file: 'soft-reveal.wav', type: 'sting', note: 'A soft chord that blooms and holds.',
    recipe: audio(evalSrc(`min(1,t/0.8)*min(1,max(0,(3.2-t)*0.9))*(${[52, 59, 64, 71].map((m) => tone(midi(m), 4)).join('+')})*0.07`, 3.2), 3.2, 'lowpass=f=3000'),
  },
  {
    folder: ['Music', 'Stings'], file: 'sports-stab.wav', type: 'sting', note: 'A short, bright stab for a sports cut.',
    recipe: audio(evalSrc(`${env(0, 1.2, 0.004, 3.4)}*(${[57, 64, 69, 76].map((m) => tone(midi(m), 3)).join('+')})*0.12+${NOISE}*exp(-40*t)*0.15`, 1.6), 1.6, 'highpass=f=180'),
  },
  {
    folder: ['Music', 'Stings'], file: 'logo-tag.wav', type: 'sting', note: 'A two-chord tag to close a logo.',
    recipe: audio(evalSrc(`${env(0, 0.7, 0.005, 3)}*(${[50, 57, 62].map((m) => tone(midi(m), 3)).join('+')})*0.11+${env(0.45, 2.3, 0.005, 1.2)}*(${[55, 62, 67, 71].map((m) => tone(midi(m), 3)).join('+')})*0.1`, 2.8), 2.8),
  },
];

const STILLS: SampleMediaItem[] = [
  { folder: ['Stills', 'Photos'], file: 'sunset-haze.jpg', type: 'photo', note: 'A photo-style sunset gradient with haze and grain.', recipe: { kind: 'still', page: 'photo', variant: 'sunset', format: 'jpg', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Photos'], file: 'ocean-dusk.jpg', type: 'photo', note: 'A photo-style dusk over water with bokeh.', recipe: { kind: 'still', page: 'photo', variant: 'ocean', format: 'jpg', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Photos'], file: 'forest-light.jpg', type: 'photo', note: 'A photo-style forest light with soft beams.', recipe: { kind: 'still', page: 'photo', variant: 'forest', format: 'jpg', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Illustrations'], file: 'rolling-hills.png', type: 'illustration', note: 'A flat-shape landscape with a sun.', recipe: { kind: 'still', page: 'illustration', variant: 'hills', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Illustrations'], file: 'skyline.png', type: 'illustration', note: 'A flat-shape city skyline at night.', recipe: { kind: 'still', page: 'illustration', variant: 'skyline', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Illustrations'], file: 'rocket.png', type: 'illustration', note: 'A flat-shape rocket among stars.', recipe: { kind: 'still', page: 'illustration', variant: 'rocket', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Layered graphics'], file: 'badge.png', type: 'layered-graphic', note: 'A rosette badge on a transparent background.', recipe: { kind: 'still', page: 'layered', variant: 'badge', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Stills', 'Layered graphics'], file: 'ribbon-banner.png', type: 'layered-graphic', note: 'A ribbon banner on a transparent background.', recipe: { kind: 'still', page: 'layered', variant: 'ribbon', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Layered graphics'], file: 'speech-bubble.png', type: 'layered-graphic', note: 'A speech bubble on a transparent background.', recipe: { kind: 'still', page: 'layered', variant: 'bubble', format: 'png', width: 1080, height: 1080 } },

  // ---- Milestone 24: three more of each, to take every still type to six.
  { folder: ['Stills', 'Photos'], file: 'city-blue-hour.jpg', type: 'photo', note: 'A photo-style city at blue hour, lights coming on.', recipe: { kind: 'still', page: 'photo', variant: 'city', format: 'jpg', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Photos'], file: 'desert-afternoon.jpg', type: 'photo', note: 'A photo-style desert in hard afternoon light.', recipe: { kind: 'still', page: 'photo', variant: 'desert', format: 'jpg', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Photos'], file: 'snow-field.jpg', type: 'photo', note: 'A photo-style snow field under a pale sky.', recipe: { kind: 'still', page: 'photo', variant: 'snow', format: 'jpg', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Illustrations'], file: 'mountains.png', type: 'illustration', note: 'Flat-shape mountain ridges at sunrise.', recipe: { kind: 'still', page: 'illustration', variant: 'mountains', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Illustrations'], file: 'waves.png', type: 'illustration', note: 'Flat-shape water in stacked bands.', recipe: { kind: 'still', page: 'illustration', variant: 'waves', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Illustrations'], file: 'leaves.png', type: 'illustration', note: 'Scattered flat-shape leaves on paper.', recipe: { kind: 'still', page: 'illustration', variant: 'leaves', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Layered graphics'], file: 'arrow-mark.png', type: 'layered-graphic', note: 'A bold arrow on a transparent background.', recipe: { kind: 'still', page: 'layered', variant: 'arrow', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Stills', 'Layered graphics'], file: 'starburst.png', type: 'layered-graphic', note: 'A starburst badge on a transparent background.', recipe: { kind: 'still', page: 'layered', variant: 'starburst', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Stills', 'Layered graphics'], file: 'tag-label.png', type: 'layered-graphic', note: 'A tag-shaped label on a transparent background.', recipe: { kind: 'still', page: 'layered', variant: 'tag', format: 'png', width: 1920, height: 1080 } },


  // ---- Milestone 24: overlay plates, backdrops and design elements, as stills.
  { folder: ['Backgrounds'], file: 'mesh-gradient.png', type: 'still-background', note: 'A deep blue mesh gradient with soft blooms.', recipe: { kind: 'still', page: 'backdrop', variant: 'mesh-gradient', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Backgrounds'], file: 'paper-grain.png', type: 'still-background', note: 'A warm paper ground with fine grain.', recipe: { kind: 'still', page: 'backdrop', variant: 'paper-grain', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Backgrounds'], file: 'dusk-bands.png', type: 'still-background', note: 'Banded dusk colours from violet to amber.', recipe: { kind: 'still', page: 'backdrop', variant: 'dusk-bands', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Textures'], file: 'canvas-weave.png', type: 'texture', note: 'A woven canvas texture.', recipe: { kind: 'still', page: 'backdrop', variant: 'canvas-weave', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Textures'], file: 'concrete.png', type: 'texture', note: 'A mottled concrete texture.', recipe: { kind: 'still', page: 'backdrop', variant: 'concrete', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Textures'], file: 'noise-grid.png', type: 'texture', note: 'A sparse lit grid on near-black.', recipe: { kind: 'still', page: 'backdrop', variant: 'noise-grid', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Frames'], file: 'frame-thin.png', type: 'frame', note: 'A thin double rule framing the frame.', recipe: { kind: 'still', page: 'overlay', variant: 'frame-thin', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Frames'], file: 'frame-corners.png', type: 'frame', note: 'Gold corner marks, as a viewfinder.', recipe: { kind: 'still', page: 'overlay', variant: 'frame-corners', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Frames'], file: 'frame-deco.png', type: 'frame', note: 'A bordered frame with corner dots.', recipe: { kind: 'still', page: 'overlay', variant: 'frame-deco', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Vignettes'], file: 'vignette-soft.png', type: 'vignette', note: 'A soft vignette that darkens the corners.', recipe: { kind: 'still', page: 'overlay', variant: 'vignette-soft', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Vignettes'], file: 'vignette-heavy.png', type: 'vignette', note: 'A heavy vignette for a close, dark look.', recipe: { kind: 'still', page: 'overlay', variant: 'vignette-heavy', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Vignettes'], file: 'vignette-oval.png', type: 'vignette', note: 'An oval vignette, warm at the edge.', recipe: { kind: 'still', page: 'overlay', variant: 'vignette-oval', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Film grunge'], file: 'grunge-dust.png', type: 'film-grunge', note: 'Scattered dust specks for a film look.', recipe: { kind: 'still', page: 'overlay', variant: 'grunge-dust', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Film grunge'], file: 'grunge-scratch.png', type: 'film-grunge', note: 'Vertical scratches down the frame.', recipe: { kind: 'still', page: 'overlay', variant: 'grunge-scratch', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Film grunge'], file: 'grunge-stain.png', type: 'film-grunge', note: 'Soft brown stains, as aged stock.', recipe: { kind: 'still', page: 'overlay', variant: 'grunge-stain', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Light leaks'], file: 'leak-warm.png', type: 'light-particles', note: 'A warm light leak across one corner.', recipe: { kind: 'still', page: 'overlay', variant: 'leak-warm', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Light leaks'], file: 'leak-cool.png', type: 'light-particles', note: 'A cool light leak across one corner.', recipe: { kind: 'still', page: 'overlay', variant: 'leak-cool', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Light leaks'], file: 'spark-motes.png', type: 'light-particles', note: 'Scattered warm motes of light.', recipe: { kind: 'still', page: 'overlay', variant: 'spark-motes', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Logo bugs'], file: 'bug-round.png', type: 'logo-bug', note: 'A round corner bug with a mark.', recipe: { kind: 'still', page: 'overlay', variant: 'bug-round', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Logo bugs'], file: 'bug-square.png', type: 'logo-bug', note: 'A square corner bug with a mark.', recipe: { kind: 'still', page: 'overlay', variant: 'bug-square', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Overlays', 'Logo bugs'], file: 'bug-strip.png', type: 'logo-bug', note: 'A wide corner strip with a mark.', recipe: { kind: 'still', page: 'overlay', variant: 'bug-strip', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Design elements', 'Shapes'], file: 'shape-stack.png', type: 'shapes', note: 'Four flat discs in a row.', recipe: { kind: 'still', page: 'element', variant: 'shape-stack', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Shapes'], file: 'shape-chevrons.png', type: 'shapes', note: 'Three forward chevrons.', recipe: { kind: 'still', page: 'element', variant: 'shape-chevrons', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Shapes'], file: 'shape-rings.png', type: 'shapes', note: 'Concentric rings fading outward.', recipe: { kind: 'still', page: 'element', variant: 'shape-rings', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons'], file: 'icon-play.png', type: 'icons', note: 'A play mark in a filled circle.', recipe: { kind: 'still', page: 'element', variant: 'icon-play', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons'], file: 'icon-pin.png', type: 'icons', note: 'A map pin.', recipe: { kind: 'still', page: 'element', variant: 'icon-pin', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons'], file: 'icon-star.png', type: 'icons', note: 'A five-pointed star.', recipe: { kind: 'still', page: 'element', variant: 'icon-star', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Arrows'], file: 'arrow-curved.png', type: 'arrows', note: 'A curved arrow sweeping right.', recipe: { kind: 'still', page: 'element', variant: 'arrow-curved', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Design elements', 'Arrows'], file: 'arrow-block.png', type: 'arrows', note: 'A solid block arrow.', recipe: { kind: 'still', page: 'element', variant: 'arrow-block', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Design elements', 'Arrows'], file: 'arrow-sketch.png', type: 'arrows', note: 'A hand-drawn arrow with a wobble.', recipe: { kind: 'still', page: 'element', variant: 'arrow-sketch', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Design elements', 'Infographics'], file: 'chart-bars.png', type: 'infographic', note: 'A five-bar chart on a baseline.', recipe: { kind: 'still', page: 'element', variant: 'chart-bars', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Design elements', 'Infographics'], file: 'chart-donut.png', type: 'infographic', note: 'A four-part donut chart.', recipe: { kind: 'still', page: 'element', variant: 'chart-donut', format: 'png', width: 1920, height: 1080 } },
  { folder: ['Design elements', 'Infographics'], file: 'chart-line.png', type: 'infographic', note: 'A line chart with plotted points.', recipe: { kind: 'still', page: 'element', variant: 'chart-line', format: 'png', width: 1920, height: 1080 } },


  // ---- Milestone 24: themed motifs, so every theme in the tree is at least six deep.
  { folder: ['Design elements', 'Icons', 'Medical'], file: 'medical-cross.png', type: 'icons', note: 'A ringed medical cross.', recipe: { kind: 'still', page: 'motif', variant: 'medical-cross', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Medical'], file: 'heart-pulse.png', type: 'icons', note: 'A pulse trace in a disc.', recipe: { kind: 'still', page: 'motif', variant: 'heart-pulse', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Legal'], file: 'scales.png', type: 'icons', note: 'The scales of justice.', recipe: { kind: 'still', page: 'motif', variant: 'scales', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Legal'], file: 'gavel.png', type: 'icons', note: 'A gavel over its block.', recipe: { kind: 'still', page: 'motif', variant: 'gavel', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Faith'], file: 'dove.png', type: 'icons', note: 'A dove in flight.', recipe: { kind: 'still', page: 'motif', variant: 'dove', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Memorial'], file: 'remembrance-candle.png', type: 'icons', note: 'A candle with a remembrance ring.', recipe: { kind: 'still', page: 'motif', variant: 'candle-remembrance', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Nonprofit'], file: 'hands-heart.png', type: 'icons', note: 'Hands holding up a heart.', recipe: { kind: 'still', page: 'motif', variant: 'hands-heart', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Nonprofit'], file: 'awareness-ribbon.png', type: 'icons', note: 'An awareness ribbon.', recipe: { kind: 'still', page: 'motif', variant: 'awareness-ribbon', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Civic'], file: 'ballot-box.png', type: 'icons', note: 'A ballot dropping into its box.', recipe: { kind: 'still', page: 'motif', variant: 'ballot-box', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Space'], file: 'ringed-planet.png', type: 'icons', note: 'A ringed planet.', recipe: { kind: 'still', page: 'motif', variant: 'planet-ring', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Baseball'], file: 'diamond.png', type: 'icons', note: 'A ball field from above.', recipe: { kind: 'still', page: 'motif', variant: 'baseball-diamond', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Baseball'], file: 'pennant.png', type: 'icons', note: 'A team pennant on its pole.', recipe: { kind: 'still', page: 'motif', variant: 'pennant', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Hockey'], file: 'rink.png', type: 'icons', note: 'A rink with centre line and face-off circle.', recipe: { kind: 'still', page: 'motif', variant: 'hockey-rink', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Hockey'], file: 'goalie-mask.png', type: 'icons', note: 'A goalie mask.', recipe: { kind: 'still', page: 'motif', variant: 'goalie-mask', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Golf'], file: 'pin-flag.png', type: 'icons', note: 'The pin and its flag over a cup.', recipe: { kind: 'still', page: 'motif', variant: 'golf-flag', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Golf'], file: 'green.png', type: 'icons', note: 'A green with the pin and a ball.', recipe: { kind: 'still', page: 'motif', variant: 'golf-green', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Tennis'], file: 'court.png', type: 'icons', note: 'A court from above.', recipe: { kind: 'still', page: 'motif', variant: 'tennis-court', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Tennis'], file: 'racket.png', type: 'icons', note: 'A strung racket.', recipe: { kind: 'still', page: 'motif', variant: 'racket', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Motorsport'], file: 'checkered-flag.png', type: 'icons', note: 'The checkered flag.', recipe: { kind: 'still', page: 'motif', variant: 'checkered-flag', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Fitness'], file: 'dumbbell.png', type: 'icons', note: 'A dumbbell.', recipe: { kind: 'still', page: 'motif', variant: 'dumbbell', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Fitness'], file: 'whistle.png', type: 'icons', note: 'A referee whistle on its ring.', recipe: { kind: 'still', page: 'motif', variant: 'whistle', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Easter'], file: 'painted-egg.png', type: 'icons', note: 'A painted egg with bands and dots.', recipe: { kind: 'still', page: 'motif', variant: 'egg', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Easter'], file: 'tulip.png', type: 'icons', note: 'A tulip in bloom.', recipe: { kind: 'still', page: 'motif', variant: 'tulip', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Easter'], file: 'basket.png', type: 'icons', note: 'A woven basket of eggs.', recipe: { kind: 'still', page: 'motif', variant: 'basket', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Halloween'], file: 'pumpkin.png', type: 'icons', note: 'A carved pumpkin.', recipe: { kind: 'still', page: 'motif', variant: 'pumpkin', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Halloween'], file: 'bat.png', type: 'icons', note: 'A bat mid-flap.', recipe: { kind: 'still', page: 'motif', variant: 'bat', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Halloween'], file: 'haunted-house.png', type: 'icons', note: 'A lit house on a dark hill.', recipe: { kind: 'still', page: 'motif', variant: 'haunted-house', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Thanksgiving'], file: 'turkey.png', type: 'icons', note: 'A fanned-tail turkey.', recipe: { kind: 'still', page: 'motif', variant: 'turkey', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Thanksgiving'], file: 'cornucopia.png', type: 'icons', note: 'A horn of plenty.', recipe: { kind: 'still', page: 'motif', variant: 'cornucopia', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Patriotic'], file: 'shield.png', type: 'icons', note: 'A stars-and-stripes shield.', recipe: { kind: 'still', page: 'motif', variant: 'stars-stripes-shield', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Patriotic'], file: 'bunting.png', type: 'icons', note: 'Bunting on a swag line.', recipe: { kind: 'still', page: 'motif', variant: 'bunting', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Patriotic'], file: 'tricolor-flag.png', type: 'icons', note: 'A tricolour flag on its pole.', recipe: { kind: 'still', page: 'motif', variant: 'rosette-flag', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Ocean'], file: 'lighthouse.png', type: 'icons', note: 'A lighthouse with its beam.', recipe: { kind: 'still', page: 'motif', variant: 'lighthouse', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Ocean'], file: 'wave.png', type: 'icons', note: 'A breaking wave.', recipe: { kind: 'still', page: 'motif', variant: 'wave-crest', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Ocean'], file: 'shell.png', type: 'icons', note: 'A fan shell.', recipe: { kind: 'still', page: 'motif', variant: 'shell', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Weather'], file: 'sun-and-cloud.png', type: 'icons', note: 'Sun behind a cloud.', recipe: { kind: 'still', page: 'motif', variant: 'sun-cloud', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Weather'], file: 'umbrella.png', type: 'icons', note: 'An open umbrella.', recipe: { kind: 'still', page: 'motif', variant: 'umbrella', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Weather'], file: 'lightning.png', type: 'icons', note: 'A lightning bolt.', recipe: { kind: 'still', page: 'motif', variant: 'lightning-bolt', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'City'], file: 'neon-sign.png', type: 'icons', note: 'A neon café sign.', recipe: { kind: 'still', page: 'motif', variant: 'neon-sign', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'City'], file: 'metro-map.png', type: 'icons', note: 'Metro lines with their stops.', recipe: { kind: 'still', page: 'motif', variant: 'metro-lines', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Food'], file: 'chef-hat.png', type: 'icons', note: 'A chef hat.', recipe: { kind: 'still', page: 'motif', variant: 'chef-hat', format: 'png', width: 1080, height: 1080 } },

  // Celebration motifs: the Festival set is a general celebration look, so the specific
  // occasions are carried by assets of their own rather than by every piece in the pack.
  { folder: ['Design elements', 'Icons', 'Christmas'], file: 'ornament.png', type: 'icons', note: 'A bauble on its hook.', recipe: { kind: 'still', page: 'motif', variant: 'ornament', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Christmas'], file: 'tree.png', type: 'icons', note: 'A lit tree with a star.', recipe: { kind: 'still', page: 'motif', variant: 'christmas-tree', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'New year'], file: 'champagne-pop.png', type: 'icons', note: 'A bottle popping.', recipe: { kind: 'still', page: 'motif', variant: 'champagne-pop', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'New year'], file: 'midnight-clock.png', type: 'icons', note: 'A clock at midnight.', recipe: { kind: 'still', page: 'motif', variant: 'midnight-clock', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Valentines'], file: 'heart.png', type: 'icons', note: 'A heart.', recipe: { kind: 'still', page: 'motif', variant: 'heart', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Valentines'], file: 'rose.png', type: 'icons', note: 'A single rose.', recipe: { kind: 'still', page: 'motif', variant: 'rose', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Birthday'], file: 'cake.png', type: 'icons', note: 'A cake with three candles.', recipe: { kind: 'still', page: 'motif', variant: 'birthday-cake', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Birthday'], file: 'balloons.png', type: 'icons', note: 'Three balloons on strings.', recipe: { kind: 'still', page: 'motif', variant: 'balloons', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Graduation'], file: 'cap.png', type: 'icons', note: 'A mortarboard with its tassel.', recipe: { kind: 'still', page: 'motif', variant: 'graduation-cap', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Graduation'], file: 'diploma.png', type: 'icons', note: 'A rolled diploma with its ribbon.', recipe: { kind: 'still', page: 'motif', variant: 'diploma', format: 'png', width: 1080, height: 1080 } },
  { folder: ['Design elements', 'Icons', 'Wedding'], file: 'rings.png', type: 'icons', note: 'Two rings, linked.', recipe: { kind: 'still', page: 'motif', variant: 'wedding-rings', format: 'png', width: 1080, height: 1080 } },
];

const CLIPS: SampleMediaItem[] = [
  ...['boardroom', 'newsdesk', 'matchday', 'festival'].map((set): SampleMediaItem => ({
    folder: ['Video clips', 'Stock footage'],
    file: `${set}-loop.mp4`,
    type: 'stock-footage',
    note: `The ${set[0]!.toUpperCase()}${set.slice(1)} background template rendered to H.264 at 1280 × 720, four seconds.`,
    recipe: { kind: 'clip', templateId: `pulp.samples.${set}.background`, seconds: 4, width: 1280, height: 720 },
  })),
  // Milestone 24: two standalone backgrounds as well, to take stock footage to six.
  {
    folder: ['Video clips', 'Stock footage'], file: 'soft-gradient-loop.mp4', type: 'stock-footage',
    note: 'The Soft Gradient background rendered to H.264 at 1280 × 720, four seconds.',
    recipe: { kind: 'clip', templateId: 'pulp.samples.soft-gradient', seconds: 4, width: 1280, height: 720 },
  },
  {
    folder: ['Video clips', 'Stock footage'], file: 'cinematic-gradient-loop.mp4', type: 'stock-footage',
    note: 'The Cinematic Gradient background rendered to H.264 at 1280 × 720, four seconds.',
    recipe: { kind: 'clip', templateId: 'pulp.samples.cinematic-gradient', seconds: 4, width: 1280, height: 720 },
  },
  // Milestone 36: six more, one from each new animated background, so stock video reaches twelve
  // clips that each look like something else — aurora, bokeh, cubes, paper waves, stadium lights, confetti.
  ...([
    ['aurora-ribbons', 'Aurora Ribbons', 8], ['bokeh-drift', 'Bokeh Drift', 6], ['tumbling-cubes', 'Tumbling Cubes', 6],
    ['paper-waves', 'Paper Waves', 6], ['stadium-sweep', 'Stadium Sweep', 5], ['confetti-rain', 'Confetti Rain', 6],
  ] as const).map(([slug, name, seconds]): SampleMediaItem => ({
    folder: ['Video clips', 'Stock footage'],
    file: `${slug}-loop.mp4`,
    type: 'stock-footage',
    note: `The ${name} background rendered to H.264 at 1280 × 720, ${seconds === 5 ? 'five' : seconds === 6 ? 'six' : 'eight'} seconds — one whole loop.`,
    recipe: { kind: 'clip', templateId: `pulp.samples.${slug}`, seconds, width: 1280, height: 720 },
  })),
];

// ---- Milestone 26: the Assets group. Every asset is drawn on transparency by the asset page
// over its own time: a WebM with alpha for a moving one, a PNG for a still. Effects first,
// generic and tagged with whichever theme fits; then the Objects, themed props filed under the
// theme they belong to, so that every theme in the taxonomy has assets of its own.

/**
 * One asset: its folder under "Assets" (the category, then the theme subfolder that tags it),
 * the variant the asset page draws, and how it moves — a loop meets its own first frame, a
 * one-shot plays once and clears, and no motion at all is a still. Squares are 512 px, wide
 * effects 640 × 360; clips run two seconds.
 */
function asset(folder: readonly string[], type: string, variant: string, note: string, shape: 'square' | 'wide' = 'square', motion?: 'loop' | 'once'): SampleMediaItem {
  const size = shape === 'wide' ? { width: 640, height: 360 } : { width: 512, height: 512 };
  const clip = motion !== undefined;
  return {
    folder: ['Assets', ...folder],
    file: `${variant}.${clip ? 'webm' : 'png'}`,
    type,
    note,
    recipe: { kind: 'asset', page: 'asset', variant, format: clip ? 'webm' : 'png', ...size, seconds: clip ? 2 : 1, fps: ASSET_FPS, loop: motion === 'loop' },
  };
}

const ASSETS: SampleMediaItem[] = [
  // Fire and flames
  asset(['Fire and flames'], 'fire', 'candle-flame', 'A candle flame licking on the spot; loops.', 'square', 'loop'),
  asset(['Fire and flames'], 'fire', 'torch-flame', 'A torch flame, held still.'),
  asset(['Fire and flames', 'Nature'], 'fire', 'campfire', 'A campfire over crossed logs; loops.', 'square', 'loop'),
  asset(['Fire and flames'], 'fire', 'match-flare', 'A match struck, flaring and settling; one shot.', 'square', 'once'),
  asset(['Fire and flames', 'Gaming'], 'fire', 'fireball', 'A fireball with its trailing tail, held still.', 'wide'),
  asset(['Fire and flames'], 'fire', 'flame-burst', 'Flames bursting upward from a line, held still.', 'wide'),
  // Smoke and steam
  asset(['Smoke and steam'], 'smoke', 'smoke-wisps', 'Wisps of smoke rising and thinning; loops.', 'square', 'loop'),
  asset(['Smoke and steam'], 'smoke', 'steam-cup', 'Steam off a cup, held still.'),
  asset(['Smoke and steam'], 'smoke', 'smoke-puff', 'A puff of smoke rolling out and fading; one shot.', 'square', 'once'),
  asset(['Smoke and steam'], 'smoke', 'smoke-trail', 'A smoke trail curling off to one side, held still.', 'wide'),
  asset(['Smoke and steam', 'Halloween'], 'smoke', 'fog-patch', 'Low fog drifting along the ground; loops.', 'wide', 'loop'),
  asset(['Smoke and steam'], 'smoke', 'smoke-ring', 'A smoke ring, held still.'),
  // Sparks and embers
  asset(['Sparks and embers'], 'sparks', 'spark-shower', 'A shower of sparks thrown and falling; one shot.', 'wide', 'once'),
  asset(['Sparks and embers'], 'sparks', 'drifting-embers', 'Embers adrift, held still.', 'wide'),
  asset(['Sparks and embers', 'Technology'], 'sparks', 'welding-sparks', 'Welding sparks spraying from a point; loops.', 'wide', 'loop'),
  asset(['Sparks and embers', 'New year'], 'sparks', 'sparkler', 'A sparkler fizzing on its stick; loops.', 'square', 'loop'),
  asset(['Sparks and embers', 'Patriotic'], 'sparks', 'firework-burst', 'A single firework bursting and falling; one shot.', 'square', 'once'),
  asset(['Sparks and embers', 'Science'], 'sparks', 'electric-arc', 'An electric arc between two points, held still.', 'wide'),
  // Explosions and impacts
  asset(['Explosions and impacts'], 'explosion-asset', 'shockwave-ring', 'A shockwave ring opening out; one shot.', 'wide', 'once'),
  asset(['Explosions and impacts'], 'explosion-asset', 'dust-burst', 'A burst of dust, held still.', 'wide'),
  asset(['Explosions and impacts'], 'explosion-asset', 'fireball-blast', 'A fireball blast rolling up; one shot.', 'square', 'once'),
  asset(['Explosions and impacts'], 'explosion-asset', 'debris-scatter', 'Debris scattered from an impact, held still.', 'wide'),
  asset(['Explosions and impacts', 'Gaming'], 'explosion-asset', 'energy-burst', 'A burst of energy shards flying out; one shot.', 'square', 'once'),
  asset(['Explosions and impacts'], 'explosion-asset', 'starburst-flash', 'A starburst flash, held still.'),
  // Energy and magic
  asset(['Energy and magic'], 'energy', 'energy-orb', 'An orb pulsing inside its rings; loops.', 'square', 'loop'),
  asset(['Energy and magic'], 'energy', 'sparkle-trail', 'A trail of sparkles, held still.', 'wide'),
  asset(['Energy and magic', 'Gaming'], 'energy', 'portal-ring', 'A portal ring turning with its runes; loops.', 'square', 'loop'),
  asset(['Energy and magic', 'Gaming'], 'energy', 'plasma-beam', 'A plasma beam across the frame, held still.', 'wide'),
  asset(['Energy and magic', 'Technology'], 'energy', 'glow-pulse', 'A glow pulsing out in rings; loops.', 'square', 'loop'),
  asset(['Energy and magic'], 'energy', 'magic-bolt', 'A jagged bolt of magic, held still.', 'wide'),
  // Light and flares
  asset(['Light and flares'], 'light-asset', 'glint', 'A glint flaring and dying; one shot.', 'square', 'once'),
  asset(['Light and flares'], 'light-asset', 'lens-flare', 'An anamorphic lens flare, held still.', 'wide'),
  asset(['Light and flares', 'Faith'], 'light-asset', 'light-rays', 'Rays of light fanning down and shifting; loops.', 'wide', 'loop'),
  asset(['Light and flares', 'City'], 'light-asset', 'neon-flicker', 'A neon tube flickering on; loops.', 'wide', 'loop'),
  asset(['Light and flares', 'Concert'], 'light-asset', 'bokeh-cluster', 'A cluster of bokeh discs, held still.', 'wide'),
  asset(['Light and flares', 'Cinema'], 'light-asset', 'flashlight-beam', 'A flashlight beam cutting across, held still.', 'wide'),
  // Weather effects
  asset(['Weather effects'], 'weather-asset', 'rain-fall', 'Rain falling across the frame; loops.', 'wide', 'loop'),
  asset(['Weather effects'], 'weather-asset', 'snow-flurry', 'A flurry of snow, held still.', 'wide'),
  asset(['Weather effects', 'Weather'], 'weather-asset', 'rain-cloud', 'A cloud raining; loops.', 'square', 'loop'),
  asset(['Weather effects', 'Thanksgiving'], 'weather-asset', 'falling-leaves', 'Autumn leaves tumbling down; loops.', 'wide', 'loop'),
  asset(['Weather effects', 'Weather'], 'weather-asset', 'hail', 'Hailstones falling, held still.', 'wide'),
  asset(['Weather effects', 'Weather'], 'weather-asset', 'drifting-cloud', 'A cloud drifting by, held still.', 'wide'),
  // Liquids and splashes
  asset(['Liquids and splashes'], 'liquid', 'water-splash', 'A splash thrown up and out; one shot.', 'square', 'once'),
  asset(['Liquids and splashes'], 'liquid', 'ink-bloom', 'Ink blooming in water, held still.'),
  asset(['Liquids and splashes', 'Kids'], 'liquid', 'paint-splash', 'A splash of paint, held still.'),
  asset(['Liquids and splashes'], 'liquid', 'drip', 'A drop forming, falling and rippling; loops.', 'square', 'loop'),
  asset(['Liquids and splashes', 'Ocean'], 'liquid', 'rising-bubbles', 'Bubbles rising and wobbling; loops.', 'square', 'loop'),
  asset(['Liquids and splashes', 'Food'], 'liquid', 'pouring-stream', 'A stream pouring from above, held still.'),
  // Confetti and celebration
  asset(['Confetti and celebration'], 'confetti', 'confetti-burst', 'Confetti thrown up and falling; one shot.', 'wide', 'once'),
  asset(['Confetti and celebration'], 'confetti', 'glitter-fall', 'Glitter falling, held still.', 'wide'),
  asset(['Confetti and celebration', 'Birthday'], 'confetti', 'balloon-release', 'Balloons released and rising; one shot.', 'square', 'once'),
  asset(['Confetti and celebration', 'New year'], 'confetti', 'streamers', 'Streamers hanging in curls, held still.', 'wide'),
  asset(['Confetti and celebration', 'Wedding'], 'confetti', 'petal-shower', 'Petals showering down; loops.', 'wide', 'loop'),
  asset(['Confetti and celebration', 'Kids'], 'confetti', 'star-burst', 'Stars bursting from a point, held still.'),
  // Brush and ink strokes
  asset(['Brush and ink strokes'], 'brush', 'brush-swipe', 'A brush swiping across; one shot.', 'wide', 'once'),
  asset(['Brush and ink strokes'], 'brush', 'marker-underline', 'A marker underline, held still.', 'wide'),
  asset(['Brush and ink strokes', 'Kids'], 'brush', 'ink-scribble', 'An ink scribble drawing itself; one shot.', 'square', 'once'),
  asset(['Brush and ink strokes', 'Education'], 'brush', 'hand-drawn-circle', 'A circle drawn by hand around something; one shot.', 'square', 'once'),
  asset(['Brush and ink strokes'], 'brush', 'paint-splatter', 'Paint splattered across, held still.', 'wide'),
  asset(['Brush and ink strokes'], 'brush', 'roller-stroke', 'A paint roller stroke, held still.', 'wide'),

  // ---- Objects: themed props. The theme subfolder is what tags each one.
  // Sports equipment
  asset(['Sports equipment', 'Sports'], 'sports-objects', 'trophy', 'A gold trophy cup.'),
  asset(['Sports equipment', 'Sports'], 'sports-objects', 'whistle', 'A referee whistle on its cord.'),
  asset(['Sports equipment', 'Sports'], 'sports-objects', 'medal', 'A gold medal on a ribbon.'),
  asset(['Sports equipment', 'Sports'], 'sports-objects', 'stopwatch', 'A stopwatch, its hand sweeping; loops.', 'square', 'loop'),
  asset(['Sports equipment', 'Football'], 'sports-objects', 'football-ball', 'A football with its laces.'),
  asset(['Sports equipment', 'Football'], 'sports-objects', 'football-helmet', 'A football helmet.'),
  asset(['Sports equipment', 'Football'], 'sports-objects', 'goalpost', 'A goalpost.'),
  asset(['Sports equipment', 'Basketball'], 'sports-objects', 'basketball-ball', 'A basketball bouncing; loops.', 'square', 'loop'),
  asset(['Sports equipment', 'Basketball'], 'sports-objects', 'basketball-hoop', 'A hoop with its net and backboard.'),
  asset(['Sports equipment', 'Basketball'], 'sports-objects', 'basketball-jersey', 'A basketball jersey.'),
  asset(['Sports equipment', 'Baseball'], 'sports-objects', 'baseball-ball', 'A baseball with its stitching.'),
  asset(['Sports equipment', 'Baseball'], 'sports-objects', 'baseball-bat', 'A baseball bat.'),
  asset(['Sports equipment', 'Baseball'], 'sports-objects', 'baseball-glove', 'A baseball glove.'),
  asset(['Sports equipment', 'Soccer'], 'sports-objects', 'soccer-ball', 'A soccer ball.'),
  asset(['Sports equipment', 'Soccer'], 'sports-objects', 'soccer-goal', 'A soccer goal with its net.'),
  asset(['Sports equipment', 'Soccer'], 'sports-objects', 'soccer-boot', 'A soccer boot.'),
  asset(['Sports equipment', 'Hockey'], 'sports-objects', 'hockey-puck', 'A hockey puck.'),
  asset(['Sports equipment', 'Hockey'], 'sports-objects', 'hockey-stick', 'A hockey stick.'),
  asset(['Sports equipment', 'Hockey'], 'sports-objects', 'hockey-skate', 'An ice skate.'),
  asset(['Sports equipment', 'Golf'], 'sports-objects', 'golf-ball', 'A dimpled golf ball on its tee.'),
  asset(['Sports equipment', 'Golf'], 'sports-objects', 'golf-flag', 'A pin flag in its hole.'),
  asset(['Sports equipment', 'Golf'], 'sports-objects', 'golf-club', 'A golf club.'),
  asset(['Sports equipment', 'Tennis'], 'sports-objects', 'tennis-ball', 'A tennis ball.'),
  asset(['Sports equipment', 'Tennis'], 'sports-objects', 'tennis-racket', 'A tennis racket.'),
  asset(['Sports equipment', 'Tennis'], 'sports-objects', 'tennis-net', 'A tennis net.'),
  asset(['Sports equipment', 'Motorsport'], 'sports-objects', 'checkered-flag-wave', 'A checkered flag waving; loops.', 'square', 'loop'),
  asset(['Sports equipment', 'Motorsport'], 'sports-objects', 'racing-tyre', 'A racing tyre.'),
  asset(['Sports equipment', 'Motorsport'], 'sports-objects', 'racing-helmet', 'A racing helmet.'),
  asset(['Sports equipment', 'Fitness'], 'sports-objects', 'dumbbell-pair', 'A pair of dumbbells.'),
  asset(['Sports equipment', 'Fitness'], 'sports-objects', 'kettlebell', 'A kettlebell.'),
  asset(['Sports equipment', 'Fitness'], 'sports-objects', 'jump-rope', 'A jump rope.'),
  // Celebration objects
  asset(['Celebration objects', 'Wedding'], 'celebration-objects', 'wedding-rings-pair', 'Two wedding rings linked.'),
  asset(['Celebration objects', 'Wedding'], 'celebration-objects', 'bouquet', 'A bridal bouquet.'),
  asset(['Celebration objects', 'Birthday'], 'celebration-objects', 'birthday-cake-candles', 'A birthday cake, its candles flickering; loops.', 'square', 'loop'),
  asset(['Celebration objects', 'Birthday'], 'celebration-objects', 'gift-box-bow', 'A gift box with a bow.'),
  asset(['Celebration objects', 'Graduation'], 'celebration-objects', 'mortarboard-toss', 'A mortarboard tossed up and turning; one shot.', 'square', 'once'),
  asset(['Celebration objects', 'Graduation'], 'celebration-objects', 'diploma-scroll', 'A diploma rolled and ribboned.'),
  asset(['Celebration objects', 'Graduation'], 'celebration-objects', 'mortarboard', 'A mortarboard with its tassel.'),
  asset(['Celebration objects', 'Baby'], 'celebration-objects', 'baby-rattle', 'A baby rattle.'),
  asset(['Celebration objects', 'Baby'], 'celebration-objects', 'pacifier', 'A pacifier.'),
  asset(['Celebration objects', 'Baby'], 'celebration-objects', 'baby-bottle', 'A baby bottle.'),
  asset(['Celebration objects', 'Memorial'], 'celebration-objects', 'memorial-candle', 'A memorial candle burning; loops.', 'square', 'loop'),
  asset(['Celebration objects', 'Memorial'], 'celebration-objects', 'dove', 'A dove in flight.'),
  asset(['Celebration objects', 'Memorial'], 'celebration-objects', 'lily', 'A white lily.'),
  // Holiday objects
  asset(['Holiday objects', 'Holiday'], 'holiday-objects', 'gift-stack', 'A stack of wrapped gifts.'),
  asset(['Holiday objects', 'Holiday'], 'holiday-objects', 'string-lights', 'A string of lights twinkling; loops.', 'wide', 'loop'),
  asset(['Holiday objects', 'Holiday'], 'holiday-objects', 'lantern', 'A paper lantern.'),
  asset(['Holiday objects', 'Christmas'], 'holiday-objects', 'bauble', 'A bauble on its hook.'),
  asset(['Holiday objects', 'Christmas'], 'holiday-objects', 'fir-tree', 'A decorated fir tree.'),
  asset(['Holiday objects', 'Christmas'], 'holiday-objects', 'candy-cane', 'A candy cane.'),
  asset(['Holiday objects', 'New year'], 'holiday-objects', 'champagne-cork-pop', 'A champagne cork popping; one shot.', 'square', 'once'),
  asset(['Holiday objects', 'Valentines'], 'holiday-objects', 'heart-balloon', 'A heart-shaped balloon.'),
  asset(['Holiday objects', 'Valentines'], 'holiday-objects', 'love-letter', 'A sealed love letter.'),
  asset(['Holiday objects', 'Valentines'], 'holiday-objects', 'rose-stem', 'A rose on its stem.'),
  asset(['Holiday objects', 'Easter'], 'holiday-objects', 'easter-egg', 'A painted egg.'),
  asset(['Holiday objects', 'Easter'], 'holiday-objects', 'tulip-pair', 'Two tulips.'),
  asset(['Holiday objects', 'Easter'], 'holiday-objects', 'chick', 'A chick.'),
  asset(['Holiday objects', 'Halloween'], 'holiday-objects', 'jack-o-lantern', 'A jack-o-lantern, its candle flickering; loops.', 'square', 'loop'),
  asset(['Holiday objects', 'Halloween'], 'holiday-objects', 'witch-hat', 'A witch hat.'),
  asset(['Holiday objects', 'Thanksgiving'], 'holiday-objects', 'pumpkin-pie', 'A slice of pumpkin pie.'),
  asset(['Holiday objects', 'Thanksgiving'], 'holiday-objects', 'roast-turkey', 'A roast turkey on its platter.'),
  asset(['Holiday objects', 'Summer'], 'holiday-objects', 'beach-ball', 'A beach ball.'),
  asset(['Holiday objects', 'Summer'], 'holiday-objects', 'sunshine', 'A sun, its rays turning; loops.', 'square', 'loop'),
  asset(['Holiday objects', 'Summer'], 'holiday-objects', 'ice-cream-cone', 'An ice cream cone.'),
  asset(['Holiday objects', 'Patriotic'], 'holiday-objects', 'waving-flag', 'A striped flag waving; loops.', 'wide', 'loop'),
  asset(['Holiday objects', 'Patriotic'], 'holiday-objects', 'rosette-ribbon', 'A rosette with ribbons.'),
  // Business objects
  asset(['Business objects', 'Corporate'], 'business-objects', 'briefcase', 'A briefcase.'),
  asset(['Business objects', 'Corporate'], 'business-objects', 'id-badge', 'An ID badge on a lanyard.'),
  asset(['Business objects', 'Corporate'], 'business-objects', 'bar-chart-rise', 'A bar chart growing with a rising arrow; one shot.', 'square', 'once'),
  asset(['Business objects', 'Finance'], 'business-objects', 'spinning-coin', 'A coin spinning; loops.', 'square', 'loop'),
  asset(['Business objects', 'Finance'], 'business-objects', 'money-stack', 'A stack of banknotes.'),
  asset(['Business objects', 'Finance'], 'business-objects', 'piggy-bank', 'A piggy bank.'),
  asset(['Business objects', 'Real estate'], 'business-objects', 'house-key', 'A key with a house tag.'),
  asset(['Business objects', 'Real estate'], 'business-objects', 'house-front', 'The front of a house.'),
  asset(['Business objects', 'Real estate'], 'business-objects', 'sold-sign', 'A sold sign on its post.'),
  asset(['Business objects', 'Legal'], 'business-objects', 'gavel', 'A gavel on its block.'),
  asset(['Business objects', 'Legal'], 'business-objects', 'scales-of-justice', 'The scales of justice.'),
  asset(['Business objects', 'Legal'], 'business-objects', 'law-book', 'A law book.'),
  // Science objects
  asset(['Science objects', 'Technology'], 'science-objects', 'gear-spin', 'Two gears turning together; loops.', 'square', 'loop'),
  asset(['Science objects', 'Technology'], 'science-objects', 'smartphone', 'A smartphone.'),
  asset(['Science objects', 'Medical'], 'science-objects', 'first-aid-cross', 'A first-aid cross on its case.'),
  asset(['Science objects', 'Medical'], 'science-objects', 'heartbeat-line', 'A heartbeat line tracing itself; loops.', 'wide', 'loop'),
  asset(['Science objects', 'Medical'], 'science-objects', 'pill-capsule', 'A two-tone capsule.'),
  asset(['Science objects', 'Science'], 'science-objects', 'atom-orbit', 'An atom, its electrons orbiting; loops.', 'square', 'loop'),
  asset(['Science objects', 'Science'], 'science-objects', 'dna-helix', 'A DNA helix.'),
  asset(['Science objects', 'Science'], 'science-objects', 'beaker-bubbling', 'A beaker bubbling; loops.', 'square', 'loop'),
  // Media objects
  asset(['Media objects', 'News'], 'media-objects', 'news-microphone', 'A hand microphone with a flag.'),
  asset(['Media objects', 'News'], 'media-objects', 'tv-camera', 'A studio camera.'),
  asset(['Media objects', 'News'], 'media-objects', 'newspaper', 'A folded newspaper.'),
  asset(['Media objects', 'Documentary'], 'media-objects', 'film-reel', 'A film reel.'),
  asset(['Media objects', 'Documentary'], 'media-objects', 'vintage-camera', 'A vintage camera.'),
  asset(['Media objects', 'Documentary'], 'media-objects', 'boom-mic', 'A boom microphone.'),
  asset(['Media objects', 'Podcast'], 'media-objects', 'podcast-mic', 'A studio microphone on its arm.'),
  asset(['Media objects', 'Podcast'], 'media-objects', 'headphones', 'A pair of headphones.'),
  asset(['Media objects', 'Podcast'], 'media-objects', 'on-air-sign', 'An on-air sign lighting up; loops.', 'wide', 'loop'),
  asset(['Media objects', 'Social media'], 'media-objects', 'like-heart-burst', 'A like heart popping with sparks; one shot.', 'square', 'once'),
  asset(['Media objects', 'Social media'], 'media-objects', 'speech-bubble', 'A speech bubble with three dots.'),
  asset(['Media objects', 'Social media'], 'media-objects', 'thumbs-up', 'A thumbs up.'),
  asset(['Media objects', 'Concert'], 'media-objects', 'music-notes-float', 'Music notes floating up; loops.', 'square', 'loop'),
  asset(['Media objects', 'Concert'], 'media-objects', 'vinyl-record-spin', 'A vinyl record spinning; loops.', 'square', 'loop'),
  asset(['Media objects', 'Cinema'], 'media-objects', 'clapperboard', 'A clapperboard.'),
  asset(['Media objects', 'Cinema'], 'media-objects', 'popcorn-bucket', 'A bucket of popcorn.'),
  asset(['Media objects', 'Kids'], 'media-objects', 'teddy-bear', 'A teddy bear.'),
  asset(['Media objects', 'Fashion'], 'media-objects', 'lipstick', 'A lipstick.'),
  asset(['Media objects', 'Fashion'], 'media-objects', 'high-heel', 'A high-heeled shoe.'),
  asset(['Media objects', 'Fashion'], 'media-objects', 'handbag', 'A handbag.'),
  // Nature objects
  asset(['Nature objects', 'Nature'], 'nature-objects', 'green-leaf', 'A green leaf.'),
  asset(['Nature objects', 'Nature'], 'nature-objects', 'butterfly-flap', 'A butterfly flapping; loops.', 'square', 'loop'),
  asset(['Nature objects', 'Ocean'], 'nature-objects', 'fish-swim', 'A fish swimming; loops.', 'square', 'loop'),
  asset(['Nature objects', 'Ocean'], 'nature-objects', 'scallop-shell', 'A scallop shell.'),
  asset(['Nature objects', 'Space'], 'nature-objects', 'planet-rings', 'A ringed planet.'),
  asset(['Nature objects', 'Space'], 'nature-objects', 'rocket-launch', 'A rocket lifting off; one shot.', 'square', 'once'),
  asset(['Nature objects', 'Space'], 'nature-objects', 'comet-streak', 'A comet with its tail.', 'wide'),
  asset(['Nature objects', 'Weather'], 'nature-objects', 'rainbow-arc', 'A rainbow.', 'wide'),
  asset(['Nature objects', 'Weather'], 'nature-objects', 'umbrella-open', 'An open umbrella.'),
  // Travel objects
  asset(['Travel objects', 'Travel'], 'travel-objects', 'aeroplane-fly', 'An aeroplane flying by; loops.', 'wide', 'loop'),
  asset(['Travel objects', 'Travel'], 'travel-objects', 'suitcase', 'A suitcase with stickers.'),
  asset(['Travel objects', 'Travel'], 'travel-objects', 'compass-rose', 'A compass.'),
  asset(['Travel objects', 'City'], 'travel-objects', 'traffic-light-cycle', 'A traffic light cycling; loops.', 'square', 'loop'),
  asset(['Travel objects', 'City'], 'travel-objects', 'map-pin-drop', 'A map pin dropping in; one shot.', 'square', 'once'),
  asset(['Travel objects', 'City'], 'travel-objects', 'street-lamp', 'A street lamp.'),
  // Home objects
  asset(['Home objects', 'Food'], 'home-objects', 'coffee-cup-steam', 'A coffee cup steaming; loops.', 'square', 'loop'),
  asset(['Home objects', 'Food'], 'home-objects', 'pizza-slice', 'A slice of pizza.'),
  asset(['Home objects', 'Food'], 'home-objects', 'cupcake', 'A cupcake.'),
  asset(['Home objects'], 'home-objects', 'house-plant', 'A house plant in its pot.'),
  asset(['Home objects'], 'home-objects', 'table-lamp', 'A table lamp.'),
  asset(['Home objects'], 'home-objects', 'toaster-pop', 'A toaster popping its toast; one shot.', 'square', 'once'),
  // Community objects
  asset(['Community objects', 'Faith'], 'community-objects', 'candle-pair', 'Two candles burning; loops.', 'square', 'loop'),
  asset(['Community objects', 'Faith'], 'community-objects', 'church-bell', 'A bell.'),
  asset(['Community objects', 'Education'], 'community-objects', 'pencil-and-ruler', 'A pencil and a ruler.'),
  asset(['Community objects', 'Education'], 'community-objects', 'red-apple', 'A red apple.'),
  asset(['Community objects', 'Nonprofit'], 'community-objects', 'heart-in-hands', 'A heart held in two hands.'),
  asset(['Community objects', 'Nonprofit'], 'community-objects', 'donation-jar', 'A jar of coins.'),
  asset(['Community objects', 'Nonprofit'], 'community-objects', 'awareness-ribbon', 'An awareness ribbon.'),
  asset(['Community objects', 'Civic'], 'community-objects', 'ballot-box', 'A ballot box.'),
  asset(['Community objects', 'Civic'], 'community-objects', 'columned-building', 'A building with columns.'),
  asset(['Community objects', 'Civic'], 'community-objects', 'megaphone', 'A megaphone.'),
];

/** Every sample file, in the order they are made. */
export const SAMPLE_MEDIA: readonly SampleMediaItem[] = [...CLIPS, ...STILLS, ...MUSIC, ...SFX, ...ASSETS];

/** The file's media kind, from its extension. */
export function sampleMediaKind(item: SampleMediaItem): MediaKind {
  const { recipe } = item;
  if (recipe.kind === 'audio') return 'audio';
  if (recipe.kind === 'still') return 'image';
  if (recipe.kind === 'asset') return recipe.format === 'png' ? 'image' : 'video';
  return 'video';
}

/**
 * Encode an asset's PNG frames as WebM with alpha: VP9 in `yuva420p`, which is
 * the transparent video every platform here can decode. Tuned for speed over
 * size — these are generated on demand, not shipped.
 */
export function sampleAssetArgs(recipe: Extract<SampleRecipe, { kind: 'asset' }>, out: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(recipe.fps), '-i', '-',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '34',
    '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1',
    out,
  ];
}

/** The type the library scan will give the file from its folders, so the test can compare it with the intent. */
export function sampleMediaInferredType(item: SampleMediaItem): string | undefined {
  return inferMediaType(sampleMediaKind(item), item.folder.map(normalizeTag));
}

/** Path segments of the file under the sample-media root. */
export function sampleMediaPath(item: SampleMediaItem): string[] {
  return [...item.folder, item.file];
}

/** ffmpeg arguments that write one audio item to `out`. */
export function sampleAudioArgs(recipe: Extract<SampleRecipe, { kind: 'audio' }>, out: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', recipe.graph,
    ...(recipe.filters ? ['-af', recipe.filters] : []),
    '-t', num(recipe.seconds), '-ar', String(SR), '-ac', String(recipe.channels ?? 1), '-c:a', 'pcm_s16le',
    out,
  ];
}

/** ffmpeg arguments that turn a PNG on stdin into a JPEG at `out`. */
export function sampleJpegArgs(out: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', 'pipe:0', '-frames:v', '1', '-q:v', '3', out];
}

/** The license file every generated folder carries. */
export const SAMPLE_MEDIA_LICENSE = `CC0 1.0 Universal

The files in this folder were generated by Pulp's sample-media generator from tones, noise, gradients and the bundled sample templates. To the extent possible under law, the author has waived all copyright and related or neighboring rights to them. You can copy, modify, distribute and use them, including for commercial purposes, without asking permission.

https://creativecommons.org/publicdomain/zero/1.0/
`;

/** A README naming every file and how it was made. */
export function sampleMediaReadme(): string {
  const lines = [
    '# Sample media',
    '',
    'Generated by Pulp so that every media type in the browse tree has at least six examples. Everything here is original and CC0 (see LICENSE-CC0.txt): sounds are synthesized from tones, noise and envelopes (the animal calls are synthesized, not recorded), stills are drawn on a canvas, the clips are the bundled background templates rendered out, and the assets are drawn on transparency. The folder names give each file its type when the folder is in a Pulp library.',
    '',
    'Delete any file and run the generator again to get it back; files that already exist are left alone.',
    '',
  ];
  // Grouped by folder, not by where the item sits in the catalogue, so a file added to a folder
  // later in the list still lands under that folder's one heading.
  const byFolder = new Map<string, SampleMediaItem[]>();
  for (const item of SAMPLE_MEDIA) {
    const folder = item.folder.join(' / ');
    const group = byFolder.get(folder);
    if (group) group.push(item);
    else byFolder.set(folder, [item]);
  }
  for (const [folder, items] of byFolder) {
    lines.push(`## ${folder}`, '');
    for (const item of items) lines.push(`- \`${item.file}\`: ${item.note}`);
  }
  return `${lines.join('\n')}\n`;
}
