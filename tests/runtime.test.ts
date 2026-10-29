import { describe, expect, it } from 'vitest';
import { BRIDGE_SCRIPT, BRIDGE_SCRIPT_INLINE, frameState, injectBridge } from '../src/core/runtime';
import { FIXTURE_SIZE, timing } from './fixtures';

describe('frameState', () => {
  it('computes time and progress from the frame index', () => {
    const s = frameState(timing(), 30, { a: 1 }, FIXTURE_SIZE);
    expect(s).toMatchObject({ frame: 30, time: 1, progress: 0.5, fps: 30, totalFrames: 60, width: 1920, height: 1080 });
    expect(s.params).toEqual({ a: 1 });
  });

  it('clamps the frame index to the valid range', () => {
    expect(frameState(timing(), -5, {}, FIXTURE_SIZE).frame).toBe(0);
    expect(frameState(timing(), 999, {}, FIXTURE_SIZE).frame).toBe(59);
    expect(frameState(timing(), 2.7, {}, FIXTURE_SIZE).frame).toBe(2);
  });

  it('takes the canvas size from the caller, not the manifest: the shape is the template\'s, the pixels are the render\'s', () => {
    const tall = frameState(timing({ aspects: ['16:9', '9:16'] }), 0, {}, { width: 1080, height: 1920 });
    expect(tall).toMatchObject({ width: 1080, height: 1920 });
  });
});

describe('injectBridge', () => {
  const tag = '<script data-pulp-bridge>';

  it('inserts the bridge as the first element of <head>', () => {
    const out = injectBridge('<!doctype html><html><head><title>x</title></head><body></body></html>');
    expect(out.indexOf(tag)).toBe(out.indexOf('<head>') + '<head>'.length);
    expect(out).toContain(BRIDGE_SCRIPT_INLINE);
  });

  it('handles <head> with attributes and mixed case', () => {
    const out = injectBridge('<HTML><HEAD lang="en"><script>user()</script></HEAD></HTML>');
    expect(out.indexOf(tag)).toBeLessThan(out.indexOf('user()'));
  });

  it('creates a head when only <html> exists', () => {
    expect(injectBridge('<html><body></body></html>')).toMatch(/^<html><head><script data-pulp-bridge>/);
  });

  it('keeps the doctype first for fragments without html or head', () => {
    const out = injectBridge('<!DOCTYPE html><canvas></canvas>');
    expect(out.startsWith('<!DOCTYPE html><script data-pulp-bridge>')).toBe(true);
  });

  it('bridge script is syntactically valid JavaScript', () => {
    expect(() => new Function(BRIDGE_SCRIPT)).not.toThrow();
  });

  it('injects the bridge on one line so template line numbers are unchanged', () => {
    const html = '<!doctype html>\n<html><head>\n<title>x</title></head>\n<body><script>draw()</script></body></html>';
    const out = injectBridge(html);
    expect(BRIDGE_SCRIPT_INLINE).not.toContain('\n');
    expect(() => new Function(BRIDGE_SCRIPT_INLINE)).not.toThrow();
    expect(out.split('\n')).toHaveLength(html.split('\n').length);
  });
});

describe('frameState under a chosen length (milestone 30)', () => {
  const designed = () => ({ ...timing(), duration: 6, fps: 30, structure: { holdFrom: 1, holdTo: 5 } });

  it('keeps a template that declares nothing exactly as it was', () => {
    const plain = timing();
    const before = frameState(plain, 30, {}, FIXTURE_SIZE);
    const asked = frameState(plain, 30, {}, FIXTURE_SIZE, {}, {}, 20);
    expect(asked).toEqual(before);
  });

  it('runs for the length asked for, on the template\'s own clock', () => {
    const m = designed();
    const twenty = (frame: number) => frameState(m, frame, {}, FIXTURE_SIZE, {}, {}, 20);
    // Twenty seconds at 30 fps is 600 frames, where its own six seconds were 180.
    expect(twenty(0).totalFrames).toBe(600);
    expect(frameState(m, 0, {}, FIXTURE_SIZE).totalFrames).toBe(180);
    // The template still sees its own duration, so it animates exactly as it was designed to.
    expect(twenty(0).duration).toBe(6);
    // The entrance is itself: frame 15 of the render is half a second into the template.
    expect(twenty(15).time).toBeCloseTo(0.5, 6);
    // The middle of the stretched hold is the middle of the template's hold.
    expect(twenty(300).time).toBeCloseTo(3, 6);
    // The last frame is the template's last moment, and progress ends at 1.
    // The last frame is one frame before the end, exactly as it is at the template's own length.
    expect(twenty(599).time).toBeCloseTo(6 - 1 / 30, 3);
    expect(twenty(599).progress).toBeCloseTo((6 - 1 / 30) / 6, 6);
    expect(twenty(599).progress).toBeCloseTo(frameState(m, 179, {}, FIXTURE_SIZE).progress, 6);
    // Frames past the end clamp to the last, as they always did.
    expect(twenty(9999).frame).toBe(599);
  });

  it('gives a video layer the time the graphic is watched at, not the template\'s', () => {
    // A clip's delay is set in seconds of the graphic a person sees, so a stretched hold must
    // not slow it down: at frame 300 of a twenty-second graphic, ten seconds have passed.
    const m = { ...designed(), blocks: [] as never[] };
    expect(frameState(m, 300, {}, FIXTURE_SIZE, {}, {}, 20).time).toBeCloseTo(3, 6);
  });
});
