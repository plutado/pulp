import { describe, expect, it } from 'vitest';
import {
  candidatePaths,
  checkPresetSupport,
  detectFfmpeg,
  FFMPEG_MISSING_MESSAGE,
  parseEncoders,
  parseFfmpegVersion,
  type ProcessRunner,
} from '../src/core/ffmpeg';
import { OUTPUT_PRESETS } from '../src/core/render-plan';

const ENCODERS_OUTPUT = `Encoders:
 V..... = Video
 A..... = Audio
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 VF...D png                  PNG (Portable Network Graphics) image
 VFS... prores_ks            Apple ProRes (codec prores)
 A....D aac                  AAC (Advanced Audio Coding)
`;

/** Fake runner: only `found` exists; everything else behaves like ENOENT. */
function fakeRunner(found: string, encoders = ENCODERS_OUTPUT): ProcessRunner & { calls: string[] } {
  const calls: string[] = [];
  const run = (async (command: string, args: string[]) => {
    calls.push(command);
    if (command !== found) throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    if (args.includes('-encoders')) return { code: 0, stdout: encoders, stderr: '' };
    return { code: 0, stdout: 'ffmpeg version 7.1.1 Copyright (c) 2000-2025\n', stderr: '' };
  }) as ProcessRunner & { calls: string[] };
  run.calls = calls;
  return run;
}

describe('parsers', () => {
  it('parseFfmpegVersion', () => {
    expect(parseFfmpegVersion('ffmpeg version 8.0 Copyright')).toBe('8.0');
    expect(parseFfmpegVersion('ffmpeg version n7.1-3-gabc Copyright')).toBe('n7.1-3-gabc');
    expect(parseFfmpegVersion('something else')).toBeNull();
  });

  it('parseEncoders reads names after the separator line', () => {
    expect(parseEncoders(ENCODERS_OUTPUT)).toEqual(['libx264', 'png', 'prores_ks', 'aac']);
  });
});

describe('detectFfmpeg', () => {
  it('prefers PULP_FFMPEG_PATH', async () => {
    const run = fakeRunner('/custom/ffmpeg');
    const status = await detectFfmpeg(run, { PULP_FFMPEG_PATH: '/custom/ffmpeg' });
    expect(status).toEqual({ ok: true, path: '/custom/ffmpeg', version: '7.1.1', encoders: ['libx264', 'png', 'prores_ks', 'aac'] });
    expect(run.calls[0]).toBe('/custom/ffmpeg');
  });

  it('falls back to PATH and then Homebrew locations', async () => {
    const status = await detectFfmpeg(fakeRunner('/usr/local/bin/ffmpeg'), {});
    expect(status.ok && status.path).toBe('/usr/local/bin/ffmpeg');
  });

  it('returns a clear, actionable error when ffmpeg is missing', async () => {
    const status = await detectFfmpeg(fakeRunner('nowhere'), {});
    expect(status).toEqual({ ok: false, message: FFMPEG_MISSING_MESSAGE });
    expect(FFMPEG_MISSING_MESSAGE).toMatch(/brew install ffmpeg/);
    expect(FFMPEG_MISSING_MESSAGE).toMatch(/PULP_FFMPEG_PATH/);
  });

  it('skips candidates that exit non-zero', async () => {
    const run: ProcessRunner = async (command) =>
      command === 'ffmpeg' ? { code: 1, stdout: '', stderr: 'broken' } : Promise.reject(new Error('ENOENT'));
    expect((await detectFfmpeg(run, {})).ok).toBe(false);
  });

  it('candidatePaths has no duplicates', () => {
    expect(candidatePaths({ PULP_FFMPEG_PATH: 'ffmpeg' })).toEqual(['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
  });
});

describe('checkPresetSupport', () => {
  it('flags presets whose encoder is missing', async () => {
    const status = await detectFfmpeg(fakeRunner('ffmpeg'), {});
    expect(checkPresetSupport(status, OUTPUT_PRESETS['prores-4444'])).toBeNull();
    expect(checkPresetSupport(status, OUTPUT_PRESETS['webm-vp9-alpha'])).toMatch(/libvpx-vp9/);
  });

  it('passes through the missing-ffmpeg message', () => {
    expect(checkPresetSupport({ ok: false, message: 'nope' }, OUTPUT_PRESETS['h264-mp4'])).toBe('nope');
  });
});
