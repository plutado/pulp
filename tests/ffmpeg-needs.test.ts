/**
 * What Pulp needs of the ffmpeg in use (milestone 88): the one table, the one
 * reading of a build, and the table held to the code both ways —
 *
 * - **What the planners write**: real argument lists from the planners —
 *   every preset at every shape of input, the cut track with its HDR,
 *   reframe, speeds and transitions, the mix with its dips, voices and
 *   leveling, an item rendered on its own, the clean-ups, the strips, the
 *   sample media — read for every filter and codec, each of which the table
 *   must name.
 * - **What the source names**: any library-backed filter or encoder in a
 *   string anywhere under src/, whether a planner here reaches it or not.
 *
 * And the builds Pulp fetches are held to the table, feature by feature.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  argsUse, CORE_FILTERS, FFMPEG_FEATURES, FFMPEG_NEEDS, featureForEncoder, featureStatus, featureStatuses, graphFilters, missingSentence, needsOn, tableNames,
} from '../src/core/ffmpeg-needs';
import { candidatePaths, capabilitiesOf, detectFfmpeg, parseDecoders, parseFilters, type ProcessRunner } from '../src/core/ffmpeg';
import { FFMPEG_BUILDS } from '../src/core/ffmpeg-download';
import { buildRenderPlan, OUTPUT_PRESETS, PRESET_IDS, type PresetId } from '../src/core/render-plan';
import { applyLayerAudio, applyStemAudio, measureMixArgs, type SoundAudioLayer, type ClipAudioLayer } from '../src/core/layer-audio';
import { buildMediaRenderPlan, AUDIO_PRESET_IDS, type MediaSource } from '../src/core/media-render';
import { EMPTY_SOUND } from '../src/core/sound-layer';
import { EMPTY_CLIP } from '../src/core/video-layer';
import { VOICE_TREATMENTS, voiceSteps } from '../src/core/voice-treatment';
import { chromaKeyArgs, chromaKeyStillArgs, KEY_DEFAULTS, sceneDetectArgs, sceneSplitArgs, STABILIZE_DEFAULTS, stabilizeDetectArgs, stabilizeTransformArgs } from '../src/core/clip-clean';
import { filmFramesArgs, filmStripPlan, filmTileArgs } from '../src/core/film-strip';
import { framesStripArgs, mediaStripArgs, sequenceStripArgs } from '../src/core/hover-scrub';
import { mediaThumbArgs, posterThumbArgs } from '../src/core/thumbnails';
import { posterFromFrameArgs, probeFrameArgs } from '../src/core/poster';
import { waveformArgs } from '../src/core/waveform';
import { levelArgs } from '../src/core/duck';
import { trackFramesArgs } from '../src/core/motion-track';
import { videoTakeArgs } from '../src/core/video-take';
import { clipSetLayersFramesArgs, clipSetLayersStitchArgs } from '../src/core/clip-set';
import { SAMPLE_MEDIA, sampleAssetArgs, sampleAudioArgs, sampleJpegArgs } from '../src/core/sample-media';
import { timing } from './fixtures';

const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------- the table and a build

describe('the table', () => {
  it('names every feature once, with a label and something it needs', () => {
    expect(FFMPEG_NEEDS.map((n) => n.id)).toEqual([...FFMPEG_FEATURES]);
    for (const need of FFMPEG_NEEDS) {
      expect(need.label.length, need.id).toBeGreaterThan(0);
      expect([need.filters, need.encoders, need.decoders, need.anyEncoder].some((l) => l && l.length > 0), need.id).toBe(true);
    }
  });

  it('knows which features a platform has: HEVC with alpha is Apple\'s', () => {
    expect(needsOn('darwin').map((n) => n.id)).toContain('hevc-alpha');
    expect(needsOn('win32').map((n) => n.id)).not.toContain('hevc-alpha');
  });

  it('answers a feature from a build: what it lacks, by name and by library', () => {
    const caps = { filters: ['scale', 'tonemap'], encoders: ['libx264', 'h264_videotoolbox'], decoders: ['libvpx'] };
    expect(featureStatus(caps, 'hdr')).toEqual({ id: 'hdr', ok: false, missing: ['zscale'], library: 'libzimg' });
    expect(featureStatus(caps, 'h264').ok).toBe(true);
    // One decoder of the two will do for reading WebM with alpha; one H.264 encoder of five for a take.
    expect(featureStatus(caps, 'webm-alpha').ok).toBe(true);
    expect(featureStatus(caps, 'take').ok).toBe(true);
    expect(featureStatus({ ...caps, encoders: ['png'] }, 'take')).toMatchObject({ ok: false, missing: ['libx264'] });
    expect(missingSentence(featureStatus(caps, 'hdr'))).toMatch(/libzimg.*zscale.*Settings → FFmpeg/);
  });

  it('holds nothing against a list it could not read', () => {
    const unknown = { filters: null, encoders: null, decoders: null };
    expect(featureStatuses(unknown, 'darwin').every((f) => f.ok)).toBe(true);
  });

  it('says which feature an encoder belongs to, and none for one every build has', () => {
    expect(featureForEncoder('libwebp_anim')).toBe('webp');
    expect(featureForEncoder('prores_ks')).toBeUndefined();
  });
});

describe('reading a build once', () => {
  const FILTERS = `Filters:
  T.. = Timeline support
  .S. = Slice threading
  A = Audio input/output
  | = Source or sink filter
 TS scale             V->V       Scale the input video size and/or convert the image format.
 .. zscale            V->V       Apply resizing, colorspace and bit depth conversion.
 .. color             |->V       Provide an uniformly colored input.
 T.C tonemap          V->V       Conversion to/from different dynamic ranges.
`;
  const DECODERS = `Decoders:
 V..... = Video
 ------
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
`;

  it('reads the filter and decoder lists, and says unknown for anything that is not one', () => {
    expect(parseFilters(FILTERS)).toEqual(['scale', 'zscale', 'color', 'tonemap']);
    expect(parseDecoders(DECODERS)).toEqual(['libvpx-vp9', 'aac']);
    expect(parseFilters('ffmpeg version 8.0')).toBeNull();
    expect(parseDecoders('')).toBeNull();
  });

  it('reads every list from the one ffmpeg, and gives the table what it read', async () => {
    const calls: string[][] = [];
    const run: ProcessRunner = async (command, args) => {
      calls.push(args);
      if (command !== '/x/ffmpeg') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      if (args.includes('-filters')) return { code: 0, stdout: FILTERS, stderr: '' };
      if (args.includes('-decoders')) return { code: 0, stdout: DECODERS, stderr: '' };
      if (args.includes('-encoders')) return { code: 0, stdout: ' ------\n V....D libx264  x264\n', stderr: '' };
      return { code: 0, stdout: 'ffmpeg version 8.0\n', stderr: '' };
    };
    const status = await detectFfmpeg(run, { PULP_FFMPEG_PATH: '/x/ffmpeg' });
    expect(status.ok && status.filters).toEqual(['scale', 'zscale', 'color', 'tonemap']);
    expect(featureStatus(capabilitiesOf(status), 'hdr').ok).toBe(true);
    expect(featureStatus(capabilitiesOf(status), 'stabilize').ok).toBe(false);
    expect(calls.map((a) => a.find((x) => x.startsWith('-') && x !== '-hide_banner'))).toEqual(['-version', '-encoders', '-decoders', '-filters', '-h']);
  });

  it('puts a chosen ffmpeg first, after the override for scripts, and the fetched build last unless chosen', () => {
    expect(candidatePaths({}, '/data/ffmpeg/ffmpeg', '/opt/own/ffmpeg')).toEqual(['/opt/own/ffmpeg', 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/data/ffmpeg/ffmpeg']);
    expect(candidatePaths({ PULP_FFMPEG_PATH: '/ci/ffmpeg' }, null, '/opt/own/ffmpeg')[0]).toBe('/ci/ffmpeg');
    expect(candidatePaths({}, '/data/ffmpeg/ffmpeg', '/data/ffmpeg/ffmpeg')[0]).toBe('/data/ffmpeg/ffmpeg');
    expect(candidatePaths({}, '/data/ffmpeg/ffmpeg', null).at(-1)).toBe('/data/ffmpeg/ffmpeg');
  });
});

describe('reading what a plan uses', () => {
  it('finds each filter of a graph past its labels, its options and its quoted commas', () => {
    expect(graphFilters("[0:v]scale=1920:1080,format=rgba[a];[a][1:v]overlay=shortest=1[out]")).toEqual(['scale', 'format', 'overlay']);
    expect(graphFilters("select='between(n\\,0\\,9)',setpts=N/FRAME_RATE/TB")).toEqual(['select', 'setpts']);
    expect(graphFilters("crop=320:180:'clip((0.5)*iw-ow/2,0,iw-ow)':'if(lt(t,1),0.5,0.4)'")).toEqual(['crop']);
    expect(graphFilters('null')).toEqual(['null']);
    // A filter with no options and an output label: the label is not the name.
    expect(graphFilters('[0:v]null[src];[src]split[pic][mat]')).toEqual(['null', 'split']);
  });

  it('reads the graphs and the codecs of an argument list, lavfi inputs included', () => {
    const used = argsUse(['-f', 'lavfi', '-i', 'sine=frequency=440', '-c:v', 'libvpx-vp9', '-i', 'a.webm', '-af', 'volume=2', '-c:a', 'libopus', 'out.webm']);
    expect(used.filters.sort()).toEqual(['sine', 'volume']);
    expect(used.codecs.sort()).toEqual(['libopus', 'libvpx-vp9']);
  });
});

// ---------------------------------------------------------------- held to the code: what the planners write

/** Argument lists from every planner, at the inputs that bring out the most of each. */
function plannedArgs(): { what: string; args: string[] }[] {
  const out: { what: string; args: string[] }[] = [];
  const add = (what: string, args: string[]) => out.push({ what, args });
  const music = (over: Partial<SoundAudioLayer['value']> = {}): SoundAudioLayer => ({ kind: 'sound', path: '/lib/m.wav', value: { ...EMPTY_SOUND, id: 'm', ...over }, source: { duration: 6 } });
  const clipSound: ClipAudioLayer = { kind: 'clip', path: '/lib/c.mov', value: { ...EMPTY_CLIP, id: 'c', ending: 'loop', speed: 0.5, voice: { treatment: 'clean-voice', amount: 1 } }, source: { frames: 60, fps: 30 } };
  const duck = { depth: 12, speed: 0.2, spans: [{ from: 1, to: 2 }] };
  const track = {
    cuts: [
      { path: '/lib/a.mov', from: 0, to: 2, tonemap: 'hlg' as const, transition: { type: 'dissolve' as const, seconds: 0.5 } },
      { path: '/lib/b.mov', from: 0, to: 2, speed: { rate: 0.5, to: 2, smooth: true as const }, transition: { type: 'dip' as const, seconds: 0.5, color: '#000000' } },
      { path: '/lib/c.mov', from: 1, to: 1.05, hold: 1 },
      { path: '/lib/d.mov', from: 0, to: 2, reframe: [{ at: 0, x: 0.3, y: 0.5 }, { at: 2, x: 0.7, y: 0.5 }] },
    ],
    wipes: [{ pattern: '/tmp/wipe_%05d.png', at: 2, seconds: 0.5 }],
  };
  for (const presetId of PRESET_IDS) {
    for (const alpha of [true, false]) {
      for (const frameFormat of ['raw', 'png'] as const) {
        const animated = OUTPUT_PRESETS[presetId].animatedImage;
        const options = { background: '#336699', lut: '/looks/warm.cube', ...(animated ? { animatedImage: { fps: 10, width: 320 } } : { matte: true }) };
        let plan = buildRenderPlan({ manifest: timing({ alpha }), presetId, outputPath: '/out/x', frameFormat, tagAlphaMode: true, options });
        plan = applyLayerAudio(plan, [music({ duck: { under: 'b.v', depth: 12, speed: 0.2 }, fadeIn: 0.5, fadeOut: 0.5, ending: 'loop', delay: 0.5, voice: { treatment: 'podcast', amount: 0.5 } }), clipSound], { target: { lufs: -14, truePeakDb: -1 } });
        plan = applyStemAudio(plan, [{ layer: music(), label: 'Drums' }]);
        add(`${presetId} ${alpha ? 'alpha' : 'opaque'} ${frameFormat}`, plan.args);
      }
    }
    const withTrack = buildRenderPlan({ manifest: timing({ alpha: true }), presetId, outputPath: '/out/t', track, options: OUTPUT_PRESETS[presetId].animatedImage ? {} : { matte: true } });
    add(`${presetId} with the cut track`, withTrack.args);
  }
  const ducked = music();
  (ducked as SoundAudioLayer).duck = duck;
  add('the mix measured', measureMixArgs([ducked, clipSound], { fps: 30, firstFrame: 0, totalFrames: 60, length: 2 }));
  for (const treatment of VOICE_TREATMENTS) add(`voice ${treatment}`, ['-af', voiceSteps({ treatment, amount: 1 }).join(',')]);

  // An item rendered on its own: every video and sound preset, looped with a crossfade, retimed and recolored.
  const clip: MediaSource = { kind: 'video', input: { path: '/lib/c.webm', decoder: 'libvpx-vp9' }, width: 1920, height: 1080, duration: 2, fps: 30, alpha: true, hasAudio: true, hdr: 'pq' };
  const sound: MediaSource = { kind: 'audio', input: { path: '/lib/s.wav' }, duration: 4, alpha: false, hasAudio: true };
  for (const presetId of PRESET_IDS as PresetId[]) {
    const options = { length: 5, crossfade: 0.5, speed: 1.5, tint: '#ff8800', ...(OUTPUT_PRESETS[presetId].animatedImage ? {} : { matte: true }) };
    const plan = buildMediaRenderPlan({ source: clip, presetId, outputPath: '/out/m', options, scratchDir: '/tmp/s', tonemap: true });
    plan.stages.forEach((s, i) => add(`item ${presetId} stage ${i}`, s.args));
  }
  for (const presetId of AUDIO_PRESET_IDS) {
    const plan = buildMediaRenderPlan({ source: sound, presetId, outputPath: '/out/s', options: { length: 9, crossfade: 1, speed: 0.8 }, scratchDir: '/tmp/s' });
    plan.stages.forEach((s, i) => add(`sound ${presetId} stage ${i}`, s.args));
  }

  // The clean-ups, the strips, the posters, the measures.
  add('key a clip', chromaKeyArgs('/lib/g.mov', { ...KEY_DEFAULTS, lut: '/looks/warm.cube' } as typeof KEY_DEFAULTS, '/out/k.mov'));
  add('key a still', chromaKeyStillArgs('/lib/g.mov', KEY_DEFAULTS, 1));
  add('find scenes', sceneDetectArgs('/lib/long.mov'));
  add('split scenes', sceneSplitArgs('/lib/long.mov', [1, 2], '/out/scene_%03d.mov'));
  add('stabilize, pass one', stabilizeDetectArgs('/lib/shaky.mov', '/tmp/t.trf'));
  for (const edges of ['zoom', 'keep'] as const) add(`stabilize, pass two (${edges})`, stabilizeTransformArgs('/lib/shaky.mov', '/tmp/t.trf', { ...STABILIZE_DEFAULTS, edges }, '/out/s.mov'));
  const filmPlan = filmStripPlan(30, 1920, 1080, 30);
  add('film strip frames', filmFramesArgs('/lib/c.webm', filmPlan, 'libvpx-vp9'));
  add('film strip tiles', filmTileArgs(72, 40, 120));
  add('hover strip', mediaStripArgs('/lib/c.mov', '/tmp/s.png', 4));
  add('hover strip of a sequence', sequenceStripArgs('/lib/f_%04d.png', 1, '/tmp/s.png', 4, 24));
  add('hover strip of frames', framesStripArgs('/tmp/s.png'));
  add('thumbnail of a clip', mediaThumbArgs('/lib/c.mov', '/tmp/t.png', 4, true));
  add('poster of a template', posterThumbArgs('/tmp/p.png', '/tmp/t.png'));
  add('poster probe', probeFrameArgs());
  add('poster from a frame', posterFromFrameArgs('/tmp/t.png', { x: 0, y: 0, width: 10, height: 10 }));
  add('waveform', waveformArgs('/lib/s.wav'));
  add('voice levels', levelArgs('/lib/v.wav'));
  add('tracker frames', trackFramesArgs('/lib/c.mov', 0, 2, { width: 320, height: 180 }));
  add('a camera take', videoTakeArgs({ input: '/tmp/take.webm', output: '/out/take.mp4', rate: { fps: 30, rational: '30' } as never, sound: true, encoder: 'libx264', width: 1280, height: 720 }));
  const files = { intro: '/lib/in.webm', loop: '/lib/loop.webm', outro: '/lib/out.webm' };
  const setTiming = { intro: 1, loop: 2, outro: 1 };
  add('a clip set stitched', clipSetLayersStitchArgs([{ files, timing: setTiming, decoder: 'libvpx-vp9', sound: { intro: true, loop: true, outro: true } }, { files, timing: setTiming }], 8, { fps: 30, width: 1920, height: 1080 }, true));
  add('a clip set as frames', clipSetLayersFramesArgs([{ files, timing: setTiming, decoder: 'libvpx-vp9' }, { files, timing: setTiming }], { fps: 30, width: 1920, height: 1080 }, { first: 0, frames: 30 }, 'scale=640:-2'));

  // The sample media, every recipe of the catalog.
  for (const item of SAMPLE_MEDIA) {
    const r = item.recipe;
    if (r.kind === 'audio') add(`sample ${item.file}`, sampleAudioArgs(r, '/out/x.wav', item.moods ?? []));
    else if (r.kind === 'asset') add(`sample ${item.file}`, sampleAssetArgs(r, '/out/x', { rawInput: { pixelFormat: 'bgra', premultiplied: true }, tagAlphaMode: true }));
  }
  add('a sample photo', sampleJpegArgs('/out/x.jpg'));
  return out;
}

describe('held to the code: what the planners write', () => {
  const names = tableNames();
  const planned = plannedArgs();

  it('reaches enough of the planners to mean something', () => {
    expect(planned.length).toBeGreaterThan(400);
    const all = new Set(planned.flatMap((p) => argsUse(p.args).filters));
    // The library-backed filters are among what was reached, so their features are held here too.
    for (const f of ['zscale', 'tonemap', 'vidstabdetect', 'vidstabtransform', 'palettegen', 'loudnorm', 'minterpolate', 'xfade']) expect(all, f).toContain(f);
  });

  it('writes no filter the table does not name', () => {
    const unnamed = new Map<string, string>();
    for (const { what, args } of planned) for (const f of argsUse(args).filters) if (!names.filters.has(f) && !unnamed.has(f)) unnamed.set(f, what);
    expect([...unnamed].map(([f, what]) => `${f} (first in: ${what})`)).toEqual([]);
  });

  it('writes no codec the table does not name', () => {
    const unnamed = new Map<string, string>();
    for (const { what, args } of planned) for (const c of argsUse(args).codecs) if (!names.codecs.has(c) && !unnamed.has(c)) unnamed.set(c, what);
    expect([...unnamed].map(([c, what]) => `${c} (first in: ${what})`)).toEqual([]);
  });

  it('names only what is used: every filter of the core list is written by a planner, or inline where named', () => {
    const written = new Set(planned.flatMap((p) => argsUse(p.args).filters));
    // Written in the main process's own argument list rather than by a planner the test can call.
    const inline: Record<string, string> = { silencedetect: 'src/main/track-silence.ts' };
    for (const [name, file] of Object.entries(inline)) expect(readFileSync(join(ROOT, file), 'utf8'), file).toContain(`${name}=`);
    const unused = CORE_FILTERS.filter((f) => !written.has(f) && !(f in inline));
    expect(unused).toEqual([]);
  });

  it('names every preset\'s encoder', () => {
    for (const id of PRESET_IDS) expect(names.codecs.has(OUTPUT_PRESETS[id].encoder), id).toBe(true);
  });
});

// ---------------------------------------------------------------- held to the code: what the source names

/** Filters that exist only where a build is configured with a library, as ffmpeg's documentation lists them. */
const LIBRARY_FILTERS = new Set([
  'zscale', 'vidstabdetect', 'vidstabtransform', 'subtitles', 'ass', 'drawtext', 'frei0r', 'frei0r_src', 'ladspa', 'lv2', 'libplacebo', 'rubberband',
  'sofalizer', 'zmq', 'azmq', 'ocr', 'libvmaf', 'lensfun', 'bs2b', 'chromaprint', 'flite', 'arnndn_lib',
]);
/** Encoders and decoders from a library or a platform's hardware: the ones a build may lack. */
const LIBRARY_CODEC = /^(lib(x26[45]|vpx(-vp9)?|aom(-av1)?|dav1d|svtav1|opus|vorbis|mp3lame|webp(_anim)?|fdk_aac|twolame|theora|xvid|kvazaar|openh264|rav1e|jxl|shine|speex|gsm|ilbc|codec2|lc3|zimg|vidstab)|[a-z0-9]+_(videotoolbox|nvenc|qsv|vaapi|amf|mf|v4l2m2m|cuvid|vulkan))$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Every string in a file, as the compiler reads it: comments are not strings, and a template's pieces are. */
function strings(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) out.push(node.head.text, ...node.templateSpans.map((s) => s.literal.text));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('held to the code: what the source names', () => {
  // The table itself, the catalog of builds and the words of the interface are where these names are
  // said rather than used.
  const files = sourceFiles(join(ROOT, 'src')).filter((f) => !/[\\/]src[\\/]locales[\\/]|ffmpeg-needs\.ts$|ffmpeg-download\.ts$/.test(f));
  const names = tableNames();

  it('uses no library-backed filter the table does not name', () => {
    const unnamed: string[] = [];
    for (const file of files) {
      for (const text of strings(file)) {
        // A filter where a graph would have one: before its options, or between the links of a chain.
        for (const m of text.matchAll(/(?:^|[\],;\s'])([a-z][a-z0-9_]*)(?==|,|;|\[|$)/g)) {
          const name = m[1]!;
          if (LIBRARY_FILTERS.has(name) && /=|,|;|\[/.test(text) && !names.filters.has(name)) unnamed.push(`${name} in ${file.slice(ROOT.length + 1)}`);
        }
      }
    }
    expect(unnamed).toEqual([]);
  });

  it('uses no library-backed or hardware codec the table does not name', () => {
    const unnamed: string[] = [];
    for (const file of files) {
      for (const text of strings(file)) {
        for (const m of text.matchAll(/[a-z0-9_-]+/g)) if (LIBRARY_CODEC.test(m[0]) && !names.codecs.has(m[0])) unnamed.push(`${m[0]} in ${file.slice(ROOT.length + 1)}`);
      }
    }
    expect(unnamed).toEqual([]);
  });

  it('would catch one: a string naming a library-backed codec the table does not know', () => {
    expect(LIBRARY_CODEC.test('libsvtav1') && !names.codecs.has('libsvtav1')).toBe(true);
    expect(LIBRARY_FILTERS.has('drawtext') && !names.filters.has('drawtext')).toBe(true);
  });
});

// ---------------------------------------------------------------- the builds Pulp fetches

describe('the builds Pulp fetches', () => {
  it('each carries every feature of its platform, by its publisher\'s configure line', () => {
    for (const build of FFMPEG_BUILDS) {
      const platform = build.id.split('-')[0]!;
      const lacking = needsOn(platform).map((n) => n.id).filter((id) => !build.carries.includes(id));
      expect(lacking, build.id).toEqual([]);
      // And claims nothing its platform does not have.
      for (const id of build.carries) expect(needsOn(platform).map((n) => n.id), `${build.id} ${id}`).toContain(id);
    }
  });
});
