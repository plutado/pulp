/**
 * Recording from a camera (milestone 64), the parts with no camera in them:
 * the recorder's format, the camera's rate as a steady one, the mirror rule,
 * which encoder converts, the command that converts, what is remembered, and
 * the staged file a take is written into a piece at a time — then a real
 * conversion, where FFmpeg is installed, of a variable-rate WebM like the
 * window's recorder writes into the MP4 the library keeps.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectFfmpeg, nodeRunner } from '../src/core/ffmpeg';
import { ffprobePathFor } from '../src/core/media-probe';
import {
  cameraFrameRate, DEFAULT_VIDEO_INPUTS, h264EncodersFor, mirrorsPreview, pickTakeMimeType, sanitizeVideoInputs, TakeFile,
  takeBitrate, takeMimeTypes, videoTakeArgs,
} from '../src/core/video-take';

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});
const scratch = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pulp-take-'));
  dirs.push(dir);
  return dir;
};

describe("the recorder's format", () => {
  it('asks for WebM, VP8 first, with Opus only when the take has sound', () => {
    expect(takeMimeTypes(true)[0]).toBe('video/webm;codecs=vp8,opus');
    expect(takeMimeTypes(false).every((t) => !t.includes('opus')), 'no sound, no audio codec').toBe(true);
    expect(pickTakeMimeType(true, (t) => t === 'video/webm;codecs=vp9,opus')).toBe('video/webm;codecs=vp9,opus');
    expect(pickTakeMimeType(false, (t) => t === 'video/webm')).toBe('video/webm');
    expect(pickTakeMimeType(true, () => false), 'a recorder that writes none of them').toBeNull();
  });
});

describe("the camera's frame rate, as the steady rate the file is written at", () => {
  it('takes a standard rate exactly when the camera reports a hair off it, the NTSC rates as fractions', () => {
    expect(cameraFrameRate(30.000030)).toEqual({ fps: 30, ffmpeg: '30' });
    expect(cameraFrameRate(29.97)).toEqual({ fps: 30000 / 1001, ffmpeg: '30000/1001' });
    expect(cameraFrameRate(29.98), 'nearest first: 29.97 and 30 are only 0.1% apart').toMatchObject({ ffmpeg: '30000/1001' });
    expect(cameraFrameRate(23.976)).toMatchObject({ ffmpeg: '24000/1001' });
    expect(cameraFrameRate(59.94)).toMatchObject({ ffmpeg: '60000/1001' });
    expect(cameraFrameRate(25.1)).toEqual({ fps: 25, ffmpeg: '25' });
  });

  it("keeps a webcam's own whole-number rate, and is 30 when nothing sensible is reported", () => {
    expect(cameraFrameRate(15)).toEqual({ fps: 15, ffmpeg: '15' });
    expect(cameraFrameRate(20.2)).toEqual({ fps: 20, ffmpeg: '20' });
    for (const reported of [undefined, Number.NaN, 0, -5, 0.5, 1000]) expect(cameraFrameRate(reported), String(reported)).toEqual({ fps: 30, ffmpeg: '30' });
  });
});

describe('the preview, mirrored as a mirror shows a face', () => {
  it("mirrors a camera facing the person, or one that does not say — a computer's camera faces whoever is at it — and not one facing away", () => {
    expect(mirrorsPreview('user')).toBe(true);
    expect(mirrorsPreview(undefined)).toBe(true);
    expect(mirrorsPreview('environment')).toBe(false);
  });
});

describe('the bitrate', () => {
  it('scales with the picture and is clamped at both ends', () => {
    expect(takeBitrate(1920, 1080, 30, 0.12)).toBe(Math.round(1920 * 1080 * 30 * 0.12));
    expect(takeBitrate(320, 240, 15, 0.12), 'a tiny camera still looks clean').toBe(2_500_000);
    expect(takeBitrate(7680, 4320, 60, 0.2), 'and 8K does not make a file nobody can move').toBe(40_000_000);
  });
});

describe('the encoder that converts', () => {
  it("tries libx264 first, then the platforms' own, only those this FFmpeg lists", () => {
    expect(h264EncodersFor(['h264_videotoolbox', 'libx264', 'libvpx'])).toEqual(['libx264', 'h264_videotoolbox']);
    expect(h264EncodersFor(['h264_mf', 'h264_nvenc', 'aac'])).toEqual(['h264_mf', 'h264_nvenc']);
    expect(h264EncodersFor(['libvpx', 'aac']), 'none: the WebM is kept').toEqual([]);
  });
});

describe('the conversion command', () => {
  const base = { input: 'in.webm', output: 'out.mp4', rate: cameraFrameRate(29.97), sound: true, width: 1280, height: 720 };

  it('writes H.264 at a constant rate at the camera size, 4:2:0, AAC at 48 kHz, the index at the front', () => {
    const args = videoTakeArgs({ ...base, encoder: 'libx264' });
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after('-i')).toBe('in.webm');
    expect(after('-vf'), 'the steady rate, an odd side cropped by a pixel rather than scaled').toBe('fps=30000/1001,crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p');
    expect(after('-c:v')).toBe('libx264');
    expect(after('-crf')).toBe('18');
    expect(after('-c:a')).toBe('aac');
    expect(after('-ar')).toBe('48000');
    expect(after('-movflags')).toBe('+faststart');
    expect(args.at(-1)).toBe('out.mp4');
    expect(args).not.toContain('scale');
    // The sound is optional in the mapping: a take whose microphone gave nothing still converts.
    expect(args.join(' ')).toContain('-map 0:v:0 -map 0:a:0?');
  });

  it('has no audio stream at all without sound', () => {
    const args = videoTakeArgs({ ...base, sound: false, encoder: 'libx264' });
    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
    expect(args.join(' ')).not.toContain('0:a');
  });

  it('gives a hardware encoder a bitrate, and VideoToolbox its software path for a machine without the hardware', () => {
    const vt = videoTakeArgs({ ...base, encoder: 'h264_videotoolbox' });
    expect(vt[vt.indexOf('-b:v') + 1]).toBe(String(takeBitrate(1280, 720, 30000 / 1001, 0.12)));
    expect(vt.join(' ')).toContain('-allow_sw 1');
    const mf = videoTakeArgs({ ...base, encoder: 'h264_mf' });
    expect(mf).toContain('-b:v');
    expect(mf).not.toContain('-allow_sw');
    expect(mf).not.toContain('-crf');
  });
});

describe('what the preview remembers', () => {
  it('keeps a well-formed camera, microphone and sound switch, and makes anything else the default', () => {
    const chosen = { camera: { id: 'cam-1', label: 'FaceTime HD Camera' }, microphone: { id: 'mic-2', label: 'USB Mic' }, sound: false };
    expect(sanitizeVideoInputs(chosen)).toEqual(chosen);
    expect(sanitizeVideoInputs(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen);
    expect(sanitizeVideoInputs(undefined)).toEqual(DEFAULT_VIDEO_INPUTS);
    expect(sanitizeVideoInputs('camera')).toEqual(DEFAULT_VIDEO_INPUTS);
    expect(sanitizeVideoInputs({ camera: { id: 4 }, microphone: { id: '', label: 'x' } }), 'malformed devices are the defaults, sound on').toEqual(DEFAULT_VIDEO_INPUTS);
    expect(DEFAULT_VIDEO_INPUTS.sound).toBe(true);
  });
});

describe('a take written a piece at a time', () => {
  it('appends every piece in the order given, whatever order the writes finish in, and says its size', async () => {
    const dir = await scratch();
    const file = await TakeFile.open(join(dir, 'staging', 'take.webm'));
    const pieces = Array.from({ length: 40 }, (_, i) => new Uint8Array(1000 + i * 37).fill(i));
    // Not awaited one by one: the recorder hands pieces over as they come.
    await Promise.all(pieces.map((p) => file.append(p)));
    const size = await file.close();
    const expected = pieces.reduce((n, p) => n + p.length, 0);
    expect(size).toBe(expected);
    expect(file.bytes).toBe(expected);
    const back = new Uint8Array(await readFile(file.path));
    let at = 0;
    for (const [i, p] of pieces.entries()) {
      expect(back[at], `piece ${i} where it belongs`).toBe(i);
      expect(back[at + p.length - 1]).toBe(i);
      at += p.length;
    }
  });

  it('leaves nothing behind when discarded', async () => {
    const dir = await scratch();
    const file = await TakeFile.open(join(dir, 'take.webm'));
    await file.append(new Uint8Array(100));
    await file.discard();
    expect(existsSync(file.path)).toBe(false);
  });
});

// The conversion itself, where FFmpeg can make a WebM like the recorder's and convert it.
const ffmpeg = await detectFfmpeg();
const canMakeWebm = ffmpeg.ok && ffmpeg.encoders.includes('libvpx') && ffmpeg.encoders.includes('libopus');
const encoders = ffmpeg.ok ? h264EncodersFor(ffmpeg.encoders) : [];

describe.skipIf(!canMakeWebm || encoders.length === 0)("converting a recorder's WebM into the take the library keeps", () => {
  /** ffprobe's view of a file: its streams and its length. */
  const probe = async (file: string) => {
    if (!ffmpeg.ok) throw new Error('no ffmpeg');
    const result = await nodeRunner(ffprobePathFor(ffmpeg.path), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
    return JSON.parse(result.stdout) as {
      streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; pix_fmt?: string; sample_rate?: string; nb_frames?: string }[];
      format: { duration: string };
    };
  };

  /**
   * Two seconds as a camera's recorder writes them: VP8 and Opus in WebM, an odd width, and the
   * frames at uneven times — one in five missing, as a busy camera drops them.
   */
  const recorderWebm = async (dir: string, sound: boolean) => {
    if (!ffmpeg.ok) throw new Error('no ffmpeg');
    const out = join(dir, sound ? 'take.webm' : 'silent.webm');
    const result = await nodeRunner(ffmpeg.path, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=321x240:rate=30:duration=2',
      ...(sound ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2'] : []),
      '-vf', "select='not(eq(mod(n\\,5)\\,2))'", '-fps_mode', 'vfr',
      '-c:v', 'libvpx', '-b:v', '1M',
      ...(sound ? ['-c:a', 'libopus'] : []),
      out,
    ]);
    expect(result.code, result.stderr).toBe(0);
    return out;
  };

  it('writes H.264 and AAC at the steady rate, at the camera size less the odd pixel, for the length recorded', async () => {
    if (!ffmpeg.ok) return;
    const dir = await scratch();
    const input = await recorderWebm(dir, true);
    const output = join(dir, 'Recording.mp4');
    const rate = cameraFrameRate(30);
    const result = await nodeRunner(ffmpeg.path, videoTakeArgs({ input, output, rate, sound: true, encoder: encoders[0]!, width: 321, height: 240 }));
    expect(result.code, result.stderr).toBe(0);
    expect((await stat(output)).size).toBeGreaterThan(0);
    const info = await probe(output);
    const video = info.streams.find((s) => s.codec_type === 'video')!;
    const audio = info.streams.find((s) => s.codec_type === 'audio')!;
    expect(video.codec_name).toBe('h264');
    expect(video.pix_fmt).toBe('yuv420p');
    expect([video.width, video.height], 'the odd side loses its last pixel, nothing is scaled').toEqual([320, 240]);
    // A constant rate: what it is said to run at and what it averages are the same, the camera's own.
    expect(video.r_frame_rate).toBe('30/1');
    expect(video.avg_frame_rate).toBe('30/1');
    expect(Number(video.nb_frames), 'the dropped frames filled in: two seconds at 30').toBeGreaterThanOrEqual(58);
    expect(Number(video.nb_frames)).toBeLessThanOrEqual(62);
    expect(audio.codec_name).toBe('aac');
    expect(audio.sample_rate).toBe('48000');
    expect(Number(info.format.duration)).toBeGreaterThan(1.9);
    expect(Number(info.format.duration)).toBeLessThan(2.2);
  });

  it('writes a take recorded without sound with no audio stream at all', async () => {
    if (!ffmpeg.ok) return;
    const dir = await scratch();
    const input = await recorderWebm(dir, false);
    const output = join(dir, 'Silent.mp4');
    const result = await nodeRunner(ffmpeg.path, videoTakeArgs({ input, output, rate: cameraFrameRate(30), sound: false, encoder: encoders[0]!, width: 321, height: 240 }));
    expect(result.code, result.stderr).toBe(0);
    const info = await probe(output);
    expect(info.streams.map((s) => s.codec_type)).toEqual(['video']);
  });

  it('still converts a take with sound on whose microphone gave nothing: the sound is optional in the mapping', async () => {
    if (!ffmpeg.ok) return;
    const dir = await scratch();
    const input = await recorderWebm(dir, false);
    const output = join(dir, 'Mapped.mp4');
    const result = await nodeRunner(ffmpeg.path, videoTakeArgs({ input, output, rate: cameraFrameRate(30), sound: true, encoder: encoders[0]!, width: 321, height: 240 }));
    expect(result.code, result.stderr).toBe(0);
    expect((await probe(output)).streams.map((s) => s.codec_type)).toEqual(['video']);
  });
});
