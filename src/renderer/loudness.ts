/**
 * The loudness meter in the transport row (milestone 52): what the project's
 * mix measures (EBU R128, integrated), against the target a platform preset
 * would level it to.
 *
 * Measured, not live: the number that matters is "how far is this mix from
 * the platform's target", which is a fact about the whole mix, so the main
 * process runs the same measurement a leveled render's first pass runs —
 * once per change to what is heard, debounced, never per frame — and the
 * meter shows the loudness a render would start from. A project with nothing
 * to hear shows no meter at all.
 *
 * The scale runs -36 to -6 LUFS, the range the platform targets live in; the
 * notch on it is the chosen platform's target (the session's lean, the same
 * one the Output tab sets).
 */

import { effect } from '@preact/signals';
import { trackAudio, type CutTrack } from '../core/cut-track';
import { playableSounds } from '../core/sound-layer';
import type { Layer, LayerValues } from '../core/layers';
import { platformPreset } from '../core/platform-presets';
import { preferredPlatform } from './store';

const SCALE = { from: -36, to: -6 } as const;

/** Edits land in bursts; one measurement after the burst answers for all of it. */
const MEASURE_DELAY_MS = 400;

let els: { root: HTMLElement; fill: HTMLElement; target: HTMLElement } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let shown: { lufs: number; truePeakDb: number | null } | null = null;

/** One entry on the meter's wire: ids and settings, never paths; a template entry names its template. */
type SoundRequestEntry = { kind: 'clip' | 'sound' | 'template'; value: unknown; span?: { start: number; end: number | null }; speed?: number; templateId?: string };

/** The layers that could be heard, as the wire carries them: ids and settings, never paths. */
function soundRequest(layers: LayerValues): SoundRequestEntry[] {
  const out: SoundRequestEntry[] = [];
  const spanOf = (layer: Layer) => (layer.span ? { span: layer.span } : {});
  for (const stack of Object.values(layers)) {
    for (const layer of stack) {
      if (layer.hidden) continue;
      // Music as stems (milestone 16) measures as what is heard: one entry per unmuted (or soloed) stem.
      if (layer.type === 'audio' && layer.sound?.id && !layer.sound.hidden) {
        for (const playable of playableSounds(layer.sound)) out.push({ kind: 'sound', value: playable.value, ...spanOf(layer) });
      }
      if (layer.type === 'video' && layer.clip?.id && !layer.clip.hidden) out.push({ kind: 'clip', value: layer.clip, ...spanOf(layer) });
    }
  }
  return out;
}

/** Where a loudness sits on the meter's scale, 0 to 1. */
function along(lufs: number): number {
  return Math.min(1, Math.max(0, (lufs - SCALE.from) / (SCALE.to - SCALE.from)));
}

function paint(): void {
  if (!els) return;
  const platform = platformPreset(preferredPlatform.value ?? undefined);
  if (shown === null) {
    els.root.hidden = true;
    return;
  }
  els.root.hidden = false;
  els.fill.style.width = `${along(shown.lufs) * 100}%`;
  // The reading itself lives in the tooltip and the accessible name, where this row keeps its
  // detail: the packed 1280 px line has no room for a second numeric readout beside the timecode.
  els.root.setAttribute('aria-label', `Mix loudness ${shown.lufs.toFixed(1)} LUFS`);
  if (platform) {
    els.target.hidden = false;
    els.target.style.left = `${along(platform.loudnessLufs) * 100}%`;
    const off = shown.lufs - platform.loudnessLufs;
    const stands = Math.abs(off) < 0.5 ? 'which is on it' : `${Math.abs(off).toFixed(1)} LU ${off > 0 ? 'above' : 'below'} it`;
    els.root.dataset.tip = `The mix measures ${shown.lufs.toFixed(1)} LUFS${shown.truePeakDb !== null ? `, peaking at ${shown.truePeakDb.toFixed(1)} dBTP` : ''}. A render aimed at ${platform.label} is leveled to ${platform.loudnessLufs} LUFS — ${stands}.`;
  } else {
    els.target.hidden = true;
    els.root.dataset.tip = `The mix measures ${shown.lufs.toFixed(1)} LUFS (EBU R128). A render aimed at a platform is leveled to its target.`;
  }
}

/**
 * What is heard has changed: measure again, after the edits settle. Called by
 * the stage whenever the layers, the sources or the length move.
 */
export function loudnessUpdate(
  layers: LayerValues,
  fps: number,
  length: number,
  track: CutTrack | null = null,
  /** The template's own sound and the wipes' (milestone 16), as the stage resolved them. */
  templateSounds: readonly { templateId: string; value: unknown; speed?: number }[] = [],
  /** The media slots' clips (milestone 22), whose own sound is in the mix as a video layer's is. */
  slotClips: readonly unknown[] = [],
): void {
  if (!els) return;
  const asked = ++generation;
  clearTimeout(timer);
  const request = soundRequest(layers);
  // The cut track's sound is part of the mix (milestone 49), so the meter measures it too.
  for (const cut of track ? trackAudio(track) : []) request.push({ kind: 'sound', value: cut.value, span: cut.span, ...(cut.speed !== undefined ? { speed: cut.speed } : {}) });
  // And the template's own sound (milestone 16), so the meter shows the mix the render levels.
  for (const own of templateSounds) request.push({ kind: 'template', templateId: own.templateId, value: own.value, ...(own.speed !== undefined ? { speed: own.speed } : {}) });
  for (const clip of slotClips) request.push({ kind: 'clip', value: clip });
  if (request.length === 0 || !(length > 0) || !(fps > 0)) {
    shown = null;
    paint();
    return;
  }
  timer = setTimeout(() => {
    void window.pulp.mixLoudness({ layers: request, fps, length }).then((answer) => {
      if (asked !== generation) return;
      shown = answer.lufs === null ? null : { lufs: answer.lufs, truePeakDb: answer.truePeakDb };
      paint();
    });
  }, MEASURE_DELAY_MS);
}

/** Another item is being shown: whatever was measured was of the last one. */
export function loudnessClear(): void {
  generation += 1;
  clearTimeout(timer);
  shown = null;
  paint();
}

export function initLoudness(): void {
  const byId = (id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing #${id}`);
    return el;
  };
  els = { root: byId('loudness'), fill: byId('loudness-fill'), target: byId('loudness-target') };
  // The notch follows the platform the session leans to, as the Output tab does.
  effect(() => {
    void preferredPlatform.value;
    paint();
  });
}
