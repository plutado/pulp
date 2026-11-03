/**
 * On-device transcription's pure parts (milestone 50): the model catalog
 * the fetch is held to, how the sound is laid out on the project's clock, and
 * how whisper.cpp's answer is read back as words with their timings.
 *
 * The model files themselves are not fetched here — a test does not download
 * a hundred megabytes — so what is checked is the promise the checksum makes:
 * every entry names a size and a SHA-256, and the fetch refuses anything that
 * does not hash to it (src/main/speech-service.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEECH_MODEL, modelSizeText, speechLanguage, speechMixFilter, speechModel, speechRunnerPaths, SPEECH_LANGUAGE_AUTO,
  SPEECH_LANGUAGES, SPEECH_MODELS, SPEECH_SAMPLE_RATE, whisperArgs, whisperProgress, wordsFromWhisperJson, type SpeechSegment,
} from '../src/core/speech';
import { linesFromWords, lineText } from '../src/core/captions';

describe('the model catalog', () => {
  it('names a publisher, a size and a checksum for every model, over https', () => {
    for (const model of SPEECH_MODELS) {
      expect(model.url.startsWith('https://'), model.id).toBe(true);
      expect(model.bytes, model.id).toBeGreaterThan(1_000_000);
      expect(model.sha256, model.id).toMatch(/^[0-9a-f]{64}$/);
      expect(model.file.endsWith('.bin'), model.id).toBe(true);
    }
  });

  it('falls back to the default for anything it does not know', () => {
    expect(speechModel('small').id).toBe('small');
    expect(speechModel(undefined).id).toBe(DEFAULT_SPEECH_MODEL);
    expect(speechModel('enormous').id).toBe(DEFAULT_SPEECH_MODEL);
  });

  it('says a size the way a person reads one', () => {
    expect(modelSizeText(147_951_465)).toBe('148 MB');
  });

  it('looks for whisper.cpp by its own names, and takes a path given directly first', () => {
    expect(speechRunnerPaths({})).toContain('whisper-cli');
    expect(speechRunnerPaths({ PULP_WHISPER_PATH: '/opt/w/whisper-cli' })[0]).toBe('/opt/w/whisper-cli');
  });
});

describe('what the model is asked', () => {
  it('asks for the full JSON, at the language it was given', () => {
    const args = whisperArgs({ modelPath: '/m/ggml-base.bin', wavPath: '/tmp/a.wav', outBase: '/tmp/a', language: 'de', threads: 4 });
    expect(args).toContain('-ojf');
    expect(args.join(' ')).toContain('-l de');
    expect(args.join(' ')).toContain('-t 4');
    expect(args).toContain('/m/ggml-base.bin');
  });

  it('lets the model decide the language when none was chosen, or when the choice is not one it knows', () => {
    expect(whisperArgs({ modelPath: 'm', wavPath: 'w', outBase: 'o' }).join(' ')).toContain(`-l ${SPEECH_LANGUAGE_AUTO}`);
    expect(whisperArgs({ modelPath: 'm', wavPath: 'w', outBase: 'o', language: 'klingon' }).join(' ')).toContain(`-l ${SPEECH_LANGUAGE_AUTO}`);
    expect(speechLanguage(' DE ')).toBe('de');
  });

  it('offers the model\'s languages: ninety-nine, each once, by code and name, in the order a person reads', () => {
    expect(SPEECH_LANGUAGES).toHaveLength(99);
    expect(new Set(SPEECH_LANGUAGES.map((l) => l.code)).size).toBe(99);
    for (const l of SPEECH_LANGUAGES) expect(l.code, l.name).toMatch(/^[a-z]{2,3}$/);
    const names = SPEECH_LANGUAGES.map((l) => l.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(SPEECH_LANGUAGES.find((l) => l.code === 'en')?.name).toBe('English');
  });

  it('reads its progress prints, and nothing else', () => {
    expect(whisperProgress('whisper_print_progress_callback: progress =  40%')).toBe(0.4);
    expect(whisperProgress('whisper_init_from_file_with_params_no_state: loading model')).toBeNull();
  });
});

describe('laying the project\'s sound out for the model', () => {
  const cut = (at: number, from: number, to: number): SpeechSegment => ({ kind: 'clip', id: 'clip', from, to, at });

  it('delays each stretch to where it is heard, so a word lands on the project\'s clock', () => {
    const filter = speechMixFilter([cut(0, 0, 2), cut(2, 10, 12.5)]);
    expect(filter).toContain('adelay=0:all=1');
    expect(filter).toContain('adelay=2000:all=1');
    expect(filter).toContain('amix=inputs=2:normalize=0');
    expect(filter.endsWith('[speech]')).toBe(true);
  });

  it('stretches a stretch at a speed the way the mix plays it, so its words land where they are heard (milestone 56)', () => {
    // Two seconds of file at 2× are one second of the clock: the tempo is doubled, the pitch
    // kept, before the delay puts it in its place — and real time adds nothing.
    const fast = speechMixFilter([{ ...cut(0, 0, 2), speed: 2 }, cut(1, 5, 6)]);
    expect(fast).toContain('channel_layouts=mono,atempo=2,adelay=0:all=1');
    expect(fast).toContain('channel_layouts=mono,adelay=1000:all=1');
    // A quarter speed is two halvings, as the mix factors it.
    expect(speechMixFilter([{ ...cut(0, 0, 1), speed: 0.25 }])).toContain('atempo=0.5,atempo=0.5,adelay=0');
  });

  it('resamples to what the model listens at', () => {
    expect(speechMixFilter([cut(0, 0, 1)])).toContain(`aresample=${SPEECH_SAMPLE_RATE}`);
  });

  it('mixes nothing when there is one stretch, and builds nothing from none', () => {
    const one = speechMixFilter([cut(1.5, 0, 1)]);
    expect(one).not.toContain('amix');
    expect(one).toContain('adelay=1500:all=1');
    expect(speechMixFilter([])).toBe('');
  });
});

describe('reading the model\'s answer', () => {
  const full = JSON.stringify({
    transcription: [
      {
        offsets: { from: 0, to: 2000 },
        text: ' Hello there, world.',
        tokens: [
          { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
          { text: ' Hello', offsets: { from: 120, to: 480 } },
          { text: ' there', offsets: { from: 480, to: 900 } },
          { text: ',', offsets: { from: 900, to: 900 } },
          { text: ' wor', offsets: { from: 1100, to: 1400 } },
          { text: 'ld', offsets: { from: 1400, to: 1600 } },
          { text: '.', offsets: { from: 1600, to: 1600 } },
        ],
      },
    ],
  });

  it('joins the pieces of a word back up and takes its span from the first and the last', () => {
    expect(wordsFromWhisperJson(full)).toEqual([
      { text: 'Hello', start: 0.12, end: 0.48 },
      { text: 'there,', start: 0.48, end: 0.9 },
      { text: 'world.', start: 1.1, end: 1.6 },
    ]);
  });

  it('drops the markers that are not speech', () => {
    const quiet = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 3000 }, text: '[BLANK_AUDIO]', tokens: [{ text: '[BLANK_AUDIO]', offsets: { from: 0, to: 3000 } }] },
        { offsets: { from: 3000, to: 3400 }, text: ' (music)', tokens: [] },
      ],
    });
    expect(wordsFromWhisperJson(quiet)).toEqual([]);
  });

  it('spreads a segment over its own words when a build wrote no tokens', () => {
    const segments = JSON.stringify({ transcription: [{ offsets: { from: 1000, to: 3000 }, text: 'one two three' }] });
    const words = wordsFromWhisperJson(segments);
    expect(words.map((w) => w.text)).toEqual(['one', 'two', 'three']);
    expect(words[0]!.start).toBe(1);
    expect(words[2]!.end).toBe(3);
  });

  it('answers with nothing at all for anything that is not an answer', () => {
    expect(wordsFromWhisperJson('not json')).toEqual([]);
    expect(wordsFromWhisperJson('{"transcription":"soon"}')).toEqual([]);
    expect(wordsFromWhisperJson('{}')).toEqual([]);
  });

  it('comes out as caption lines, which is what it is for', () => {
    expect(linesFromWords(wordsFromWhisperJson(full)).map(lineText)).toEqual(['Hello there, world.']);
  });
});
