/**
 * A video layer's own sound in the preview (milestone 48). The stage draws a
 * template's clip layers from decoded frames, so there is no media element to
 * hear; each audible layer gets a hidden `<audio>` playing the clip's file
 * through `pulp-media://`, held to the playhead by the same arithmetic the
 * picture is drawn by (`clipMediaTimeAt`): seeked when it drifts past a
 * tolerance — which is also what carries it over a loop's join and a scrub —
 * paused before its start delay and after a `once` clip has played out, and
 * scaled by the layer's volume under the transport's own volume and mute.
 *
 * Playback while paused is nothing: a frame step or a scrub makes no sound,
 * as in an editing app a held frame is silent.
 */

import type { LayerValues } from '../core/layers';
import type { MediaEntry } from '../core/library-types';
import { mediaUrlFor } from '../shared/api';
import { CLIP_LIMITS, clipAudible, clipMediaTimeAt, DEFAULT_CLIP_SPEED, type ClipSource, type ClipValue } from '../core/video-layer';

interface LayerSound {
  el: HTMLAudioElement;
  value: ClipValue;
  source: ClipSource;
}

/** One element per audible video layer, keyed block.layer. */
const sounds = new Map<string, LayerSound>();

/** How far the element may drift from the playhead before it is seeked. Within it, the element's own clock is smoother. */
const DRIFT_SECONDS = 0.3;

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return DEFAULT_CLIP_SPEED;
  return Math.min(CLIP_LIMITS.speed.max, Math.max(CLIP_LIMITS.speed.min, speed));
}

/**
 * Bring the elements in line with the layers: one per audible video layer
 * whose clip is a file with sound. A drawn template and a frame sequence have
 * no file to hear; a clip the library has read and found silent gets nothing,
 * and one not yet read is given the benefit of the doubt — the element simply
 * plays nothing if there is nothing there.
 */
export function layerSoundsSync(layers: LayerValues, sources: Record<string, ClipSource>, entryFor: (id: string) => MediaEntry | undefined): void {
  const wanted = new Map<string, { value: ClipValue; source: ClipSource }>();
  for (const [blockId, stack] of Object.entries(layers)) {
    for (const layer of stack) {
      if (layer.type !== 'video' || !clipAudible(layer.clip)) continue;
      const source = sources[layer.clip.id!];
      const entry = entryFor(layer.clip.id!);
      if (!source || !entry || entry.sequence || (entry.meta && !entry.meta.audioCodec)) continue;
      wanted.set(`${blockId}.${layer.id}`, { value: layer.clip, source });
    }
  }
  for (const [key, sound] of sounds) {
    const next = wanted.get(key);
    if (next && next.value.id === sound.value.id) {
      // The same clip with new settings keeps its element and its buffered sound.
      sound.value = next.value;
      sound.source = next.source;
      wanted.delete(key);
      continue;
    }
    sound.el.pause();
    sound.el.removeAttribute('src');
    sound.el.load();
    sounds.delete(key);
  }
  for (const [key, next] of wanted) {
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.src = mediaUrlFor(next.value.id!);
    sounds.set(key, { el, value: next.value, source: next.source });
  }
}

/**
 * Hold every layer's sound to the playhead. Called when playback starts, on
 * each playing tick, and when the master volume or mute changes; cheap when
 * nothing has drifted.
 */
export function layerSoundsUpdate(timeSeconds: number, playing: boolean, master: { volume: number; muted: boolean }): void {
  for (const sound of sounds.values()) {
    const { el, value, source } = sound;
    const at = clipMediaTimeAt(timeSeconds, value, source);
    el.volume = Math.min(1, Math.max(0, master.volume * value.volume));
    el.muted = master.muted || value.muted;
    el.playbackRate = clampSpeed(value.speed);
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

/** For the UI test: which layers have a sound element, and whether each is audibly playing. */
export function layerSoundsDebug(): { key: string; playing: boolean; muted: boolean; volume: number; time: number }[] {
  return [...sounds.entries()].map(([key, s]) => ({ key, playing: !s.el.paused, muted: s.el.muted, volume: s.el.volume, time: s.el.currentTime }));
}
