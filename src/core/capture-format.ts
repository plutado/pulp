/**
 * Capture format calibration. The raw frame path sends the capture's own
 * bitmap to ffmpeg, so it must know the byte order and whether the colors are
 * premultiplied by alpha. Electron documents the bitmap format as
 * platform-dependent, so instead of assuming, the renderer draws this probe
 * page in an offscreen window, captures it and classifies the bytes. Pure;
 * the main process does the capturing.
 */

export interface CaptureFormat {
  /** Byte order of each pixel, as ffmpeg names it. */
  pixelFormat: 'bgra' | 'rgba';
  /** True if color channels are already multiplied by alpha. */
  premultiplied: boolean;
}

/**
 * Probe window size. Windows enforces a minimum window size even for frameless
 * windows (a 16x16 probe came back as 32x39 on windows-latest), so the probe is
 * large enough to be honored everywhere. 256 KB of pixels, once per process.
 */
export const CAPTURE_PROBE_SIZE = 256;

/** Left half: red at 50% alpha. Right half: opaque blue. */
export const CAPTURE_PROBE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}canvas{display:block}</style></head>' +
  `<body><canvas id="c" width="${CAPTURE_PROBE_SIZE}" height="${CAPTURE_PROBE_SIZE}"></canvas><script>` +
  "var x=document.getElementById('c').getContext('2d');" +
  `x.fillStyle='rgba(255,0,0,0.5)';x.fillRect(0,0,${CAPTURE_PROBE_SIZE / 2},${CAPTURE_PROBE_SIZE});` +
  `x.fillStyle='rgb(0,0,255)';x.fillRect(${CAPTURE_PROBE_SIZE / 2},0,${CAPTURE_PROBE_SIZE / 2},${CAPTURE_PROBE_SIZE});` +
  '</script></body></html>';

export const CAPTURE_PROBE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(CAPTURE_PROBE_HTML)}`;

/** Sample points: the center of each half, far from the edges. */
const HALF_RED = { x: CAPTURE_PROBE_SIZE / 4, y: CAPTURE_PROBE_SIZE / 2 };
const OPAQUE_BLUE = { x: (CAPTURE_PROBE_SIZE * 3) / 4, y: CAPTURE_PROBE_SIZE / 2 };

function pixelAt(bytes: Uint8Array, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [bytes[i] ?? -1, bytes[i + 1] ?? -1, bytes[i + 2] ?? -1, bytes[i + 3] ?? -1];
}

const near = (value: number, target: number, tolerance: number) => Math.abs(value - target) <= tolerance;

/** Work out the capture format from the probe bitmap, or null if the bytes fit neither known layout. */
export function classifyCapture(bytes: Uint8Array, width = CAPTURE_PROBE_SIZE): CaptureFormat | null {
  if (bytes.length < width * CAPTURE_PROBE_SIZE * 4) return null;
  const blue = pixelAt(bytes, width, OPAQUE_BLUE.x, OPAQUE_BLUE.y);
  const red = pixelAt(bytes, width, HALF_RED.x, HALF_RED.y);
  if (!near(blue[3], 255, 1)) return null;

  let pixelFormat: CaptureFormat['pixelFormat'];
  if (near(blue[0], 255, 1) && near(blue[1], 0, 1) && near(blue[2], 0, 1)) pixelFormat = 'bgra';
  else if (near(blue[2], 255, 1) && near(blue[1], 0, 1) && near(blue[0], 0, 1)) pixelFormat = 'rgba';
  else return null;

  const alpha = red[3];
  if (!near(alpha, 128, 8)) return null;
  const redIndex = pixelFormat === 'bgra' ? 2 : 0;
  const others = [0, 1, 2].filter((i) => i !== redIndex);
  if (!others.every((i) => near(red[i]!, 0, 2))) return null;
  const value = red[redIndex]!;
  if (near(value, alpha, 3)) return { pixelFormat, premultiplied: true };
  if (value >= 250) return { pixelFormat, premultiplied: false };
  return null;
}

export function describeCaptureFormat(format: CaptureFormat): string {
  return `${format.pixelFormat}, ${format.premultiplied ? 'premultiplied' : 'straight'} alpha`;
}

/** What the probe pixels read as, for the warning when classification fails. */
export function describeProbePixels(bytes: Uint8Array, width = CAPTURE_PROBE_SIZE): string {
  const red = pixelAt(bytes, width, HALF_RED.x, HALF_RED.y);
  const blue = pixelAt(bytes, width, OPAQUE_BLUE.x, OPAQUE_BLUE.y);
  return `half-transparent red read as [${red.join(', ')}], opaque blue as [${blue.join(', ')}]`;
}
