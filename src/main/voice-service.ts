/**
 * Treated voice previews (milestone 53): the preview plays each layer's sound
 * through a hidden element (src/renderer/stage-audio.ts), and an element
 * cannot run an ffmpeg filter — so the main process runs the treatment once,
 * over the whole file, into a small AAC beside the other caches, and the
 * element plays that instead. The treated file is the file's own timeline to
 * the second, so every seek, loop and fade the element is held to lands where
 * it always did — and the recipe is the very one the render mixes by
 * (src/core/voice-treatment.ts), so what is heard is what is written.
 *
 * The window names an item and a treatment, never a path (ADR 0013); the
 * answer is a pulp-media://voice/<hash>.m4a URL into the cache folder, which
 * the protocol serves by exactly that name shape and nothing else. The cache
 * is keyed by the file, its mtime and the treatment, and pruned to a bound so
 * an afternoon of slider work cannot fill a disk.
 */

import { createHash } from 'node:crypto';
import { app } from 'electron';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { voicePreviewUrlFor } from '../core/media-serve';
import { ffprobePathFor } from '../core/media-probe';
import { sanitizeVoice, voiceSteps } from '../core/voice-treatment';
import { resolveClipAudio } from './clip-grant';
import { resolveSoundSource } from './sound-grant';

/** Treated previews the cache keeps; past this the oldest go. */
const CACHE_KEEP = 64;

/** A treatment over a long file is a decode and an encode; longer than this is something wrong. */
const TREAT_TIMEOUT_MS = 120_000;

export function voicePreviewDir(): string {
  return join(app.getPath('userData'), 'voice-cache');
}

export interface VoicePreviewAnswer {
  /** The treated file's URL, or null: nothing to treat, no ffmpeg, or the treatment failed. */
  url: string | null;
}

/** The same ask twice runs once: a slider settles faster than a long file encodes. */
const inFlight = new Map<string, Promise<VoicePreviewAnswer>>();

export async function voicePreview(raw: unknown): Promise<VoicePreviewAnswer> {
  const request = raw as Partial<{ kind: 'sound' | 'clip'; id: string; voice: unknown }>;
  const voice = sanitizeVoice(request?.voice);
  const id = typeof request?.id === 'string' ? request.id : '';
  if (!voice || voice.amount <= 0 || id === '' || (request?.kind !== 'sound' && request?.kind !== 'clip')) return { url: null };
  const key = `${request.kind}|${id}|${voice.treatment}|${voice.amount}`;
  const running = inFlight.get(key);
  if (running) return running;
  const work = treat(request.kind, id, voice).catch((): VoicePreviewAnswer => ({ url: null }));
  inFlight.set(key, work);
  return work.finally(() => {
    if (inFlight.get(key) === work) inFlight.delete(key);
  });
}

async function treat(kind: 'sound' | 'clip', id: string, voice: NonNullable<ReturnType<typeof sanitizeVoice>>): Promise<VoicePreviewAnswer> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { url: null };
  const found = kind === 'sound'
    ? await resolveSoundSource(ffprobePathFor(ffmpeg.path), id)
    : await resolveClipAudio(ffprobePathFor(ffmpeg.path), id).then((audio) => (audio?.hasAudio ? audio : null));
  if (!found) return { url: null };
  let mtime: number;
  try {
    mtime = (await stat(found.path)).mtimeMs;
  } catch {
    return { url: null };
  }
  const name = `${createHash('sha1').update(`${found.path}|${mtime}|${voice.treatment}|${voice.amount}`).digest('hex')}.m4a`;
  const dir = voicePreviewDir();
  const file = join(dir, name);
  const url = voicePreviewUrlFor(name);
  try {
    await stat(file);
    return { url };
  } catch {
    // Not cached yet: treat it now.
  }
  await mkdir(dir, { recursive: true });
  const run = runForBuffer(ffmpeg.path, [
    '-v', 'error', '-y', '-i', found.path, '-vn', '-sn', '-dn',
    '-af', voiceSteps(voice).join(','),
    '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    file,
  ]);
  const made = await Promise.race([
    run,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the treatment did not finish in time')), TREAT_TIMEOUT_MS)), // i18n-exempt(diagnostic)
  ]);
  if (made.code !== 0) {
    await rm(file, { force: true }).catch(() => undefined);
    return { url: null };
  }
  void prune(dir).catch(() => undefined);
  return { url };
}

/** The cache holds its newest and lets the rest go; called after a write, never awaited by the ask. */
async function prune(dir: string): Promise<void> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.m4a'));
  if (names.length <= CACHE_KEEP) return;
  const dated = await Promise.all(names.map(async (n) => ({ n, at: (await stat(join(dir, n))).mtimeMs })));
  dated.sort((a, b) => b.at - a.at);
  for (const { n } of dated.slice(CACHE_KEEP)) await rm(join(dir, n), { force: true }).catch(() => undefined);
}
