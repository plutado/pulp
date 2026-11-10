/**
 * Recording from a camera (milestone 64), the parts with no camera in them:
 * which format the window's recorder writes, the camera's frame rate as a
 * steady one, whether the preview is mirrored, and how the bundled FFmpeg
 * turns the recorder's file into one the editors open. The naming and the
 * folder are the voice recorder's (src/core/recording.ts).
 *
 * The browser records WebM — VP8 or VP9 with Opus, the one container
 * Chromium's MediaRecorder writes on every platform — at a variable frame
 * rate, each frame stamped when it arrived. Premiere Pro and Final Cut do not
 * open WebM, and an editor handed a variable-rate clip drifts its sound or
 * conforms it badly, so the take is converted: H.264 and AAC in an MP4, at
 * the camera's own size and a constant frame rate.
 */

import { createWriteStream, type WriteStream } from 'node:fs';
import { needFor } from './ffmpeg-needs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A device chosen in a menu: the browser's id for it, and the name shown for it. */
export interface RecordingDevice {
  id: string;
  label: string;
}

/**
 * What the camera's preview remembers: the camera and the microphone chosen in its menus — null
 * for the system's default — and whether the take has sound at all. Its own, not the voice
 * recorder's input: choosing No sound for a video says nothing about recording a voice.
 */
export interface VideoInputs {
  camera: RecordingDevice | null;
  microphone: RecordingDevice | null;
  sound: boolean;
}

export const DEFAULT_VIDEO_INPUTS: VideoInputs = { camera: null, microphone: null, sound: true };

function sanitizeDevice(raw: unknown): RecordingDevice | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, label } = raw as { id?: unknown; label?: unknown };
  return typeof id === 'string' && id !== '' && typeof label === 'string' ? { id, label } : null;
}

/** As read back from settings.json, or sent by the window: anything malformed is the default. */
export function sanitizeVideoInputs(raw: unknown): VideoInputs {
  if (!raw || typeof raw !== 'object') return DEFAULT_VIDEO_INPUTS;
  const r = raw as { camera?: unknown; microphone?: unknown; sound?: unknown };
  return { camera: sanitizeDevice(r.camera), microphone: sanitizeDevice(r.microphone), sound: r.sound !== false };
}

/** What the window's recorder is asked to write, best first; the first the recorder supports wins. */
export function takeMimeTypes(sound: boolean): string[] {
  // VP8 first: the cheapest of the two to encode in real time, and the take is converted anyway.
  return sound
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
}

export function pickTakeMimeType(sound: boolean, supported: (type: string) => boolean): string | null {
  return takeMimeTypes(sound).find(supported) ?? null;
}

/** A frame rate as FFmpeg is told it, and as a number for everything else. */
export interface TakeRate {
  fps: number;
  /** "30", or "30000/1001" for the NTSC rates, which are not exact as decimals. */
  ffmpeg: string;
}

const STANDARD_RATES: readonly TakeRate[] = [
  { fps: 24000 / 1001, ffmpeg: '24000/1001' },
  { fps: 24, ffmpeg: '24' },
  { fps: 25, ffmpeg: '25' },
  { fps: 30000 / 1001, ffmpeg: '30000/1001' },
  { fps: 30, ffmpeg: '30' },
  { fps: 48, ffmpeg: '48' },
  { fps: 50, ffmpeg: '50' },
  { fps: 60000 / 1001, ffmpeg: '60000/1001' },
  { fps: 60, ffmpeg: '60' },
];

/**
 * The camera's own frame rate, as the steady rate the file is written at. A
 * camera reports what it was opened at, often a hair off a standard rate
 * (30.000030, 29.97): within 1% of one it is that one, exactly; otherwise its
 * whole-number rate (a webcam at 15 or 20 is a real camera too). Nothing
 * reported, or nothing sensible, is 30.
 */
export function cameraFrameRate(reported: number | undefined): TakeRate {
  if (reported === undefined || !Number.isFinite(reported) || reported < 1 || reported > 240) return { fps: 30, ffmpeg: '30' };
  // Nearest first, so 29.98 is 29.97 rather than 30 — the two are only 0.1% apart.
  const near = [...STANDARD_RATES].sort((a, b) => Math.abs(a.fps - reported) - Math.abs(b.fps - reported))[0]!;
  if (Math.abs(near.fps - reported) / near.fps <= 0.01) return near;
  const whole = Math.round(reported);
  return { fps: whole, ffmpeg: String(whole) };
}

/**
 * Whether the preview is shown mirrored, as a mirror shows a face: for a
 * camera that faces the person at the computer, which is what a computer's
 * camera does unless it says otherwise. One that says it faces away
 * ("environment") is shown as it sees. The file is never mirrored — the
 * preview is mirrored by its own styling, and the recorder takes the camera's
 * picture as it came.
 */
export function mirrorsPreview(facingMode: string | undefined): boolean {
  return facingMode !== 'environment';
}

/**
 * Bits per second for a picture of this size and rate: what the recorder is
 * asked for (generous, since its file is converted once more) and what a
 * hardware H.264 encoder is given (it has no quality setting libx264's CRF
 * stands for). Clamped so a tiny camera still looks clean and a 4K one does
 * not make a file nobody can move.
 */
export function takeBitrate(width: number, height: number, fps: number, bitsPerPixel: number): number {
  const raw = Math.max(1, width) * Math.max(1, height) * Math.max(1, fps) * bitsPerPixel;
  return Math.round(Math.min(40_000_000, Math.max(2_500_000, raw)));
}

/**
 * The H.264 encoders to try, in order, from what this FFmpeg lists: libx264
 * first, the one a full build has; then the platforms' own (VideoToolbox,
 * Media Foundation, NVIDIA, AMD), which an FFmpeg without libx264 often has.
 * More than one, because a hardware encoder can be listed and still fail on
 * a machine without the hardware; the next is then tried.
 */
export function h264EncodersFor(encoders: readonly string[]): string[] {
  // The choices, in order, are the feature table's (milestone 88): one list, which Settings reads too.
  return (needFor('take').anyEncoder ?? []).filter((e) => encoders.includes(e));
}

export interface TakeConversion {
  input: string;
  output: string;
  rate: TakeRate;
  /** The take was recorded with sound; without it, the file has no audio stream at all. */
  sound: boolean;
  encoder: string;
  /** The camera's size, for a hardware encoder's bitrate. */
  width: number;
  height: number;
}

/**
 * The FFmpeg command that turns the recorder's WebM into the take kept in the
 * library: H.264 at the camera's own size (an odd side, which H.264 cannot
 * hold, loses its last pixel rather than being scaled), a constant frame rate
 * at the camera's own, 4:2:0 for every player, AAC at 48 kHz, and the index at
 * the front of the file so it opens without being read to the end.
 */
export function videoTakeArgs(c: TakeConversion): string[] {
  const video = c.encoder === 'libx264'
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18']
    : [
        '-c:v', c.encoder, '-b:v', String(takeBitrate(c.width, c.height, c.rate.fps, 0.12)),
        // VideoToolbox in a virtual machine (CI's Mac) has no hardware; its software path is the same encoder.
        ...(c.encoder === 'h264_videotoolbox' ? ['-allow_sw', '1'] : []),
      ];
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', c.input,
    '-map', '0:v:0',
    ...(c.sound ? ['-map', '0:a:0?'] : []),
    '-vf', `fps=${c.rate.ffmpeg},crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
    ...video,
    ...(c.sound ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an']),
    '-movflags', '+faststart',
    c.output,
  ];
}

/**
 * A take on its way to disk: the recorder hands over a piece every second,
 * and each is appended in the order it was given, whatever order the writes
 * would have finished in. So a long take is never held in memory, and a camera
 * unplugged mid-take leaves on disk everything it recorded.
 */
export class TakeFile {
  private readonly stream: WriteStream;
  private chain: Promise<void>;
  private failed: Error | null = null;
  bytes = 0;

  private constructor(readonly path: string, stream: WriteStream, opened: Promise<void>) {
    this.stream = stream;
    this.chain = opened;
    stream.on('error', (err) => { this.failed ??= err; });
  }

  static async open(path: string): Promise<TakeFile> {
    await mkdir(dirname(path), { recursive: true });
    const stream = createWriteStream(path);
    const opened = new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve());
      stream.once('error', reject);
    });
    return new TakeFile(path, stream, opened);
  }

  append(piece: Uint8Array): Promise<void> {
    this.chain = this.chain.then(() => new Promise<void>((resolve, reject) => {
      if (this.failed) {
        reject(this.failed);
        return;
      }
      this.stream.write(piece, (err) => (err ? reject(err) : resolve()));
    }));
    this.bytes += piece.length;
    return this.chain;
  }

  /** Every piece written and the file closed; resolves to its size on disk. */
  async close(): Promise<number> {
    await this.chain;
    await new Promise<void>((resolve, reject) => this.stream.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (this.failed) throw this.failed;
    return (await stat(this.path)).size;
  }

  /** Nothing worth keeping: the file goes. */
  async discard(): Promise<void> {
    await this.chain.catch(() => undefined);
    await new Promise<void>((resolve) => this.stream.end(() => resolve()));
    await rm(this.path, { force: true });
  }
}
