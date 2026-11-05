/**
 * Recording a voice, the main process's side (milestone 63): whether the
 * microphone may be used — the operating system's question, asked plainly,
 * with the way to its settings when the answer was no — and where a finished
 * take lands: a WAV in the managed Recordings folder under the app's own
 * data, added to the library like any folder of the person's own.
 *
 * The capture itself happens in the renderer, the one process with
 * `getUserMedia`; what arrives here is the finished file's bytes.
 */

import { app, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import { RECORDINGS_FOLDER_NAME, writeRecordingFile } from '../core/recording';
import type { MicrophoneAccess, SavedRecording } from '../shared/api';
import { addLibraryFolder, findMediaIdByPath, markItemUsed } from './library-service';

/** The managed folder, beside the managed fonts: Pulp's own, so it never needs asking where. */
export function recordingsDir(): string {
  return join(app.getPath('userData'), RECORDINGS_FOLDER_NAME);
}

/**
 * May Pulp hear the microphone? On macOS the system decides and remembers; the
 * first ask is the system's own prompt, with the reason from the app's usage
 * description. Windows answers through the same Electron call where its
 * privacy setting forbids apps the microphone; Linux has no central gate.
 * Under the fake microphone (tests) there is no device to be allowed.
 */
export async function microphoneAccess(): Promise<MicrophoneAccess> {
  if (process.env.PULP_FAKE_MIC) return { ok: true };
  const refused = {
    ok: false as const,
    message: 'Pulp may not use the microphone. Allow it in the system settings, then record again.',
    canOpenSettings: process.platform !== 'linux',
  };
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return { ok: true };
    if (status === 'not-determined') return (await systemPreferences.askForMediaAccess('microphone')) ? { ok: true } : refused;
    return refused;
  }
  if (process.platform === 'win32' && systemPreferences.getMediaAccessStatus('microphone') === 'denied') return refused;
  return { ok: true };
}

/** The system's own microphone page, for the "no" that has to be changed there. */
export function openMicrophoneSettings(): void {
  if (process.platform === 'darwin') void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
  else if (process.platform === 'win32') void shell.openExternal('ms-settings:privacy-microphone');
}

/**
 * A finished take into the library: written into Recordings, the folder added
 * (first take) or rescanned, and the new file marked used so it sits in
 * Recently used. Resolves with the library's id for the renderer to select.
 */
export async function saveRecording(wav: Uint8Array, at: Date = new Date()): Promise<SavedRecording> {
  const path = await writeRecordingFile(recordingsDir(), wav, at);
  await addLibraryFolder(recordingsDir());
  const found = findMediaIdByPath(path);
  if (found) markItemUsed(found.id);
  return { path, id: found?.id ?? null };
}
