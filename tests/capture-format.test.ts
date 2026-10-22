import { describe, expect, it } from 'vitest';
import {
  CAPTURE_PROBE_HTML,
  CAPTURE_PROBE_SIZE,
  CAPTURE_PROBE_URL,
  classifyCapture,
  describeCaptureFormat,
  describeProbePixels,
} from '../src/core/capture-format';

/** A probe bitmap: left half `red`, right half `blue`, each as 4 bytes in the layout under test. */
function probe(red: number[], blue: number[]): Uint8Array {
  const n = CAPTURE_PROBE_SIZE;
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) out.set(x < n / 2 ? red : blue, (y * n + x) * 4);
  }
  return out;
}

describe('classifyCapture', () => {
  it('recognises premultiplied BGRA (Chromium on macOS)', () => {
    expect(classifyCapture(probe([0, 0, 128, 128], [255, 0, 0, 255]))).toEqual({ pixelFormat: 'bgra', premultiplied: true });
  });

  it('recognises straight BGRA', () => {
    expect(classifyCapture(probe([0, 0, 255, 128], [255, 0, 0, 255]))).toEqual({ pixelFormat: 'bgra', premultiplied: false });
  });

  it('recognises premultiplied and straight RGBA', () => {
    expect(classifyCapture(probe([128, 0, 0, 128], [0, 0, 255, 255]))).toEqual({ pixelFormat: 'rgba', premultiplied: true });
    expect(classifyCapture(probe([255, 0, 0, 128], [0, 0, 255, 255]))).toEqual({ pixelFormat: 'rgba', premultiplied: false });
  });

  it('tolerates rounding in the half-alpha pixel', () => {
    expect(classifyCapture(probe([0, 0, 127, 127], [255, 0, 0, 255]))?.premultiplied).toBe(true);
    expect(classifyCapture(probe([0, 0, 130, 128], [255, 0, 0, 255]))?.premultiplied).toBe(true);
    expect(classifyCapture(probe([0, 0, 254, 128], [255, 0, 0, 255]))?.premultiplied).toBe(false);
  });

  it('returns null for anything else', () => {
    // Opaque window: the half-transparent pixel came back opaque.
    expect(classifyCapture(probe([0, 0, 255, 255], [255, 0, 0, 255]))).toBeNull();
    // Neither premultiplied nor straight.
    expect(classifyCapture(probe([0, 0, 200, 128], [255, 0, 0, 255]))).toBeNull();
    // Color bleeding into other channels.
    expect(classifyCapture(probe([40, 0, 128, 128], [255, 0, 0, 255]))).toBeNull();
    // Unknown byte order.
    expect(classifyCapture(probe([0, 128, 0, 128], [0, 255, 0, 255]))).toBeNull();
    // Too short.
    expect(classifyCapture(new Uint8Array(16))).toBeNull();
  });
});

describe('probe page and descriptions', () => {
  it('draws half-transparent red on the left and opaque blue on the right', () => {
    const s = CAPTURE_PROBE_SIZE;
    expect(s).toBeGreaterThanOrEqual(64); // above the Windows minimum window size
    expect(CAPTURE_PROBE_HTML).toContain(`fillStyle='rgba(255,0,0,0.5)';x.fillRect(0,0,${s / 2},${s})`);
    expect(CAPTURE_PROBE_HTML).toContain(`fillStyle='rgb(0,0,255)';x.fillRect(${s / 2},0,${s / 2},${s})`);
    expect(CAPTURE_PROBE_URL.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(CAPTURE_PROBE_URL.split(',')[1]!)).toBe(CAPTURE_PROBE_HTML);
  });

  it('describes formats and probe pixels', () => {
    expect(describeCaptureFormat({ pixelFormat: 'bgra', premultiplied: true })).toBe('bgra, premultiplied alpha');
    expect(describeCaptureFormat({ pixelFormat: 'rgba', premultiplied: false })).toBe('rgba, straight alpha');
    expect(describeProbePixels(probe([0, 0, 128, 128], [255, 0, 0, 255]))).toBe(
      'half-transparent red read as [0, 0, 128, 128], opaque blue as [255, 0, 0, 255]',
    );
  });
});
