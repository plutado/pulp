/**
 * The project's mix in the preview (milestone 48): every layer that makes
 * sound, played together and held to the transport.
 *
 * The stage draws a template's picture from frames, so there is no media
 * element to hear. Each audible layer — a video layer whose clip carries an
 * audio stream, an audio layer holding music or a voice-over — gets a hidden
 * `<audio>` playing its file through `pulp-media://`, held to the playhead by
 * the arithmetic the render mixes by (`src/core/layer-audio.ts`): seeked when
 * it drifts past a tolerance, which is also what carries it over a loop's
 * join and a scrub, and gained per tick so a fade in the preview is the fade
 * that will be written. Every element sits under the transport row's own
 * volume and mute, which are the master.
 *
 * Elements rather than a Web Audio graph: a `MediaElementSourceNode` over a
 * custom scheme is the kind of thing that silently outputs nothing, the
 * elements already carry decoding and buffering for free, and a gain set per
 * animation frame is a fade at a resolution no one can hear the steps in.
 *
 * Playback while paused is nothing: a frame step or a scrub makes no sound,
 * as in an editing app a held frame is silent.
 */

import { layerGainAt, type AudioLayer } from '../core/layer-audio';
import type { LayerValues } from '../core/layers';
import type { MediaEntry } from '../core/library-types';
import { soundAudible, soundTimeAt, type SoundSource } from '../core/sound-layer';
import { mediaUrlFor } from '../shared/api';
import { CLIP_LIMITS, clipAudible, clipMediaTimeAt, DEFAULT_CLIP_SPEED, type ClipSource } from '../core/video-layer';

interface LayerSound {
  el: HTMLAudioElement;
  /** What the layer is and how it plays; the one place that decides when it is heard. */
  layer: AudioLayer;
  /** The treatment the element's src is treated for (milestone 53); '' is the file as recorded. */
  voiceKey: string;
  /** The ask for a treated file, waiting for the settings to settle. */
  voiceTimer?: ReturnType<typeof setTimeout>;
}

/** One element per audible layer, keyed block.layer. */
const sounds = new Map<string, LayerSound>();

/** How far the element may drift from the playhead before it is seeked. Within it, the element's own clock is smoother. */
const DRIFT_SECONDS = 0.3;

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return DEFAULT_CLIP_SPEED;
  return Math.min(CLIP_LIMITS.speed.max, Math.max(CLIP_LIMITS.speed.min, speed));
}

/** The library id a layer's sound plays, whichever kind it is. */
function sourceId(layer: AudioLayer): string {
  return (layer.kind === 'sound' ? layer.value.id : layer.value.id) ?? '';
}

/** What the library measured about a sound file: its length, which the window and the loop are held to. */
function soundSourceFor(entry: MediaEntry | undefined): SoundSource | null {
  const duration = entry?.meta?.duration;
  return duration && duration > 0 ? { duration } : null;
}

/**
 * Bring the elements in line with the layers: one per layer that will be
 * heard. A drawn template and a frame sequence have no file to play; a clip
 * the library has read and found silent gets nothing, and one not yet read is
 * given the benefit of the doubt — the element simply plays nothing if there
 * is nothing there. A sound the library has not measured yet is left out,
 * since without its length there is no window to play.
 */
export function layerSoundsSync(layers: LayerValues, sources: Record<string, ClipSource>, entryFor: (id: string) => MediaEntry | undefined): void {
  const wanted = new Map<string, AudioLayer>();
  for (const [blockId, stack] of Object.entries(layers)) {
    for (const layer of stack) {
      const key = `${blockId}.${layer.id}`;
      const span = layer.span;
      if (layer.type === 'video' && clipAudible(layer.clip)) {
        const source = sources[layer.clip.id!];
        const entry = entryFor(layer.clip.id!);
        if (!source || !entry || entry.sequence || (entry.meta && !entry.meta.audioCodec)) continue;
        wanted.set(key, { kind: 'clip', path: '', value: layer.clip, source, ...(span ? { span } : {}) });
      } else if (layer.type === 'audio' && soundAudible(layer.sound)) {
        const entry = entryFor(layer.sound.id!);
        const source = soundSourceFor(entry);
        if (!entry || entry.offline || !source) continue;
        wanted.set(key, { kind: 'sound', path: '', value: layer.sound, source, ...(span ? { span } : {}) });
      }
    }
  }
  for (const [key, sound] of sounds) {
    const next = wanted.get(key);
    if (next && next.kind === sound.layer.kind && sourceId(next) === sourceId(sound.layer)) {
      // The same file with new settings keeps its element and the sound it has already buffered.
      sound.layer = next;
      wanted.delete(key);
      bindVoice(key, sound);
      continue;
    }
    clearTimeout(sound.voiceTimer);
    sound.el.pause();
    sound.el.removeAttribute('src');
    sound.el.load();
    sounds.delete(key);
  }
  for (const [key, layer] of wanted) {
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.src = mediaUrlFor(sourceId(layer));
    const sound: LayerSound = { el, layer, voiceKey: '' };
    sounds.set(key, sound);
    bindVoice(key, sound);
  }
}

// ---------------------------------------------------------------- voice treatments (milestone 53)

/** A slider settles faster than a long file treats: one ask after the burst answers for all of it. */
const VOICE_DEBOUNCE_MS = 350;

/** What the element should be treated for: the treatment and its amount, or '' for the file as recorded. */
function voiceKeyOf(layer: AudioLayer): string {
  const voice = layer.value.voice;
  return voice && voice.amount > 0 ? `${voice.treatment}|${voice.amount}` : '';
}

/**
 * Bring the element's source in line with the layer's treatment: the file as
 * recorded straight away when the treatment goes, and the treated file once
 * the main process has rendered it — through the recipe the render mixes by,
 * so the preview is the mix (src/main/voice-service.ts). Until it lands, or
 * when it cannot be made, the element keeps playing the sound as recorded.
 */
function bindVoice(key: string, sound: LayerSound): void {
  const want = voiceKeyOf(sound.layer);
  if (want === sound.voiceKey) return;
  clearTimeout(sound.voiceTimer);
  if (want === '') {
    sound.voiceKey = '';
    swapSrc(sound.el, mediaUrlFor(sourceId(sound.layer)));
    return;
  }
  const id = sourceId(sound.layer);
  const voice = sound.layer.value.voice;
  const kind = sound.layer.kind;
  sound.voiceTimer = setTimeout(() => {
    void window.pulp.voicePreview({ kind, id, voice }).then(({ url }) => {
      // The layer may have moved on, or gone, while the treatment rendered.
      if (sounds.get(key) !== sound || voiceKeyOf(sound.layer) !== want || sourceId(sound.layer) !== id) return;
      if (!url) return;
      sound.voiceKey = want;
      swapSrc(sound.el, url);
    });
  }, VOICE_DEBOUNCE_MS);
}

/** A new source for a playing element, kept where it was: the drift seek tidies the rest. */
function swapSrc(el: HTMLAudioElement, url: string): void {
  const at = el.currentTime;
  const playing = !el.paused;
  el.src = url;
  try {
    el.currentTime = at;
  } catch {
    // Not seekable yet; the next tick's drift seek lands it.
  }
  if (playing) void el.play().catch(() => undefined);
}

/**
 * Hold every layer's sound to the playhead. Called when playback starts, on
 * each playing tick, and when the master volume or mute changes; cheap when
 * nothing has drifted. `length` is the graphic's, which a loop's fade-out and
 * a span are measured against.
 */
export function layerSoundsUpdate(timeSeconds: number, playing: boolean, master: { volume: number; muted: boolean }, length: number): void {
  for (const sound of sounds.values()) {
    const { el, layer } = sound;
    const at = layer.kind === 'sound'
      ? soundTimeAt(timeSeconds, layer.value, layer.source)
      : clipMediaTimeAt(timeSeconds, layer.value, layer.source);
    // The layer's own volume and its fades, under the transport's master.
    el.volume = Math.min(1, Math.max(0, master.volume * layerGainAt(layer, timeSeconds, length)));
    el.muted = master.muted;
    el.playbackRate = layer.kind === 'clip' ? clampSpeed(layer.value.speed) : 1;
    if (!playing || at === null) {
      if (!el.paused) el.pause();
      continue;
    }
    if (Math.abs(el.currentTime - at) > DRIFT_SECONDS) {
      try {
        el.currentTime = at;
      } catch {
        // Not seekable yet; the next tick tries again once it is.
      }
    }
    if (el.paused) void el.play().catch(() => undefined);
  }
}

/** Playback stopped: every layer falls silent where it is. */
export function layerSoundsStop(): void {
  for (const sound of sounds.values()) {
    if (!sound.el.paused) sound.el.pause();
  }
}

/** Another item is being shown: the elements go with the layers they played for. */
export function layerSoundsClear(): void {
  layerSoundsSync({}, {}, () => undefined);
}

/** For the UI test: which layers have a sound element, whether each is audibly playing, and what it is treated for. */
export function layerSoundsDebug(): { key: string; kind: string; playing: boolean; muted: boolean; volume: number; time: number; voice: string }[] {
  return [...sounds.entries()].map(([key, s]) => ({
    key, kind: s.layer.kind, playing: !s.el.paused, muted: s.el.muted, volume: Math.round(s.el.volume * 1000) / 1000, time: s.el.currentTime, voice: s.voiceKey,
  }));
}
