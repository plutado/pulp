/**
 * Music as stems (milestone 16): one piece split into parallel tracks under a
 * layer's one window, each with its mute, solo and gain; the expansion every
 * consumer plays through; and the render that writes one WAV per stem beside
 * the output. Plus the pack-declared sound variations (milestone 16 meets
 * packs) and the Sound badge on cards.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyStemAudio, stemOutputPath, type SoundAudioLayer } from '../src/core/layer-audio';
import { layerSoundChoices } from '../src/core/layer-layout';
import { applyPackDefaults, packSoundFor } from '../src/core/library-scan';
import { parsePackManifest } from '../src/core/pack';
import { buildRenderPlan, type RenderPlan } from '../src/core/render-plan';
import { entryBadges } from '../src/core/results-view';
import {
  EMPTY_SOUND, heardStems, layersHaveStems, playableSounds, sanitizeSoundValue, SOUND_LIMITS,
  soundIdsInLayers, soundValueFromText, soundValueToText, type SoundStem, type SoundValue,
} from '../src/core/sound-layer';
import { validManifest } from './fixtures';

const stem = (over: Partial<SoundStem> = {}): SoundStem => ({ id: 'drums', label: 'Drums', muted: false, solo: false, gain: 1, ...over });
const stemmed = (stems: SoundStem[], over: Partial<SoundValue> = {}): SoundValue => ({ ...EMPTY_SOUND, id: stems[0]!.id, stems, ...over });

describe('stems on a sound value', () => {
  it('sanitizes stems, keeps the first stem as the layer\'s id, and caps the list', () => {
    const value = sanitizeSoundValue({ stems: [{ id: 'a', label: ' Drums ' }, { id: 'b', gain: 7 }, { id: '' }, 'junk'] });
    expect(value?.id).toBe('a');
    expect(value?.stems).toEqual([
      { id: 'a', label: 'Drums', muted: false, solo: false, gain: 1 },
      { id: 'b', label: 'Stem 2', muted: false, solo: false, gain: 1 },
    ]);
    const many = sanitizeSoundValue({ stems: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` })) });
    expect(many?.stems).toHaveLength(SOUND_LIMITS.stems);
  });

  it('hears the unmuted stems, the solos when any is soloed, and mute wins inside a solo', () => {
    const drums = stem();
    const bass = stem({ id: 'bass', label: 'Bass', muted: true });
    const keys = stem({ id: 'keys', label: 'Keys' });
    expect(heardStems({ stems: [drums, bass, keys] })).toEqual([drums, keys]);
    const soloed = stem({ id: 'keys', label: 'Keys', solo: true });
    expect(heardStems({ stems: [drums, bass, soloed] })).toEqual([soloed]);
    expect(heardStems({ stems: [drums, stem({ id: 'bass', solo: true, muted: true })] })).toEqual([]);
  });

  it('expands to one playable sound per heard stem, the gain folded into the volume, the window shared', () => {
    const value = stemmed([stem({ gain: 0.5 }), stem({ id: 'bass', label: 'Bass' })], { volume: 0.8, delay: 2, fadeOut: 1 });
    const out = playableSounds(value);
    expect(out).toHaveLength(2);
    expect(out[0]!.stem).toEqual({ index: 0, label: 'Drums' });
    expect(out[0]!.value).toMatchObject({ id: 'drums', volume: 0.4, delay: 2, fadeOut: 1 });
    expect(out[0]!.value.stems).toBeUndefined();
    expect(out[1]!.value).toMatchObject({ id: 'bass', volume: 0.8 });
    // One file stays one playable sound, unmarked.
    expect(playableSounds({ ...EMPTY_SOUND, id: 'one' })).toEqual([{ value: { ...EMPTY_SOUND, id: 'one' } }]);
  });

  it('round-trips through the text form, labels and buttons included', () => {
    const value = stemmed([stem({ gain: 0.5, muted: true }), stem({ id: 'bass', label: 'Bass & Keys', solo: true })], { delay: 1 });
    const back = soundValueFromText(soundValueToText(value));
    expect(back?.stems).toEqual(value.stems);
    expect(back?.delay).toBe(1);
    expect(back?.id).toBe('drums');
  });

  it('names every stem\'s file among the layers\' sound ids, and says when a project holds stems', () => {
    const layers = { stack: [{ type: 'audio', sound: stemmed([stem(), stem({ id: 'bass', label: 'Bass' })]) }] };
    expect(soundIdsInLayers(layers)).toEqual(['bass', 'drums']);
    expect(layersHaveStems(layers)).toBe(true);
    expect(layersHaveStems({ stack: [{ type: 'audio', sound: { ...EMPTY_SOUND, id: 'one' } }] })).toBe(false);
  });

  it('expands layer sound choices to one entry per heard stem, each naming which stem it is', () => {
    const manifest = { blocks: [{ id: 'b', label: 'B', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [] }] } as unknown as Parameters<typeof layerSoundChoices>[0];
    const layers = { b: [{ id: 'music', label: 'Music', type: 'audio', sound: stemmed([stem(), stem({ id: 'bass', label: 'Bass', muted: true }), stem({ id: 'keys', label: 'Keys' })]) }] } as unknown as Parameters<typeof layerSoundChoices>[1];
    const choices = layerSoundChoices(manifest, layers);
    expect(choices.map((c) => c.id)).toEqual(['drums', 'keys']);
    expect(choices.map((c) => c.stem)).toEqual([{ index: 0, label: 'Drums' }, { index: 2, label: 'Keys' }]);
    expect(choices.every((c) => c.layer === 'music')).toBe(true);
  });
});

describe('one WAV per stem beside the render', () => {
  const plan = (presetId: string): RenderPlan => buildRenderPlan({
    manifest: { fps: 30, duration: 2, alpha: true, aspects: ['16:9'], size: { width: 320, height: 180 } },
    presetId,
    outputPath: '/out/render',
  });
  const stemLayer = (id: string, path: string): SoundAudioLayer => ({ kind: 'sound', path, value: { ...EMPTY_SOUND, id }, source: { duration: 4 } });

  it('names each stem\'s file from its label, beside the output, the sequence pattern dropped', () => {
    expect(stemOutputPath('/out/render.mp4', 'Drums', 0)).toBe('/out/render-drums.wav');
    expect(stemOutputPath('/out/render_%05d.png', 'Bass & Keys', 1)).toBe('/out/render-bass-keys.wav');
    expect(stemOutputPath('/out/render.mov', '!!!', 2)).toBe('/out/render-stem-3.wav');
  });

  it('adds each stem as its own chain, mapped to its own PCM WAV after the main output', () => {
    const after = applyStemAudio(plan('h264-mp4'), [
      { layer: stemLayer('drums', '/lib/drums.wav'), label: 'Drums' },
      { layer: stemLayer('bass', '/lib/bass.wav'), label: 'Bass' },
    ]);
    expect(after.stemOutputs).toEqual(['/out/render-drums.wav', '/out/render-bass.wav']);
    const args = after.args;
    const inputs = args.flatMap((a: string, i: number) => (a === '-i' ? [args[i + 1]] : []));
    expect(inputs).toEqual(['pipe:0', '/lib/drums.wav', '/lib/bass.wav']);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[1:a]aresample');
    expect(graph).toContain('[aouts0]');
    expect(graph).toContain('[aouts1]');
    // Each stem is mapped after the main output, PCM, to its own file.
    const out = args.indexOf(after.output);
    expect(args.indexOf('/out/render-drums.wav')).toBeGreaterThan(out);
    expect(args.filter((a) => a === 'pcm_s16le')).toHaveLength(2);
  });

  it('folds a plain -vf chain into one graph, exactly as the mix does, so stems alone still render', () => {
    const after = applyStemAudio(plan('prores-4444'), [{ layer: stemLayer('drums', '/lib/drums.wav'), label: 'Drums' }]);
    expect(after.args).not.toContain('-vf');
    const maps = after.args.flatMap((a: string, i: number) => (a === '-map' ? [after.args[i + 1]] : []));
    expect(maps).toEqual(['[vout]', '[aouts0]']);
  });

  it('is the plan untouched when every stem is silent', () => {
    const before = plan('h264-mp4');
    const muted = stemLayer('drums', '/lib/drums.wav');
    muted.value = { ...muted.value, muted: true };
    expect(applyStemAudio(before, [{ layer: muted, label: 'Drums' }])).toBe(before);
  });
});

describe('a pack\'s sound variations', () => {
  const packJson = (over: Record<string, unknown> = {}) => JSON.stringify({
    formatVersion: 1, name: 'Whoosh Pack', license: 'CC0-1.0', templates: ['one'],
    sound: { variants: [{ value: 'soft', label: 'Soft', file: 'sounds/soft.wav' }, { value: 'sharp', label: 'Sharp', file: 'sounds/sharp.wav' }], default: 'soft' },
    ...over,
  });

  it('parses a declared sound, and refuses a broken one by name', () => {
    const parsed = parsePackManifest(packJson());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.sound?.variants).toHaveLength(2);
    const broken = parsePackManifest(packJson({ sound: { variants: [{ value: 'soft', label: 'Soft', file: '../soft.wav' }] } }));
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.problems.join(' ')).toContain('sound.variants[0].file');
  });

  it('applies to a template that declares none, and never over one that declares its own', () => {
    const manifest = validManifest();
    const sound = { variants: [{ value: 'soft', label: 'Soft', file: 'sounds/soft.wav' }] };
    const pack = { name: 'P', slug: 'p', sound };
    expect(applyPackDefaults(manifest, pack).sound).toEqual(sound);
    const own = { ...manifest, sound: { variants: [{ value: 'own', label: 'Own', file: 'own.wav' }] } };
    expect(applyPackDefaults(own, pack).sound).toEqual(own.sound);
  });

  it('keeps only the variants whose files the template folder really holds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulp-pack-sound-'));
    cleanups.push(dir);
    await mkdir(join(dir, 'sounds'), { recursive: true });
    await writeFile(join(dir, 'sounds', 'soft.wav'), 'x');
    const sound = {
      variants: [
        { value: 'soft', label: 'Soft', file: 'sounds/soft.wav' },
        { value: 'sharp', label: 'Sharp', file: 'sounds/sharp.wav' },
      ],
      default: 'sharp',
    };
    const applied = await packSoundFor(sound, dir);
    expect(applied?.variants.map((v) => v.value)).toEqual(['soft']);
    // The default named a dropped variant, so it goes with it; the first kept variant stands.
    expect(applied?.default).toBeUndefined();
    expect(await packSoundFor({ variants: [sound.variants[1]!] }, dir)).toBeNull();
  });
});

describe('the Sound badge', () => {
  it('sits on a template that carries its own sound, counting the variations, and on no other card', () => {
    const plain = { kind: 'template' as const, key: 'k', id: 'i', dir: '/t', size: 0, mtimeMs: 0, root: '/r', manifest: validManifest(), tags: [], warnings: [] };
    expect(entryBadges(plain).some((b) => b.id === 'sound')).toBe(false);
    const sounded = {
      ...plain,
      manifest: { ...validManifest(), sound: { variants: [{ value: 'a', label: 'A', file: 'a.wav' }, { value: 'b', label: 'B', file: 'b.wav' }] } },
    };
    const badge = entryBadges(sounded).find((b) => b.id === 'sound');
    expect(badge?.label).toBe('Sound');
    expect(badge?.tip).toContain('2 variations');
  });
});

const cleanups: string[] = [];
afterAll(async () => {
  for (const dir of cleanups) await rm(dir, { recursive: true, force: true });
});
