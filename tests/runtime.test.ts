import { describe, expect, it } from 'vitest';
import { BRIDGE_SCRIPT, frameState, injectBridge } from '../src/core/runtime';
import { timing } from './fixtures';

describe('frameState', () => {
  it('computes time and progress from the frame index', () => {
    const s = frameState(timing(), 30, { a: 1 });
    expect(s).toMatchObject({ frame: 30, time: 1, progress: 0.5, fps: 30, totalFrames: 60, width: 1920, height: 1080 });
    expect(s.params).toEqual({ a: 1 });
  });

  it('clamps the frame index to the valid range', () => {
    expect(frameState(timing(), -5, {}).frame).toBe(0);
    expect(frameState(timing(), 999, {}).frame).toBe(59);
    expect(frameState(timing(), 2.7, {}).frame).toBe(2);
  });
});

describe('injectBridge', () => {
  const tag = '<script data-pulp-bridge>';

  it('inserts the bridge as the first element of <head>', () => {
    const out = injectBridge('<!doctype html><html><head><title>x</title></head><body></body></html>');
    expect(out.indexOf(tag)).toBe(out.indexOf('<head>') + '<head>'.length);
    expect(out).toContain(BRIDGE_SCRIPT);
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
});
