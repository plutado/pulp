import { describe, expect, it } from 'vitest';
import type { ProcessRunner } from '../src/core/ffmpeg';
import { ffprobeArgs, ffprobePathFor, probeMedia } from '../src/core/media-probe';
import { parseFfprobe, resolutionLabel } from '../src/core/media-meta';

// Real ffprobe 8 output for a 2 s VP9+Opus WebM made from testsrc and sine.
const WEBM = `{
    "programs": [

    ],
    "stream_groups": [

    ],
    "streams": [
        { "codec_name": "vp9", "codec_type": "video", "width": 64, "height": 36, "pix_fmt": "yuv420p", "r_frame_rate": "10/1", "avg_frame_rate": "10/1", "tags": { "alpha_mode": "1" } },
        { "codec_name": "opus", "codec_type": "audio", "sample_rate": "48000", "channels": 1, "r_frame_rate": "0/0", "avg_frame_rate": "0/0" }
    ],
    "format": { "duration": "2.008000" }
}`;

describe('parseFfprobe', () => {
  it('reads duration, picture, rate, codecs and alpha', () => {
    expect(parseFfprobe(WEBM)).toEqual({
      duration: 2.008,
      codec: 'vp9',
      width: 64,
      height: 36,
      pixelFormat: 'yuv420p',
      fps: 10,
      alpha: true,
      audioCodec: 'opus',
      channels: 1,
      sampleRate: 48000,
    });
  });

  it('detects alpha from the pixel format and reads NTSC rates', () => {
    const prores = `{"streams":[{"codec_type":"video","codec_name":"prores","width":1920,"height":1080,"pix_fmt":"yuva444p12le","r_frame_rate":"30000/1001","avg_frame_rate":"30000/1001"}],"format":{"duration":"6.0"}}`;
    expect(parseFfprobe(prores)).toMatchObject({ codec: 'prores', alpha: true, fps: 29.97, duration: 6 });
    const h264 = `{"streams":[{"codec_type":"video","codec_name":"h264","width":1080,"height":1920,"pix_fmt":"yuv420p","r_frame_rate":"25/1"}],"format":{"duration":"1.0"}}`;
    expect(parseFfprobe(h264)).toMatchObject({ alpha: false, fps: 25, width: 1080, height: 1920 });
  });

  it('handles images and audio-only files', () => {
    const png = `{"streams":[{"codec_type":"video","codec_name":"png","width":2,"height":2,"pix_fmt":"rgba","r_frame_rate":"25/1","avg_frame_rate":"0/0"}],"format":{}}`;
    expect(parseFfprobe(png)).toEqual({ codec: 'png', width: 2, height: 2, pixelFormat: 'rgba', fps: 25, alpha: true });
    const wav = `{"streams":[{"codec_type":"audio","codec_name":"pcm_u8","sample_rate":"8000","channels":1}],"format":{"duration":"1.000000"}}`;
    expect(parseFfprobe(wav)).toEqual({ duration: 1, audioCodec: 'pcm_u8', channels: 1, sampleRate: 8000 });
  });

  it('returns null for non-ffprobe output', () => {
    expect(parseFfprobe('')).toBeNull();
    expect(parseFfprobe('not json')).toBeNull();
    expect(parseFfprobe('42')).toBeNull();
    expect(parseFfprobe('{}')).toBeNull();
  });
});

describe('probeMedia and helpers', () => {
  it('runs ffprobe with json output and parses it; failures give null', async () => {
    const calls: string[][] = [];
    const run: ProcessRunner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: WEBM, stderr: '' };
    };
    expect((await probeMedia('/bin/ffprobe', '/lib/a.webm', run))?.codec).toBe('vp9');
    expect(calls[0]?.[0]).toBe('/bin/ffprobe');
    expect(calls[0]?.at(-1)).toBe('/lib/a.webm');
    expect(ffprobeArgs('x')).toContain('json');
    const failing: ProcessRunner = async () => ({ code: 1, stdout: '', stderr: 'Invalid data' });
    expect(await probeMedia('ffprobe', '/lib/bad.mov', failing)).toBeNull();
    const missing: ProcessRunner = async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    expect(await probeMedia('ffprobe', '/lib/a.mov', missing)).toBeNull();
  });

  it('finds ffprobe next to ffmpeg, or on PATH', () => {
    expect(ffprobePathFor('ffmpeg')).toBe('ffprobe');
    expect(ffprobePathFor('/opt/homebrew/bin/ffmpeg')).toBe('/opt/homebrew/bin/ffprobe');
    if (process.platform === 'win32') expect(ffprobePathFor('C:\\\\tools\\\\ffmpeg.exe')).toMatch(/ffprobe\\.exe$/);
  });

  it('labels resolution by the shorter side', () => {
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(1080, 1920)).toBe('1080p');
    expect(resolutionLabel(3840, 2160)).toBe('2160p');
    expect(resolutionLabel(undefined, 1080)).toBeUndefined();
  });
});
