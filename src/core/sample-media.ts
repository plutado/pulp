/**
 * The sample-media catalogue (milestone 21): original CC0 media files that a
 * library can be filled with on demand, so the browse tree's media types —
 * video clips, stills, music, sound effects — have three to five examples
 * each without a single binary file in the repository.
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
 * check the catalogue against the type inference and the 3-5 rule.
 */

import { STILL_PAGES } from './sample-stills';
import { normalizeTag } from './tags';
import { inferMediaType } from './taxonomy';
import type { MediaKind } from './library-types';

export const SAMPLE_MEDIA_FOLDER_NAME = 'Sample media';

export type SampleRecipe =
  | { kind: 'audio'; graph: string; filters?: string; seconds: number; channels?: 1 | 2 }
  | { kind: 'still'; page: keyof typeof STILL_PAGES; variant: string; format: 'png' | 'jpg'; width: number; height: number }
  | { kind: 'clip'; templateId: string; seconds: number; width: number; height: number };

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
];

/** Every sample file, in the order they are made. */
export const SAMPLE_MEDIA: readonly SampleMediaItem[] = [...CLIPS, ...STILLS, ...MUSIC, ...SFX];

/** The file's media kind, from its extension. */
export function sampleMediaKind(item: SampleMediaItem): MediaKind {
  return item.recipe.kind === 'audio' ? 'audio' : item.recipe.kind === 'still' ? 'image' : 'video';
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
    'Generated by Pulp so that every media type in the browse tree has at least six examples. Everything here is original and CC0 (see LICENSE-CC0.txt): sounds are synthesized from tones, noise and envelopes (the animal calls are synthesized, not recorded), stills are drawn on a canvas, and the clips are the bundled background templates rendered out. The folder names give each file its type when the folder is in a Pulp library.',
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
