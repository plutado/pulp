import { describe, expect, it } from 'vitest';
import {
  ASPECTS,
  AspectError,
  aspectOf,
  defaultAspect,
  inferAspect,
  orientationOf,
  resolutionsFor,
  resolveRenderSize,
  templateDefaultSize,
} from '../src/core/aspect';

describe('the aspect list', () => {
  it('has four shapes, each with even standard sizes of that shape and a 1080-class default', () => {
    expect(ASPECTS.map((a) => a.id)).toEqual(['16:9', '9:16', '1:1', '4:5']);
    for (const a of ASPECTS) {
      expect(a.resolutions.length).toBeGreaterThanOrEqual(4);
      for (const r of a.resolutions) {
        expect(r.width % 2, `${a.id} ${r.label}`).toBe(0);
        expect(r.height % 2, `${a.id} ${r.label}`).toBe(0);
        expect(aspectOf(r.width, r.height), `${a.id} ${r.label}`).toBe(a.id);
      }
      expect(a.default.label).toBe('1080p');
      expect(a.resolutions).toContain(a.default);
    }
  });
});

describe('aspectOf', () => {
  it('names the built-in shapes, within a percent, and reduces anything else', () => {
    expect(aspectOf(1920, 1080)).toBe('16:9');
    expect(aspectOf(1366, 768)).toBe('16:9');
    expect(aspectOf(64, 36)).toBe('16:9');
    expect(aspectOf(1080, 1920)).toBe('9:16');
    expect(aspectOf(1080, 1080)).toBe('1:1');
    expect(aspectOf(1080, 1350)).toBe('4:5');
    expect(aspectOf(640, 480)).toBe('4:3');
    expect(aspectOf(1920, 1200)).toBe('8:5');
    expect(inferAspect(640, 480)).toBeNull();
    expect(inferAspect(0, 480)).toBeNull();
  });

  it('tells orientation apart', () => {
    expect(orientationOf(1920, 1080)).toBe('landscape');
    expect(orientationOf(1080, 1920)).toBe('portrait');
    expect(orientationOf(720, 720)).toBe('square');
  });
});

describe('a template\'s defaults', () => {
  it('uses the declared size where there is one, else the first aspect\'s 1080-class size', () => {
    expect(templateDefaultSize({ aspects: ['16:9'], size: { width: 1280, height: 720 } })).toEqual({ width: 1280, height: 720 });
    expect(templateDefaultSize({ aspects: ['9:16', '16:9'] })).toEqual({ width: 1080, height: 1920 });
    expect(templateDefaultSize({ aspects: ['4:5'] })).toEqual({ width: 1080, height: 1350 });
    expect(defaultAspect({ aspects: ['16:9', '9:16'], size: { width: 1080, height: 1920 } })).toBe('9:16');
    expect(defaultAspect({ aspects: ['1:1', '16:9'] })).toBe('1:1');
  });

  it('offers the standard sizes for a built-in aspect and only its own size for a custom one', () => {
    expect(resolutionsFor({ aspects: ['9:16'] }, '9:16').map((r) => r.label)).toEqual(['720p', '1080p', '1440p', '4K']);
    const legacy = { aspects: ['4:3'], size: { width: 640, height: 480 } };
    expect(resolutionsFor(legacy, '4:3')).toEqual([{ label: '640 × 480', width: 640, height: 480 }]);
    expect(resolutionsFor(legacy, '16:9')).toEqual(ASPECTS[0]!.resolutions);
    expect(resolutionsFor({ aspects: ['16:9'] }, '4:3')).toEqual([]);
  });
});

describe('resolveRenderSize', () => {
  const multi = { aspects: ['16:9', '9:16', '1:1'] };
  const legacy = { aspects: ['16:9'], size: { width: 1280, height: 720 } };

  it('defaults to the declared size, else the first aspect at 1080-class', () => {
    expect(resolveRenderSize(legacy)).toEqual({ aspect: '16:9', width: 1280, height: 720 });
    expect(resolveRenderSize(multi)).toEqual({ aspect: '16:9', width: 1920, height: 1080 });
    expect(resolveRenderSize({ aspects: ['4:5'] })).toEqual({ aspect: '4:5', width: 1080, height: 1350 });
  });

  it('takes an aspect the template draws for, at that aspect\'s default size', () => {
    expect(resolveRenderSize(multi, { aspect: '9:16' })).toEqual({ aspect: '9:16', width: 1080, height: 1920 });
    expect(resolveRenderSize(multi, { aspect: '1:1' })).toEqual({ aspect: '1:1', width: 1080, height: 1080 });
  });

  it('takes an exact size, inferring the aspect when none is named', () => {
    expect(resolveRenderSize(multi, { width: 720, height: 720 })).toEqual({ aspect: '1:1', width: 720, height: 720 });
    expect(resolveRenderSize(multi, { aspect: '9:16', width: 2160, height: 3840 })).toEqual({ aspect: '9:16', width: 2160, height: 3840 });
    // A declared size is only a default for its own aspect; another aspect falls back to the standard size.
    expect(resolveRenderSize({ aspects: ['16:9', '9:16'], size: { width: 1280, height: 720 } }, { aspect: '9:16' })).toEqual({ aspect: '9:16', width: 1080, height: 1920 });
    // A custom size of a built-in aspect still counts as that aspect.
    expect(resolveRenderSize(multi, { width: 1366, height: 768 })).toEqual({ aspect: '16:9', width: 1366, height: 768 });
  });

  it('refuses what the template does not draw for, and sizes that are not of the aspect', () => {
    expect(() => resolveRenderSize(legacy, { aspect: '9:16' })).toThrow(AspectError);
    expect(() => resolveRenderSize(legacy, { aspect: '9:16' })).toThrow(/aspect 9:16 is not one the template draws for \(16:9\)/);
    expect(() => resolveRenderSize(multi, { aspect: '4:5' })).toThrow(/16:9, 9:16, 1:1/);
    expect(() => resolveRenderSize(multi, { width: 640, height: 480 })).toThrow(/aspect 4:3 is not one/);
    expect(() => resolveRenderSize(multi, { aspect: '16:9', width: 1080, height: 1920 })).toThrow(/1080 × 1920 is 9:16, not 16:9/);
  });

  it('refuses half a size and sizes outside the renderer\'s range', () => {
    expect(() => resolveRenderSize(multi, { width: 1920 })).toThrow(/together/);
    expect(() => resolveRenderSize(multi, { width: 8, height: 4.5 })).toThrow(/width must be a whole number of pixels between 16 and 8192/);
    expect(() => resolveRenderSize(multi, { width: 16384, height: 9216 })).toThrow(/width must be/);
    expect(() => resolveRenderSize(multi, { width: 1920, height: 1080.5 })).toThrow(/height must be/);
  });
});
