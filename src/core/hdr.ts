/**
 * HDR clips made ready to use (milestone 81): what makes a file HDR, and the
 * one ffmpeg recipe that brings it to standard range wherever its pixels are
 * read.
 *
 * **Why at all.** Phones record HDR by default — an iPhone writes HLG, most
 * Android phones HLG or PQ — and such a file handed to a standard-range
 * pipeline comes out washed out and flat, since its code values mean far more
 * light than the pipeline thinks. Pulp draws, composites and writes in
 * standard range throughout, so an HDR clip is converted on the way in.
 *
 * **Recognized by the file's own tags**, not guessed from the codec or the
 * bit depth: a transfer function of `smpte2084` (PQ, what HDR10 and Dolby
 * Vision's base layer carry) or `arib-std-b67` (HLG). Anything else is
 * standard range and is left exactly alone, as it always was.
 *
 * **Converted on the way in, never in place.** The original file is never
 * written to, re-encoded or moved: the steps below join the filter chain that
 * already reads the clip — the preview's proxy frames, the render's cut track,
 * an item rendered on its own — so what the library holds is the camera's own
 * file, and the HDR is still there if the clip is used somewhere else.
 *
 * **Needs zimg.** `zscale` is libavfilter's binding to zimg, which not every
 * ffmpeg build carries; `hasTonemapping` reads the filter list for it, and
 * without it the clip is read as it is and the person is told why rather than
 * being handed a silently darker picture.
 */

/** The two HDR transfer functions in the wild, as a file tags itself. */
export type HdrFormat = 'pq' | 'hlg';

/** The transfer each one is written as — ffprobe's `color_transfer`, and zscale's `tin`. */
export const HDR_TRANSFERS: Readonly<Record<HdrFormat, string>> = {
  pq: 'smpte2084',
  hlg: 'arib-std-b67',
};

/** How a file's transfer tag may be spelled; ffprobe says `smpte2084`, some containers `smpte-st-2084`. */
const TRANSFER_NAMES: Readonly<Record<string, HdrFormat>> = {
  smpte2084: 'pq',
  'smpte-st-2084': 'pq',
  'smpte-st2084': 'pq',
  pq: 'pq',
  'arib-std-b67': 'hlg',
  'arib_std_b67': 'hlg',
  hlg: 'hlg',
};

/** Which HDR a `color_transfer` names, or undefined for standard range (and for nothing at all). */
export function hdrFromTransfer(transfer: string | undefined): HdrFormat | undefined {
  if (!transfer) return undefined;
  return TRANSFER_NAMES[transfer.trim().toLowerCase()];
}

/**
 * The light level the picture is mapped against, in nits: standard range's
 * own reference white. A PQ file says what light its code values mean, so
 * 100 puts diffuse white where a standard-range screen puts it and leaves the
 * highlights above it for the tone curve to pull down.
 */
export const TONEMAP_PEAK_NITS = 100;

/**
 * The steps that bring an HDR picture to Rec. 709, in front of whatever the
 * caller does next (its own `format=`, its scale, its grade). One recipe for
 * every path — the preview's frames, the render's cut track, an item rendered
 * on its own — so a clip cannot look like one thing while playing and another
 * when written.
 *
 * Linear light first (`zscale` undoes the PQ or HLG curve), then the gamut to
 * Rec. 709, then Hable's curve for the range itself — it holds the midtones
 * where the eye expects a face to be and rolls the highlights off rather than
 * clipping them — and back to a Rec. 709 picture. The input's transfer,
 * matrix and primaries are stated rather than read: a phone's HDR is BT.2020
 * throughout, and a file whose frames carry no tags would otherwise stop the
 * conversion dead.
 */
export function tonemapSteps(hdr: HdrFormat): string[] {
  return [
    `zscale=tin=${HDR_TRANSFERS[hdr]}:min=bt2020nc:pin=bt2020:t=linear:npl=${TONEMAP_PEAK_NITS}`,
    // The tone curve works in floating-point RGB; anything less bands in the sky.
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
  ];
}

/** The same as one `-vf` fragment, ending in a comma, for a chain built as a string. */
export function tonemapPrefix(hdr: HdrFormat | undefined): string {
  return hdr ? `${tonemapSteps(hdr).join(',')},` : '';
}

/**
 * Whether this ffmpeg can convert HDR at all, from `ffmpeg -hide_banner
 * -filters`: zimg's `zscale` for the color conversions and `tonemap` for the
 * curve. Read from the build actually in use, which Settings can change.
 */
export function hasTonemapping(filtersOutput: string): boolean {
  return /\bzscale\b/.test(filtersOutput) && /\btonemap\b/.test(filtersOutput);
}
