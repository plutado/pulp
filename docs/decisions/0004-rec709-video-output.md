# 0004. Video output is Rec.709, limited range; PNG stays sRGB

Date: 2026-10-22
Status: Accepted

## Context

Templates draw with Canvas 2D, whose default color space is sRGB, and the renderer captures sRGB pixels. The video presets (ProRes 4444, ProRes 422 HQ, H.264, VP9) store Y'CbCr, so the pixels are converted and the file should say how. Until now the output carried no color information at all: ffprobe reported range, matrix, transfer and primaries as unknown, and ffmpeg converted RGB to Y'CbCr with its BT.601 default. Editors and players assume BT.709 for HD, so a pure red decoded as about (255, 25, 0): a visible hue shift on every saturated color.

## Decision

- The four video presets convert with the BT.709 matrix to limited (video) range, and every frame is tagged BT.709 primaries, BT.709 transfer, BT.709 matrix, limited range. The muxers write this as the `colr` atom in .mov and .mp4 (and H.264 VUI), and as the Colour element in WebM.
- The PNG sequence preset stays full-range sRGB RGBA and carries no video tags.
- When an alpha template is flattened over a background color for a non-alpha preset, the background is treated as sRGB like the template pixels: compositing happens in RGB and the Rec.709 conversion runs on the composite, so both go through the same step.
- Fixed behavior, not a setting.

In ffmpeg terms: `scale=out_color_matrix=bt709:out_range=tv`, then `setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`, then the preset's `format`. The `format` filter sits last so the `scale` step is the one doing the conversion, with the matrix and range above.

## Reasons

- **Limited range BT.709 is what editing and broadcast delivery expect for HD.** Premiere Pro, DaVinci Resolve and Final Cut Pro interpret untagged HD as BT.709 limited; matching that, and saying so in the file, means what the template author saw is what the editor sees.
- **BT.709 transfer tag rather than the strictly accurate sRGB tag.** The pixels follow the sRGB curve, and H.273 has a code for it (13, IEC 61966-2-1). But QuickTime's documented `nclc` vocabulary does not include it: Apple Technical Note TN2162 lists transfer function 1 (BT.709), 7 (SMPTE 240M) and 2 (unknown), and marks 8 and above as reserved, so AVFoundation-based software and most editors treat an sRGB tag as unknown or ignore it. The BT.709 and sRGB curves differ mainly in the darkest tones, far less than an unknown-matrix hue shift, and tagging BT.709 is the convention for sRGB-authored graphics delivered as video.
- **Tags set on frames, not only as encoder options.** ffmpeg 7 and later take color properties from the frames leaving the filter graph. `-color_primaries` and friends alone left transfer and primaries unknown in the test files; `setparams` on the frames set all four in every container, and the MOV `colr` atom appeared without the experimental `write_colr` flag.
- **Composite before convert.** Blending in Y'CbCr would mix the background color under a different matrix than the template pixels. Compositing in RGB and converting once keeps the background exact (verified: 0x102030 decodes as (16, 32, 49)).

## Costs

- Any pipeline that wants the exact sRGB curve honored end to end would need the sRGB transfer tag. A setting for sRGB-tagged output (`color_trc=iec61966-2-1`) can be added later; it is a one-line change in the tag constant. Not needed by the editors this project targets today.
- Limited range costs about 12% of code values compared to full range. This is the delivery standard and what editors expect; full-range Y'CbCr is often mishandled.
- A `scale` and `setparams` step per frame. The scale step replaces the conversion ffmpeg inserted anyway; no measurable cost.

## Revisit if

- A target editor or platform is shown to honor the sRGB transfer tag and to render BT.709-tagged graphics visibly wrong, or
- HDR or wide-gamut templates are wanted, which would need Canvas color space support (`display-p3`, `rec2100-pq`) end to end.
