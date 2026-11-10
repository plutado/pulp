/**
 * Generated footage for the flash warning (milestone 84), shared by the unit
 * and end-to-end suites: lavfi `geq` pictures whose brightness follows an
 * expression of the frame number, so a test knows to the frame where a strobe
 * starts and stops and how fast it goes.
 */

/** A clip's size and rate: small, since the check reads a 32 × 32 grid of it anyway. */
export const FL_WIDTH = 160;
export const FL_HEIGHT = 90;
export const FL_FPS = 30;

/**
 * The picture's value at frame N as a `geq` expression: `dark` everywhere,
 * and `light` on the on-frames of a strobe of `hz` flashes a second between
 * `from` and `to` seconds — whole frame, or only `area` of it (a box at the
 * left, its share of the width). A flash is one light-and-dark cycle.
 */
export function strobeExpr(o: { hz: number; from: number; to: number; dark?: number; light?: number; area?: number }): string {
  const period = FL_FPS / o.hz;
  const dark = o.dark ?? 16;
  const light = o.light ?? 235;
  const box = o.area !== undefined ? `*lt(X,${Math.round(FL_WIDTH * o.area)})` : '';
  return `if(between(N,${Math.round(o.from * FL_FPS)},${Math.round(o.to * FL_FPS) - 1})*lt(mod(N,${period}),${period / 2})${box},${light},${dark})`;
}

/**
 * ffmpeg's arguments for a gray clip of `seconds` whose brightness follows `expr`, with a tone under
 * it: H.264, or MPEG-4 Part 2 where a suite's own searches count the H.264 clips in its library.
 */
export function grayClipArgs(expr: string, seconds: number, out: string, codec: 'h264' | 'mpeg4' = 'h264'): string[] {
  return [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${FL_WIDTH}x${FL_HEIGHT}:r=${FL_FPS}:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-vf', `geq=lum='${expr}':cb=128:cr=128`,
    ...(codec === 'h264' ? ['-c:v', 'libx264', '-crf', '12'] : ['-c:v', 'mpeg4', '-qscale:v', '2']), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
  ];
}

/**
 * ffmpeg's arguments for a clip alternating between two RGB colors — `a` on the
 * on-frames of a strobe of `hz` a second, `b` otherwise — as QuickTime
 * Animation, which keeps the colors exact.
 */
export function colorStrobeArgs(a: [number, number, number], b: [number, number, number], hz: number, seconds: number, out: string): string[] {
  const period = FL_FPS / hz;
  const on = `lt(mod(N,${period}),${period / 2})`;
  return [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${FL_WIDTH}x${FL_HEIGHT}:r=${FL_FPS}:d=${seconds}`,
    '-vf', `format=rgb24,geq=r='if(${on},${a[0]},${b[0]})':g='if(${on},${a[1]},${b[1]})':b='if(${on},${a[2]},${b[2]})'`,
    '-c:v', 'qtrle', out,
  ];
}

/** ffmpeg's arguments for a white square flashing on and off over transparency, as QuickTime Animation with alpha. */
export function alphaStrobeArgs(hz: number, seconds: number, out: string): string[] {
  const period = FL_FPS / hz;
  return [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=white:s=${FL_WIDTH}x${FL_HEIGHT}:r=${FL_FPS}:d=${seconds}`,
    '-vf', `format=rgba,geq=r=255:g=255:b=255:a='if(lt(mod(N,${period}),${period / 2}),255,0)'`,
    '-c:v', 'qtrle', '-pix_fmt', 'argb', out,
  ];
}
