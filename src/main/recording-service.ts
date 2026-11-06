/**
 * Recording a voice (milestone 63) and from a camera (milestone 64), the main
 * process's side: whether the microphone and the camera may be used — the
 * operating system's question, asked plainly, with the way to its settings
 * when the answer was no — and where a finished take lands: in the managed
 * Recordings folder under the app's own data, added to the library like any
 * folder of the person's own.
 *
 * The capture itself happens in the renderer, the one process with
 * `getUserMedia`. A voice arrives here as the finished WAV's bytes; a camera's
 * take arrives a second at a time, is written to a staging file outside the
 * library as it comes, and is converted with FFmpeg once it ends.
 */

import { app, shell, systemPreferences } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { detectFfmpeg, nodeRunner } from '../core/ffmpeg';
import { tr } from '../core/i18n';
import { freeRecordingPath, RECORDINGS_FOLDER_NAME, writeRecordingFile } from '../core/recording';
import { cameraFrameRate, h264EncodersFor, TakeFile, videoTakeArgs, type TakeRate } from '../core/video-take';
import type { DeviceAccess, MediaDevice, SavedRecording, SavedVideoTake, VideoTakeFacts } from '../shared/api';
import { addLibraryFolder, findMediaIdByPath, markItemUsed } from './library-service';

/** The managed folder, beside the managed fonts: Pulp's own, so it never needs asking where. */
export function recordingsDir(): string {
  return join(app.getPath('userData'), RECORDINGS_FOLDER_NAME);
}

/**
 * Where a camera's take is written while it records and converts: beside
 * Recordings, not in it, so the library never scans half a file. A take moves
 * into Recordings only once it is whole.
 */
function stagingDir(): string {
  return join(app.getPath('userData'), 'Recordings in progress'); // i18n-exempt(content): a folder on disk
}

/** What is said when the system refuses a device, in the interface's language when it is said. */
const REFUSED: Record<MediaDevice, () => string> = {
  microphone: () => tr('recording.refused.microphone'),
  camera: () => tr('recording.refused.camera'),
};

/**
 * May Pulp use this device? On macOS the system decides and remembers; the
 * first ask is the system's own prompt, with the reason from the app's usage
 * description. Windows answers through the same Electron call where its
 * privacy setting forbids apps the device; Linux has no central gate. Under
 * the fake devices (tests) there is nothing to be allowed.
 */
async function deviceAccess(device: MediaDevice): Promise<DeviceAccess> {
  if (process.env.PULP_FAKE_MEDIA) return { ok: true };
  const refused = { ok: false as const, device, message: REFUSED[device](), canOpenSettings: process.platform !== 'linux' };
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus(device);
    if (status === 'granted') return { ok: true };
    if (status === 'not-determined') return (await systemPreferences.askForMediaAccess(device)) ? { ok: true } : refused;
    return refused;
  }
  if (process.platform === 'win32' && systemPreferences.getMediaAccessStatus(device) === 'denied') return refused;
  return { ok: true };
}

export function microphoneAccess(): Promise<DeviceAccess> {
  return deviceAccess('microphone');
}

/** The camera, and — when the take is to have sound — the microphone after it: two prompts, one at a time. */
export async function cameraAccess(sound: boolean): Promise<DeviceAccess> {
  const camera = await deviceAccess('camera');
  if (!camera.ok || !sound) return camera;
  return deviceAccess('microphone');
}

/** The system's own page for the device, for the "no" that has to be changed there. */
export function openPrivacySettings(device: MediaDevice): void {
  if (process.platform === 'darwin') {
    void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${device === 'camera' ? 'Camera' : 'Microphone'}`);
  } else if (process.platform === 'win32') {
    void shell.openExternal(device === 'camera' ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone');
  }
}

/** A file now in Recordings, in the library, and marked used so it sits in Recently used. */
async function intoLibrary(path: string): Promise<string | null> {
  await addLibraryFolder(recordingsDir());
  const found = findMediaIdByPath(path);
  if (found) markItemUsed(found.id);
  return found?.id ?? null;
}

/**
 * A finished voice take into the library: written into Recordings, the folder
 * added (first take) or rescanned, and the new file marked used. Resolves
 * with the library's id for the renderer to select.
 */
export async function saveRecording(wav: Uint8Array, at: Date = new Date()): Promise<SavedRecording> {
  const path = await writeRecordingFile(recordingsDir(), wav, at);
  return { path, id: await intoLibrary(path) };
}

// ---------------------------------------------------------------- a camera's take

interface VideoTake {
  file: TakeFile;
  /** When it began: the take is named by it, as "the take from half past two". */
  at: Date;
}

const videoTakes = new Map<string, VideoTake>();

/** A take begins: a staging file opens for its pieces. Resolves with the id its pieces are sent under. */
export async function beginVideoTake(): Promise<string> {
  const id = randomUUID();
  const file = await TakeFile.open(join(stagingDir(), `${id}.webm`));
  videoTakes.set(id, { file, at: new Date() });
  return id;
}

export function appendVideoTake(id: string, piece: Uint8Array): Promise<void> {
  const take = videoTakes.get(id);
  if (!take) return Promise.reject(new Error(tr('recording.not-open')));
  return take.file.append(piece);
}

/** Nothing was recorded after all: the staging file goes and nothing reaches the library. */
export async function abandonVideoTake(id: string): Promise<void> {
  const take = videoTakes.get(id);
  videoTakes.delete(id);
  await take?.file.discard();
}

/** Why a take could not be converted: the note says it in a sentence of its own for each. */
type NotConverted = { ok: false; why: 'no-ffmpeg' } | { ok: false; why: 'no-encoder' } | { ok: false; why: 'failed'; detail: string };

/** Convert with the first H.264 encoder that works here; null — with why — when none did. */
async function convertTake(input: string, output: string, facts: VideoTakeFacts, rate: TakeRate): Promise<{ ok: true } | NotConverted> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, why: 'no-ffmpeg' };
  const encoders = h264EncodersFor(ffmpeg.encoders);
  if (encoders.length === 0) return { ok: false, why: 'no-encoder' };
  let last = '';
  for (const encoder of encoders) {
    const result = await nodeRunner(ffmpeg.path, videoTakeArgs({ input, output, rate, sound: facts.sound, encoder, width: facts.width, height: facts.height }));
    if (result.code === 0) return { ok: true };
    last = result.stderr.trim().split('\n').at(-1) ?? '';
    await rm(output, { force: true });
  }
  return { ok: false, why: 'failed', detail: last || 'no reason given' }; // i18n-exempt(diagnostic): FFmpeg's last line, or that it gave none
}

/**
 * A take ends: every piece on disk, then converted to an MP4 the editors open
 * — H.264 and AAC at the camera's size and a constant frame rate — and moved
 * into Recordings and the library. Where it cannot be converted the
 * recorder's own WebM is kept instead, which Pulp plays, and the note says
 * why: a take is never thrown away for want of an encoder.
 */
export async function finishVideoTake(id: string, facts: VideoTakeFacts): Promise<SavedVideoTake> {
  const take = videoTakes.get(id);
  if (!take) throw new Error(tr('recording.not-open'));
  videoTakes.delete(id);
  const size = await take.file.close();
  if (size === 0) {
    await rm(take.file.path, { force: true });
    throw new Error(tr('recording.camera.nothing'));
  }
  const staged = join(stagingDir(), `${id}.mp4`);
  const converted = await convertTake(take.file.path, staged, facts, cameraFrameRate(facts.frameRate));
  await mkdir(recordingsDir(), { recursive: true });
  let path: string;
  let note: string | null = null;
  // Into Recordings only once whole: a rename within the app's own data, so the library sees the file appear complete.
  if (converted.ok) {
    path = freeRecordingPath(recordingsDir(), take.at, 'mp4');
    await rename(staged, path);
    await rm(take.file.path, { force: true });
  } else {
    path = freeRecordingPath(recordingsDir(), take.at, 'webm');
    await rename(take.file.path, path);
    note = converted.why === 'no-ffmpeg' ? tr('recording.kept-webm.no-ffmpeg')
      : converted.why === 'no-encoder' ? tr('recording.kept-webm.no-encoder')
        : tr('recording.kept-webm.failed', { detail: converted.detail });
  }
  return { path, id: await intoLibrary(path), converted: converted.ok, note };
}
