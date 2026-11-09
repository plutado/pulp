/**
 * Audio layers (milestone 48): a piece of music or a voice-over placed in a
 * project, and the arithmetic that decides which moment of the file belongs
 * to a given moment of the graphic.
 *
 * The sibling of `video-layer.ts` and deliberately shaped like it, so a sound
 * is set up the way a clip is: an in and an out point, loop or play once, a
 * start delay, a volume and a mute. What it adds is a fade in and a fade out,
 * which a picture gets from its transitions and a sound cannot.
 *
 * **In and out points are seconds, not frames.** A clip is counted in frames
 * because it has them and the picture must land on one; a sound has none, and
 * a person placing music thinks "from eight seconds in", not "from frame 384".
 *
 * Pure, and the only place the decision is made: the preview and the render
 * both ask these functions, so what is heard cannot drift from what is
 * written.
 */

import { duckFromText, duckToText, sanitizeDuck, type DuckValue } from './duck';
import { sanitizeVoice, voiceFromText, voiceToText, type VoiceValue } from './voice-treatment';

/** How the sound behaves when it reaches its out point. */
export const SOUND_ENDINGS = ['loop', 'once'] as const;
export type SoundEnding = (typeof SOUND_ENDINGS)[number];

export const SOUND_LIMITS = {
  /** Seconds to wait before the sound starts, within the graphic. */
  delay: { min: 0, max: 600 },
  /** Seconds of fade at either end. Longer than this is a mix, not a fade. */
  fade: { min: 0, max: 30 },
  /** Seconds into the file; the window is held to what the file actually holds once it is measured. */
  point: { min: 0, max: 86_400 },
  /** How many stems one piece of music may be split into (milestone 16). More than this is a session, not a layer. */
  stems: 12,
} as const;

/**
 * One stem of a piece of music (milestone 16): the same piece split into
 * parallel tracks — drums, bass, keys, vocals — that play **together** under
 * the layer's one window, delay and fades, since they are one recording cut
 * apart. What differs per stem is which file it is, its own gain against the
 * layer's volume, and the mixer's two buttons: mute, and solo — when any stem
 * is soloed, only the soloed ones are heard.
 */
export interface SoundStem {
  /** A library id, like the layer's own sound. */
  id: string;
  /** What the lane and the card call it: "Drums", "Bass". */
  label: string;
  muted: boolean;
  solo: boolean;
  /** 0 to 1 against the file as recorded, under the layer's volume. */
  gain: number;
}

/**
 * A sound chosen for a layer. `id` is a library id and nothing else — the
 * page never sees a path, and the host reads only the sounds a layer names,
 * by the same grant pictures and clips use (ADR 0013).
 */
export interface SoundValue {
  id: string | null;
  /** Seconds into the file the layer plays from. */
  inPoint: number;
  /** Seconds into the file it plays to; -1 means "to the end", whatever the length turns out to be. */
  outPoint: number;
  ending: SoundEnding;
  /** Seconds into the graphic before the sound starts. */
  delay: number;
  /** 0 to 1; 1 is as recorded. */
  volume: number;
  /** Sound off, volume kept, like a mixer's mute. */
  muted: boolean;
  /** Seconds of silence rising to the volume at the start of what is heard. */
  fadeIn: number;
  /** Seconds of the volume falling to silence at the end of what is heard. */
  fadeOut: number;
  /** Chosen but not heard, and taking no room, like a hidden picture. */
  hidden: boolean;
  /** A voice treatment with its amount (milestone 53, src/core/voice-treatment.ts); absent is as recorded. */
  voice?: VoiceValue;
  /** Dip under a voice layer while it speaks (milestone 80, src/core/duck.ts); absent is a level held. */
  duck?: DuckValue;
  /**
   * The music as stems (milestone 16): when present, these files play together
   * instead of `id` — which is kept equal to the first stem's id, so everything
   * that asks "is a sound chosen" keeps its answer. Absent is one file, as ever.
   */
  stems?: SoundStem[];
}

export const EMPTY_SOUND: SoundValue = {
  id: null,
  inPoint: 0,
  outPoint: -1,
  ending: 'once',
  delay: 0,
  volume: 1,
  muted: false,
  fadeIn: 0,
  fadeOut: 0,
  hidden: false,
};

/** What the host measured about a sound: enough to know where its end is. */
export interface SoundSource {
  /** Seconds the whole file runs for. */
  duration: number;
}

/**
 * The stretch of the file a value selects, in its own seconds, held to what
 * the file holds. An out point of -1, or one past the end, is the end; an in
 * point at or past the out point leaves nothing to play, which is silence
 * rather than a guess at what was meant.
 */
export function soundWindow(value: Pick<SoundValue, 'inPoint' | 'outPoint'>, source: SoundSource): { from: number; to: number; seconds: number } {
  const duration = Number.isFinite(source.duration) && source.duration > 0 ? source.duration : 0;
  if (duration === 0) return { from: 0, to: 0, seconds: 0 };
  const to = value.outPoint < 0 || value.outPoint > duration ? duration : Math.max(0, value.outPoint);
  const from = Math.min(Math.max(0, value.inPoint), to);
  return { from, to, seconds: Math.max(0, to - from) };
}

/** Seconds one pass of the chosen window runs for. A looping sound has no end, so this is one pass. */
export function soundPassSeconds(value: SoundValue, source: SoundSource): number {
  return soundWindow(value, source).seconds;
}

/** Does the layer ask to be heard at all? A hidden, muted or silent one does not. */
export function soundAudible(value: SoundValue | null): value is SoundValue {
  return Boolean(value && value.id !== null && !value.hidden && !value.muted && value.volume > 0);
}

/**
 * Seconds into the file whose sound belongs to `time` seconds of the graphic,
 * or `null` when the layer is silent then — before its start delay, or after
 * a `once` sound has played its window out. A looping sound comes round
 * forever, so it is only ever absent during its delay.
 */
export function soundTimeAt(time: number, value: SoundValue, source: SoundSource): number | null {
  if (!Number.isFinite(time) || value.id === null || value.hidden) return null;
  const { from, seconds } = soundWindow(value, source);
  if (seconds <= 0) return null;
  const elapsed = time - Math.max(0, value.delay);
  // A hair under zero is the start, not "not yet": a boundary computed in seconds can land early.
  if (elapsed < -1e-9) return null;
  let within = Math.max(0, elapsed);
  if (value.ending === 'loop') within = within % seconds;
  else if (within >= seconds - 1e-9) return null;
  return from + within;
}

/** The stems a layer is heard through (milestone 16): the soloed ones when any is soloed, otherwise the unmuted. */
export function heardStems(value: Pick<SoundValue, 'stems'>): SoundStem[] {
  const stems = value.stems ?? [];
  const solos = stems.filter((s) => s.solo);
  // Mute wins inside a solo, as on a mixing desk: a stem both soloed and muted is silent.
  return (solos.length > 0 ? solos : stems).filter((s) => !s.muted);
}

/**
 * One sound to actually play per file (milestone 16): the value itself when it
 * is one file, or one derived single-file value per heard stem — the layer's
 * own window, delay, fades and voice, the stem's file and its gain folded into
 * the volume. The preview's elements, the loudness meter and the render's
 * chains all expand through here, so a solo is the same solo everywhere.
 */
export interface PlayableSound {
  value: SoundValue;
  /** Which stem this is, when the sound is stems; absent for a single file. */
  stem?: { index: number; label: string };
}

export function playableSounds(value: SoundValue | null): PlayableSound[] {
  if (!value || value.id === null) return [];
  if (!value.stems || value.stems.length === 0) return [{ value }];
  const heard = new Set(heardStems(value));
  return value.stems.flatMap((stem, index) => {
    if (!heard.has(stem)) return [];
    const derived: SoundValue = { ...value, id: stem.id, volume: Math.round(value.volume * stem.gain * 100) / 100 };
    delete derived.stems;
    return [{ value: derived, stem: { index, label: stem.label } }];
  });
}

/** The stems read from anything at all: each with an id, a label, its gain in range, and its two buttons. */
export function sanitizeStems(input: unknown): SoundStem[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: SoundStem[] = [];
  for (const raw of input) {
    if (out.length >= SOUND_LIMITS.stems) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' && r.id.trim() !== '' ? r.id.trim() : null;
    if (id === null) continue;
    const label = typeof r.label === 'string' && r.label.trim() !== '' ? r.label.trim() : `Stem ${out.length + 1}`;
    const gain = typeof r.gain === 'number' && Number.isFinite(r.gain) ? Math.min(1, Math.max(0, Math.round(r.gain * 100) / 100)) : 1;
    out.push({ id, label, muted: r.muted === true, solo: r.solo === true, gain });
  }
  return out.length > 0 ? out : undefined;
}

/** A sound value with every field in range, from anything at all; `undefined` when the input is not one. */
export function sanitizeSoundValue(input: unknown): SoundValue | null | undefined {
  if (input === null) return null;
  if (typeof input === 'string') {
    const text = input.trim();
    if (text === '') return null;
    if (text.toLowerCase() === 'hidden') return { ...EMPTY_SOUND, hidden: true };
    return { ...EMPTY_SOUND, id: text };
  }
  if (typeof input !== 'object') return undefined;
  const r = input as Record<string, unknown>;
  const stems = sanitizeStems(r.stems);
  const id = typeof r.id === 'string' && r.id.trim() !== '' ? r.id.trim() : (stems ? stems[0]!.id : null);
  if (id === null && r.hidden !== true) return null;
  /** Seconds, kept to the millisecond: a sound is placed by ear, not to the sample. */
  const seconds = (v: unknown, fallback: number, limit: { min: number; max: number }): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return Math.min(limit.max, Math.max(limit.min, Math.round(v * 1000) / 1000));
  };
  const inPoint = seconds(r.inPoint, 0, SOUND_LIMITS.point);
  // -1 is "to the end" and is kept as it is; anything else is a point in the file.
  const outPoint = typeof r.outPoint === 'number' && Number.isFinite(r.outPoint) && r.outPoint < 0 ? -1 : seconds(r.outPoint, -1, SOUND_LIMITS.point);
  const ending = (SOUND_ENDINGS as readonly string[]).includes(r.ending as string) ? (r.ending as SoundEnding) : EMPTY_SOUND.ending;
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, Math.round(r.volume * 100) / 100)) : 1;
  const voice = sanitizeVoice(r.voice);
  const duck = sanitizeDuck(r.duck);
  return {
    // The first stem's file stands as the layer's id (milestone 16), so "is a sound chosen" and
    // "what does the library know about it" keep an answer; playback goes through the stems.
    id: stems ? stems[0]!.id : id,
    inPoint,
    outPoint,
    ending,
    delay: seconds(r.delay, 0, SOUND_LIMITS.delay),
    volume,
    muted: r.muted === true,
    fadeIn: seconds(r.fadeIn, 0, SOUND_LIMITS.fade),
    fadeOut: seconds(r.fadeOut, 0, SOUND_LIMITS.fade),
    hidden: r.hidden === true,
    ...(voice ? { voice } : {}),
    ...(duck ? { duck } : {}),
    ...(stems ? { stems } : {}),
  };
}

/** The same value written short, for presets, collections and CSV: defaults are left out. */
export function soundValueToText(value: SoundValue | null): string {
  if (value === null) return '';
  if (value.id === null) return value.hidden ? 'hidden' : '';
  const parts = [value.id];
  if (value.inPoint !== 0) parts.push(`in=${value.inPoint}`);
  if (value.outPoint !== -1) parts.push(`out=${value.outPoint}`);
  if (value.ending !== EMPTY_SOUND.ending) parts.push(`ending=${value.ending}`);
  if (value.delay !== 0) parts.push(`delay=${value.delay}`);
  if (value.volume !== 1) parts.push(`volume=${value.volume}`);
  if (value.fadeIn !== 0) parts.push(`fadein=${value.fadeIn}`);
  if (value.fadeOut !== 0) parts.push(`fadeout=${value.fadeOut}`);
  if (value.voice) parts.push(`voice=${voiceToText(value.voice)}`);
  if (value.duck) parts.push(`duck=${duckToText(value.duck)}`);
  // Each stem (milestone 16): id, URI-encoded label, gain, and its two buttons as flags.
  for (const stem of value.stems ?? []) {
    const flags = `${stem.muted ? 'm' : ''}${stem.solo ? 's' : ''}`;
    parts.push(`stem=${stem.id}|${encodeURIComponent(stem.label)}|${stem.gain}|${flags}`);
  }
  if (value.muted) parts.push('muted');
  if (value.hidden) parts.push('hidden');
  return parts.join(' ');
}

/** The short names the text form uses, against the fields they set. */
const TEXT_KEYS: Record<string, string> = {
  in: 'inPoint', out: 'outPoint', ending: 'ending', delay: 'delay', volume: 'volume', fadein: 'fadeIn', fadeout: 'fadeOut',
};

/** Read what `soundValueToText` wrote: an id, then any of the settings as `key=value`. */
export function soundValueFromText(text: string): SoundValue | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (trimmed.toLowerCase() === 'hidden') return { ...EMPTY_SOUND, hidden: true };
  const [id, ...rest] = trimmed.split(/\s+/);
  const fields: Record<string, unknown> = { id };
  for (const part of rest) {
    const word = part.toLowerCase();
    if (word === 'hidden' || word === 'muted') {
      fields[word] = true;
      continue;
    }
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const name = part.slice(0, at).toLowerCase();
    const raw = part.slice(at + 1);
    if (name === 'voice') {
      const voice = voiceFromText(raw);
      if (voice) fields.voice = voice;
      continue;
    }
    if (name === 'duck') {
      const duck = duckFromText(raw);
      if (duck) fields.duck = duck;
      continue;
    }
    if (name === 'stem') {
      const [stemId, label, gain, flags] = raw.split('|');
      if (!stemId) continue;
      const stems = (fields.stems as unknown[] | undefined) ?? [];
      stems.push({
        id: stemId,
        label: label ? decodeURIComponent(label) : undefined,
        gain: gain !== undefined && gain !== '' ? Number(gain) : 1,
        muted: (flags ?? '').includes('m'),
        solo: (flags ?? '').includes('s'),
      });
      fields.stems = stems;
      continue;
    }
    const field = TEXT_KEYS[name];
    if (!field) continue;
    if (field === 'ending') fields.ending = raw;
    else if (raw.trim() !== '' && Number.isFinite(Number(raw))) fields[field] = Number(raw);
  }
  return sanitizeSoundValue(fields) ?? null;
}

/** Does any audio layer in these raw stacks hold its music as stems (milestone 16)? Read tolerantly, like `soundIdsInLayers`. */
export function layersHaveStems(layers: unknown): boolean {
  if (typeof layers !== 'object' || layers === null) return false;
  for (const stack of Object.values(layers as Record<string, unknown>)) {
    if (!Array.isArray(stack)) continue;
    for (const layer of stack) {
      if (typeof layer !== 'object' || layer === null) continue;
      const value = sanitizeSoundValue((layer as { sound?: unknown }).sound);
      if (value && !value.hidden && (value.stems?.length ?? 0) > 0) return true;
    }
  }
  return false;
}

/**
 * Every sound id named by a set of layer stacks, however raw. Used where the
 * stacks have not been resolved against a manifest yet — the render cache key
 * is built before the template is loaded — so it reads tolerantly and ignores
 * anything that is not a sound.
 */
export function soundIdsInLayers(layers: unknown): string[] {
  const ids: string[] = [];
  if (typeof layers !== 'object' || layers === null) return ids;
  for (const stack of Object.values(layers as Record<string, unknown>)) {
    if (!Array.isArray(stack)) continue;
    for (const layer of stack) {
      if (typeof layer !== 'object' || layer === null) continue;
      const value = sanitizeSoundValue((layer as { sound?: unknown }).sound);
      if (!value || value.hidden) continue;
      // Every file the layer may read: the one sound, or each of its stems (milestone 16).
      for (const id of value.stems ? value.stems.map((s) => s.id) : value.id ? [value.id] : []) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
  }
  return ids.sort();
}
