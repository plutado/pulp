import { describe, expect, it } from 'vitest';
import {
  resolveImageCell,
  boxFor,
  chosenImageIds,
  fitImage,
  imageIdsIn,
  imageRequests,
  imageSlots,
  isSlotBox,
  sanitizeImageValue,
  type ImageSlotParam,
} from '../src/core/image-slot';

const id = 'abcdefabcdefabcdefabcdef';
const other = '0123456789abcdef01234567';

describe('slot boxes', () => {
  it('accept fractions inside the frame and nothing else', () => {
    expect(isSlotBox({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isSlotBox({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 })).toBe(true);
    expect(isSlotBox({ x: 0.6, y: 0, width: 0.5, height: 0.5 })).toBe(false);
    expect(isSlotBox({ x: 0, y: 0, width: 0, height: 0.5 })).toBe(false);
    expect(isSlotBox({ x: '0', y: 0, width: 1, height: 1 })).toBe(false);
    expect(isSlotBox(null)).toBe(false);
  });

  it('pick the box for a shape: per aspect, then the default, then whatever is first', () => {
    const wide = { x: 0.05, y: 0.8, width: 0.1, height: 0.15 };
    const tall = { x: 0.06, y: 0.6, width: 0.2, height: 0.1 };
    expect(boxFor(wide, { width: 1920, height: 1080 })).toBe(wide);
    expect(boxFor({ '16:9': wide, '9:16': tall }, { width: 1080, height: 1920 })).toBe(tall);
    expect(boxFor({ '16:9': wide, default: tall }, { width: 1080, height: 1080 })).toBe(tall);
    expect(boxFor({ '16:9': wide }, { width: 1080, height: 1080 })).toBe(wide);
  });
});

describe('fitImage', () => {
  const box = { x: 100, y: 100, width: 200, height: 100 };

  it('contains a wide image in a wide box edge to edge, and a tall one centred', () => {
    expect(fitImage(box, 400, 200, 'contain', 'center', 0)).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    expect(fitImage(box, 100, 100, 'contain', 'center', 0)).toEqual({ x: 150, y: 100, width: 100, height: 100 });
  });

  it('covers the box, cropping, and keeps the margin clear', () => {
    expect(fitImage(box, 100, 100, 'cover', 'center', 0)).toEqual({ x: 100, y: 50, width: 200, height: 200 });
    // A 10% margin of the shorter side (100) is 10 px on every edge.
    expect(fitImage(box, 400, 200, 'contain', 'center', 0.1)).toEqual({ x: 120, y: 110, width: 160, height: 80 });
  });

  it('aligns a smaller image inside what is left', () => {
    expect(fitImage(box, 100, 100, 'contain', 'left', 0).x).toBe(100);
    expect(fitImage(box, 100, 100, 'contain', 'right', 0).x).toBe(200);
    expect(fitImage(box, 400, 100, 'contain', 'top', 0)).toEqual({ x: 100, y: 100, width: 200, height: 50 });
    expect(fitImage(box, 400, 100, 'contain', 'bottom-right', 0).y).toBe(150);
  });
});

describe('a hidden slot', () => {
  it('is a value of its own: kept, with the choice, and not the same as empty', () => {
    expect(sanitizeImageValue({ id, hidden: true })).toEqual({ id, treatment: 'original', tint: '#ffffff', effect: 'none', hidden: true });
    // Hidden with nothing ever chosen: the one value that carries no id.
    expect(sanitizeImageValue({ hidden: true })).toEqual({ id: null, treatment: 'original', tint: '#ffffff', effect: 'none', hidden: true });
    expect(sanitizeImageValue('hidden')).toMatchObject({ id: null, hidden: true });
    expect(sanitizeImageValue(`{"id":"${id}","hidden":true,"treatment":"white"}`)).toMatchObject({ id, hidden: true, treatment: 'white' });
    // Saying the slot is empty is `id: null`; an object that says only "not hidden" says nothing usable.
    expect(sanitizeImageValue({ id: null })).toBeNull();
    expect(sanitizeImageValue({ hidden: false })).toBeUndefined();
  });

  it('draws nothing: no image to hand over, and no fallback either', () => {
    const params = [{ id: 'logo', type: 'image', box: { x: 0, y: 0, width: 0.5, height: 0.5 }, fit: 'contain', align: 'center', margin: 0, fallbackText: 'name' }] as const;
    const size = { width: 1920, height: 1080 };
    const shown = imageSlots(params as never, { logo: id, name: 'Northwind' }, size).logo!;
    expect(shown).toMatchObject({ id, hidden: false, fallback: 'Northwind' });
    const hidden = imageSlots(params as never, { logo: { id, hidden: true }, name: 'Northwind' }, size).logo!;
    expect(hidden).toMatchObject({ id: null, hidden: true, fallback: null });
    // Nothing is requested, granted or stamped for it.
    expect(imageRequests({ logo: hidden })).toEqual([]);
    expect(chosenImageIds({ logo: hidden })).toEqual([]);
    expect(imageIdsIn(params as never, { logo: { id, hidden: true } })).toEqual([]);
  });

  it('keeps the slot\'s box, so a design can still lay out around it', () => {
    const params = [{ id: 'logo', type: 'image', box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, fit: 'contain', align: 'center', margin: 0 }] as const;
    const slot = imageSlots(params as never, { logo: 'hidden' }, { width: 1000, height: 1000 }).logo!;
    expect(slot.box).toEqual({ x: 100, y: 200, width: 300, height: 400 });
  });
});

describe('image values and slot state', () => {
  const slot: ImageSlotParam = { id: 'logo', type: 'image', box: { x: 0.5, y: 0.5, width: 0.25, height: 0.25 }, fit: 'cover', align: 'top-left', margin: 0.1, fallbackText: 'name' };
  const params = [{ id: 'name', type: 'text' }, slot, { id: 'accent', type: 'color' }];

  it('read a library id or an object, and nothing path-like', () => {
    expect(sanitizeImageValue(id)).toEqual({ id, treatment: 'original', tint: '#ffffff', effect: 'none', hidden: false });
    expect(sanitizeImageValue({ id, treatment: 'black', effect: 'shadow' })).toMatchObject({ id, treatment: 'black', effect: 'shadow' });
    expect(sanitizeImageValue(null)).toBeNull();
    expect(sanitizeImageValue('')).toBeNull();
    expect(sanitizeImageValue('C:\\\\logos\\\\mark.png')).toBeUndefined();
    expect(sanitizeImageValue({ id: 'pulp-media://x/' })).toBeUndefined();
    // From the command line or a CSV cell, an object arrives as text.
    expect(sanitizeImageValue(`{"id":"${id}","treatment":"white"}`)).toMatchObject({ id, treatment: 'white' });
    expect(sanitizeImageValue('{not json')).toBeUndefined();
  });

  it('lay every slot out in pixels for the frame, with the chosen image or the fallback', () => {
    const empty = imageSlots(params, { name: 'Acme' }, { width: 1920, height: 1080 });
    expect(empty.logo).toEqual({ id: null, treatment: 'original', tint: '#ffffff', effect: 'none', fit: 'cover', align: 'top-left', margin: 0.1, box: { x: 960, y: 540, width: 480, height: 270 }, fallback: 'Acme', hidden: false });
    const chosen = imageSlots(params, { name: 'Acme', logo: { id, treatment: 'tinted', tint: '#ff8800', effect: 'glow' } }, { width: 1080, height: 1920 });
    expect(chosen.logo).toMatchObject({ id, treatment: 'tinted', tint: '#ff8800', effect: 'glow', box: { x: 540, y: 960, width: 270, height: 480 } });
    expect(Object.keys(chosen)).toEqual(['logo']);
  });

  it('resolve a CSV cell: an id or a value as is, a file name against the Imported folder, else nothing', () => {
    const imported = [{ name: 'Acme Logo.png', id }, { name: 'mark.svg', id: other }];
    expect(resolveImageCell(id, imported)).toMatchObject({ id });
    expect(resolveImageCell(`{"id":"${other}","treatment":"white"}`, imported)).toMatchObject({ id: other, treatment: 'white' });
    expect(resolveImageCell('acme logo.png', imported)).toMatchObject({ id, treatment: 'original' });
    expect(resolveImageCell('Acme Logo', imported)).toMatchObject({ id });
    expect(resolveImageCell('MARK', imported)).toMatchObject({ id: other });
    expect(resolveImageCell('', imported)).toBeNull();
    expect(resolveImageCell('nothing.png', imported)).toBeUndefined();
    expect(resolveImageCell('/Users/dana/logo.png', imported)).toBeUndefined();
  });

  it('name the images to decode once per id and treatment, and the ids to grant', () => {
    const two = [slot, { ...slot, id: 'mark' }, { ...slot, id: 'bug' }];
    const slots = imageSlots(two, { logo: id, mark: { id, treatment: 'white' }, bug: other }, { width: 100, height: 100 });
    expect(imageRequests(slots)).toEqual([
      { id, treatment: 'original', tint: '#ffffff' },
      { id, treatment: 'white', tint: '#ffffff' },
      { id: other, treatment: 'original', tint: '#ffffff' },
    ]);
    expect(chosenImageIds(slots)).toEqual([id, other]);
    expect(chosenImageIds(imageSlots(two, {}, { width: 100, height: 100 }))).toEqual([]);
  });
});
