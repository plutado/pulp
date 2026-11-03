/**
 * Media slots (milestone 22): a box a chosen library clip plays inside,
 * frame-accurately — the image slot's shape with the video layer's playback.
 * The slot states per frame, the clips chosen, the ids for grants and cache
 * keys, the decode height, the manifest's reading of the parameter, and how a
 * value resolves from a project, the command line and a CSV cell.
 */

import { describe, expect, it } from 'vitest';
import { PARAMETER_TYPES, validateManifest } from '../src/core/manifest';
import { mediaIdsIn, mediaSlotChoices, mediaSlotDrawnHeight, mediaSlots } from '../src/core/media-slot';
import { resolveParams } from '../src/core/params';
import { frameState } from '../src/core/runtime';
import { EMPTY_CLIP, type ClipSource } from '../src/core/video-layer';
import { rawManifest, validManifest } from './fixtures';

const plate = { id: 'plate', type: 'media', label: 'Plate', box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, fit: 'contain', align: 'center', margin: 0 } as const;
const size = { width: 320, height: 180 };
/** A one-second, 30 fps clip. */
const source: ClipSource = { frames: 30, fps: 30 };

describe('the slots for a frame', () => {
  it('lays the box out in pixels and names the decoded frame that belongs to the moment', () => {
    const slots = mediaSlots([plate], { plate: { ...EMPTY_CLIP, id: 'c1' } }, size, 0.5, { c1: source });
    expect(slots.plate).toMatchObject({ id: 'c1', frame: 15, fit: 'contain', align: 'center', hidden: false });
    expect(slots.plate!.box).toEqual({ x: 80, y: 45, width: 160, height: 90 });
  });

  it('follows the trim, the loop and the once-through exactly as a video layer does', () => {
    const trimmed = { ...EMPTY_CLIP, id: 'c1', inPoint: 10, outPoint: 19 };
    // A ten-frame window: frame 9 of the graphic is the window's last, frame 10 loops round.
    expect(mediaSlots([plate], { plate: trimmed }, size, 9 / 30, { c1: source }).plate!.frame).toBe(9);
    expect(mediaSlots([plate], { plate: trimmed }, size, 10 / 30, { c1: source }).plate!.frame).toBe(0);
    // Played once, it is over after its window.
    const once = { ...trimmed, ending: 'once' as const };
    expect(mediaSlots([plate], { plate: once }, size, 10 / 30, { c1: source }).plate!.frame).toBeNull();
    // A start delay holds it back: nothing before, the first frame at the moment it starts.
    const delayed = { ...EMPTY_CLIP, id: 'c1', delay: 0.5 };
    expect(mediaSlots([plate], { plate: delayed }, size, 0.4, { c1: source }).plate!.frame).toBeNull();
    expect(mediaSlots([plate], { plate: delayed }, size, 0.5, { c1: source }).plate!.frame).toBe(0);
  });

  it('plays nothing with no clip, with a hidden one, or with a clip the host has not measured', () => {
    expect(mediaSlots([plate], {}, size, 0).plate).toMatchObject({ id: null, frame: null, hidden: false });
    expect(mediaSlots([plate], { plate: { ...EMPTY_CLIP, id: 'c1', hidden: true } }, size, 0, { c1: source }).plate).toMatchObject({ id: null, frame: null, hidden: true });
    expect(mediaSlots([plate], { plate: { ...EMPTY_CLIP, id: 'c1' } }, size, 0).plate).toMatchObject({ id: 'c1', frame: null });
  });

  it('names the clips chosen and their ids, for the grant and the cache key', () => {
    const values = { plate: { ...EMPTY_CLIP, id: 'c1', inPoint: 3 }, other: 'x' };
    const choices = mediaSlotChoices([plate, { id: 'other', type: 'text' }], values);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ id: 'c1', inPoint: 3, slot: 'plate' });
    expect(mediaIdsIn([plate], values)).toEqual(['c1']);
    expect(mediaIdsIn([plate], { plate: { ...EMPTY_CLIP, id: 'c1', hidden: true } })).toEqual([]);
  });

  it('decodes at the box\'s height for contain, and at its longer side for cover', () => {
    const box = { x: 0, y: 0, width: 320, height: 90 };
    expect(mediaSlotDrawnHeight({ box, fit: 'contain' }, 180)).toBe(90);
    expect(mediaSlotDrawnHeight({ box, fit: 'cover' }, 180)).toBe(180);
    expect(mediaSlotDrawnHeight({ box: { x: 0, y: 0, width: 4, height: 4 }, fit: 'contain' }, 180)).toBe(16);
  });
});

describe('the manifest', () => {
  it('knows the media type, fills its defaults, and has no default value', () => {
    expect(PARAMETER_TYPES).toContain('media');
    const result = validateManifest(rawManifest({ parameters: [{ id: 'plate', type: 'media', label: 'Plate', box: { x: 0, y: 0, width: 1, height: 1 } }] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.parameters[0]).toMatchObject({ type: 'media', default: null, fit: 'contain', align: 'center', margin: 0 });
  });

  it('refuses a default, a bad box, a bad fit and a margin out of range, by path', () => {
    const bad = (over: Record<string, unknown>) => {
      const r = validateManifest(rawManifest({ parameters: [{ id: 'plate', type: 'media', label: 'Plate', box: { x: 0, y: 0, width: 1, height: 1 }, ...over }] }));
      return r.ok ? [] : r.errors.map((e) => e.path);
    };
    expect(bad({ default: 'c1' })).toContain('parameters[0].default');
    expect(bad({ box: { x: 2 } })[0]).toContain('parameters[0].box');
    expect(bad({ fit: 'stretch' })).toContain('parameters[0].fit');
    expect(bad({ margin: 0.9 })).toContain('parameters[0].margin');
  });
});

describe('the value', () => {
  const manifest = validManifest({ parameters: [{ id: 'plate', type: 'media', label: 'Plate', box: { x: 0, y: 0, width: 1, height: 1 } }] });

  it('resolves from an object, from JSON on the command line, and from a CSV cell\'s text form', () => {
    expect(resolveParams(manifest, { plate: { id: 'c1', inPoint: 4, ending: 'once' } }).values.plate).toMatchObject({ id: 'c1', inPoint: 4, ending: 'once' });
    expect(resolveParams(manifest, { plate: '{"id":"c1","inPoint":10,"outPoint":19}' }).values.plate).toMatchObject({ id: 'c1', inPoint: 10, outPoint: 19 });
    expect(resolveParams(manifest, { plate: 'c1 in=2 out=8 ending=once delay=0.5' }).values.plate).toMatchObject({ id: 'c1', inPoint: 2, outPoint: 8, ending: 'once', delay: 0.5 });
    expect(resolveParams(manifest, { plate: 'c1' }).values.plate).toMatchObject({ id: 'c1' });
  });

  it('is nothing by default, and falls back to nothing with an issue for garbage', () => {
    expect(resolveParams(manifest, {}).values.plate).toBeNull();
    const r = resolveParams(manifest, { plate: 42 });
    expect(r.values.plate).toBeNull();
    expect(r.issues[0]?.id).toBe('plate');
  });

  it('reaches the page in the frame state, with the frame for the elapsed moment', () => {
    const state = frameState(manifest, 15, { plate: { ...EMPTY_CLIP, id: 'c1' } }, size, {}, { c1: source });
    expect(state.media.plate).toMatchObject({ id: 'c1', frame: 15 });
  });
});
