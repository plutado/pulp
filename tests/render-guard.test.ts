import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureBytesMessage,
  captureSizeMessage,
  expandSequence,
  formatTemplateError,
  frameCallScript,
  frameTimeoutMessage,
  loadTimeoutMessage,
  partialOutputFiles,
  RenderTimeoutError,
  templateThrewMessage,
  withTimeout,
} from '../src/core/render-guard';
import { frameState } from '../src/core/runtime';
import { timing } from './fixtures';

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('passes through a value that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 100, 'slow')).resolves.toBe(7);
  });

  it('passes through a rejection that arrives in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100, 'slow')).rejects.toThrow('boom');
  });

  it('rejects with RenderTimeoutError when the promise never settles', async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise(() => undefined), 500, 'frame 3 timed out');
    const check = expect(result).rejects.toSatisfy((e) => e instanceof RenderTimeoutError && e.message === 'frame 3 timed out');
    await vi.advanceTimersByTimeAsync(500);
    await check;
  });

  it('clears its timer once settled', async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve(1), 500, 'x');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('frameCallScript', () => {
  const state = frameState(timing(), 4, { title: 'a "quoted" </script>' });

  /** Run the script against a fake bridge whose render behaves as given. */
  function run(render: () => Promise<unknown>): Promise<unknown> {
    const window = { __pulp: { render } };
    return new Function('window', `return ${frameCallScript(state)};`)(window) as Promise<unknown>;
  }

  it('embeds the frame state as JSON', () => {
    expect(frameCallScript(state)).toContain(JSON.stringify(state));
  });

  it('resolves to null when the frame renders', async () => {
    await expect(run(() => Promise.resolve(true))).resolves.toBeNull();
  });

  it('turns a thrown Error into data instead of rejecting', async () => {
    const err = new TypeError('ctx is null');
    err.stack = 'TypeError: ctx is null\n    at draw (pulp-template://com.example.x/index.html:12:5)';
    await expect(run(() => Promise.reject(err))).resolves.toEqual({ name: 'TypeError', message: 'ctx is null', stack: err.stack });
  });

  it('handles non-Error rejections', async () => {
    await expect(run(() => Promise.reject('nope'))).resolves.toEqual({ message: 'nope' });
  });
});

describe('formatTemplateError', () => {
  it('includes the error type and the first location inside the template', () => {
    const stack = [
      'TypeError: ctx is null',
      '    at draw (pulp-template://com.example.lower-third/js/draw%20me.js:12:5)',
      '    at window.pulpRender (pulp-template://com.example.lower-third/index.html:40:3)',
    ].join('\n');
    expect(formatTemplateError({ name: 'TypeError', message: 'ctx is null', stack })).toBe('TypeError: ctx is null (js/draw me.js:12:5)');
  });

  it('omits the generic Error name and a missing location', () => {
    expect(formatTemplateError({ name: 'Error', message: 'bad param', stack: 'Error: bad param\n    at <anonymous>:1:1' })).toBe('bad param');
  });

  it('never returns an empty message', () => {
    expect(formatTemplateError({})).toBe('unknown error');
  });
});

describe('messages', () => {
  it('name the template and frame', () => {
    expect(templateThrewMessage('Title Card', 12, { message: 'oops' })).toBe('Template "Title Card" threw an error on frame 12: oops');
    expect(frameTimeoutMessage('Title Card', 3, 10_000)).toMatch(/^Template "Title Card" did not finish frame 3 within 10 s\./);
    expect(frameTimeoutMessage('Title Card', 3, 2500)).toContain('within 2.5 s');
    expect(loadTimeoutMessage('Title Card', 30_000)).toBe('Template "Title Card" did not finish loading within 30 s.');
  });
});

describe('expandSequence', () => {
  it('expands zero-padded patterns from frame 0', () => {
    expect(expandSequence('/out/wipe_%05d.png', 3)).toEqual(['/out/wipe_00000.png', '/out/wipe_00001.png', '/out/wipe_00002.png']);
  });

  it('expands unpadded patterns', () => {
    expect(expandSequence('f%d.png', 11).at(-1)).toBe('f10.png');
  });

  it('starts at the first frame of a trimmed render', () => {
    expect(expandSequence('/out/a_%05d.png', 3, 60)).toEqual(['/out/a_00060.png', '/out/a_00061.png', '/out/a_00062.png']);
  });

  it('returns a path without a pattern unchanged', () => {
    expect(expandSequence('/out/a.png', 5)).toEqual(['/out/a.png']);
  });
});

describe('partialOutputFiles', () => {
  const base = { sequence: false, totalFrames: 3, overwrite: true, existedBefore: new Set<string>() };

  it('removes a single output file', () => {
    expect(partialOutputFiles({ ...base, output: '/out/a.mov' })).toEqual(['/out/a.mov']);
  });

  it('removes only the frames of this render for sequences', () => {
    expect(partialOutputFiles({ ...base, sequence: true, output: '/out/a_%05d.png' })).toEqual([
      '/out/a_00000.png',
      '/out/a_00001.png',
      '/out/a_00002.png',
    ]);
  });

  it('numbers sequence files from the first frame', () => {
    expect(partialOutputFiles({ ...base, sequence: true, firstFrame: 60, output: '/out/a_%05d.png' })).toEqual([
      '/out/a_00060.png',
      '/out/a_00061.png',
      '/out/a_00062.png',
    ]);
  });

  it('keeps files that existed before when not overwriting', () => {
    const existedBefore = new Set(['/out/a.mov', '/out/b_00001.png']);
    expect(partialOutputFiles({ ...base, overwrite: false, existedBefore, output: '/out/a.mov' })).toEqual([]);
    expect(partialOutputFiles({ ...base, sequence: true, overwrite: false, existedBefore, output: '/out/b_%05d.png' })).toEqual([
      '/out/b_00000.png',
      '/out/b_00002.png',
    ]);
  });

  it('removes files that existed before when the user chose to overwrite them', () => {
    const existedBefore = new Set(['/out/a.mov']);
    expect(partialOutputFiles({ ...base, existedBefore, output: '/out/a.mov' })).toEqual(['/out/a.mov']);
  });
});

describe('captureSizeMessage', () => {
  it('names the template, frame, both sizes and the scale', () => {
    expect(captureSizeMessage('Lower Third', 0, { width: 1920, height: 1080 }, { width: 3840, height: 2160 })).toBe(
      'Template "Lower Third" frame 0 was captured at 3840x2160 instead of 1920x1080 (scale 2). ' +
        'Pulp renders offscreen at device scale 1 and does not resize captured frames.',
    );
  });

  it('rounds fractional scales', () => {
    expect(captureSizeMessage('T', 3, { width: 320, height: 180 }, { width: 480, height: 270 })).toContain('(scale 1.5)');
  });

  it('omits the scale when the aspect ratio changed (clamped window)', () => {
    const message = captureSizeMessage('T', 0, { width: 7680, height: 4320 }, { width: 7680, height: 2000 });
    expect(message).toContain('captured at 7680x2000 instead of 7680x4320. ');
    expect(message).not.toContain('(scale');
  });
});

describe('captureBytesMessage', () => {
  it('names the template, frame and both byte counts', () => {
    expect(captureBytesMessage('T', 2, 8_294_400, 8_355_840)).toBe(
      'Template "T" frame 2 produced 8355840 bytes of pixel data instead of 8294400. ' +
        'Raw frames must be tightly packed 32-bit BGRA; use --frame-format png as a workaround.',
    );
  });
});
