# 0005. HEVC with alpha through VideoToolbox, fed 4:4:4 Y'CbCr

Date: 2026-10-22
Status: Accepted

## Context

HEVC with an alpha layer is the small-file alpha format for Final Cut Pro, Premiere Pro and recent macOS apps. ffmpeg can write it only through Apple's `hevc_videotoolbox` encoder, which exists in macOS builds alone. The encoder accepts alpha in two input layouts: packed BGRA, or packed 4:4:4 Y'CbCr with alpha (`ayuv`).

## Decision

- Preset `hevc-alpha`, labelled "HEVC (alpha, macOS only)". Quality 80 and alpha quality 0.9, fixed. Stream tag `hvc1`, which Apple's players require.
- The frames are converted to Y'CbCr with alpha by the renderer's own Rec.709 steps (ADR 0004) and handed to the encoder as `ayuv`, not as BGRA.
- On Windows and Linux the preset is shown as unavailable with the reason, and refused at render time.

## Reasons

- **Tags.** From BGRA, VideoToolbox converts internally and writes `colr` with primaries 1, transfer 1, matrix 0: the matrix is left unspecified. A decoder that falls back to BT.601 then reads pure red as (233, 0, 1). From `ayuv` the file carries BT.709 for all three (verified: `nclc` 1/1/1) and decodes pure red as (253, 0, 0).
- **One conversion path.** Every Y'CbCr preset now converts with the same `scale` matrix and range and the same tags. VideoToolbox gets no say in color.
- **Quality 80 / alpha 0.9.** Measured on the 180-frame 1080p lower third: quality 50 gives 50.2 dB PSNR at 0.24 MB, 65 gives 53.3 dB at 0.27 MB, 80 gives 54.4 dB at 0.31 MB, 90 gives 54.9 dB at 0.38 MB (ProRes 4444: 70 dB at 15.7 MB). Returns flatten above 80. Alpha quality 1.0 adds about half again to the file for the alpha layer; 0.5 saves a quarter and softens edges.

## Costs

- The `ayuv` input is 8-bit 4:4:4; the encoder subsamples to 4:2:0 internally, as it would from BGRA. No loss added by our conversion.
- ffmpeg decodes the HEVC alpha layer from 8.0 on; older builds return only the base layer. The end-to-end test skips its alpha assertion in that case and says so.
- Verification inside editing apps is still pending (milestone 2); the format is what they document, but it has not been imported here yet.

## Revisit if

- An editing app rejects or misreads `ayuv`-sourced files where BGRA-sourced ones work, or
- a cross-platform HEVC-with-alpha encoder appears in ffmpeg, which would remove the macOS-only limit.
