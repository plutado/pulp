/**
 * Every layer's sound (milestone 48): when a layer is heard and how loud,
 * and the audio inputs and filter chains that join the render plan's ffmpeg
 * command. Pure arithmetic over argument lists, so what a render would run is
 * read here rather than hoped for — a wrong trim, a missing map or a fade on
 * the wrong clock would show as a file that drifts from its picture, the kind
 * of thing only ffprobe or this test catches.
 */

import { describe, expect, it } from 'vitest';
import {
  applyLayerAudio, atempoChain, audibleLayers, audioOutputPath, GATE_SECONDS, LAYER_AUDIO_RATE,
  layerAudioChain, layerAudioFilter, layerBarPeaks, layerGainAt, layerHeard, loudnormFilter,
  measureMixArgs, parseMixLoudness, presetAudioArgs,
  type ClipAudioLayer, type MixLoudness, type SoundAudioLayer,
} from '../src/core/layer-audio';
import { buildRenderPlan, PRESET_IDS, type RenderPlan } from '../src/core/render-plan';
import { EMPTY_SOUND, type SoundValue } from '../src/core/sound-layer';
import { EMPTY_CLIP, type ClipSource, type ClipValue } from '../src/core/video-layer';

const source: ClipSource = { frames: 30, fps: 30 };
const clip = (over: Partial<ClipValue> = {}): ClipValue => ({ ...EMPTY_CLIP, id: 'abc', ...over });
const layer = (over: Partial<ClipValue> = {}, path = '/lib/clip.mp4'): ClipAudioLayer => ({ kind: 'clip', path, value: clip(over), source });

/** An audio layer over a four-second file. */
const sound = (over: Partial<SoundValue> = {}): SoundValue => ({ ...EMPTY_SOUND, id: 'snd', ...over });
const music = (over: Partial<SoundValue> = {}, path = '/lib/music.wav'): SoundAudioLayer => ({ kind: 'sound', path, value: sound(over), source: { duration: 4 } });

/** A plan for the fixture-shaped template; alpha so h264 takes the flatten branch and prores the plain one. */
function plan(presetId: string, options: Record<string, unknown> = {}): RenderPlan {
  return buildRenderPlan({
    manifest: { fps: 30, duration: 2, alpha: true, aspects: ['16:9'], size: { width: 320, height: 180 } },
    presetId,
    outputPath: '/out/render',
    options,
  });
}

describe('what each preset does with sound', () => {
  it('names a codec for every output with room for one, and none for the images', () => {
    expect(presetAudioArgs('h264-mp4')).toEqual(['-c:a', 'aac', '-b:a', '192k']);
    expect(presetAudioArgs('prores-4444')).toEqual(['-c:a', 'pcm_s16le']);
    expect(presetAudioArgs('webm-vp9-alpha')).toEqual(['-c:a', 'libopus', '-b:a', '128k']);
    expect(presetAudioArgs('png-sequence')).toBeNull();
    expect(presetAudioArgs('png-still')).toBeNull();
    // Every preset has an answer, so a new one cannot arrive without deciding.
    for (const id of PRESET_IDS) expect(presetAudioArgs(id), id).not.toBeUndefined();
  });

  it('names the file the mix goes to beside an output with no room for it', () => {
    expect(audioOutputPath('/out/render.mp4')).toBe('/out/render-audio.wav');
    // A sequence's frame pattern goes: one sound file, not one per frame.
    expect(audioOutputPath('/out/render_%05d.png')).toBe('/out/render-audio.wav');
    expect(audioOutputPath('C:\\out\\render.mov')).toBe('C:\\out\\render-audio.wav');
  });
});

describe('the speed chain', () => {
  it('is nothing at speed 1, one atempo in range, and halves below it', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(2)).toEqual(['atempo=2']);
    expect(atempoChain(0.5)).toEqual(['atempo=0.5']);
    // 0.1 = 0.5 × 0.5 × 0.5 × 0.8: each atempo stays within the filter's own 0.5 floor.
    expect(atempoChain(0.1)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.5', 'atempo=0.8']);
    expect(atempoChain(Number.NaN)).toEqual([]);
  });
});

describe('when a layer is heard', () => {
  it('starts at the delay and, played once, ends when its pass does', () => {
    expect(layerHeard(music({ delay: 1 }), 10)).toEqual({ from: 1, to: 5 });
    // Trimmed to two seconds of the file, it is heard for two.
    expect(layerHeard(music({ inPoint: 1, outPoint: 3 }), 10)).toEqual({ from: 0, to: 2 });
  });

  it('runs a loop to the end of the graphic, which is the only end it has', () => {
    expect(layerHeard(music({ ending: 'loop' }), 10)).toEqual({ from: 0, to: 10 });
    expect(layerHeard(music({ ending: 'loop', delay: 2 }), 10)).toEqual({ from: 2, to: 10 });
  });

  it('is held inside the layer\'s span, so dragging its bar moves its sound (milestone 28)', () => {
    expect(layerHeard({ ...music({ ending: 'loop' }), span: { start: 2, end: 6 } }, 10)).toEqual({ from: 2, to: 6 });
    // The later of the span's start and the delay wins: both say "not before here".
    expect(layerHeard({ ...music({ ending: 'loop', delay: 4 }), span: { start: 2, end: 8 } }, 10)).toEqual({ from: 4, to: 8 });
    // A span that ends before the sound starts leaves nothing to hear.
    const silent = layerHeard({ ...music({ delay: 6 }), span: { start: 0, end: 3 } }, 10);
    expect(silent.to).toBeLessThanOrEqual(silent.from);
  });
});

describe('how loud a layer is at a moment', () => {
  it('is its volume, flat, with no fades', () => {
    expect(layerGainAt(music({ volume: 0.5 }), 1, 10)).toBe(0.5);
    // Outside what it is heard over it is silent: the pass is four seconds long.
    expect(layerGainAt(music(), 5, 10)).toBe(0);
  });

  it('rises over the fade in and falls over the fade out', () => {
    const faded = music({ fadeIn: 2, fadeOut: 2 });
    expect(layerGainAt(faded, 0, 10)).toBe(0);
    expect(layerGainAt(faded, 1, 10)).toBeCloseTo(0.5, 6);
    expect(layerGainAt(faded, 2, 10)).toBeCloseTo(1, 6);
    // The pass ends at 4 s, so the fade out runs from 2 s to 4 s.
    expect(layerGainAt(faded, 3, 10)).toBeCloseTo(0.5, 6);
    expect(layerGainAt(faded, 4, 10)).toBeCloseTo(0, 6);
  });

  it('fades a loop out at the end of the graphic, the only end it has', () => {
    const looping = music({ ending: 'loop', fadeOut: 2 });
    expect(layerGainAt(looping, 5, 10)).toBe(1);
    expect(layerGainAt(looping, 9, 10)).toBeCloseTo(0.5, 6);
  });

  it('is silent when the layer asks to be: muted, hidden, at zero, or nothing chosen', () => {
    expect(layerGainAt(music({ muted: true }), 1, 10)).toBe(0);
    expect(layerGainAt(music({ hidden: true }), 1, 10)).toBe(0);
    expect(layerGainAt(music({ volume: 0 }), 1, 10)).toBe(0);
    expect(layerGainAt(music({ id: null }), 1, 10)).toBe(0);
  });

  it('gives a clip layer the same answer, by its own arithmetic', () => {
    // The fixture clip is one second of material, looping by default.
    expect(layerGainAt(layer({ volume: 0.25 }), 1.5, 10)).toBe(0.25);
    expect(layerGainAt(layer({ ending: 'once' }), 1.5, 10)).toBe(0);
    expect(layerGainAt({ ...layer(), span: { start: 2, end: 4 } }, 1, 10)).toBe(0);
    expect(layerGainAt({ ...layer(), span: { start: 2, end: 4 } }, 3, 10)).toBe(1);
  });
});

describe('the waveform on a layer\'s bar (milestone 48)', () => {
  // Peaks that rise across the file: bucket i holds i, so where a column read from is legible.
  const ramp = Uint8Array.from({ length: 200 }, (_, i) => i);

  it('draws the material at the project\'s time: the in point shifts it and a loop repeats it', () => {
    // The whole four-second file across a four-second bar: the shape is the ramp.
    const whole = layerBarPeaks(music({ ending: 'loop' }), ramp, 4, 40);
    expect(whole[0]).toBeLessThan(20);
    expect(whole[39]).toBeGreaterThan(180);
    // From two seconds in, the first column reads from the middle of the file.
    const shifted = layerBarPeaks(music({ inPoint: 2, ending: 'loop' }), ramp, 4, 40);
    expect(shifted[0]).toBeGreaterThanOrEqual(99);
    // A one-second window looping over four seconds comes round: the shape repeats.
    const looped = layerBarPeaks(music({ inPoint: 0, outPoint: 1, ending: 'loop' }), ramp, 4, 40);
    expect(looped[10]!, 'the second pass starts over').toBeLessThan(looped[9]!);
  });

  it('is silent before the delay, shaped by the fades, and drawn for a muted layer all the same', () => {
    const delayed = layerBarPeaks(music({ delay: 2, ending: 'loop' }), ramp, 4, 40);
    expect(Array.from(delayed.slice(0, 19)).every((p) => p === 0), 'nothing before the delay').toBe(true);
    expect(delayed[30]).toBeGreaterThan(0);
    // A fade in scales the start down; the bar shows the fade that will be heard.
    const faded = layerBarPeaks(music({ inPoint: 2, ending: 'loop', fadeIn: 2 }), ramp, 4, 40);
    expect(faded[1]!).toBeLessThan(layerBarPeaks(music({ inPoint: 2, ending: 'loop' }), ramp, 4, 40)[1]!);
    // Muted and quiet layers still show what they hold: the bar is about time, not level.
    expect(layerBarPeaks(music({ muted: true, ending: 'loop' }), ramp, 4, 40)).toEqual(whole40());
    expect(layerBarPeaks(music({ volume: 0.1, ending: 'loop' }), ramp, 4, 40)).toEqual(whole40());
    function whole40(): Uint8Array {
      return layerBarPeaks(music({ ending: 'loop' }), ramp, 4, 40);
    }
  });

  it('draws inside the span\'s own window, which is what the bar covers', () => {
    // The bar covers 1..3 s; the sound starts at its delay of 2 s, so the first half is empty.
    const spanned = layerBarPeaks({ ...music({ delay: 2, ending: 'loop' }), span: { start: 1, end: 3 } }, ramp, 4, 40);
    expect(Array.from(spanned.slice(0, 19)).every((p) => p === 0)).toBe(true);
    expect(spanned[30]).toBeGreaterThan(0);
  });

  it('draws nothing without peaks, a length or columns', () => {
    expect(layerBarPeaks(music(), new Uint8Array(), 4, 40)).toEqual(new Uint8Array(40));
    expect(layerBarPeaks(music(), ramp, 4, 0)).toEqual(new Uint8Array(0));
    expect(layerBarPeaks(music({}, ''), ramp, 0, 4)).toEqual(new Uint8Array(4));
  });
});

describe('levelling the mix (milestone 52)', () => {
  const target = { lufs: -14, truePeakDb: -1 };
  const measured: MixLoudness = { inputI: -22.3, inputTp: -3.1, inputLra: 6.4, inputThresh: -32.9 };

  it('levels dynamically with the target alone, and linearly once the mix is measured', () => {
    expect(loudnormFilter(target)).toBe(`loudnorm=I=-14:TP=-1:LRA=11,aresample=${LAYER_AUDIO_RATE}`);
    expect(loudnormFilter(target, measured)).toBe(
      `loudnorm=I=-14:TP=-1:LRA=11:measured_I=-22.3:measured_TP=-3.1:measured_LRA=6.4:measured_thresh=-32.9:linear=true,aresample=${LAYER_AUDIO_RATE}`,
    );
  });

  it('measures the mix to nowhere: the same graph, the files as the only inputs, the report on stderr', () => {
    const args = measureMixArgs([music()], { fps: 30, firstFrame: 0, totalFrames: 60, length: 2 });
    expect(args.slice(0, 3)).toEqual(['-hide_banner', '-nostats', '-nostdin']);
    expect(args.slice(3, 5)).toEqual(['-i', '/lib/music.wav']);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[0:a]aresample');
    expect(graph).toContain('[aout]loudnorm=I=-14:TP=-1:LRA=11:print_format=json[mout]');
    expect(args.slice(-5)).toEqual(['-map', '[mout]', '-f', 'null', '-']);
  });

  it('reads what loudnorm printed, silence as the meter\'s floor, and garbage as nothing', () => {
    const stderr = 'noise before\n{\n"input_i" : "-22.30",\n"input_tp" : "-3.10",\n"input_lra" : "6.40",\n"input_thresh" : "-32.90",\n"output_i" : "-14.01"\n}';
    expect(parseMixLoudness(stderr)).toEqual({ inputI: -22.3, inputTp: -3.1, inputLra: 6.4, inputThresh: -32.9 });
    const silent = '{"input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00", "input_thresh" : "-inf"}';
    expect(parseMixLoudness(silent)).toEqual({ inputI: -70, inputTp: -70, inputLra: 0, inputThresh: -80 });
    expect(parseMixLoudness('nothing here')).toBeNull();
    expect(parseMixLoudness('{"input_i": "what"}')).toBeNull();
  });

  it('joins the plan after the cut, so what is levelled is exactly what is written — and only when asked', () => {
    const plain = applyLayerAudio(plan('h264-mp4'), [music()]);
    expect(plain.args.join(' ')).not.toContain('loudnorm');
    const levelled = applyLayerAudio(plan('h264-mp4'), [music()], { target, measured });
    const graph = levelled.args[levelled.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain(`apad=whole_dur=2,loudnorm=I=-14:TP=-1:LRA=11:measured_I=-22.3`);
    expect(graph).toContain('linear=true,aresample=48000[aout]');
  });
});

describe('one layer\'s chain', () => {
  it('trims to the window, retimes, loops, scales and delays — in that order', () => {
    const chain = layerAudioChain(1, layer({ inPoint: 15, outPoint: 29, speed: 2, delay: 1.5, volume: 0.5 }), 'la0', 2);
    expect(chain).toBe(
      `[1:a]aresample=${LAYER_AUDIO_RATE},atrim=start=0.5:end=1,asetpts=PTS-STARTPTS,atempo=2,` +
      // Half a second of material at double speed is a quarter-second pass, plus the spare second.
      `aloop=loop=-1:size=${Math.ceil(0.25 * LAYER_AUDIO_RATE) + LAYER_AUDIO_RATE},volume=0.5,adelay=1500:all=1,` +
      // Heard from its delay to the end of the graphic: the gate's ten milliseconds, not a fade.
      `afade=t=in:st=1.5:d=${GATE_SECONDS}[la0]`,
    );
  });

  it('plays once without a loop, and leaves out what is at its default', () => {
    // A one-second clip played once inside a one-second graphic: nothing to delay, gate or fade.
    const chain = layerAudioChain(2, layer({ ending: 'once' }), 'la1', 1);
    expect(chain).toBe(`[2:a]aresample=${LAYER_AUDIO_RATE},atrim=start=0:end=1,asetpts=PTS-STARTPTS[la1]`);
    expect(chain).not.toContain('aloop');
    expect(chain).not.toContain('volume');
    expect(chain).not.toContain('adelay');
    expect(chain).not.toContain('afade');
  });

  it('trims an audio layer in its own seconds, and writes its fades on the graphic\'s clock', () => {
    const chain = layerAudioChain(1, music({ inPoint: 1, outPoint: 3, delay: 2, fadeIn: 0.5, fadeOut: 1 }), 'la0', 10);
    expect(chain).toBe(
      `[1:a]aresample=${LAYER_AUDIO_RATE},atrim=start=1:end=3,asetpts=PTS-STARTPTS,adelay=2000:all=1,` +
      // Heard from 2 s to 4 s: the fade in starts where it starts, the fade out ends where it ends.
      'afade=t=in:st=2:d=0.5,afade=t=out:st=3:d=1[la0]',
    );
  });

  it('gates a layer to its span with a fade too short to hear', () => {
    const chain = layerAudioChain(1, { ...music({ ending: 'loop' }), span: { start: 2, end: 6 } }, 'la0', 10);
    expect(chain).toContain(`afade=t=in:st=2:d=${GATE_SECONDS}`);
    expect(chain).toContain(`afade=t=out:st=${6 - GATE_SECONDS}:d=${GATE_SECONDS}`);
  });
});

describe('the mix', () => {
  it('lays every layer on a silent bed of the graphic\'s length, and cuts the result to the rendered range', () => {
    const filter = layerAudioFilter([layer()], { fps: 30, firstFrame: 0, totalFrames: 60, length: 2 }, 1);
    expect(filter.startsWith(`anullsrc=r=${LAYER_AUDIO_RATE}:cl=stereo:d=2[abase]`)).toBe(true);
    expect(filter).toContain('[abase][la0]amix=inputs=2:normalize=0[amix]');
    expect(filter).toContain('[amix]atrim=start=0:end=2,asetpts=PTS-STARTPTS,apad=whole_dur=2[aout]');
  });

  it('mixes several without normalising, and a trimmed render hears its own range', () => {
    const filter = layerAudioFilter([layer(), music({ delay: 1 })], { fps: 30, firstFrame: 30, totalFrames: 30, length: 2 }, 1);
    expect(filter).toContain('[abase][la0][la1]amix=inputs=3:normalize=0[amix]');
    // The render starts a second in, so the mix is cut from there: sound and picture agree.
    expect(filter).toContain('[amix]atrim=start=1:end=2,asetpts=PTS-STARTPTS,apad=whole_dur=1[aout]');
  });

  it('makes the bed long enough for a render that reaches past the graphic\'s own length', () => {
    const filter = layerAudioFilter([music()], { fps: 30, firstFrame: 0, totalFrames: 120, length: 2 }, 1);
    expect(filter).toContain('anullsrc=r=48000:cl=stereo:d=4[abase]');
  });
});

describe('which layers are heard at all', () => {
  it('drops the muted, the hidden, the silent, the empty and the pathless', () => {
    const kept = audibleLayers(
      [
        layer(),
        music(),
        music({ muted: true }),
        music({ hidden: true }),
        music({ volume: 0 }),
        music({ inPoint: 2, outPoint: 2 }),
        music({}, ''),
        // Its four-second pass is over before its span begins, so there is nothing left to hear.
        { ...music(), span: { start: 8, end: null } },
      ],
      10,
    );
    expect(kept).toHaveLength(2);
    expect(kept.map((l) => l.kind)).toEqual(['clip', 'sound']);
  });
});

describe('the plan with sound mixed in', () => {
  it('joins the flattening graph: inputs after the pipe, the chains in the one filter, the mix mapped and encoded', () => {
    const before = plan('h264-mp4');
    const after = applyLayerAudio(before, [layer()]);
    const args = after.args;
    // The clip is input 1, right after the frame pipe, so [1:a] names it.
    expect(args.slice(args.indexOf('pipe:0') + 1, args.indexOf('pipe:0') + 3)).toEqual(['-i', '/lib/clip.mp4']);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('overlay'); // the flatten is still there
    expect(graph).toContain('[1:a]aresample');
    expect(graph).toContain('[aout]');
    // Mapped and encoded with the preset's codec, before the output path.
    const out = args.indexOf(after.output);
    expect(args.indexOf('[aout]')).toBeLessThan(out);
    expect(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 4)).toEqual(['-c:a', 'aac', '-b:a', '192k']);
    expect(args.filter((a) => a === '-filter_complex')).toHaveLength(1);
    expect(after.audioOutput, 'the output carries it, so nothing is written beside it').toBeUndefined();
  });

  it('folds a plain -vf chain into one complex graph, with the video mapped first', () => {
    const before = plan('prores-4444');
    expect(before.args).toContain('-vf');
    const after = applyLayerAudio(before, [layer()]);
    expect(after.args).not.toContain('-vf');
    const graph = after.args[after.args.indexOf('-filter_complex') + 1]!;
    expect(graph.startsWith('[0:v]')).toBe(true);
    expect(graph).toContain('[vout];');
    const maps = after.args.flatMap((a: string, i: number) => (a === '-map' ? [after.args[i + 1]] : []));
    expect(maps).toEqual(['[vout]', '[aout]']);
    expect(after.args).toContain('pcm_s16le');
  });

  it('takes an audio layer\'s own file as an input beside the clips, in chain order', () => {
    const after = applyLayerAudio(plan('h264-mp4'), [layer(), music({ delay: 1 })]);
    const inputs = after.args.flatMap((a: string, i: number) => (a === '-i' ? [after.args[i + 1]] : []));
    expect(inputs).toEqual(['pipe:0', '/lib/clip.mp4', '/lib/music.wav']);
    const graph = after.args[after.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[2:a]aresample');
    expect(graph).toContain('[abase][la0][la1]amix=inputs=3:normalize=0');
  });

  it('writes the mix beside an output with no room for it, as a second output of the same command', () => {
    const before = plan('png-sequence');
    const after = applyLayerAudio(before, [music()]);
    expect(after.audioOutput).toBe('/out/render-audio.wav');
    // The sequence is still the first output; the WAV follows it with its own map and codec.
    const tail = after.args.slice(after.args.indexOf(after.output) + 1);
    expect(tail).toEqual(['-map', '[aout]', '-c:a', 'pcm_s16le', '/out/render-audio.wav']);
  });

  it('keeps the matte pass silent: the audio is mapped into the first output only', () => {
    const before = plan('prores-4444', { matte: true });
    const after = applyLayerAudio(before, [layer()]);
    const firstOut = after.args.indexOf(after.output);
    expect(after.args.indexOf('[aout]')).toBeLessThan(firstOut);
    // Nothing audio joins the matte's own options, which follow the first output.
    expect(after.args.slice(firstOut + 1).join(' ')).not.toContain('aout');
  });

  it('changes nothing when nothing is audible, however the output is written', () => {
    const before = plan('h264-mp4');
    expect(applyLayerAudio(before, [])).toBe(before);
    expect(applyLayerAudio(before, [layer({ muted: true })]).args).toEqual(before.args);
    expect(applyLayerAudio(before, [layer({ volume: 0 })]).args).toEqual(before.args);
    expect(applyLayerAudio(before, [layer({ hidden: true })]).args).toEqual(before.args);
    // A silent project writes no sound file beside an image sequence either.
    const stills = plan('png-sequence');
    expect(applyLayerAudio(stills, [music({ muted: true })]).args).toEqual(stills.args);
    expect(applyLayerAudio(stills, [music({ muted: true })]).audioOutput).toBeUndefined();
  });
});
