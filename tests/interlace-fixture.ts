/**
 * Generated footage for deinterlacing (milestone 83), shared by the unit and
 * the end-to-end suites: a white box crossing a gray PAL frame, 720 × 576 at
 * 25 frames a second, either interlaced — 50 fields a second woven two to a
 * frame, top or bottom first — or progressive, the same motion caught once a
 * frame. Each can be written untagged (MPEG-4 Part 2, whose `field_order`
 * reads `unknown`) or tagged top field first (MPEG-2 with interlaced coding),
 * so a test can hold the frames against a tag that lies.
 *
 * And what a test measures in it: how combed a frame is, and where the box's
 * leading edge is.
 */

export const IL_WIDTH = 720;
export const IL_HEIGHT = 576;
export const IL_FPS = 25;
/** The box: this wide and tall, from this row, its left edge at `IL_X0 + IL_STEP × field`. */
export const IL_BOX = { width: 120, height: 400, top: 88 } as const;
export const IL_X0 = 40;
/** Pixels the box moves per field (a fiftieth of a second): 24 a frame, fast enough to comb plainly. */
export const IL_STEP = 12;

export type FixtureScan = 'tff' | 'bff' | 'progressive';

/**
 * ffmpeg's arguments for one fixture clip of `seconds`, written to `out`. The
 * interlaced ones are made at the field rate and woven by `tinterlace`; the
 * progressive one moves the same distance a frame at the frame rate.
 */
export function fixtureClipArgs(scan: FixtureScan, out: string, options: { seconds?: number; tagged?: boolean } = {}): string[] {
  const seconds = options.seconds ?? 2;
  const fieldRate = scan === 'progressive' ? IL_FPS : IL_FPS * 2;
  const step = scan === 'progressive' ? IL_STEP * 2 : IL_STEP;
  const weave = scan === 'tff' ? ',tinterlace=mode=interleave_top' : scan === 'bff' ? ',tinterlace=mode=interleave_bottom' : '';
  // Tagged top field first whatever it is, which is exactly the lie a progressive file can tell.
  const tag = options.tagged ? ',setfield=tff' : '';
  const codec = options.tagged ? ['-c:v', 'mpeg2video', '-flags', '+ilme+ildct', '-top', '1', '-q:v', '2'] : ['-c:v', 'mpeg4', '-qscale:v', '2'];
  return [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x404040:s=${IL_WIDTH}x${IL_HEIGHT}:r=${fieldRate}:d=${seconds}`,
    '-f', 'lavfi', '-i', `color=c=white:s=${IL_BOX.width}x${IL_BOX.height}:r=${fieldRate}:d=${seconds}`,
    '-filter_complex', `[0][1]overlay=x='${IL_X0}+${step}*n':y=${IL_BOX.top}:shortest=1${weave}${tag}`,
    ...codec,
    out,
  ];
}

/**
 * How combed a gray picture is: the mean, over every pixel, of how far it
 * stands out from both lines around it in the same direction — positive only
 * where a line is brighter, or darker, than both its neighbors, which is a
 * comb's tooth. A clean horizontal edge scores nothing, since one of its
 * neighbors is the line itself; the fixture combed reads in the hundreds, and
 * deinterlaced well under one.
 */
export function combScore(gray: Uint8Array, width: number, height: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const a = gray[y * width + x]!;
      const up = gray[(y - 1) * width + x]!;
      const down = gray[(y + 1) * width + x]!;
      sum += Math.max(0, (a - up) * (a - down));
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

/** Where the box's left edge is along one row of a gray picture: the first pixel past half-way to white. */
export function boxLeftEdge(gray: Uint8Array, width: number, row: number): number {
  for (let x = 0; x < width; x++) if (gray[row * width + x]! > 150) return x;
  return -1;
}
