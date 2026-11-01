/**
 * A clip's sound in a render (milestone 48): the audio inputs and filter
 * chains that join the render plan's ffmpeg command. Pure arithmetic over
 * argument lists, so what a render would run is read here rather than hoped
 * for — a wrong trim or a missing map would show as a file that drifts from
 * its picture, the kind of thing only ffprobe or this test catches.
 */

import { describe, expect, it } from 'vitest';
import { applyClipAudio, atempoChain, CLIP_AUDIO_RATE, clipAudioChain, clipAudioFilter, presetAudioArgs, type ClipAudioLayer } from '../src/core/clip-audio';
import { buildRenderPlan, PRESET_IDS, type RenderPlan } from '../src/core/render-plan';
import { EMPTY_CLIP, type ClipSource, type ClipValue } from '../src/core/video-layer';

const source: ClipSource = { frames: 30, fps: 30 };
const clip = (over: Partial<ClipValue> = {}): ClipValue => ({ ...EMPTY_CLIP, id: 'abc', ...over });
const layer = (over: Partial<ClipValue> = {}, path = '/lib/clip.mp4'): ClipAudioLayer => ({ path, value: clip(over), source });

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

describe('one layer\'s chain', () => {
  it('trims to the window, retimes, loops, scales and delays — in that order', () => {
    const chain = clipAudioChain(1, layer({ inPoint: 15, outPoint: 29, speed: 2, delay: 1.5, volume: 0.5 }), 'la0');
    expect(chain).toBe(
      `[1:a]aresample=${CLIP_AUDIO_RATE},atrim=start=0.5:end=1,asetpts=PTS-STARTPTS,atempo=2,` +
      // Half a second of material at double speed is a quarter-second pass, plus the spare second.
      `aloop=loop=-1:size=${Math.ceil(0.25 * CLIP_AUDIO_RATE) + CLIP_AUDIO_RATE},volume=0.5,adelay=1500:all=1[la0]`,
    );
  });

  it('plays once without a loop, and leaves out what is at its default', () => {
    const chain = clipAudioChain(2, layer({ ending: 'once' }), 'la1');
    expect(chain).toBe(`[2:a]aresample=${CLIP_AUDIO_RATE},atrim=start=0:end=1,asetpts=PTS-STARTPTS[la1]`);
    expect(chain).not.toContain('aloop');
    expect(chain).not.toContain('volume');
    expect(chain).not.toContain('adelay');
  });
});

describe('the mix', () => {
  it('trims one layer\'s sound to exactly the rendered range and pads it to length', () => {
    const filter = clipAudioFilter([layer()], { fps: 30, firstFrame: 0, totalFrames: 60 }, 1);
    expect(filter).toContain('[la0]atrim=start=0:end=2,asetpts=PTS-STARTPTS,apad=whole_dur=2[aout]');
    expect(filter).not.toContain('amix');
  });

  it('mixes several without normalising, and a trimmed render hears its own range', () => {
    const filter = clipAudioFilter([layer(), layer({ delay: 1 })], { fps: 30, firstFrame: 30, totalFrames: 30 }, 1);
    expect(filter).toContain('[la0][la1]amix=inputs=2:normalize=0[lamix]');
    // The render starts a second in, so the mix is cut from there: sound and picture agree.
    expect(filter).toContain('[lamix]atrim=start=1:end=2,asetpts=PTS-STARTPTS,apad=whole_dur=1[aout]');
  });
});

describe('the plan with sound mixed in', () => {
  it('joins the flattening graph: inputs after the pipe, the chains in the one filter, the mix mapped and encoded', () => {
    const before = plan('h264-mp4');
    const after = applyClipAudio(before, [layer()]);
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
  });

  it('folds a plain -vf chain into one complex graph, with the video mapped first', () => {
    const before = plan('prores-4444');
    expect(before.args).toContain('-vf');
    const after = applyClipAudio(before, [layer()]);
    expect(after.args).not.toContain('-vf');
    const graph = after.args[after.args.indexOf('-filter_complex') + 1]!;
    expect(graph.startsWith('[0:v]')).toBe(true);
    expect(graph).toContain('[vout];');
    const maps = after.args.flatMap((a, i) => (a === '-map' ? [after.args[i + 1]] : []));
    expect(maps).toEqual(['[vout]', '[aout]']);
    expect(after.args).toContain('pcm_s16le');
  });

  it('keeps the matte pass silent: the audio is mapped into the first output only', () => {
    const before = plan('prores-4444', { matte: true });
    const after = applyClipAudio(before, [layer()]);
    const firstOut = after.args.indexOf(after.output);
    expect(after.args.indexOf('[aout]')).toBeLessThan(firstOut);
    // Nothing audio joins the matte's own options, which follow the first output.
    expect(after.args.slice(firstOut + 1).join(' ')).not.toContain('aout');
  });

  it('changes nothing when nothing is audible or the output has no room for sound', () => {
    const before = plan('h264-mp4');
    expect(applyClipAudio(before, [])).toBe(before);
    expect(applyClipAudio(before, [layer({ muted: true })]).args).toEqual(before.args);
    expect(applyClipAudio(before, [layer({ volume: 0 })]).args).toEqual(before.args);
    expect(applyClipAudio(before, [layer({ hidden: true })]).args).toEqual(before.args);
    const stills = plan('png-sequence');
    expect(applyClipAudio(stills, [layer()]).args).toEqual(stills.args);
  });
});
