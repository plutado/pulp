# 0008. Straight alpha in every preset; no premultiplied export option for now

Date: 2026-10-23
Status: Accepted

## Context

Milestone 2 asked what Chromium captures, what each editing app expects, and whether a straight/premultiplied export setting is needed. The capture side was settled earlier: `toBitmap()` returns premultiplied pixels (measured per platform by a probe), and every alpha preset is written with straight alpha, unpremultiplied in ffmpeg and tagged for ffmpeg 8.1 and later. On 2026-10-23 the files were imported into Premiere Pro 2026 (26.5.2) and DaVinci Resolve Studio 20.2.3 on macOS and measured against an ffmpeg straight-alpha reference (`docs/nle-verification.md`).

## What the apps do

- **ProRes 4444 and PNG sequences**: both apps read them as straight by default and composite them correctly, pixel for pixel over black.
- **QuickTime Animation**: Premiere correct by default. Resolve's Data Levels "Auto" treated the file as video range and scaled the alpha by about 255/235 (red 140 for 128); Data Levels set to Full fixes it. The file carried no color metadata; it now carries a `colr` atom with the GBR matrix and BT.709 primaries and transfer, which is how a QuickTime reader is told the data is full-range RGB (MOV has no range flag for RGB codecs). Whether Resolve's Auto honors it is to be re-checked.
- **HEVC with alpha**: Premiere does not read the alpha layer at all and decodes with video levels; no setting helps. Resolve defaults the clip to Premultiplied, which clips semi-transparent areas toward white over black; Alpha Mode set to Straight makes it correct.
- **WebM VP9 with alpha**: Premiere cannot import WebM. Resolve imports it with the alpha effectively binarized and offers only None and Premultiplied; nothing fixes it. This looks like a decoding problem, not an interpretation problem.
- Premiere's default **Composite in Linear Color** blends semi-transparent pixels in linear light (50% red over black reads 191, not 128). The alpha is still read correctly; this is expected behavior, not a bug in the files.

## Decision

Keep writing straight alpha in every preset. Do not add a premultiplied export option now.

## Reasons

- Straight is what the formats specify and what both apps assume for ProRes 4444, PNG and QuickTime Animation, the presets that matter for editing. An option would add a way to make those files wrong.
- The one case where premultiplied output would help, HEVC in Resolve, is a Resolve default for a format Premiere cannot read at all, and Final Cut Pro, the main consumer of HEVC with alpha, has not been tested. Changing HEVC's alpha before that check could fix Resolve and break Final Cut.
- WebM's problem in Resolve would not be solved by premultiplying.
- The remaining differences are documented as per-app caveats with the setting that fixes each, which is what an editor's user needs.

## Costs

- A Resolve user importing Pulp's HEVC must set Alpha Mode to Straight once per clip (or by selecting all). Documented.
- QuickTime Animation in Resolve may still need Data Levels: Full if the new `colr` atom is not enough; to be confirmed.

## Revisit if

- Final Cut Pro turns out to read Pulp's HEVC alpha as premultiplied too, which would make a premultiplied HEVC variant the better default for that preset, or
- an editing app is shown to need premultiplied ProRes or PNG, which none did here.
