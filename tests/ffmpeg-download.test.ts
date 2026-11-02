/**
 * The FFmpeg download helper's catalogue (milestone 17, ADR 0022).
 *
 * What a fetch is allowed to leave on disk is decided by the data in
 * `src/core/ffmpeg-download.ts`: a pinned URL, the byte count and the SHA-256
 * the publisher published, and the one entry to take out of the archive. An
 * entry that is wrong in any of those ways cannot be caught by running the
 * app — the fetch would simply refuse, or worse, keep something unexpected —
 * so the shape of every entry is held here, with the unpacking itself proved
 * against a zip built in the test.
 */

import { describe, expect, it } from 'vitest';
import {
  downloadBytes, downloadSizeText, FFMPEG_BUILDS, FFMPEG_DOWNLOAD_LICENSE, ffmpegBinaryName,
  ffmpegBuildFor, ffmpegDownloadNote,
} from '../src/core/ffmpeg-download';
import { candidatePaths, setManagedFfmpeg } from '../src/core/ffmpeg';
import { readZip, writeZip } from '../src/core/zip';

describe('which FFmpeg Pulp offers to fetch', () => {
  it('has a build for every machine a Pulp build runs on', () => {
    // The packaged app is universal on macOS and x64 on Windows and Linux; the two Linux
    // architectures are there for anyone running a build of their own.
    const ids = FFMPEG_BUILDS.map((b) => b.id).sort();
    expect(ids).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);
    expect(ffmpegBuildFor('darwin', 'arm64')?.label).toBe('macOS (Apple Silicon)');
    expect(ffmpegBuildFor('win32', 'x64')?.label).toBe('Windows (64-bit)');
    // Nothing pinned for this one, and that is an answer rather than a guess at a near match.
    expect(ffmpegBuildFor('freebsd', 'x64')).toBeNull();
    expect(ffmpegBuildFor('win32', 'ia32')).toBeNull();
  });

  it('pins every download to its bytes, so what arrives is what was chosen', () => {
    for (const build of FFMPEG_BUILDS) {
      expect(build.archives.length, build.id).toBeGreaterThanOrEqual(2);
      // Both programs: Pulp encodes with one and reads media with the other, and
      // `ffprobePathFor` expects to find the prober beside the encoder.
      expect(build.archives.map((a) => a.binary).sort()).toEqual(['ffmpeg', 'ffprobe']);
      for (const archive of build.archives) {
        expect(archive.url, build.id).toMatch(/^https:\/\//);
        // A versioned URL: the rolling "latest" names these publishers also offer would
        // break the checksum the first time they rebuilt.
        expect(archive.url, `${build.id} is pinned to a version`).toContain(build.version);
        expect(archive.sha256, archive.url).toMatch(/^[0-9a-f]{64}$/);
        expect(archive.bytes, archive.url).toBeGreaterThan(1_000_000);
        expect(archive.member.length, archive.url).toBeGreaterThan(0);
        // The member is a path inside the archive, never one that could escape it.
        expect(archive.member, archive.url).not.toMatch(/^[/\\]|\.\.|^[a-zA-Z]:/);
      }
    }
  });

  it('says what arrives is GPL, every time, because a useful build has to be', () => {
    // An LGPL-only ffmpeg has no x264, so every H.264 render would fall back on whatever
    // hardware encoder the machine has. That is the whole reason this is a fetch rather
    // than something in the installers (ADR 0022).
    for (const build of FFMPEG_BUILDS) {
      expect(build.license, build.id).toBe(FFMPEG_DOWNLOAD_LICENSE);
      expect(FFMPEG_DOWNLOAD_LICENSE).toMatch(/^GPL/);
      expect(build.publisher.length, build.id).toBeGreaterThan(0);
      expect(build.publisherUrl, build.id).toMatch(/^https:\/\//);
    }
  });

  it('counts a download once however many programs it yields', () => {
    // Windows is one archive holding both; macOS and Linux are one archive each.
    const windows = ffmpegBuildFor('win32', 'x64')!;
    expect(new Set(windows.archives.map((a) => a.url)).size).toBe(1);
    expect(downloadBytes(windows)).toBe(windows.archives[0]!.bytes);
    const mac = ffmpegBuildFor('darwin', 'arm64')!;
    expect(downloadBytes(mac)).toBe(mac.archives[0]!.bytes + mac.archives[1]!.bytes);
  });

  it('says what it would fetch before anything is fetched', () => {
    const note = ffmpegDownloadNote(ffmpegBuildFor('darwin', 'arm64')!);
    for (const said of ['9.0.2', 'macOS (Apple Silicon)', 'MB', 'Martin Riedl', 'GPL', 'checksum']) {
      expect(note, said).toContain(said);
    }
    expect(downloadSizeText(114_768_076)).toBe('115 MB');
  });

  it('names the programs as each platform does', () => {
    expect(ffmpegBinaryName('ffmpeg', 'win32')).toBe('ffmpeg.exe');
    expect(ffmpegBinaryName('ffprobe', 'win32')).toBe('ffprobe.exe');
    expect(ffmpegBinaryName('ffprobe', 'darwin')).toBe('ffprobe');
  });
});

describe('where a fetched build sits among the rest', () => {
  it('comes last: an ffmpeg of your own still wins', () => {
    const managed = '/home/me/.config/Pulp/ffmpeg/ffmpeg';
    expect(candidatePaths({}, managed)).toEqual([
      'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', managed,
    ]);
    // And PULP_FFMPEG_PATH still comes first, as the documentation says it does.
    expect(candidatePaths({ PULP_FFMPEG_PATH: '/opt/ff/ffmpeg' }, managed)[0]).toBe('/opt/ff/ffmpeg');
    expect(candidatePaths({}, null)).not.toContain(managed);
  });

  it('is registered by the main process rather than guessed at here', () => {
    setManagedFfmpeg('/tmp/pulp/ffmpeg/ffmpeg');
    expect(candidatePaths({})).toContain('/tmp/pulp/ffmpeg/ffmpeg');
    setManagedFfmpeg(null);
    expect(candidatePaths({})).not.toContain('/tmp/pulp/ffmpeg/ffmpeg');
  });
});

describe('taking the programs out of an archive', () => {
  // The Windows build is a 115 MB zip holding ffmpeg.exe, ffprobe.exe, ffplay.exe and a
  // folder of documentation — a third of a gigabyte unpacked. Only the two named entries
  // are inflated, which is what `wanted` is for.
  const archive = writeZip([
    { name: 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe', data: Buffer.from('the encoder') },
    { name: 'ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe', data: Buffer.from('the prober') },
    { name: 'ffmpeg-9.0.2-essentials_build/bin/ffplay.exe', data: Buffer.alloc(4096, 7) },
    { name: 'ffmpeg-9.0.2-essentials_build/doc/ffmpeg-all.html', data: Buffer.alloc(8192, 3) },
  ]);

  it('reads the one entry asked for and leaves the rest packed', () => {
    const wanted = 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe';
    const entries = readZip(archive, { wanted: (name) => name === wanted });
    expect(entries.map((e) => e.name)).toEqual([wanted]);
    expect(entries[0]!.data.toString()).toBe('the encoder');
  });

  it('does not count what it skips against the size bound', () => {
    const wanted = 'ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe';
    // A bound smaller than the archive unpacked, but larger than the entry taken out of it.
    const entries = readZip(archive, { maxBytes: 64, wanted: (name) => name === wanted });
    expect(entries[0]!.data.toString()).toBe('the prober');
    expect(() => readZip(archive, { maxBytes: 64 })).toThrow(/exceeds/);
  });

  it('answers with nothing when the archive is not the one expected', () => {
    // Which is how the service says "this is not the build Pulp expects" rather than
    // writing an empty file and calling it ffmpeg.
    expect(readZip(archive, { wanted: (name) => name === 'bin/ffmpeg' })).toEqual([]);
  });
});
