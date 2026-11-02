/**
 * The FFmpeg download helper's catalogue (milestone 17, decision record 0022):
 * which build Pulp offers to fetch for this machine, from whom, how big it is,
 * what it hashes to and where it is kept.
 *
 * **Pulp ships no FFmpeg.** Renders need one, and the first answer is still
 * "use your own" — one on your PATH, or `PULP_FFMPEG_PATH` pointing at it. The
 * helper is for the person who has none and no wish to go and get one: it
 * fetches a full build from its publisher, *after asking*, checks it against
 * the checksum below, and keeps it beside the settings. That is the pattern
 * ADR 0021 set for the speech model, for the same reason — a fetch is only
 * acceptable when what arrives is pinned to the byte.
 *
 * **The builds are GPL**, because a useful one has to be: an LGPL-only FFmpeg
 * has no x264, so every H.264 render would fall back on whatever hardware
 * encoder the machine happens to have. That is why the fetch is a fetch and
 * not an installer's payload — Pulp is MIT and distributes nothing of FFmpeg;
 * what is fetched is fetched by the person who asked for it, from its own
 * publisher, and run as a separate program. ADR 0022 has the reasoning.
 *
 * Pure: the catalogue and the names are here and tested; the fetching, the
 * unpacking and the checking are src/main/ffmpeg-service.ts.
 */

/**
 * One archive to fetch, and the one file to take out of it. `bytes` and
 * `sha256` are the published archive's own, read from the publisher's
 * checksum file when the entry was written: anything else is thrown away
 * rather than kept, so a mirror, a proxy or a transfer that stopped half way
 * cannot leave something runnable on disk.
 */
export interface FfmpegArchive {
  /** Which program this archive yields: the encoder, or the prober Pulp reads media with. */
  binary: 'ffmpeg' | 'ffprobe';
  url: string;
  bytes: number;
  sha256: string;
  /** The entry inside the zip to unpack. Nothing else in the archive is read. */
  member: string;
}

/** A build Pulp can fetch for one platform and architecture. */
export interface FfmpegBuild {
  /** `${platform}-${arch}` as Node names them, which is how one is chosen. */
  id: string;
  /** The machine it is for, as a person would say it. */
  label: string;
  version: string;
  /** Who built it, named before anything is fetched. */
  publisher: string;
  publisherUrl: string;
  /** The licence of what arrives — not of Pulp, which ships none of it. */
  license: string;
  archives: readonly FfmpegArchive[];
}

/**
 * Where the builds come from (ADR 0022). Two publishers, both of them listed
 * on ffmpeg.org's own download page:
 *
 * - **Martin Riedl's build server** for macOS and Linux: static builds, one
 *   zip per program, every one with a published SHA-256 beside it, and the
 *   macOS binaries signed with a Developer ID — so a fetched ffmpeg is not
 *   itself something Gatekeeper has to be argued with.
 * - **Gyan Doshi's builds** for Windows: the release "essentials" build, which
 *   carries x264, VP9 and LAME — everything Pulp's presets name — in a third
 *   less download than a full build.
 *
 * Every URL here is a versioned one that keeps its bytes; the rolling
 * "latest" names the same publishers offer would break the checksum the
 * first time they rebuilt.
 */
const MARTIN_RIEDL = {
  publisher: 'Martin Riedl\'s FFmpeg build server',
  publisherUrl: 'https://ffmpeg.martin-riedl.de/',
} as const;

const GYAN = {
  publisher: 'Gyan Doshi\'s FFmpeg builds for Windows',
  publisherUrl: 'https://www.gyan.dev/ffmpeg/builds/',
} as const;

/** What arrives is GPL, in all five builds: they are configured with x264, which is GPL. */
export const FFMPEG_DOWNLOAD_LICENSE = 'GPL-3.0-or-later';

export const FFMPEG_BUILDS: readonly FfmpegBuild[] = [
  {
    id: 'darwin-arm64',
    label: 'macOS (Apple Silicon)',
    version: '9.0.2',
    ...MARTIN_RIEDL,
    license: FFMPEG_DOWNLOAD_LICENSE,
    archives: [
      {
        binary: 'ffmpeg',
        url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip',
        bytes: 28_395_699,
        sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
        member: 'ffmpeg',
      },
      {
        binary: 'ffprobe',
        url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffprobe.zip',
        bytes: 28_317_701,
        sha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6',
        member: 'ffprobe',
      },
    ],
  },
  {
    id: 'darwin-x64',
    label: 'macOS (Intel)',
    version: '9.0.2',
    ...MARTIN_RIEDL,
    license: FFMPEG_DOWNLOAD_LICENSE,
    archives: [
      {
        binary: 'ffmpeg',
        url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip',
        bytes: 33_816_391,
        sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
        member: 'ffmpeg',
      },
      {
        binary: 'ffprobe',
        url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffprobe.zip',
        bytes: 33_719_233,
        sha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd',
        member: 'ffprobe',
      },
    ],
  },
  {
    id: 'win32-x64',
    label: 'Windows (64-bit)',
    version: '9.0.2',
    ...GYAN,
    license: FFMPEG_DOWNLOAD_LICENSE,
    archives: [
      {
        binary: 'ffmpeg',
        url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',
        bytes: 114_768_076,
        sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
        member: 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe',
      },
      // One archive, both programs: the second entry names the same download, which is
      // fetched once (src/main/ffmpeg-service.ts) and unpacked twice.
      {
        binary: 'ffprobe',
        url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',
        bytes: 114_768_076,
        sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
        member: 'ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe',
      },
    ],
  },
  {
    id: 'linux-x64',
    label: 'Linux (64-bit)',
    version: '9.0.2',
    ...MARTIN_RIEDL,
    license: FFMPEG_DOWNLOAD_LICENSE,
    archives: [
      {
        binary: 'ffmpeg',
        url: 'https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffmpeg.zip',
        bytes: 33_326_445,
        sha256: 'fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f',
        member: 'ffmpeg',
      },
      {
        binary: 'ffprobe',
        url: 'https://ffmpeg.martin-riedl.de/download/linux/amd64/1789931100_9.0.2/ffprobe.zip',
        bytes: 33_223_234,
        sha256: '3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32',
        member: 'ffprobe',
      },
    ],
  },
  {
    id: 'linux-arm64',
    label: 'Linux (ARM64)',
    version: '9.0.2',
    ...MARTIN_RIEDL,
    license: FFMPEG_DOWNLOAD_LICENSE,
    archives: [
      {
        binary: 'ffmpeg',
        url: 'https://ffmpeg.martin-riedl.de/download/linux/arm64/1789931697_9.0.2/ffmpeg.zip',
        bytes: 28_753_826,
        sha256: '93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b',
        member: 'ffmpeg',
      },
      {
        binary: 'ffprobe',
        url: 'https://ffmpeg.martin-riedl.de/download/linux/arm64/1789931697_9.0.2/ffprobe.zip',
        bytes: 28_655_683,
        sha256: 'bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330',
        member: 'ffprobe',
      },
    ],
  },
] as const;

/**
 * The build for this machine, or none. A packaged Pulp is x64 on Windows and
 * universal on macOS, so `process.arch` is what decides: an Intel Mac and an
 * Apple Silicon one run the same app and want different binaries.
 */
export function ffmpegBuildFor(platform: string, arch: string): FfmpegBuild | null {
  return FFMPEG_BUILDS.find((build) => build.id === `${platform}-${arch}`) ?? null;
}

/** What the fetch costs over the wire: each archive once, however many programs it yields. */
export function downloadBytes(build: FfmpegBuild): number {
  const seen = new Map<string, number>();
  for (const archive of build.archives) seen.set(archive.url, archive.bytes);
  return [...seen.values()].reduce((total, bytes) => total + bytes, 0);
}

/** A download's size as the dialog says it: whole megabytes, the only precision anyone reads. */
export function downloadSizeText(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** The folder a fetched build is kept in, beside the settings and the speech models. */
export const FFMPEG_DIR_NAME = 'ffmpeg';

/** What the two programs are called on this platform. */
export function ffmpegBinaryName(binary: 'ffmpeg' | 'ffprobe', platform: string): string {
  return platform === 'win32' ? `${binary}.exe` : binary;
}

/**
 * The sentence shown before anything is fetched, and in the acknowledgements:
 * what arrives, under what licence, and that it is a program beside Pulp
 * rather than a part of it.
 */
export function ffmpegDownloadNote(build: FfmpegBuild): string {
  return (
    `FFmpeg ${build.version} for ${build.label}, ${downloadSizeText(downloadBytes(build))}, ` +
    `from ${build.publisher} — ${build.license}. ` +
    'It is checked against a published checksum as it arrives, kept beside your settings, and run as a separate program; ' +
    'Pulp itself stays MIT and ships no part of it.'
  );
}
