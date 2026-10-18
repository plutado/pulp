import { describe, expect, it } from 'vitest';
import {
  buildRenderPlan,
  fpsToRational,
  normalizeOutputPath,
  OUTPUT_PRESETS,
  PRESET_IDS,
  RenderPlanError,
} from '../src/core/render-plan';
import { timing } from './fixtures';

/** Value following a flag in an argument list. */
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

describe('buildRenderPlan', () => {
  it('uses the same PNG pipe input for every preset', () => {
    for (const presetId of PRESET_IDS) {
      const { args } = buildRenderPlan({ manifest: timing(), presetId, outputPath: '/out/clip' });
      expect(args.slice(0, 13)).toEqual([
        '-hide_banner', '-loglevel', 'error', '-n',
        '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', 'pipe:0',
        args[12],
      ]);
      expect(flag(args, '-frames:v')).toBe('60');
    }
  });

  it('prores-4444 keeps alpha', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/out/lt.mov', overwrite: true });
    expect(plan.output).toBe('/out/lt.mov');
    expect(plan.args).toContain('-y');
    expect(flag(plan.args, '-pix_fmt')).toBe('yuva444p10le');
    expect(flag(plan.args, '-c:v', )).toBe('png'); // input codec comes first
    expect(plan.args.join(' ')).toContain('-c:v prores_ks -profile:v 4444 -vendor apl0 -alpha_bits 16');
    expect(plan.args.at(-1)).toBe('/out/lt.mov');
    expect(plan.args).not.toContain('-filter_complex');
    expect(plan.warnings).toEqual([]);
  });

  it('png-sequence writes a numbered RGBA sequence starting at 0', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'png-sequence', outputPath: '/out/lt.png' });
    expect(plan.output).toBe('/out/lt_%05d.png');
    expect(flag(plan.args, '-pix_fmt')).toBe('rgba');
    expect(flag(plan.args, '-f', )).toBe('image2pipe');
    expect(plan.args.join(' ')).toContain('-c:v png -f image2 -start_number 0');
  });

  it('webm-vp9-alpha uses yuva420p and disables alt-ref frames', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'webm-vp9-alpha', outputPath: '/out/lt.webm' });
    expect(flag(plan.args, '-pix_fmt')).toBe('yuva420p');
    expect(flag(plan.args, '-auto-alt-ref')).toBe('0');
    expect(plan.args).toContain('libvpx-vp9');
  });

  it('non-alpha presets flatten alpha templates over the background color', () => {
    const plan = buildRenderPlan({
      manifest: timing({ width: 1280, height: 720, fps: 29.97 }),
      presetId: 'h264-mp4',
      outputPath: '/out/lt.mp4',
      background: '#102030',
    });
    expect(flag(plan.args, '-filter_complex')).toBe(
      'color=c=0x102030:s=1280x720:r=30000/1001[bg];[bg][0:v]overlay=shortest=1:format=auto,format=yuv420p[out]',
    );
    expect(flag(plan.args, '-map')).toBe('[out]');
    expect(plan.args).not.toContain('-pix_fmt');
    expect(flag(plan.args, '-framerate')).toBe('30000/1001');
  });

  it('non-alpha presets skip flattening for opaque templates', () => {
    const plan = buildRenderPlan({ manifest: timing({ alpha: false }), presetId: 'prores-422hq', outputPath: '/o/t.mov' });
    expect(plan.args).not.toContain('-filter_complex');
    expect(flag(plan.args, '-pix_fmt')).toBe('yuv422p10le');
    expect(flag(plan.args, '-profile:v')).toBe('hq');
  });

  it('warns when an alpha preset is used for an opaque template', () => {
    const plan = buildRenderPlan({ manifest: timing({ alpha: false }), presetId: 'prores-4444', outputPath: '/o/t.mov' });
    expect(plan.warnings).toHaveLength(1);
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
