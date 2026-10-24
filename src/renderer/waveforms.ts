/**
 * Waveform peaks for the window: asked for once per audio file and kept for the
 * session, so the results rows and the stage draw the same shape without asking
 * twice. The peaks themselves and the path that draws them are in
 * `src/core/waveform.ts`; this is only the cache and the request.
 */

import { signal } from '@preact/signals';
import { decodePeaks, wantsWaveform } from '../core/waveform';
import type { LibraryEntry } from '../core/library-types';

/** Peaks by library id; null means the file has none and will not be asked about again. */
export const waveforms = signal<ReadonlyMap<string, Uint8Array | null>>(new Map());

const asking = new Set<string>();

/** The peaks of an audio item, asking for them the first time they are wanted. */
export function peaksFor(entry: LibraryEntry): Uint8Array | null {
  const known = waveforms.value.get(entry.id);
  if (known !== undefined) return known;
  requestWaveform(entry);
  return null;
}

export function requestWaveform(entry: LibraryEntry): void {
  if (!wantsWaveform(entry) || waveforms.value.has(entry.id) || asking.has(entry.id)) return;
  asking.add(entry.id);
  void window.pulp.waveform(entry.id).then((result) => {
    asking.delete(entry.id);
    if (result.reason) console.warn(`No waveform for ${entry.id}: ${result.reason}`);
    // A busy machine or a missing ffmpeg is worth asking about again next time.
    if (result.peaks === null && result.transient) return;
    waveforms.value = new Map(waveforms.value).set(entry.id, result.peaks === null ? null : decodePeaks(result.peaks));
  });
}
