/**
 * A voice's levels (milestone 80): the loudest sample in every fiftieth of a
 * second of a file, which is how a music layer knows when the voice it dips
 * under is speaking (src/core/duck.ts). Measured once per file and kept in
 * memory, keyed by the path and its mtime, so a render and the preview's ask
 * read one measurement.
 *
 * The window asks by library id, never by path (ADR 0013), and gets the
 * bytes back; the render asks by the path it already resolved.
 */

import { stat } from 'node:fs/promises';
import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { applyDucks, type AudioLayer } from '../core/layer-audio';
import { levelArgs, levelsFromPcm } from '../core/duck';
import { ffprobePathFor } from '../core/media-probe';
import { resolveSoundSource } from './sound-grant';

/** Files whose levels are kept; a project names a handful of voices, so this is generous. */
const KEEP = 32;

const known = new Map<string, Promise<Uint8Array | null>>();

/** The levels of a file, measured now if they have not been; null when it cannot be decoded. */
export async function levelsForPath(ffmpegPath: string, path: string): Promise<Uint8Array | null> {
  let mtime: number;
  try {
    mtime = (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
  const key = `${path}|${mtime}`;
  const cached = known.get(key);
  if (cached) return cached;
  const work = runForBuffer(ffmpegPath, levelArgs(path))
    .then((run) => (run.code === 0 ? levelsFromPcm(run.stdout) : null))
    .catch(() => null);
  known.set(key, work);
  while (known.size > KEEP) known.delete(known.keys().next().value!);
  const levels = await work;
  // A failure is not kept: the file may be readable next time.
  if (levels === null) known.delete(key);
  return levels;
}

/** The window's ask: a library sound's levels by its id. */
export async function voiceLevels(id: unknown): Promise<Uint8Array | null> {
  if (typeof id !== 'string' || id === '') return null;
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return null;
  const found = await resolveSoundSource(ffprobePathFor(ffmpeg.path), id);
  return found ? levelsForPath(ffmpeg.path, found.path) : null;
}

/**
 * Work out every dip in a mix the main process is about to run (a render, or
 * the meter's measurement): the voices named are measured, then the core
 * decides the rest (`applyDucks`).
 */
export async function duckLayers(ffmpegPath: string, keyed: readonly { key: string; layer: AudioLayer }[], length: number): Promise<void> {
  const named = new Set<string>();
  for (const { layer } of keyed) if (layer.kind === 'sound' && layer.value.duck) named.add(layer.value.duck.under);
  if (named.size === 0) return;
  const levels = new Map<string, Uint8Array | null>();
  for (const { key, layer } of keyed) {
    if (!named.has(key) || levels.has(layer.path) || layer.path === '') continue;
    levels.set(layer.path, await levelsForPath(ffmpegPath, layer.path));
  }
  applyDucks(keyed, (layer) => levels.get(layer.path), length);
}
