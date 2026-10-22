import { describe, expect, it } from 'vitest';
import {
  buildRenderPlan,
  fpsToRational,
  normalizeOutputPath,
  OUTPUT_PRESETS,
  PRESET_IDS,
  REC709_CONVERT,
  REC709_TAGS,
  RenderPlanError,
  UNPREMULTIPLY,
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
    expect(flag(plan.args, '-vf')).toBe(`${UNPREMULTIPLY},format=rgba`);
    expect(flag(plan.args, '-f')).toBe('rawvideo');
    expect(plan.args.join(' ')).toContain('-c:v png -f image2 -start_number 0');
  });

  it('webm-vp9-alpha uses yuva420p and disables alt-ref frames', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'webm-vp9-alpha', outputPath: '/out/lt.webm' });
    expect(flag(plan.args, '-vf')).toMatch(/,format=yuva420p$/);
    expect(flag(plan.args, '-auto-alt-ref')).toBe('0');
    expect(plan.args).toContain('libvpx-vp9');
  });

  it('non-alpha presets flatten alpha templates over the background color', () => {
    const plan = buildRenderPlan({
      manifest: timing({ width: 1280, height: 720, fps: 29.97 }),
      presetId: 'h264-mp4',
      outputPath: '/out/lt.mp4',
      background: '#102030',
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
        const plan = buildRenderPlan({ manifest: timing(), presetId, outputPath: '/o/t', frameFormat, background: '#ffffff' });
        const chain = flag(plan.args, '-filter_complex') ?? flag(plan.args, '-vf') ?? '';
        if (preset.color === 'rec709') {
          expect(chain).toContain(`${REC709_CONVERT},${REC709_TAGS},format=${preset.pixelFormat}`);
          // Conversion comes after the background composite, so both go through it the same way.
          if (chain.includes('overlay')) expect(chain.indexOf('overlay')).toBeLessThan(chain.indexOf(REC709_CONVERT));
        } else {
          expect(presetId).toBe('png-sequence');
          expect(plan.args.join(' ')).not.toContain('bt709');
          expect(chain).toMatch(/format=rgba$/);
        }
      }
    }
  });

  it('rejects odd dimensions for chroma-subsampled presets only', () => {
    const odd = timing({ width: 1919 });
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'h264-mp4', outputPath: '/o/t.mp4' })).toThrow(RenderPlanError);
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'webm-vp9-alpha', outputPath: '/o/t.webm' })).toThrow(/even/);
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'prores-4444', outputPath: '/o/t.mov' })).not.toThrow();
    expect(() => buildRenderPlan({ manifest: odd, presetId: 'png-sequence', outputPath: '/o/t.png' })).not.toThrow();
  });

  it('rejects unknown presets and bad background colors', () => {
    expect(() => buildRenderPlan({ manifest: timing(), presetId: 'gif', outputPath: '/o/t' })).toThrow(/unknown output preset/);
    expect(() =>
      buildRenderPlan({ manifest: timing(), presetId: 'h264-mp4', outputPath: '/o/t', background: 'black' }),
    ).toThrow(/background/);
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
