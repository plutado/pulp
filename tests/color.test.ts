import { describe, expect, it } from 'vitest';
import { alphaToPercent, joinColor, parseColorText, percentToAlpha, splitColor, toCssRgba } from '../src/core/color';

describe('color values', () => {
  it('parses and normalizes hex colors with and without alpha', () => {
    expect(parseColorText('#111827D9')).toBe('#111827d9');
    expect(parseColorText('FF0000')).toBe('#ff0000');
    expect(parseColorText(' #abcdef ')).toBe('#abcdef');
    expect(parseColorText('#fff')).toBeNull();
    expect(parseColorText('red')).toBeNull();
    expect(parseColorText('#11182')).toBeNull();
  });

  it('splits into the RGB part and an alpha byte', () => {
    expect(splitColor('#111827d9')).toEqual({ rgb: '#111827', alpha: 217 });
    expect(splitColor('#ffffff')).toEqual({ rgb: '#ffffff', alpha: 255 });
    expect(splitColor('#00000000')).toEqual({ rgb: '#000000', alpha: 0 });
    expect(splitColor('garbage')).toEqual({ rgb: '#000000', alpha: 255 });
  });

  it('joins back, dropping the suffix only when opaque', () => {
    expect(joinColor('#111827', 217)).toBe('#111827d9');
    expect(joinColor('#111827', 255)).toBe('#111827');
    expect(joinColor('#111827', 0)).toBe('#11182700');
    expect(joinColor('#ABCDEF', 128)).toBe('#abcdef80');
    expect(joinColor('#111827', 300)).toBe('#111827');
    expect(joinColor('#111827', -4)).toBe('#11182700');
    for (const hex of ['#111827d9', '#ff0000', '#00ff0080']) {
      const { rgb, alpha } = splitColor(hex);
      expect(joinColor(rgb, alpha)).toBe(hex);
    }
  });

  it('converts alpha to and from percent', () => {
    expect(alphaToPercent(255)).toBe(100);
    expect(alphaToPercent(217)).toBe(85);
    expect(alphaToPercent(128)).toBe(50);
    expect(percentToAlpha(85)).toBe(217);
    expect(percentToAlpha(50)).toBe(128);
    expect(percentToAlpha(0)).toBe(0);
    expect(percentToAlpha(150)).toBe(255);
  });

  it('gives a CSS color for swatches', () => {
    expect(toCssRgba('#111827d9')).toBe('rgba(17, 24, 39, 0.851)');
    expect(toCssRgba('#ff0000')).toBe('rgba(255, 0, 0, 1.000)');
  });
});
