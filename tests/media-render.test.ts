/**
 * Rendering a library item itself (milestone 15): the pure planner. What the
 * options mean for a clip, a still and a sound; the loop with its crossfaded
 * unit; the matte; the audio presets. Nothing here spawns ffmpeg.
 */

import { describe, expect, it } from 'vitest';
import {
  atempoChain, AUDIO_PRESET_IDS, audioCodecArgsFor, audioPresetArgs, buildMediaRenderPlan, DEFAULT_STILL_SECONDS, parseProgressLine, resolveMediaTiming, tintFilter,
  type MediaSource,
} from '../src/core/media-render';
import { AUDIO_PRESETS } from '../src/core/media-render';
import { OUTPUT_PRESETS, RenderPlanError } from '../src/core/render-plan';

const clip: MediaSource = { kind: 'video', input: { path: '/lib/clip.mov' }, width: 1920, height: 1080, duration: 4, fps: 25, alpha: true, hasAudio: true };
const still: MediaSource = { kind: 'image', input: { path: '/lib/logo.png' }, width: 512, height: 512, alpha: true, hasAudio: false };
const sound: MediaSource = { kind: 'audio', input: { path: '/lib/sting.wav' }, duration: 2.5, alpha: false, hasAudio: true };
const frames: MediaSource = { kind: 'video', input: { pattern: '/lib/frames/walk_%04d.png', start: 1, fps: 30 }, width: 64, height: 36, duration: 1.2, fps: 30, alpha: true, hasAudio: false };

/** The value following a flag; the last one when it repeats, unless `nth` says which. */
function flag(args: string[], name: string, nth = 0): string | undefined {
  let seen = -1;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== name) continue;
    seen += 1;
    if (seen === nth) return args[i + 1];
  }
  return undefined;
}
const graph = (args: string[]) => flag(args, '-filter_complex') ?? flag(args, '-af') ?? '';

describe('timing', () => {
  it('plays a clip at its own rate and length, a still for five seconds, a sound against a 25 fps clock', () => {
    expect(resolveMediaTiming(clip)).toMatchObject({ fps: 25, natural: 4, length: 4, loops: false, repeats: 0, firstFrame: 0, totalFrames: 100 });
    expect(resolveMediaTiming(still)).toMatchObject({ fps: 30, natural: DEFAULT_STILL_SECONDS, length: 5, totalFrames: 150 });
    expect(resolveMediaTiming(sound)).toMatchObject({ fps: 25, natural: 2.5, totalFrames: 63 });
    expect(resolveMediaTiming(still, { length: 2 })).toMatchObject({ length: 2, loops: false, totalFrames: 60 });
  });

  it('loops a clip past its length with a crossfade, and plays it plain with none', () => {
    const looped = resolveMediaTiming(clip, { length: 10 });
    expect(looped).toMatchObject({ loops: true, crossfade: 0.5, unitSeconds: 3.5, repeats: 2, totalFrames: 250 });
    expect(resolveMediaTiming(clip, { length: 10, crossfade: 0 })).toMatchObject({ loops: true, crossfade: 0, unitSeconds: 4, repeats: 2 });
    expect(resolveMediaTiming(clip, { length: 10, crossfade: 1 })).toMatchObject({ crossfade: 1, unitSeconds: 3, repeats: 3 });
    // A shorter length is a cut, not a loop.
    expect(resolveMediaTiming(clip, { length: 2 })).toMatchObject({ loops: false, totalFrames: 50 });
    // Speed halves the natural length, and the loop counts from there.
    expect(resolveMediaTiming(clip, { speed: 2, length: 10 })).toMatchObject({ natural: 2, unitSeconds: 1.5, repeats: 6 });
  });

  it('refuses what it cannot do, by name', () => {
    expect(() => resolveMediaTiming(clip, { crossfade: 2, length: 9 })).toThrow(/needs a clip longer than 4\.00 s/);
    expect(() => resolveMediaTiming(still, { speed: 2 })).toThrow(/still has no speed/);
    expect(() => resolveMediaTiming(clip, { speed: 20 })).toThrow(RenderPlanError);
    expect(() => resolveMediaTiming(clip, { fps: 31 })).toThrow(/frame rate must be one of/);
    expect(() => resolveMediaTiming({ ...clip, duration: undefined }, {})).toThrow(/not been measured/);
    expect(() => resolveMediaTiming(clip, { outFrame: 100 })).toThrow(/out point must be at most the last frame \(99/);
  });
});

describe('a clip or a still through a video preset', () => {
  it('reads the file, keeps alpha for an alpha preset, writes progress, and names audio for the container', () => {
    const plan = buildMediaRenderPlan({ source: clip, presetId: 'prores-4444', outputPath: '/out/clip' });
    expect(plan.stages).toHaveLength(1);
    const args = plan.stages[0]!.args;
    expect(args.slice(0, 7)).toEqual(['-hide_banner', '-loglevel', 'error', '-n', '-progress', 'pipe:1', '-nostats']);
    expect(flag(args, '-i')).toBe('/lib/clip.mov');
    expect(graph(args)).toContain('fps=25');
    expect(graph(args)).toContain('format=yuva444p10le');
    expect(graph(args)).not.toContain('overlay');
    expect(args).toContain('[aout]');
    expect(flag(args, '-c:a')).toBe('pcm_s16le');
    expect(flag(args, '-frames:v')).toBe('100');
    expect(plan.output).toBe('/out/clip.mov');
    expect(plan.matteOutput).toBeUndefined();
  });

  it('flattens transparent media over the background for a preset without alpha', () => {
    const plan = buildMediaRenderPlan({ source: clip, presetId: 'h264-mp4', outputPath: '/out/clip.mp4', options: { background: '#ff0000' } });
    const g = graph(plan.stages[0]!.args);
    expect(g).toContain('color=c=0xff0000:s=1920x1080');
    expect(g).toContain('overlay=shortest=1:format=rgb');
    expect(flag(plan.stages[0]!.args, '-c:a')).toBe('aac');
  });

  it('holds a still for the length asked, with no sound and no speed', () => {
    const plan = buildMediaRenderPlan({ source: still, presetId: 'png-sequence', outputPath: '/out/logo', options: { length: 2, fps: 24 } });
    const args = plan.stages[0]!.args;
    expect(args.slice(args.indexOf('-loop'), args.indexOf('-i') + 2)).toEqual(['-loop', '1', '-framerate', '24', '-t', '2', '-i', '/lib/logo.png']);
    expect(args).toContain('-an');
    expect(flag(args, '-frames:v')).toBe('48');
    expect(plan.output).toBe('/out/logo_%05d.png');
  });

  it('reads a run of frames by pattern and loops a plain repeat with -stream_loop', () => {
    const plan = buildMediaRenderPlan({ source: frames, presetId: 'png-sequence', outputPath: '/out/walk', options: { length: 3, crossfade: 0 } });
    const args = plan.stages[0]!.args;
    expect(args.slice(args.indexOf('-stream_loop'), args.indexOf('-i') + 2)).toEqual(['-stream_loop', '2', '-framerate', '30', '-start_number', '1', '-i', '/lib/frames/walk_%04d.png']);
    expect(flag(args, '-frames:v')).toBe('90');
  });

  it('trims at the output rate, speeds the picture and its sound, and fits a size', () => {
    const plan = buildMediaRenderPlan({ source: clip, presetId: 'h264-mp4', outputPath: '/out/c.mp4', options: { fps: 50, inFrame: 10, outFrame: 59, speed: 2, width: 1280, height: 720 } });
    const g = graph(plan.stages[0]!.args);
    expect(g).toContain('setpts=PTS/2');
    expect(g).toContain('fps=50');
    expect(g).toContain('scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720');
    expect(g).toContain('trim=start=0.2:end=1.2,setpts=PTS-STARTPTS');
    expect(g).toContain('atempo=2');
    expect(g).toContain('atrim=start=0.2:end=1.2');
    expect(flag(plan.stages[0]!.args, '-frames:v')).toBe('50');
    expect([plan.width, plan.height]).toEqual([1280, 720]);
  });

  it('writes a crossfaded loop as a lossless unit first, then stream-loops it to length', () => {
    const plan = buildMediaRenderPlan({ source: clip, presetId: 'prores-4444', outputPath: '/out/loop', options: { length: 10, crossfade: 1 }, scratchDir: '/tmp/scratch' });
    expect(plan.stages).toHaveLength(2);
    const [unit, final] = plan.stages as [typeof plan.stages[0], typeof plan.stages[0]];
    expect(unit.output).toBe('/tmp/scratch/loop-unit.mov');
    const ug = graph(unit.args);
    expect(ug).toContain('[vb]trim=start=1:end=3,setpts=PTS-STARTPTS[body]');
    expect(ug).toContain('[vt]trim=start=3:end=4,setpts=PTS-STARTPTS[tail]');
    expect(ug).toContain('[vh]trim=start=0:end=1,setpts=PTS-STARTPTS[head]');
    expect(ug).toContain('xfade=transition=fade:duration=1:offset=0');
    expect(ug).toContain('acrossfade=d=1');
    expect(flag(unit.args, '-c:v')).toBe('png');
    expect(flag(unit.args, '-pix_fmt')).toBe('rgba');
    expect(final.args.slice(final.args.indexOf('-stream_loop'), final.args.indexOf('-i') + 2)).toEqual(['-stream_loop', '3', '-i', '/tmp/scratch/loop-unit.mov']);
    expect(flag(final.args, '-frames:v')).toBe('250');
    expect(plan.timing.unitSeconds).toBe(3);
    expect(() => buildMediaRenderPlan({ source: clip, presetId: 'prores-4444', outputPath: '/out/loop', options: { length: 10 } })).toThrow(/scratch folder/);
  });

  it('writes a matte beside the render, grey in the preset\'s own format, and says when it will be blank', () => {
    const plan = buildMediaRenderPlan({ source: clip, presetId: 'h264-mp4', outputPath: '/out/c.mp4', options: { matte: true } });
    expect(plan.matteOutput).toBe('/out/c-matte.mp4');
    const args = plan.stages[0]!.args;
    expect(graph(args)).toContain('[src]split[pic][mat]');
    expect(graph(args)).toContain('[mat]format=rgba,alphaextract,');
    expect(args[args.length - 1]).toBe('/out/c-matte.mp4');
    expect(flag(args, '-map', 2)).toBe('[matte]');
    expect(flag(args, '-frames:v', 1)).toBe('100');
    const sequence = buildMediaRenderPlan({ source: still, presetId: 'png-sequence', outputPath: '/out/logo', options: { matte: true } });
    expect(sequence.matteOutput).toBe('/out/logo-matte_%05d.png');
    const opaque = buildMediaRenderPlan({ source: { ...clip, alpha: false }, presetId: 'h264-mp4', outputPath: '/out/c.mp4', options: { matte: true } });
    expect(opaque.warnings.some((w) => w.includes('all white'))).toBe(true);
  });

  it('fits an odd-sized source to even sides for presets that need them, and refuses a sound', () => {
    const odd = buildMediaRenderPlan({ source: { ...clip, width: 1001, height: 601, alpha: false }, presetId: 'h264-mp4', outputPath: '/out/c.mp4' });
    expect([odd.width, odd.height]).toEqual([1000, 600]);
    expect(() => buildMediaRenderPlan({ source: clip, presetId: 'h264-mp4', outputPath: '/out/c.mp4', options: { width: 1001, height: 601 } })).toThrow(/even width and height/);
    expect(() => buildMediaRenderPlan({ source: sound, presetId: 'h264-mp4', outputPath: '/out/s.mp4' })).toThrow(/renders with an audio preset/);
    expect(() => buildMediaRenderPlan({ source: clip, presetId: 'nope', outputPath: '/out/c' })).toThrow(/unknown output preset/);
  });
});

describe('recolor (milestone 15)', () => {
  it('renders the luminance in one colour, alpha kept, before the size fit', () => {
    expect(tintFilter('#ffffff')).toBe('format=rgba,colorchannelmixer=0.299:0.587:0.114:0:0.299:0.587:0.114:0:0.299:0.587:0.114:0:0:0:0:1');
    // Half red: every luma weight scaled by 0.5 on the red row, zero elsewhere.
    const half = tintFilter('#800000');
    expect(half).toContain('colorchannelmixer=0.150086:0.294651:0.057224:0:0:0:0:0:0:0:0:0:0:0:0:1');
    const plan = buildMediaRenderPlan({ source: clip, presetId: 'prores-4444', outputPath: '/out/c', options: { tint: '#f59e0b' } });
    const g = plan.stages[0]!.args[plan.stages[0]!.args.indexOf('-filter_complex') + 1]!;
    expect(g).toContain('colorchannelmixer=');
    expect(g.indexOf('fps=25')).toBeLessThan(g.indexOf('colorchannelmixer'));
    // The loop unit carries the recolor, so every repeat matches.
    const looped = buildMediaRenderPlan({ source: clip, presetId: 'prores-4444', outputPath: '/out/c', options: { tint: '#f59e0b', length: 10, crossfade: 1 }, scratchDir: '/tmp/s' });
    expect(looped.stages[0]!.args.join(' ')).toContain('colorchannelmixer');
    expect(() => buildMediaRenderPlan({ source: clip, presetId: 'h264-mp4', outputPath: '/out/c.mp4', options: { tint: 'red' } })).toThrow(/tint must be #RRGGBB/);
  });
});

describe('a sound through an audio preset', () => {
  it('has three presets, each with an extension and an encoder, and the right sound for each video container', () => {
    expect(AUDIO_PRESET_IDS).toEqual(['wav-pcm', 'aac-m4a', 'mp3']);
    for (const id of AUDIO_PRESET_IDS) expect(AUDIO_PRESETS[id].extension).toMatch(/^\./);
    expect(audioCodecArgsFor(OUTPUT_PRESETS['h264-mp4'])).toEqual(['-c:a', 'aac', '-b:a', '192k']);
    expect(audioCodecArgsFor(OUTPUT_PRESETS['webm-vp9-alpha'])![1]).toBe('libopus');
    expect(audioCodecArgsFor(OUTPUT_PRESETS['png-sequence'])).toBeNull();
  });

  it('writes WAV at 16 or 24 bits with the asked rate and channels, and loops with a crossfade through a unit', () => {
    const plan = buildMediaRenderPlan({ source: sound, presetId: 'wav-pcm', outputPath: '/out/sting', options: { audio: { sampleRate: 48000, channels: 1, bitDepth: 24 } } });
    const args = plan.stages[0]!.args;
    expect(plan.output).toBe('/out/sting.wav');
    expect(args).toContain('-vn');
    expect(flag(args, '-c:a')).toBe('pcm_s24le');
    expect(flag(args, '-ar')).toBe('48000');
    expect(flag(args, '-ac')).toBe('1');
    expect(graph(args)).toContain('atrim=start=0:end=2.52');
    const looped = buildMediaRenderPlan({ source: sound, presetId: 'mp3', outputPath: '/out/bed', options: { length: 10, crossfade: 0.5 }, scratchDir: '/tmp/s' });
    expect(looped.stages).toHaveLength(2);
    expect(looped.stages[0]!.output).toBe('/tmp/s/loop-unit.wav');
    expect(graph(looped.stages[0]!.args)).toContain('acrossfade=d=0.5');
    expect(flag(looped.stages[1]!.args, '-stream_loop')).toBe('4');
    expect(flag(looped.stages[1]!.args, '-c:a')).toBe('libmp3lame');
    expect(audioPresetArgs(AUDIO_PRESETS['aac-m4a'])).toEqual(['-c:a', 'aac', '-b:a', '256k']);
    expect(() => audioPresetArgs(AUDIO_PRESETS['wav-pcm'], { sampleRate: 12345 })).toThrow(/sample rate/);
    expect(() => buildMediaRenderPlan({ source: still, presetId: 'mp3', outputPath: '/out/x' })).toThrow(/has none/);
  });

  it('chains atempo for speeds past its range, and reads progress lines', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(1.5)).toEqual(['atempo=1.5']);
    expect(atempoChain(6)).toEqual(['atempo=2', 'atempo=2', 'atempo=1.5']);
    expect(atempoChain(0.2)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.8']);
    expect(parseProgressLine('frame=42')).toEqual({ frame: 42 });
    expect(parseProgressLine('out_time_us=1500000')).toEqual({ seconds: 1.5 });
    expect(parseProgressLine('speed=2x')).toEqual({});
  });
});
