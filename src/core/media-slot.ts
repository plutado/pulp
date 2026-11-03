/**
 * Media slots (milestone 22's last item): a box in the layout that a chosen
 * library clip **plays** inside, frame-accurately, inside the template's own
 * animation — a plate behind a title, footage inside a frame. The image slot's
 * shape (src/core/image-slot.ts: a box, a fit, an alignment, a margin, placed
 * by the template's author) with the video layer's playback (src/core/
 * video-layer.ts: an in and an out point in clip frames, loop or play once, a
 * speed and a start delay — and the clip's own sound, mixed as a layer's is).
 *
 * The same rule as images (ADR 0013): the value is a library id with how it
 * plays, never a path; the host decodes exactly the window the slot plays and
 * hands the page those frames, so a template never holds a URL into the
 * library. The host also decides which frame belongs to each moment, with the
 * very arithmetic a video layer uses — so a slot and a layer playing the same
 * clip show the same frame — and the template only draws what it is handed.
 *
 * Pure: the slots laid out for a frame, the clips chosen, the ids for grants
 * and cache keys, and how tall a slot draws its clip, for the decode.
 */

import { boxFor, type ImageAlign, type ImageFit, type PxBox, type SlotBoxes } from './image-slot';
import type { Size } from './aspect';
import { clipWindowIndexAt, sanitizeClipValue, type ClipSource, type ClipValue } from './video-layer';

/** The manifest fields this module reads, so it can take a validated parameter without importing the manifest types. */
export interface MediaSlotParam {
  id: string;
  type: 'media';
  box: SlotBoxes;
  fit: ImageFit;
  align: ImageAlign;
  margin: number;
}

/** What a template is told about one media slot for one frame; the bridge finds the decoded frame by the clip's id. */
export interface MediaSlotState {
  /** The chosen clip, or null when the slot is empty or hidden. */
  id: string | null;
  /**
   * Which frame of the decoded window shows at this moment, or null while the
   * slot plays nothing: before its start delay, after a clip that plays once
   * has ended, or with no clip chosen. The template then draws its fallback.
   */
  frame: number | null;
  fit: ImageFit;
  align: ImageAlign;
  margin: number;
  /** The slot's box in pixels of this frame. */
  box: PxBox;
  /** The slot is kept but not drawn, and the design closes the space up. */
  hidden: boolean;
}

/**
 * Every media slot a template has, laid out for this frame size at this
 * moment of the graphic. `time` is the elapsed second as the graphic is
 * watched — a clip plays against what a person sees, however a hold is
 * stretched, exactly as a video layer does — and `sources` is what the host
 * measured about each clip; a clip not measured yet plays nothing until it is.
 */
export function mediaSlots(
  parameters: readonly { id: string; type: string }[],
  values: Record<string, unknown>,
  size: Size,
  time: number,
  sources: Readonly<Record<string, ClipSource>> = {},
): Record<string, MediaSlotState> {
  const slots: Record<string, MediaSlotState> = {};
  for (const param of parameters) {
    if (param.type !== 'media') continue;
    const p = param as MediaSlotParam;
    const value = sanitizeClipValue(values[p.id]) ?? null;
    const hidden = value?.hidden === true;
    const id = hidden ? null : value?.id ?? null;
    const source = id ? sources[id] : undefined;
    const frac = boxFor(p.box, size);
    slots[p.id] = {
      id,
      frame: id && value && source ? clipWindowIndexAt(time, value, source) : null,
      fit: p.fit,
      align: p.align,
      margin: p.margin,
      box: { x: frac.x * size.width, y: frac.y * size.height, width: frac.width * size.width, height: frac.height * size.height },
      hidden,
    };
  }
  return slots;
}

/** The clips the slots have chosen and play: one entry per slot with a clip, carrying the slot's id. */
export function mediaSlotChoices(
  parameters: readonly { id: string; type: string }[],
  values: Record<string, unknown>,
): (ClipValue & { id: string; slot: string })[] {
  const out: (ClipValue & { id: string; slot: string })[] = [];
  for (const param of parameters) {
    if (param.type !== 'media') continue;
    const value = sanitizeClipValue(values[param.id]);
    if (!value?.id || value.hidden) continue;
    out.push({ ...(value as ClipValue & { id: string }), slot: param.id });
  }
  return out;
}

/** The clip ids a media-slot value set names, in a stable order, for cache keys and grants. */
export function mediaIdsIn(parameters: readonly { id: string; type: string }[], values: Record<string, unknown>): string[] {
  return [...new Set(mediaSlotChoices(parameters, values).map((c) => c.id))].sort();
}

/**
 * How tall, in pixels of the frame, a slot draws its clip: what to decode it
 * at. `contain` never draws taller than the box; `cover` may scale the picture
 * past the box's height to fill its width, so the longer side bounds it.
 */
export function mediaSlotDrawnHeight(slot: Pick<MediaSlotState, 'box' | 'fit'>, frameHeight: number): number {
  const tallest = slot.fit === 'cover' ? Math.max(slot.box.height, slot.box.width) : slot.box.height;
  return Math.max(16, Math.min(frameHeight, Math.round(tallest)));
}
