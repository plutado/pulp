import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, hasShadow, isDefaultLook, lookFromImageEffect, lookPixels, readLook, type LayerLook } from '../src/core/layer-look';

const look = (over: Partial<LayerLook> = {}): LayerLook => ({ ...DEFAULT_LOOK, ...over });

describe('how a layer looks (milestone 28)', () => {
  it('is the template\'s own draw until a layer says otherwise, and says so when put back', () => {
    expect(isDefaultLook(undefined)).toBe(true);
    expect(isDefaultLook(look())).toBe(true);
    expect(isDefaultLook(look({ opacity: 0.5 }))).toBe(false);
    // A shadow is drawn when it has a distance or a softness; a colour alone is nothing yet.
    expect(hasShadow(look({ shadowColor: '#ff0000' }))).toBe(false);
    expect(hasShadow(look({ shadowDistance: 0.01 }))).toBe(true);
    expect(hasShadow(look({ shadowSoftness: 0.01 }))).toBe(true);
  });

  it('reads a look against a base, field by field, and drops what comes to the default', () => {
    const issues: string[] = [];
    const issue = (field: string, message: string) => issues.push(`${field} ${message}`);
    expect(readLook(undefined, undefined, issue)).toBeUndefined();
    expect(readLook({ opacity: 1, blend: 'normal' }, undefined, issue)).toBeUndefined();
    const read = readLook({ opacity: 0.5, shadowDistance: 0.0123456, shadowColor: '#FF000080', blend: 'multiply', tint: '#00FF00' }, undefined, issue)!;
    expect(read).toMatchObject({ opacity: 0.5, shadowDistance: 0.0123, shadowColor: '#ff000080', blend: 'multiply', tint: '#00ff00' });
    expect(issues).toEqual([]);
    // Against a base, only what is named changes; null clears the lot.
    expect(readLook({ blur: 0.01 }, read, issue)).toMatchObject({ opacity: 0.5, blur: 0.01, blend: 'multiply' });
    expect(readLook(null, read, issue)).toBeUndefined();
    expect(readLook({ tint: null }, look({ tint: '#ff0000' }), issue)).toBeUndefined();
  });

  it('refuses a field it cannot use, naming it, and keeps the rest', () => {
    const issues: string[] = [];
    const read = readLook({ opacity: 2, blur: 0.01, blend: 'burn', shadowColor: 'red', brightness: 'bright', tint: 7 }, undefined, (f, m) => issues.push(f + ' ' + m));
    expect(read).toMatchObject({ opacity: 1, blur: 0.01, blend: 'normal' });
    expect(issues.map((i) => i.split(' ')[0])).toEqual(['look.opacity', 'look.shadowColor', 'look.blend', 'look.brightness', 'look.tint']);
    const wrong: string[] = [];
    expect(readLook('shiny', undefined, (f, m) => wrong.push(f + ' ' + m))).toBeUndefined();
    expect(wrong[0]).toContain('look must be an object');
  });

  it('comes to pixels of the frame: the shadow from its angle and distance, the rest as a filter', () => {
    const px = lookPixels(look({ shadowDistance: 0.01, shadowAngle: 90, shadowSoftness: 0.02, glowSize: 0.03, outlineWidth: 0.001, blur: 0.005, brightness: 0.2, saturation: 0, corners: 0.04, feather: 0.01, blend: 'screen' }), 1080);
    expect(px).toMatchObject({ shadowBlur: 21.6, glowBlur: 32.4, outlineWidth: 1.08, corners: 43.2, feather: 10.8, composite: 'screen' });
    // Straight down: no offset across, all of it down.
    expect(px.shadowOffsetX).toBeCloseTo(0, 5);
    expect(px.shadowOffsetY).toBeCloseTo(10.8, 5);
    expect(px.filter).toBe('blur(5.4px) brightness(1.2) saturate(0)');
    // To the right is 0, and nothing asked for is an empty filter and the normal composite.
    const right = lookPixels(look({ shadowDistance: 0.01, shadowAngle: 0 }), 1000);
    expect([right.shadowOffsetX, right.shadowOffsetY]).toEqual([10, 0]);
    expect(lookPixels(look(), 1080)).toMatchObject({ filter: '', composite: 'source-over' });
    // The same look is proportionally the same at every size.
    expect(lookPixels(look({ blur: 0.01 }), 2160).filter).toBe('blur(21.6px)');
  });

  it('reads milestone 22\'s picture effects as the looks they always drew as', () => {
    // A shadow fell straight down by a twenty-fifth of the picture's height and blurred by an eighth of it.
    expect(lookFromImageEffect('shadow', 0.25, '#ffffffd9')).toEqual({ shadowColor: '#00000073', shadowDistance: 0.01, shadowAngle: 90, shadowSoftness: 0.03 });
    expect(lookFromImageEffect('glow', 0.2, '#ff00ff')).toEqual({ glowColor: '#ff00ff', glowSize: 0.05 });
    expect(lookFromImageEffect('none', 0.2, '#ffffffd9')).toEqual({});
  });
});
