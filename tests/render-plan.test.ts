import { describe, expect, it } from 'vitest';
import {
  buildRenderPlan, cutSpeedSteps,
  coverArgs,
  coverFrameWithin,
  coverOutputPath,
  fpsToRational,
  matteCodecArgs,
  matteOutputPath,
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

describe('a LUT over the whole render (milestone 52)', () => {
  it('grades in RGB before the color conversion, in the plain and the flattening graphs alike', () => {
    const plain = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t', options: { lut: '/luts/warm.cube' } });
    const chain = plain.args[plain.args.indexOf('-vf') + 1]!;
    expect(chain).toContain("lut3d=file='/luts/warm.cube'");
    expect(chain.indexOf('lut3d'), 'before the Rec.709 conversion').toBeLessThan(chain.indexOf('out_color_matrix'));
    const flat = buildRenderPlan({ manifest: { ...timing(), alpha: true }, presetId: 'h264-mp4', outputPath: '/o/t', options: { lut: '/luts/warm.cube' } });
    const graph = flat.args[flat.args.indexOf('-filter_complex') + 1]!;
    expect(graph.indexOf('overlay'), 'the grade sees the finished picture, after the flatten').toBeLessThan(graph.indexOf('lut3d'));
    // Without one, nothing is graded; with the wrong kind of file, the plan is refused by name.
    expect(buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t' }).args.join(' ')).not.toContain('lut3d');
    expect(() => buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t', options: { lut: '/luts/warm.look' } })).toThrow(/\.cube/);
  });
});

describe('the cut track under the graphic (milestone 49)', () => {
  const track = { cuts: [{ path: '/lib/a.mp4', from: 0.5, to: 2.5 }, { path: '/lib/b.mov', from: 0, to: 1 }] };

  it('reads each cut as its own sought input, joins them at the output frame, and composites the graphic over', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t', track });
    const text = plan.args.join(' ');
    expect(text).toContain('-ss 0.5 -t 2 -i /lib/a.mp4');
    expect(text).toContain('-ss 0 -t 1 -i /lib/b.mov');
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
    // Inputs 1 and 2 (the pipe is 0), each brought to the output's clock, frame and square pixels.
    expect(graph).toContain('[1:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1:color=black,setsar=1,format=yuv420p');
    expect(graph).toContain('[t0][t1]concat=n=2:v=1:a=0[j0]');
    // Padded on in time and trimmed to the rendered range, so a short track pads rather than ending the file.
    expect(graph).toContain('[tcat]tpad=stop=-1:stop_mode=add:color=black,trim=start=0,setpts=PTS-STARTPTS[trk]');
    expect(graph).toContain('[trk][src]overlay=shortest=1:format=rgb');
    // The graphic's own preparation still runs, and the preset's conversion follows the composite.
    expect(graph.indexOf('overlay')).toBeLessThan(graph.indexOf('format=yuva444p10le'));
    expect(flag(plan.args, '-map')).toBe('[out]');
  });

  it('pads a flattening render with its chosen background, and starts the track at the trim', () => {
    const plan = buildRenderPlan({
      manifest: timing(), presetId: 'h264-mp4', outputPath: '/o/t', track,
      options: { background: '#112233', inFrame: 30 },
    });
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('color=0x112233');
    // The track replaces the flatten's own background source entirely.
    expect(graph).not.toContain('color=c=');
    expect(graph).toContain('trim=start=1,');
    expect(plan.firstFrame).toBe(30);
  });

  it('keeps the matte as the graphic\'s own alpha: the graphics over the footage are what an editor wants', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t', track, options: { matte: true } });
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[src]split[pic][mat]');
    expect(graph).toContain('[trk][pic]overlay=shortest=1:format=rgb');
    expect(graph).toContain('[matte]');
  });

  it('cross-fades a dissolve over clone-padded halves, so the join\'s length is the two cuts\' to the frame', () => {
    const plan = buildRenderPlan({
      manifest: timing(), presetId: 'png-sequence', outputPath: '/o/t',
      track: { cuts: [{ ...track.cuts[0]!, transition: { type: 'dissolve', seconds: 1 } }, track.cuts[1]!] },
    });
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[t0]tpad=stop_mode=clone:stop_duration=0.5[a0]');
    expect(graph).toContain('[t1]tpad=start_mode=clone:start_duration=0.5[b0]');
    // The first cut is two seconds, so the fade starts half a second before its end.
    expect(graph).toContain('[a0][b0]xfade=transition=fade:duration=1:offset=1.5[j0]');
    expect(graph).not.toContain('concat');
  });

  it('dips to the color inside the segments, out of the earlier and into the later', () => {
    const plan = buildRenderPlan({
      manifest: timing(), presetId: 'png-sequence', outputPath: '/o/t',
      track: { cuts: [{ ...track.cuts[0]!, transition: { type: 'dip', seconds: 0.5, color: '#00ff00' } }, track.cuts[1]!] },
    });
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('fade=t=out:st=1.75:d=0.25:color=0x00ff00');
    expect(graph).toContain('fade=t=in:st=0:d=0.25:color=0x00ff00');
    expect(graph, 'a dip does not move the timeline').toContain('concat=n=2');
  });

  it('plays a captured wipe over the join, with its alpha, padded to its place in time', () => {
    const plan = buildRenderPlan({
      manifest: timing(), presetId: 'png-sequence', outputPath: '/o/t',
      track: { cuts: track.cuts, wipes: [{ pattern: '/tmp/wipe/w%05d.png', at: 2, seconds: 0.5 }] },
    });
    const text = plan.args.join(' ');
    expect(text).toContain('-framerate 30 -start_number 0 -i /tmp/wipe/w%05d.png');
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('color=0x00000000,setsar=1,setpts=PTS-STARTPTS,tpad=start_mode=add:start_duration=1.75:color=0x00000000[w0]');
    expect(graph).toContain('[tcat][w0]overlay=eof_action=pass[wb0]');
    expect(graph).toContain('[wb0]tpad=stop=-1');
  });

  it('is one cut just the same, and no track is the plan as it always was', () => {
    const one = buildRenderPlan({ manifest: timing(), presetId: 'png-sequence', outputPath: '/o/t', track: { cuts: [track.cuts[0]!] } });
    const graph = one.args[one.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[t0]null[tcat]');
    expect(graph).not.toContain('concat');
    const none = buildRenderPlan({ manifest: timing(), presetId: 'png-sequence', outputPath: '/o/t', track: { cuts: [] } });
    expect(none.args.join(' ')).not.toContain('-filter_complex');
  });
});

describe('buildRenderPlan', () => {
  it('uses the same raw BGRA pipe input for every preset by default', () => {
    for (const presetId of PRESET_IDS) {
      const plan = buildRenderPlan({ manifest: timing(), presetId, outputPath: '/out/clip' });
      expect(plan.frameFormat).toBe('raw');
      expect(plan.args.slice(0, 14)).toEqual([
        '-hide_banner', '-loglevel', 'error', '-n',
        '-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', '1920x1080', '-framerate', '30', '-i', 'pipe:0',
      ]);
      // A still (milestone 44) is the one frame; a GIF (milestone 82) its 15 a second of the two
      // seconds; everything else the whole two seconds at the render's rate.
      expect(flag(plan.args, '-frames:v')).toBe(presetId === 'png-still' ? '1' : presetId === 'gif' ? '30' : '60');
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
          expect(['png-sequence', 'png-still', 'qt-animation', 'gif', 'webp-animated', 'apng']).toContain(presetId);
          expect(chain).not.toContain(REC709_CONVERT);
          expect(chain).toContain(`${RGB_FULL_TAGS},format=${preset.pixelFormat}`); // full-range RGB, declared
          // An animated image's own steps follow the conversion (milestone 82); a still's or a sequence's chain ends on it.
          if (!preset.animatedImage) expect(chain).toMatch(/format=(rgba|argb)$/);
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
    expect(() => buildRenderPlan({ manifest: timing(), presetId: 'mpeg2-ts', outputPath: '/o/t' })).toThrow(/unknown output preset/);
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
    expect(resolveTiming(two)).toEqual({ fps: 30, firstFrame: 0, totalFrames: 60, length: 2 });
    expect(resolveTiming(two, {})).toEqual({ fps: 30, firstFrame: 0, totalFrames: 60, length: 2 });
  });

  it('samples at a standard override rate over the same duration', () => {
    expect(resolveTiming(two, { fps: 60 })).toEqual({ fps: 60, firstFrame: 0, totalFrames: 120, length: 2 });
    expect(resolveTiming(two, { fps: 25 })).toEqual({ fps: 25, firstFrame: 0, totalFrames: 50, length: 2 });
    expect(resolveTiming(two, { fps: 23.976 }).totalFrames).toBe(48);
    expect(resolveTiming(two, { fps: 119.88 }).totalFrames).toBe(240);
  });

  it('only accepts frame rates from the standard list', () => {
    expect(() => resolveTiming(two, { fps: 31 })).toThrow(RenderPlanError);
    expect(() => resolveTiming(two, { fps: 31 })).toThrow(/frame rate must be one of 23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120, got 31/);
    expect(() => resolveTiming(two, { fps: 0 })).toThrow(/must be one of/);
    expect(() => resolveTiming(two, { fps: Number.NaN })).toThrow(/must be one of/);
    // A non-standard template rate is fine when not overridden.
    expect(resolveTiming({ fps: 12.5, duration: 2 })).toEqual({ fps: 12.5, firstFrame: 0, totalFrames: 25, length: 2 });
  });

  it('applies in and out points as inclusive frames at the output rate', () => {
    expect(resolveTiming(two, { inFrame: 15, outFrame: 44 })).toEqual({ fps: 30, firstFrame: 15, totalFrames: 30, length: 2 });
    expect(resolveTiming(two, { inFrame: 30 })).toEqual({ fps: 30, firstFrame: 30, totalFrames: 30, length: 2 });
    expect(resolveTiming(two, { outFrame: 14 })).toEqual({ fps: 30, firstFrame: 0, totalFrames: 15, length: 2 });
    expect(resolveTiming(two, { inFrame: 10, outFrame: 10 })).toEqual({ fps: 30, firstFrame: 10, totalFrames: 1, length: 2 });
    expect(resolveTiming(two, { fps: 60, inFrame: 60, outFrame: 119 })).toEqual({ fps: 60, firstFrame: 60, totalFrames: 60, length: 2 });
  });

  it('rejects impossible in and out points with a clear message', () => {
    expect(() => resolveTiming(two, { inFrame: -1 })).toThrow(/in point must be a frame number of 0 or more/);
    expect(() => resolveTiming(two, { inFrame: 1.5 })).toThrow(/in point/);
    expect(() => resolveTiming(two, { outFrame: 60 })).toThrow(/out point must be at most the last frame \(59 at 30 fps\)/);
    expect(() => resolveTiming(two, { inFrame: 20, outFrame: 10 })).toThrow(/out point \(frame 10\) must not be before the in point \(frame 20\)/);
  });

  it('still renders one frame for a template shorter than a frame, like frameCount', () => {
    expect(resolveTiming({ fps: 30, duration: 0.01 })).toEqual({ fps: 30, firstFrame: 0, totalFrames: 1, length: 0.01 });
  });

  it('runs for a length the template allows, and refuses one it does not (milestone 30)', () => {
    const designed = { fps: 30, duration: 6, structure: { kind: 'hold' as const, holdFrom: 1, holdTo: 5 } };
    // Twenty seconds of a six-second lower third is 600 frames at 30 fps.
    expect(resolveTiming(designed, { length: 20 })).toEqual({ fps: 30, firstFrame: 0, totalFrames: 600, length: 20 });
    // A trim is taken within the chosen length, not within the template's own.
    expect(resolveTiming(designed, { length: 20, inFrame: 300, outFrame: 599 })).toMatchObject({ firstFrame: 300, totalFrames: 300 });
    expect(() => resolveTiming(designed, { inFrame: 0, outFrame: 599 })).toThrow(/out point must be at most the last frame \(179 at 30 fps\)/);
    // Shorter than the entrance and exit allow is held at the floor rather than rushing them.
    expect(resolveTiming(designed, { length: 0.5 }).length).toBe(2.05);
    // A template with nothing to stretch says so instead of pretending.
    expect(() => resolveTiming({ fps: 30, duration: 6 }, { length: 20 })).toThrow(/does not declare an animate-in, hold and animate-out/);
    for (const length of [0, -2, Number.NaN]) {
      expect(() => resolveTiming(designed, { length }), String(length)).toThrow(/length must be a number of seconds greater than 0/);
    }
  });
});

describe('the matte pass (milestone 15)', () => {
  it('writes the alpha as gray beside the render, split from the same frames, with the codec minus its alpha', () => {
    const plan = buildRenderPlan({ manifest: { ...timing(), alpha: true }, presetId: 'prores-4444', outputPath: '/out/clip.mov', options: { matte: true } });
    expect(plan.matteOutput).toBe('/out/clip-matte.mov');
    const graph = flag(plan.args, '-filter_complex')!;
    expect(graph).toContain('[src]split[pic][mat]');
    expect(graph).toContain('[mat]format=rgba,alphaextract,');
    expect(graph).toContain('format=yuv444p10le[matte]');
    expect(plan.args.filter((a) => a === '-map')).toHaveLength(2);
    expect(plan.args[plan.args.length - 1]).toBe('/out/clip-matte.mov');
    // The matte carries no alpha bits of its own.
    const after = plan.args.slice(plan.args.lastIndexOf('[matte]'));
    expect(after).not.toContain('-alpha_bits');
    expect(matteCodecArgs(OUTPUT_PRESETS['hevc-alpha'])).not.toContain('-alpha_quality');
    // A flattened render keeps its matte: the gray is taken before the overlay.
    const flat = buildRenderPlan({ manifest: { ...timing(), alpha: true }, presetId: 'h264-mp4', outputPath: '/out/clip.mp4', options: { matte: true } });
    expect(flag(flat.args, '-filter_complex')).toContain('[bg][pic]overlay');
    expect(flat.matteOutput).toBe('/out/clip-matte.mp4');
    // A sequence's matte is a sequence of its own.
    expect(matteOutputPath('/out/clip_%05d.png', OUTPUT_PRESETS['png-sequence'])).toBe('/out/clip-matte_%05d.png');
    // Without the option nothing changes: one output, the -vf path.
    const plain = buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/out/clip.mov' });
    expect(plain.matteOutput).toBeUndefined();
    expect(plain.args).toContain('-vf');
  });
});

describe('a still image output (milestone 44)', () => {
  const timing = () => ({ fps: 30, duration: 2, alpha: true, aspects: ['16:9'] as string[] });
  it('is one PNG of the frame at the in point, whatever the out point says', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'png-still', outputPath: '/out/poster', options: { inFrame: 17, outFrame: 50 } });
    expect(plan.output).toBe('/out/poster.png');
    expect(plan.output).not.toContain('%');
    expect(plan.firstFrame).toBe(17);
    expect(plan.totalFrames).toBe(1);
    expect(plan.args).toContain('-update');
    expect(plan.args.includes('-start_number')).toBe(false);
    expect(plan.args[plan.args.indexOf('-frames:v') + 1]).toBe('1');
    expect(plan.preset.alpha).toBe(true);
  });

  it('takes the last frame for an in point past the end, since a playhead read at another rate can round past it', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'png-still', outputPath: '/out/poster.png', options: { inFrame: 200 } });
    expect(plan.firstFrame).toBe(59);
    expect(plan.totalFrames).toBe(1);
    // The sequence and the clips still refuse what they always refused.
    expect(() => buildRenderPlan({ manifest: timing(), presetId: 'png-sequence', outputPath: '/out/seq', options: { inFrame: 200 } })).toThrow(/out point/);
  });
});

describe('a cover image beside the render (milestone 20)', () => {
  const timing = () => ({ fps: 30, duration: 2, alpha: true, aspects: ['16:9'] as string[] });

  it('goes beside the render as a PNG, whatever the render is', () => {
    expect(coverOutputPath('/out/clip.mov')).toBe('/out/clip-cover.png');
    expect(coverOutputPath('/out/clip.mp4')).toBe('/out/clip-cover.png');
    // A sequence is many files; its cover is one, so the frame pattern goes.
    expect(coverOutputPath('/out/clip_%05d.png')).toBe('/out/clip-cover.png');
    expect(coverOutputPath('/out/no-extension')).toBe('/out/no-extension-cover.png');
    expect(coverOutputPath('C:\\renders\\clip.mov')).toBe('C:\\renders\\clip-cover.png');
  });

  it('is the frame that was asked for, held inside the graphic', () => {
    expect(coverFrameWithin(17, 30, 2)).toBe(17);
    expect(coverFrameWithin(0, 30, 2)).toBe(0);
    // A playhead read at one rate and a render at another can land past the end; the end is meant.
    expect(coverFrameWithin(200, 30, 2)).toBe(59);
    expect(coverFrameWithin(-5, 30, 2)).toBe(0);
    expect(coverFrameWithin(Number.NaN, 30, 2)).toBe(0);
  });

  it('is planned beside the render, and is not one of its outputs', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'h264-mp4', outputPath: '/out/clip', options: { coverFrame: 17 } });
    expect(plan.coverOutput).toBe('/out/clip-cover.png');
    expect(plan.coverFrame).toBe(17);
    // The video command is untouched: the cover is one more frame from the page, not a second output.
    expect(plan.args.join(' ')).not.toContain('cover');
    const without = buildRenderPlan({ manifest: timing(), presetId: 'h264-mp4', outputPath: '/out/clip' });
    expect(without.coverOutput).toBeUndefined();
  });

  it('can be a frame the trim leaves out: a cover is often the moment a title has landed', () => {
    const plan = buildRenderPlan({ manifest: timing(), presetId: 'h264-mp4', outputPath: '/out/clip', options: { inFrame: 40, outFrame: 50, coverFrame: 5 } });
    expect(plan.firstFrame).toBe(40);
    expect(plan.coverFrame, 'outside the trim and kept').toBe(5);
  });

  it('keeps alpha where the render has it, and is flattened over the same background where it has none', () => {
    const size = { width: 1920, height: 1080 };
    const alpha = coverArgs(OUTPUT_PRESETS['prores-4444'], size, '#000000', '/out/c.png');
    expect(alpha).toContain('rgba');
    expect(alpha.join(' ')).not.toContain('overlay');
    const opaque = coverArgs(OUTPUT_PRESETS['h264-mp4'], size, '#1e90ff', '/out/c.png');
    expect(opaque.join(' ')).toContain('color=c=0x1e90ff:s=1920x1080');
    expect(opaque.join(' ')).toContain('overlay');
    expect(opaque.join(' ')).toContain('format=rgb24');
    expect(opaque[opaque.length - 1]).toBe('/out/c.png');
  });
});

describe('speed changes on the cut track (milestone 56)', () => {
  const plan = (cuts: NonNullable<Parameters<typeof buildRenderPlan>[0]['track']>['cuts']) =>
    buildRenderPlan({ manifest: timing(), presetId: 'prores-4444', outputPath: '/o/t', track: { cuts } });
  const graph = (cuts: Parameters<typeof plan>[0]) => {
    const p = plan(cuts);
    return p.args[p.args.indexOf('-filter_complex') + 1]!;
  };

  it('divides a cut\'s timestamps by its rate and brings it back to the output rate', () => {
    expect(cutSpeedSteps({ from: 0, to: 2 }, 30)).toEqual(['fps=30']);
    expect(cutSpeedSteps({ from: 0, to: 2, speed: { rate: 2 } }, 30)).toEqual(['setpts=(PTS-STARTPTS)/2', 'fps=30']);
    // Slow motion repeats frames by default, and makes them up when asked to be smooth.
    expect(cutSpeedSteps({ from: 0, to: 2, speed: { rate: 0.5 } }, 30)).toEqual(['setpts=(PTS-STARTPTS)/0.5', 'fps=30']);
    expect(cutSpeedSteps({ from: 0, to: 2, speed: { rate: 0.5, smooth: true } }, 30)).toEqual([
      'setpts=(PTS-STARTPTS)/0.5', 'minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1',
    ]);
    // Smooth means nothing at a speed where no frame has to be made up.
    expect(cutSpeedSteps({ from: 0, to: 2, speed: { rate: 2, smooth: true } }, 30)).toEqual(['setpts=(PTS-STARTPTS)/2', 'fps=30']);
  });

  it('maps a ramp through the inverse of its integral, as a setpts expression without exponents, and trims to its length', () => {
    // 1× to 3× over 4 s of file is 2 s of timeline: a = (3−1)/(2·2) = 0.5, so t = (−1 + √(1 + 2s)) / 1.
    const steps = cutSpeedSteps({ from: 0, to: 4, speed: { rate: 1, to: 3 } }, 30);
    expect(steps).toEqual(['setpts=((0-1)+sqrt(1+2*(PTS-STARTPTS)*TB))/(1)/TB', 'fps=30', 'trim=duration=2']);
    // The expression carries no comma or colon, so it sits inside a filter graph as it is.
    expect(steps[0]).not.toMatch(/[,:]/);
    expect(steps[0]).not.toMatch(/e[+-]\d/);
    // A slow ramp interpolates when asked.
    expect(cutSpeedSteps({ from: 0, to: 1, speed: { rate: 1, to: 0.25, smooth: true } }, 30)[1]).toMatch(/^minterpolate=fps=30/);
  });

  it('holds a freeze frame\'s one frame for the hold, from a sliver of the file', () => {
    expect(cutSpeedSteps({ from: 3, to: 3.05, hold: 2 }, 30)).toEqual([
      'trim=end_frame=1', 'setpts=PTS-STARTPTS', 'tpad=stop_mode=clone:stop_duration=2', 'fps=30', 'trim=duration=2',
    ]);
    const p = plan([{ path: '/lib/a.mp4', from: 3, to: 3.05, hold: 2 }, { path: '/lib/b.mov', from: 0, to: 1 }]);
    expect(p.args.join(' ')).toContain('-ss 3 -t 0.2 -i /lib/a.mp4');
  });

  it('lays the joins at the cuts\' timeline lengths, not their file lengths', () => {
    // A 2 s window at 2× is 1 s on the timeline, so a dissolve into the next cut is centered at 1 s.
    const g = graph([
      { path: '/lib/a.mp4', from: 0, to: 2, speed: { rate: 2 }, transition: { type: 'dissolve', seconds: 0.5 } },
      { path: '/lib/b.mov', from: 0, to: 1 },
    ]);
    expect(g).toContain('[1:v]setpts=(PTS-STARTPTS)/2,fps=30,scale=1920:1080');
    expect(g).toContain('xfade=transition=fade:duration=0.5:offset=0.75[j0]');
    // A dip out of a slowed cut fades at the end of its timeline length.
    const dip = graph([
      { path: '/lib/a.mp4', from: 0, to: 1, speed: { rate: 0.5 }, transition: { type: 'dip', seconds: 0.5, color: '#000000' } },
      { path: '/lib/b.mov', from: 0, to: 1 },
    ]);
    expect(dip).toContain('fade=t=out:st=1.75:d=0.25');
  });
});
