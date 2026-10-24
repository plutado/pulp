import { describe, expect, it } from 'vitest';
import {
  buildRenderPlan,
  fpsToRational,
  normalizeOutputPath,
  OUTPUT_PRESETS,
  PRESET_IDS,
  REC709_CONVERT,
  REC709_TAGS,
  RGB_FULL_TAGS,
  RenderPlanError,
  UNPREMULTIPLY,
  alphaModeTag,
  resolveTiming,
} from '../src/core/render-plan';
import { timing } from './fixtures';

/** Value following a flag in an argument list. */
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

describe('buildRenderPlan', () => {
  it('uses the same raw BGRA pipe input for every preset by default', () => {
    for (const presetId of PRESET_IDS) {
      const plan = buildRenderPlan({ manifest: timing(), presetId, outputPath: '/out/clip' });
      expect(plan.frameFormat).toBe('raw');
      expect(plan.args.slice(0, 14)).toEqual([
        '-hide_banner', '-loglevel', 'error', '-n',
        '-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', '1920x1080', '-framerate', '30', '-i', 'pipe:0',
      ]);
      expect(flag(plan.args, '-frames:v')).toBe('60');
    }
  });

  it('keeps the PNG pipe input available for every preset', () => {
    for (const presetId of PRESET_IDS) {
      const plan = buildRenderPlan({ manifest: timing(), presetId, outputPath: '/out/clip', frameFormat: 'png' });
      expect(plan.frameFormat).toBe('png');
      expect(plan.args.slice(0, 12)).toEqual([
        '-hide_banner', '-loglevel', 'error', '-n',
        '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', 'pipe:0',
      ]);
      expect(plan.args.join(' ')).not.toContain('unpremultiply');
    }
  });

  it('unpremultiplies premultiplied raw frames from alpha templates, through planar RGB, and only those', () => {
    const alpha = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t.mov', frameFormat: 'raw' });
    expect(UNPREMULTIPLY).toBe('format=gbrap,unpremultiply=inplace=1');
    expect(flag(alpha.args, '-vf')!.startsWith(`${UNPREMULTIPLY},`)).toBe(true);
    const opaque = buildRenderPlan({ manifest: timing({ alpha: false }), presetId: 'prores-4444', outputPath: '/o/t.mov', frameFormat: 'raw' });
    expect(opaque.args.join(' ')).not.toContain('unpremultiply');
    const straight = buildRenderPlan({
      manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t.mov', frameFormat: 'raw',
      rawInput: { pixelFormat: 'bgra', premultiplied: false },
    });
    expect(straight.args.join(' ')).not.toContain('unpremultiply');
  });

  it('tags raw frames with their alpha mode when ffmpeg understands it, before anything else', () => {
    const base = { manifest: timing(), outputPath: '/o/t', frameFormat: 'raw' as const, tagAlphaMode: true };
    const premul = buildRenderPlan({ ...base, presetId: 'png-sequence' });
    expect(flag(premul.args, '-vf')).toBe(`${alphaModeTag(true)},${UNPREMULTIPLY},${RGB_FULL_TAGS},format=rgba`);
    expect(alphaModeTag(true)).toBe('setparams=alpha_mode=premultiplied');

    const straight = buildRenderPlan({ ...base, presetId: 'png-sequence', rawInput: { pixelFormat: 'rgba', premultiplied: false } });
    expect(flag(straight.args, '-vf')).toBe(`setparams=alpha_mode=straight,${RGB_FULL_TAGS},format=rgba`);

    // Opaque template: tagged, nothing to undo, straight into the Rec.709 steps.
    const opaque = buildRenderPlan({ ...base, manifest: timing({ alpha: false }), presetId: 'prores-422hq' });
    expect(flag(opaque.args, '-vf')).toBe(`${alphaModeTag(true)},${REC709_CONVERT},${REC709_TAGS},format=yuv422p10le`);

    // Flattened: the tag and the undo run on the foreground before compositing.
    const flat = buildRenderPlan({ ...base, presetId: 'h264-mp4' });
    expect(flag(flat.args, '-filter_complex')).toContain(`[0:v]${alphaModeTag(true)},${UNPREMULTIPLY}[fg];[bg][fg]overlay`);

    // PNG frames carry their own alpha mode; no tag.
    const png = buildRenderPlan({ ...base, presetId: 'png-sequence', frameFormat: 'png' });
    expect(png.args.join(' ')).not.toContain('alpha_mode');
    // Older ffmpeg (default): no tag either, since setparams would reject the option.
    const old = buildRenderPlan({ ...base, presetId: 'png-sequence', tagAlphaMode: false });
    expect(old.args.join(' ')).not.toContain('alpha_mode');
  });

  it('takes the raw byte order from the measured capture format', () => {
    for (const pixelFormat of ['bgra', 'rgba'] as const) {
      const plan = buildRenderPlan({
        manifest: timing(), presetId: 'h264-mp4', outputPath: '/o/t.mp4', frameFormat: 'raw',
        rawInput: { pixelFormat, premultiplied: true },
      });
      expect(flag(plan.args, '-pixel_format')).toBe(pixelFormat);
    }
    const png = buildRenderPlan({
      manifest: timing(), presetId: 'h264-mp4', outputPath: '/o/t.mp4', frameFormat: 'png',
      rawInput: { pixelFormat: 'rgba', premultiplied: false },
    });
    expect(png.args).not.toContain('-pixel_format');
  });

  it('prores-4444 keeps alpha', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/out/lt.mov', overwrite: true, frameFormat: 'raw' });
    expect(plan.output).toBe('/out/lt.mov');
    expect(plan.args).toContain('-y');
    expect(flag(plan.args, '-vf')).toBe(`${UNPREMULTIPLY},${REC709_CONVERT},${REC709_TAGS},format=yuva444p10le`);
    expect(plan.args).not.toContain('-pix_fmt');
    expect(flag(plan.args, '-c:v')).toBe('prores_ks');
    expect(plan.args.join(' ')).toContain('-c:v prores_ks -profile:v 4444 -vendor apl0 -alpha_bits 16');
    expect(plan.args.at(-1)).toBe('/out/lt.mov');
    expect(plan.args).not.toContain('-filter_complex');
    expect(plan.warnings).toEqual([]);
  });

  it('png-sequence writes a numbered RGBA sequence starting at 0', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'png-sequence', outputPath: '/out/lt.png', frameFormat: 'raw' });
    expect(plan.output).toBe('/out/lt_%05d.png');
    expect(flag(plan.args, '-vf')).toBe(`${UNPREMULTIPLY},${RGB_FULL_TAGS},format=rgba`);
    expect(flag(plan.args, '-f')).toBe('rawvideo');
    expect(plan.args.join(' ')).toContain('-c:v png -f image2 -start_number 0 -frames:v 60');
  });

  it('webm-vp9-alpha uses yuva420p and disables alt-ref frames', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'webm-vp9-alpha', outputPath: '/out/lt.webm' });
    expect(flag(plan.args, '-vf')).toMatch(/,format=yuva420p$/);
    expect(flag(plan.args, '-auto-alt-ref')).toBe('0');
    expect(plan.args).toContain('libvpx-vp9');
  });

  it('non-alpha presets flatten alpha templates over the background color', () => {
    const plan = buildRenderPlan({
      manifest: timing({ size: { width: 1280, height: 720 }, fps: 29.97 }),
      presetId: 'h264-mp4',
      outputPath: '/out/lt.mp4',
      options: { background: '#102030' },
      frameFormat: 'raw',
    });
    expect(flag(plan.args, '-filter_complex')).toBe(
      `color=c=0x102030:s=1280x720:r=30000/1001[bg];[0:v]${UNPREMULTIPLY}[fg];[bg][fg]overlay=shortest=1:format=rgb,${REC709_CONVERT},${REC709_TAGS},format=yuv420p[out]`,
    );
    expect(flag(plan.args, '-map')).toBe('[out]');
    expect(plan.args).not.toContain('-pix_fmt');
    expect(flag(plan.args, '-framerate')).toBe('30000/1001');
  });

  it('flattens PNG frames without unpremultiplying', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'h264-mp4', outputPath: '/out/lt.mp4', frameFormat: 'png' });
    expect(flag(plan.args, '-filter_complex')).toBe(
      `color=c=0x000000:s=1920x1080:r=30[bg];[bg][0:v]overlay=shortest=1:format=rgb,${REC709_CONVERT},${REC709_TAGS},format=yuv420p[out]`,
    );
  });

  it('non-alpha presets skip flattening for opaque templates', () => {
    const plan = buildRenderPlan({ manifest: timing({ alpha: false }), presetId: 'prores-422hq', outputPath: '/o/t.mov' });
    expect(plan.args).not.toContain('-filter_complex');
    expect(flag(plan.args, '-vf')).toBe(`${REC709_CONVERT},${REC709_TAGS},format=yuv422p10le`);
    expect(flag(plan.args, '-profile:v')).toBe('hq');
  });

  it('warns when an alpha preset is used for an opaque template', () => {
    const plan = buildRenderPlan({ manifest: timing({ alpha: false }), presetId: 'prores-4444', outputPath: '/o/t.mov' });
    expect(plan.warnings).toHaveLength(1);
  });

  it('converts video presets to Rec.709 limited range after compositing, and leaves PNG as RGB', () => {
    for (const presetId of PRESET_IDS) {
      const preset = OUTPUT_PRESETS[presetId];
      for (const frameFormat of ['raw', 'png'] as const) {
        const plan = buildRenderPlan({ manifest: timing(), presetId, outputPath: '/o/t', frameFormat, options: { background: '#ffffff' } });
        const chain = flag(plan.args, '-filter_complex') ?? flag(plan.args, '-vf') ?? '';
        if (preset.color === 'rec709') {
          expect(chain).toContain(`${REC709_CONVERT},${REC709_TAGS},format=${preset.pixelFormat}`);
          // Conversion comes after the background composite, so both go through it the same way.
          if (chain.includes('overlay')) expect(chain.indexOf('overlay')).toBeLessThan(chain.indexOf(REC709_CONVERT));
        } else {
          expect(['png-sequence', 'qt-animation']).toContain(presetId);
          expect(chain).not.toContain(REC709_CONVERT);
          expect(chain).toContain(`${RGB_FULL_TAGS},format=`); // full-range RGB, declared
          expect(chain).toMatch(/format=(rgba|argb)$/);
        }
      }
    }
  });

  it('qt-animation writes lossless ARGB QuickTime Animation', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'qt-animation', outputPath: '/o/t', frameFormat: 'raw' });
    expect(plan.output).toBe('/o/t.mov');
    expect(flag(plan.args, '-vf')).toBe(`${UNPREMULTIPLY},${RGB_FULL_TAGS},format=argb`);
    expect(RGB_FULL_TAGS).toContain('range=pc');
    expect(RGB_FULL_TAGS).toContain('colorspace=gbr');
    expect(plan.args.join(' ')).toContain('-c:v qtrle');
    expect(OUTPUT_PRESETS['qt-animation']).toMatchObject({ alpha: true, color: 'rgb', requiresEvenDimensions: false });
  });

  it('hevc-alpha feeds VideoToolbox 4:4:4 Y\'CbCr with alpha, converted and tagged here, as hvc1', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'hevc-alpha', outputPath: '/o/t', frameFormat: 'raw' });
    expect(plan.output).toBe('/o/t.mov');
    expect(flag(plan.args, '-vf')).toBe(`${UNPREMULTIPLY},${REC709_CONVERT},${REC709_TAGS},format=ayuv`);
    expect(plan.args.join(' ')).toContain('-c:v hevc_videotoolbox -q:v 80 -alpha_quality 0.9 -tag:v hvc1');
    expect(OUTPUT_PRESETS['hevc-alpha']).toMatchObject({ alpha: true, color: 'rec709', requiresEvenDimensions: true, encoder: 'hevc_videotoolbox' });
    expect(OUTPUT_PRESETS['hevc-alpha'].platformNote).toContain('macOS');
  });

  describe('frame size', () => {
    const shapes = timing({ aspects: ['16:9', '9:16', '1:1'], size: undefined });

    it('comes from the chosen aspect and resolution, not the manifest, and is reported in the plan', () => {
      const wide = buildRenderPlan({ manifest: shapes, presetId: 'prores-4444', outputPath: '/o/t.mov', frameFormat: 'raw' });
      expect(wide).toMatchObject({ aspect: '16:9', width: 1920, height: 1080 });
      expect(flag(wide.args, '-video_size')).toBe('1920x1080');
      const tall = buildRenderPlan({ manifest: shapes, presetId: 'prores-4444', outputPath: '/o/t.mov', frameFormat: 'raw', options: { aspect: '9:16' } });
      expect(tall).toMatchObject({ aspect: '9:16', width: 1080, height: 1920 });
      expect(flag(tall.args, '-video_size')).toBe('1080x1920');
      const small = buildRenderPlan({ manifest: shapes, presetId: 'h264-mp4', outputPath: '/o/t.mp4', frameFormat: 'raw', options: { width: 720, height: 720 } });
      expect(small).toMatchObject({ aspect: '1:1', width: 720, height: 720 });
      // The flattening background is the output size too.
      expect(flag(small.args, '-filter_complex')).toContain('s=720x720');
    });

    it('keeps a declared size as that template\'s default', () => {
      expect(buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t.mov' })).toMatchObject({ aspect: '16:9', width: 1920, height: 1080 });
      expect(buildRenderPlan({ manifest: timing({ size: { width: 1280, height: 720 } }), presetId: 'prores-4444', outputPath: '/o/t.mov' })).toMatchObject({ width: 1280, height: 720 });
    });

    it('refuses an aspect the template does not draw for, or a size that is not of the aspect, as a plan error', () => {
      expect(() => buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t.mov', options: { aspect: '9:16' } })).toThrow(RenderPlanError);
      expect(() => buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t.mov', options: { aspect: '9:16' } })).toThrow(/not one the template draws for/);
      expect(() => buildRenderPlan({ manifest: shapes, presetId: 'prores-4444', outputPath: '/o/t.mov', options: { aspect: '16:9', width: 1080, height: 1920 } })).toThrow(/is 9:16, not 16:9/);
      expect(() => buildRenderPlan({ manifest: shapes, presetId: 'prores-4444', outputPath: '/o/t.mov', options: { width: 1920 } })).toThrow(/together/);
    });

    it('applies the even-dimension rule to the chosen size', () => {
      expect(() => buildRenderPlan({ manifest: shapes, presetId: 'h264-mp4', outputPath: '/o/t.mp4', options: { width: 1365, height: 768 } })).toThrow(/even width and height; the output size is 1365x768/);
      expect(() => buildRenderPlan({ manifest: shapes, presetId: 'png-sequence', outputPath: '/o/t.png', options: { width: 1365, height: 768 } })).not.toThrow();
    });
  });

  it('rejects odd dimensions for chroma-subsampled presets only', () => {
    const odd = timing({ size: { width: 1919, height: 1080 } });
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'h264-mp4', outputPath: '/o/t.mp4' })).toThrow(RenderPlanError);
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'webm-vp9-alpha', outputPath: '/o/t.webm' })).toThrow(/even/);
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'prores-4444', outputPath: '/o/t.mov' })).not.toThrow();
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'png-sequence', outputPath: '/o/t.png' })).not.toThrow();
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'qt-animation', outputPath: '/o/t.mov' })).not.toThrow();
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'hevc-alpha', outputPath: '/o/t.mov' })).toThrow(/even/);
  });

  it('rejects unknown presets and bad background colors', () => {
    expect(() => buildRenderPlan({ manifest: timing(), presetId: 'gif', outputPath: '/o/t' })).toThrow(/unknown output preset/);
    expect(() =>
      buildRenderPlan({ manifest: timing(), presetId: 'h264-mp4', outputPath: '/o/t', options: { background: 'black' } }),
    ).toThrow(/background/);
  });

  it('applies a frame-rate override to the input rate, the output rate, the frame count and the background source', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t', options: { fps: 60 } });
    expect(plan.fps).toBe(60);
    expect(plan.firstFrame).toBe(0);
    expect(plan.totalFrames).toBe(120);
    expect(flag(plan.args, '-framerate')).toBe('60');
    expect(flag(plan.args, '-r')).toBe('60');
    expect(flag(plan.args, '-frames:v')).toBe('120');

    const ntsc = buildRenderPlan({ manifest: timing(), presetId: 'h264-mp4', outputPath: '/o/t', options: { fps: 29.97 } });
    expect(flag(ntsc.args, '-framerate')).toBe('30000/1001');
    expect(flag(ntsc.args, '-filter_complex')).toContain(':r=30000/1001[bg]');
    expect(ntsc.totalFrames).toBe(60);
  });

  it('applies in and out points to the frame count and numbers sequence files from the in point', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'png-sequence', outputPath: '/o/t', options: { inFrame: 15, outFrame: 44 } });
    expect(plan).toMatchObject({ fps: 30, firstFrame: 15, totalFrames: 30 });
    expect(flag(plan.args, '-frames:v')).toBe('30');
    expect(flag(plan.args, '-start_number')).toBe('15');
    const mov = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t', options: { inFrame: 15, outFrame: 44 } });
    expect(mov.args).not.toContain('-start_number');
  });

  it('every preset declares an encoder that appears in its codec args', () => {
    for (const preset of Object.values(OUTPUT_PRESETS)) {
      expect(preset.codecArgs).toContain(preset.encoder);
    }
  });
});

describe('normalizeOutputPath', () => {
  const mov = OUTPUT_PRESETS['prores-4444'];
  const png = OUTPUT_PRESETS['png-sequence'];

  it('adds or replaces the extension', () => {
    expect(normalizeOutputPath('/a/b', mov)).toBe('/a/b.mov');
    expect(normalizeOutputPath('/a/b.mp4', mov)).toBe('/a/b.mov');
    expect(normalizeOutputPath('/a/b.MOV', mov)).toBe('/a/b.MOV');
    expect(normalizeOutputPath('C:\\renders\\b', mov)).toBe('C:\\renders\\b.mov');
  });

  it('keeps dots that are part of the name', () => {
    expect(normalizeOutputPath('/a/v1.2.final', mov)).toBe('/a/v1.2.final.mov');
  });

  it('adds a frame pattern to sequences unless one is present', () => {
    expect(normalizeOutputPath('/a/frames', png)).toBe('/a/frames_%05d.png');
    expect(normalizeOutputPath('/a/frame-%04d.png', png)).toBe('/a/frame-%04d.png');
  });

  it('requires a file name', () => {
    expect(() => normalizeOutputPath('/a/', mov)).toThrow(RenderPlanError);
  });
});

describe('fpsToRational', () => {
  it('maps NTSC rates to exact rationals', () => {
    expect(fpsToRational(23.976)).toBe('24000/1001');
    expect(fpsToRational(29.97)).toBe('30000/1001');
    expect(fpsToRational(59.94)).toBe('60000/1001');
    expect(fpsToRational(25)).toBe('25');
    expect(fpsToRational(12.5)).toBe('12.5');
  });
});

describe('resolveTiming', () => {
  const two = { fps: 30, duration: 2 };

  it('defaults to the template timing', () => {
    expect(resolveTiming(two)).toEqual({ fps: 30, firstFrame: 0, totalFrames: 60 });
    expect(resolveTiming(two, {})).toEqual({ fps: 30, firstFrame: 0, totalFrames: 60 });
  });

  it('samples at a standard override rate over the same duration', () => {
    expect(resolveTiming(two, { fps: 60 })).toEqual({ fps: 60, firstFrame: 0, totalFrames: 120 });
    expect(resolveTiming(two, { fps: 25 })).toEqual({ fps: 25, firstFrame: 0, totalFrames: 50 });
    expect(resolveTiming(two, { fps: 23.976 }).totalFrames).toBe(48);
    expect(resolveTiming(two, { fps: 119.88 }).totalFrames).toBe(240);
  });

  it('only accepts frame rates from the standard list', () => {
    expect(() => resolveTiming(two, { fps: 31 })).toThrow(RenderPlanError);
    expect(() => resolveTiming(two, { fps: 31 })).toThrow(/frame rate must be one of 23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120, got 31/);
    expect(() => resolveTiming(two, { fps: 0 })).toThrow(/must be one of/);
    expect(() => resolveTiming(two, { fps: Number.NaN })).toThrow(/must be one of/);
    // A non-standard template rate is fine when not overridden.
    expect(resolveTiming({ fps: 12.5, duration: 2 })).toEqual({ fps: 12.5, firstFrame: 0, totalFrames: 25 });
  });

  it('applies in and out points as inclusive frames at the output rate', () => {
    expect(resolveTiming(two, { inFrame: 15, outFrame: 44 })).toEqual({ fps: 30, firstFrame: 15, totalFrames: 30 });
    expect(resolveTiming(two, { inFrame: 30 })).toEqual({ fps: 30, firstFrame: 30, totalFrames: 30 });
    expect(resolveTiming(two, { outFrame: 14 })).toEqual({ fps: 30, firstFrame: 0, totalFrames: 15 });
    expect(resolveTiming(two, { inFrame: 10, outFrame: 10 })).toEqual({ fps: 30, firstFrame: 10, totalFrames: 1 });
    expect(resolveTiming(two, { fps: 60, inFrame: 60, outFrame: 119 })).toEqual({ fps: 60, firstFrame: 60, totalFrames: 60 });
  });

  it('rejects impossible in and out points with a clear message', () => {
    expect(() => resolveTiming(two, { inFrame: -1 })).toThrow(/in point must be a frame number of 0 or more/);
    expect(() => resolveTiming(two, { inFrame: 1.5 })).toThrow(/in point/);
    expect(() => resolveTiming(two, { outFrame: 60 })).toThrow(/out point must be at most the last frame \(59 at 30 fps\)/);
    expect(() => resolveTiming(two, { inFrame: 20, outFrame: 10 })).toThrow(/out point \(frame 10\) must not be before the in point \(frame 20\)/);
  });

  it('still renders one frame for a template shorter than a frame, like frameCount', () => {
    expect(resolveTiming({ fps: 30, duration: 0.01 })).toEqual({ fps: 30, firstFrame: 0, totalFrames: 1 });
  });
});
