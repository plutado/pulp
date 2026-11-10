/**
 * More export formats (milestone 82): DNxHR for editing apps that prefer it,
 * and the animated images — GIF with a palette made for the clip, animated
 * WebP and APNG with alpha — each with a rate and a width of its own, no
 * sound, and no matte. Pure: the argument lists a render would run, read
 * here; the files themselves are rendered and read back in
 * tests/e2e/render.e2e.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  ANIMATED_IMAGE_FPS, animatedImageOutput, buildRenderPlan, OUTPUT_PRESETS, PRESET_IDS, REC709_CONVERT, RenderPlanError, type RenderPlan,
} from '../src/core/render-plan';
import { applyLayerAudio, applyStemAudio, presetAudioArgs, type SoundAudioLayer } from '../src/core/layer-audio';
import { buildMediaRenderPlan, type MediaSource } from '../src/core/media-render';
import { presetUnavailableReason } from '../src/core/ffmpeg-presets';
import { EMPTY_SOUND } from '../src/core/sound-layer';
import { timing } from './fixtures';
import { readWebp } from './webp-anim';

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const graphOf = (plan: RenderPlan) => flag(plan.args, '-filter_complex') ?? flag(plan.args, '-vf') ?? '';
const plan = (presetId: string, options: Parameters<typeof buildRenderPlan>[0]['options'] = {}, alpha = true) =>
  buildRenderPlan({ manifest: timing({ alpha }), presetId, outputPath: '/out/clip', options });

describe('DNxHR', () => {
  it('writes HQ and HQX as Rec. 709 .mov, 8-bit and 10-bit 4:2:2, with the matte for the key', () => {
    for (const [id, profile, pixels] of [['dnxhr-hq', 'dnxhr_hq', 'yuv422p'], ['dnxhr-hqx', 'dnxhr_hqx', 'yuv422p10le']] as const) {
      const p = plan(id, { matte: true });
      expect(p.output).toBe('/out/clip.mov');
      expect(flag(p.args, '-profile:v')).toBe(profile);
      expect(graphOf(p)).toContain(`${REC709_CONVERT}`);
      expect(graphOf(p)).toContain(`format=${pixels}`);
      // No alpha in ffmpeg's DNxHR: the graphic is flattened, and its alpha goes to the matte.
      expect(OUTPUT_PRESETS[id].alpha).toBe(false);
      expect(graphOf(p)).toContain('overlay');
      expect(p.matteOutput).toBe('/out/clip-matte.mov');
      // Its sound goes in the file, as PCM, like the other editing presets.
      expect(presetAudioArgs(id)).toEqual(['-c:a', 'pcm_s16le']);
    }
  });

  it('needs an even size, as 4:2:2 does', () => {
    expect(() => plan('dnxhr-hq', { aspect: '16:9', width: 1921, height: 1081 })).toThrow(RenderPlanError);
  });
});

describe('an animated image\'s own rate and width', () => {
  const at = { fps: 30, frames: 60 };

  it('is the preset\'s default — a GIF small to start with, WebP and APNG as rendered — or what was asked', () => {
    expect(animatedImageOutput(OUTPUT_PRESETS.gif, {}, at)).toMatchObject({ fps: 15, frames: 30, width: 480 });
    expect(animatedImageOutput(OUTPUT_PRESETS['webp-animated'], {}, at)).toEqual({ fps: 30, frames: 60, steps: '' });
    expect(animatedImageOutput(OUTPUT_PRESETS.apng, { animatedImage: { fps: 10, width: 320 } }, at)).toMatchObject({ fps: 10, frames: 20, width: 320 });
    // `null` is the render's own over a default: a GIF at full rate and size.
    const full = animatedImageOutput(OUTPUT_PRESETS.gif, { animatedImage: { fps: null, width: null } }, at)!;
    expect(full).toMatchObject({ fps: 30, frames: 60 });
    expect(full.width).toBeUndefined();
    // Every other preset has none, whatever is asked.
    expect(animatedImageOutput(OUTPUT_PRESETS['h264-mp4'], { animatedImage: { fps: 10 } }, at)).toBeNull();
  });

  it('only ever drops frames, counting them as ffmpeg\'s fps filter does, and only ever scales down', () => {
    // A rate above the render's is the render's: frames are never made up.
    expect(animatedImageOutput(OUTPUT_PRESETS.apng, { animatedImage: { fps: 30 } }, { fps: 24, frames: 48 })).toMatchObject({ fps: 24, frames: 48 });
    // To the nearest, a half up: measured on ffmpeg 8 (59 frames at 30 to 15 is 30; 61 is 31; one is one).
    for (const [frames, kept] of [[60, 30], [59, 30], [61, 31], [1, 1], [2, 1]] as const) {
      expect(animatedImageOutput(OUTPUT_PRESETS.apng, { animatedImage: { fps: 15 } }, { fps: 30, frames })!.frames).toBe(kept);
    }
    const steps = animatedImageOutput(OUTPUT_PRESETS.apng, { animatedImage: { fps: 15, width: 320 } }, at)!.steps;
    expect(steps).toBe("fps=15,scale='min(iw,320)':-2:flags=lanczos");
  });

  it('refuses a rate it does not offer and a width out of range, by name', () => {
    expect(() => animatedImageOutput(OUTPUT_PRESETS.gif, { animatedImage: { fps: 7 } }, at)).toThrow(/10, 12, 15, 20, 24, 25, 30/);
    expect(() => animatedImageOutput(OUTPUT_PRESETS.gif, { animatedImage: { width: 8 } }, at)).toThrow(/16 to 4096/);
    expect(() => animatedImageOutput(OUTPUT_PRESETS.gif, { animatedImage: { width: 320.5 } }, at)).toThrow(RenderPlanError);
    expect(ANIMATED_IMAGE_FPS.every((fps) => fps <= 50)).toBe(true);
  });
});

describe('GIF', () => {
  it('makes a palette for the clip from every frame, maps the frames onto it, and loops forever', () => {
    const p = plan('gif');
    const graph = graphOf(p);
    expect(p.output).toBe('/out/clip.gif');
    expect(graph).toContain('palettegen=max_colors=256:stats_mode=full');
    expect(graph).toContain('paletteuse=dither=bayer');
    // Rate and width before the palette, so the palette is made from the frames that are written.
    expect(graph.indexOf('fps=15')).toBeLessThan(graph.indexOf('palettegen'));
    expect(graph.indexOf("scale='min(iw,480)'")).toBeLessThan(graph.indexOf('palettegen'));
    expect(flag(p.args, '-loop')).toBe('0');
    // The file holds 15 a second of the two seconds, at 15 a second.
    expect(flag(p.args, '-frames:v')).toBe('30');
    expect(p.args[p.args.indexOf(p.output) - 1]).toBe('15');
    expect(p.image).toEqual({ fps: 15, frames: 30, width: 480 });
  });

  it('is flattened over the background: a GIF\'s one-bit transparency would leave hard edges', () => {
    const graph = graphOf(plan('gif', { background: '#336699' }));
    expect(graph).toContain('color=c=0x336699');
    expect(graph.indexOf('overlay')).toBeLessThan(graph.indexOf('palettegen'));
  });

  it('builds a graph whether the template is opaque (a plain -vf chain) or flattened (a complex graph)', () => {
    const opaque = plan('gif', {}, false);
    expect(flag(opaque.args, '-vf')).toMatch(/,split\[gifa\]\[gifb\];\[gifa\]palettegen.*\[gifb\]\[gifp\]paletteuse=[^[]*$/);
    expect(flag(plan('gif').args, '-filter_complex')).toMatch(/paletteuse=[^[;]*\[out\]$/);
  });
});

describe('animated WebP and APNG', () => {
  it('keep alpha, loop forever, and are written by the muxer they name', () => {
    const webp = plan('webp-animated');
    expect(webp.output).toBe('/out/clip.webp');
    expect(graphOf(webp)).not.toContain('overlay');
    expect(graphOf(webp)).toMatch(/format=bgra$/);
    expect(flag(webp.args, '-loop')).toBe('0');
    expect(webp.args[webp.args.lastIndexOf('-f') + 1]).toBe('webp');
    const apng = plan('apng');
    // `.png`, with the apng muxer named: `.png` alone would be a still.
    expect(apng.output).toBe('/out/clip.png');
    expect(flag(apng.args, '-plays')).toBe('0');
    expect(apng.args[apng.args.lastIndexOf('-f') + 1]).toBe('apng');
    expect(graphOf(apng)).toMatch(/format=rgba$/);
  });

  it('say plainly when this ffmpeg has no libwebp', () => {
    expect(presetUnavailableReason(['libx264', 'apng'], OUTPUT_PRESETS['webp-animated'])).toContain('libwebp');
    expect(presetUnavailableReason(['libwebp_anim'], OUTPUT_PRESETS['webp-animated'])).toBeNull();
  });
});

describe('every animated image', () => {
  const animated = PRESET_IDS.filter((id) => OUTPUT_PRESETS[id].animatedImage);

  it('is GIF, WebP and APNG, and nothing else', () => {
    expect(animated.sort()).toEqual(['apng', 'gif', 'webp-animated']);
  });

  it('takes no matte, said by name', () => {
    for (const id of animated) expect(() => plan(id, { matte: true })).toThrow(/takes no matte/);
  });

  it('carries no sound, and gets no WAV beside it either', () => {
    const music: SoundAudioLayer = { kind: 'sound', path: '/lib/m.wav', value: { ...EMPTY_SOUND, id: 'm' }, source: { duration: 4 } };
    for (const id of animated) {
      const p = plan(id);
      expect(applyLayerAudio(p, [music])).toBe(p);
      expect(applyStemAudio(p, [{ layer: music, label: 'Drums' }])).toBe(p);
    }
    // While a PNG sequence, which also has no room for a stream, still gets its WAV.
    expect(applyLayerAudio(plan('png-sequence'), [music]).audioOutput).toBeDefined();
  });

  it('is rendered from a library clip by the same rule', () => {
    const source: MediaSource = { kind: 'video', input: { path: '/lib/clip.mov' }, width: 1920, height: 1080, duration: 2, fps: 30, alpha: false, hasAudio: true };
    const gif = buildMediaRenderPlan({ source, presetId: 'gif', outputPath: '/out/clip' });
    const args = gif.stages[0]!.args;
    expect(args.join(' ')).toContain('palettegen');
    expect(flag(args, '-frames:v')).toBe('30');
    expect(args).toContain('-an');
    expect(gif.image).toEqual({ fps: 15, frames: 30 });
    expect(() => buildMediaRenderPlan({ source, presetId: 'apng', outputPath: '/out/clip', options: { matte: true } })).toThrow(/takes no matte/);
  });
});

describe('the WebP reader the render tests use', () => {
  it('reads the canvas, the flags, the loops and each frame\'s duration from the RIFF chunks', () => {
    const chunk = (name: string, body: number[]) => {
      const out = [...name].map((c) => c.charCodeAt(0));
      const size = body.length;
      out.push(size & 255, (size >> 8) & 255, (size >> 16) & 255, size >>> 24, ...body);
      if (size & 1) out.push(0);
      return out;
    };
    const u24 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
    const vp8x = chunk('VP8X', [0x12, 0, 0, 0, ...u24(63), ...u24(35)]);
    const anim = chunk('ANIM', [0, 0, 0, 0, 0, 0]);
    const frame = (ms: number) => chunk('ANMF', [...u24(0), ...u24(0), ...u24(63), ...u24(35), ...u24(ms), 0, 9, 9, 9]);
    const body = [...[...'WEBP'].map((c) => c.charCodeAt(0)), ...vp8x, ...anim, ...frame(33), ...frame(67)];
    const riff = [...[...'RIFF'].map((c) => c.charCodeAt(0)), ...[body.length & 255, (body.length >> 8) & 255, 0, 0], ...body];
    expect(readWebp(Uint8Array.from(riff))).toEqual({ width: 64, height: 36, alpha: true, animated: true, loops: 0, durations: [33, 67] });
    expect(readWebp(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});
