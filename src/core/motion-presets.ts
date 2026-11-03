/**
 * Motion presets (milestone 55's third piece): a layer on the canvas given a
 * ready-made motion in one choice, built from nothing new — milestone 28's
 * entrances and exits for how it arrives and leaves, milestone 51's keyframes
 * and easing for how it moves while it is there. A preset *writes* those
 * fields; afterwards the layer is an ordinary layer with a transition and
 * keys, edited in the Parameters tab, moved on the stage, saved with the
 * work and, when the canvas is saved as a template, carried as its motion.
 *
 * Pure. `applyMotionPreset` is the only writer; `motionPresetOf` reads a layer
 * back to the preset it matches, so a control can show where it stands.
 */

import { DEFAULT_KEY_EASING, IDENTITY_KEY, sanitizeKeys, type LayerKey } from './layer-keys';
import { DEFAULT_TRANSITION, type LayerTransition, type LayerTransitions, type TransitionDirection } from './layer-time';
import type { Layer } from './layers';

export const MOTION_PRESETS = [
  { id: 'still', label: 'Still', note: 'Arrives and leaves with no movement at all.' },
  { id: 'fade', label: 'Fade in and out', note: 'The gentle default: half a second each way.' },
  { id: 'slide-left', label: 'Slide in from the left', note: 'Slides in from the left and fades out.' },
  { id: 'slide-right', label: 'Slide in from the right', note: 'Slides in from the right and fades out.' },
  { id: 'rise', label: 'Rise from below', note: 'Rises into place and fades out.' },
  { id: 'pop', label: 'Pop', note: 'Scales up into place and scales away.' },
  { id: 'wipe', label: 'Wipe on', note: 'Uncovered from the left, covered back the same way.' },
  { id: 'drift', label: 'Drift across', note: 'Fades, and drifts slowly to the right the whole time it is on.' },
  { id: 'pulse', label: 'Pulse', note: 'Fades, and swells a little in the middle of its time.' },
  { id: 'spin-in', label: 'Spin in', note: 'Turns and grows into place from nothing, then fades out.' },
] as const;

export type MotionPresetId = (typeof MOTION_PRESETS)[number]['id'];

export const MOTION_PRESET_IDS: readonly MotionPresetId[] = MOTION_PRESETS.map((p) => p.id);

export function isMotionPresetId(value: unknown): value is MotionPresetId {
  return typeof value === 'string' && (MOTION_PRESET_IDS as readonly string[]).includes(value);
}

/** The seconds a layer is on screen, which a keyed preset spreads its keys over. */
export interface MotionWindow {
  start: number;
  end: number;
}

/** How far a drift travels, as a fraction of the frame's width; how much a pulse swells. */
export const DRIFT_DISTANCE = 0.04;
export const PULSE_SCALE = 1.08;
/** How long a spin takes to settle, bounded by half the window so a short layer still lands. */
export const SPIN_SECONDS = 0.6;

const end = (type: LayerTransition['type'], direction: TransitionDirection = 'auto'): LayerTransition => ({ ...DEFAULT_TRANSITION, type, direction });

const fade: LayerTransitions = { in: end('fade'), out: end('fade') };

/** The entrance and exit each preset writes. */
export const PRESET_TRANSITIONS: Record<MotionPresetId, LayerTransitions> = {
  still: { in: end('none'), out: end('none') },
  fade,
  'slide-left': { in: end('slide', 'left'), out: end('fade') },
  'slide-right': { in: end('slide', 'right'), out: end('fade') },
  rise: { in: end('slide', 'bottom'), out: end('fade') },
  pop: { in: end('scale'), out: end('scale') },
  wipe: { in: end('wipe', 'left'), out: end('wipe', 'left') },
  drift: fade,
  pulse: fade,
  // The keys do the arriving: the layer turns and grows from nothing, so the entrance must not also fade it.
  'spin-in': { in: end('none'), out: end('fade') },
};

const key = (at: number, pose: Partial<Omit<LayerKey, 'at' | 'easing'>>, easing: LayerKey['easing'] = DEFAULT_KEY_EASING): LayerKey =>
  ({ at: Math.round(at * 1000) / 1000, ...IDENTITY_KEY, ...pose, easing });

/** The keys a preset writes over a window; none for the presets that are an entrance and an exit alone. */
export function presetKeys(id: MotionPresetId, window: MotionWindow): LayerKey[] {
  const start = Math.max(0, window.start);
  const finish = Math.max(start + 0.1, window.end);
  const span = finish - start;
  if (id === 'drift') return [key(start, { dx: -DRIFT_DISTANCE / 2 }, 'linear'), key(finish, { dx: DRIFT_DISTANCE / 2 }, 'linear')];
  if (id === 'pulse') return [key(start, {}), key(start + span / 2, { scale: PULSE_SCALE }), key(finish, {})];
  if (id === 'spin-in') return [key(start, { rotate: -90, scale: 0.6, opacity: 0 }, 'ease-out'), key(start + Math.min(SPIN_SECONDS, span / 2), {})];
  return [];
}

/**
 * The layer with the preset's motion: its transition and keys replaced by the
 * preset's (a preset is the whole motion, so what was there before goes), and
 * the look's opacity folded into the keys where a preset keys opacity, as the
 * Animate controls do. A sound has no motion and comes back untouched.
 */
export function applyMotionPreset(layer: Layer, id: MotionPresetId, window: MotionWindow): Layer {
  if (layer.type === 'audio') return layer;
  const next: Layer = { ...layer, transition: { in: { ...PRESET_TRANSITIONS[id].in }, out: { ...PRESET_TRANSITIONS[id].out } } };
  const keys = sanitizeKeys(presetKeys(id, window)) ?? [];
  if (keys.length > 0) {
    next.keys = keys;
    if (next.look && next.look.opacity !== 1) next.look = { ...next.look, opacity: 1 };
  } else {
    delete next.keys;
  }
  return next;
}

function sameEnd(a: LayerTransition, b: LayerTransition): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'none' || a.type === 'template') return true;
  const directed = a.type === 'slide' || a.type === 'wipe';
  return Math.abs(a.seconds - b.seconds) < 1e-6 && (!directed || a.direction === b.direction);
}

function sameKeys(a: readonly LayerKey[], b: readonly LayerKey[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((k, i) => {
    const o = b[i]!;
    return Math.abs(k.at - o.at) < 1e-3 && Math.abs(k.dx - o.dx) < 1e-6 && Math.abs(k.dy - o.dy) < 1e-6
      && Math.abs(k.scale - o.scale) < 1e-6 && Math.abs(k.rotate - o.rotate) < 1e-6 && Math.abs(k.opacity - o.opacity) < 1e-6 && k.easing === o.easing;
  });
}

/**
 * Which preset a layer stands at: the one whose transition and keys it carries
 * exactly, `'template'` while it rides the template's own movement with no keys,
 * and `'custom'` for anything a person has shaped by hand.
 */
export function motionPresetOf(layer: Layer, window: MotionWindow): MotionPresetId | 'template' | 'custom' {
  if (layer.type === 'audio') return 'custom';
  const keys = layer.keys ?? [];
  if (!layer.transition && keys.length === 0) return 'template';
  if (!layer.transition) return 'custom';
  for (const preset of MOTION_PRESETS) {
    const want = PRESET_TRANSITIONS[preset.id];
    if (!sameEnd(layer.transition.in, want.in) || !sameEnd(layer.transition.out, want.out)) continue;
    if (sameKeys(keys, presetKeys(preset.id, window))) return preset.id;
  }
  return 'custom';
}
