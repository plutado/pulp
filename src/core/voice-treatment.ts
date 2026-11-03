/**
 * Voice treatments (milestone 53): one-click clean-up for a recorded voice on
 * any layer with sound — an audio layer or a clip's own track. A talking head
 * recorded on a laptop microphone often sounds like one: room noise, hum,
 * uneven level, harsh esses. Each treatment is a fixed recipe of ffmpeg's own
 * filters — noise reduction, hum and rumble removal, a gentle compressor,
 * clarity EQ and de-essing — run locally, and deliberately no more: no
 * per-band curves, effect chains or plug-in hosting. Sound that needs those
 * is finished in an audio or editing app, which is where Pulp hands over.
 *
 * The amount scales every parameter of the recipe from "untouched" to the
 * recipe's full setting, so one slider says how much of the treatment is
 * heard; at zero the chain emits nothing at all, exactly as no treatment
 * does. The steps run on the file's own clock, before a clip's speed and
 * before the loop, the delay and the fades — and so before milestone 52's
 * loudness leveling, which measures the treated mix and still lands the
 * target.
 *
 * Pure: these functions build filtergraph text from fixed numbers and are
 * pinned string-for-string by tests/voice-treatment.test.ts.
 */

/** The treatments, in the order they are offered. */
export const VOICE_TREATMENTS = ['clean-voice', 'podcast', 'reduce-noise', 'phone', 'radio', 'warm'] as const;
export type VoiceTreatment = (typeof VOICE_TREATMENTS)[number];

export const VOICE_LABELS: Record<VoiceTreatment, string> = {
  'clean-voice': 'Clean voice',
  podcast: 'Podcast',
  'reduce-noise': 'Reduce noise',
  phone: 'Phone',
  radio: 'Radio',
  warm: 'Warm',
};

/** One line each, shown where the treatment is chosen. */
export const VOICE_DESCRIPTIONS: Record<VoiceTreatment, string> = {
  'clean-voice': 'Room noise down, rumble and hum out, gently leveled, a little clarity, the esses softened',
  podcast: 'A fuller spoken-word sound: noise down, a firmer level, presence and a touch of warmth',
  'reduce-noise': 'Noise reduction alone: the room’s hiss down, the voice left as it was',
  phone: 'A telephone’s narrow band, the level flattened',
  radio: 'Broadcast-style: no rumble, a tight level and a bright presence',
  warm: 'A softer, rounder tone: the low end lifted, the highs eased',
};

/** A treatment with how much of it is heard, carried on a sound or a clip value. */
export interface VoiceValue {
  treatment: VoiceTreatment;
  /** 0 to 1; 0 is the treatment chosen but not heard, which is how a slider rests at the left. */
  amount: number;
}

export const VOICE_LIMITS = { amount: { min: 0, max: 1 } } as const;
export const DEFAULT_VOICE_AMOUNT = 1;

/**
 * A voice value from anything at all: a bare string is a treatment at full
 * amount, an object must name a known treatment. `undefined` is no treatment,
 * so a layer nobody has treated serializes as it always did.
 */
export function sanitizeVoice(input: unknown): VoiceValue | undefined {
  const named = typeof input === 'string' ? { treatment: input } : input;
  if (typeof named !== 'object' || named === null) return undefined;
  const r = named as Record<string, unknown>;
  if (!(VOICE_TREATMENTS as readonly string[]).includes(r.treatment as string)) return undefined;
  const amount = typeof r.amount === 'number' && Number.isFinite(r.amount)
    ? Math.round(Math.min(VOICE_LIMITS.amount.max, Math.max(VOICE_LIMITS.amount.min, r.amount)) * 100) / 100
    : DEFAULT_VOICE_AMOUNT;
  return { treatment: r.treatment as VoiceTreatment, amount };
}

/** The text form for presets and CSV: the treatment alone at full amount, `treatment:0.6` otherwise. */
export function voiceToText(voice: VoiceValue): string {
  return voice.amount === DEFAULT_VOICE_AMOUNT ? voice.treatment : `${voice.treatment}:${voice.amount}`;
}

export function voiceFromText(text: string): VoiceValue | undefined {
  const [treatment, amount] = text.split(':', 2);
  return sanitizeVoice({ treatment, ...(amount !== undefined ? { amount: Number(amount) } : {}) });
}

// ---------------------------------------------------------------- the recipes

/** A parameter scaled by the amount, from its untouched value to the recipe's own. */
const toward = (from: number, to: number, amount: number, decimals = 2): string => {
  const v = from + (to - from) * amount;
  const rounded = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return String(rounded);
};

/** A frequency scaled by the amount, to the whole hertz. */
const hz = (from: number, to: number, amount: number): string => toward(from, to, amount, 0);

/**
 * The filter steps a treatment adds to a layer's audio chain, scaled by its
 * amount; none at all at zero. The noise reducer carries its floor (`nf`)
 * raised with the amount: ffmpeg's default floor sits at -50 dB and leaves a
 * real room's hiss untouched, and the tracked floor settles on the hiss as
 * "signal" — a fixed floor scaled by the slider is what audibly cleans. Thresholds are linear (ffmpeg's compressor
 * takes no dB), 0.125 being -18 dBFS; every number is fixed by the recipe, so
 * nothing here ever needs quoting (src/core/clip-clean.ts quotes paths, and a
 * recipe has none).
 */
export function voiceSteps(voice: VoiceValue | undefined, amount = voice?.amount ?? 0): string[] {
  if (!voice || !(amount > 0)) return [];
  const a = Math.min(1, amount);
  switch (voice.treatment) {
    case 'clean-voice':
      return [
        `highpass=f=${hz(20, 80, a)}`,
        `afftdn=nr=${toward(0.01, 12, a, 1)}:nf=${toward(-50, -30, a, 1)}`,
        `acompressor=threshold=0.125:ratio=${toward(1, 2, a)}:attack=20:release=250:makeup=${toward(1, 1.4, a)}`,
        `equalizer=f=3000:t=q:w=1:g=${toward(0, 2.5, a)}`,
        `deesser=i=${toward(0, 0.35, a)}`,
      ];
    case 'podcast':
      return [
        `highpass=f=${hz(20, 90, a)}`,
        `afftdn=nr=${toward(0.01, 10, a, 1)}:nf=${toward(-50, -30, a, 1)}`,
        `acompressor=threshold=0.1:ratio=${toward(1, 3, a)}:attack=15:release=200:makeup=${toward(1, 1.6, a)}`,
        `bass=g=${toward(0, 1.5, a)}:f=130`,
        `equalizer=f=3500:t=q:w=1:g=${toward(0, 3, a)}`,
        `deesser=i=${toward(0, 0.4, a)}`,
      ];
    case 'reduce-noise':
      return [
        `highpass=f=${hz(20, 60, a)}`,
        `afftdn=nr=${toward(0.01, 30, a, 1)}:nf=${toward(-50, -25, a, 1)}`,
      ];
    case 'phone':
      return [
        `highpass=f=${hz(20, 310, a)}`,
        `lowpass=f=${hz(20000, 3400, a)}`,
        `acompressor=threshold=0.0625:ratio=${toward(1, 4, a)}:attack=10:release=150:makeup=${toward(1, 1.8, a)}`,
      ];
    case 'radio':
      return [
        `highpass=f=${hz(20, 120, a)}`,
        `lowpass=f=${hz(20000, 9000, a)}`,
        `afftdn=nr=${toward(0.01, 8, a, 1)}:nf=${toward(-50, -30, a, 1)}`,
        `acompressor=threshold=0.09:ratio=${toward(1, 4, a)}:attack=5:release=150:makeup=${toward(1, 1.8, a)}`,
        `equalizer=f=3200:t=q:w=1:g=${toward(0, 4, a)}`,
        `deesser=i=${toward(0, 0.3, a)}`,
      ];
    case 'warm':
      return [
        `highpass=f=${hz(20, 50, a)}`,
        `bass=g=${toward(0, 4, a)}:f=150`,
        `treble=g=${toward(0, -2.5, a)}:f=8000`,
        `acompressor=threshold=0.125:ratio=${toward(1, 2, a)}:attack=25:release=300:makeup=${toward(1, 1.2, a)}`,
      ];
  }
}
