# Alpha in editing apps: what is established, what to verify

Status: the renderer side is settled and tested. The import side was checked on 2026-10-23 in Premiere Pro 2026 (26.5.2) and DaVinci Resolve Studio 20.2.3 on macOS 26.5.1, against frames the apps exported and an ffmpeg straight-alpha reference; results are below. Final Cut Pro and Windows (Premiere Pro, Resolve) are not tested yet. The decision that follows from the results is ADR 0008.

## What is established

- **Chromium captures premultiplied pixels.** `capturePage().toBitmap()` returns colors already multiplied by alpha, in BGRA byte order on macOS and on Windows CI. The renderer does not assume this: before the first raw render it draws a probe page and classifies the bytes (`src/core/capture-format.ts`), and headless mode prints the result as `frames: raw (bgra, premultiplied alpha)`.
- **Every alpha preset is written with straight (unpremultiplied) alpha.** The raw path undoes the premultiplication in ffmpeg (`format=gbrap,unpremultiply=inplace=1`), tagged for ffmpeg 8.1 and later so the graph does not guess; the PNG path's encoder does the same implicitly. An end-to-end test compares a white panel at 85% alpha between the two paths: 255 on both, where premultiplied pixels would read 217.
- **The formats themselves expect straight alpha.** ProRes 4444 stores an unassociated alpha channel. PNG alpha is unassociated by definition. QuickTime Animation (ARGB) and HEVC's alpha auxiliary layer are likewise straight. WebM VP9 carries alpha as a separate plane, straight. So the files are internally consistent; what remains is how each app reads them.
- **Color** is Rec.709 limited range for the Y'CbCr presets and sRGB full range for PNG and QuickTime Animation (ADR 0004). Inside an app, semi-transparent colors should match the template's values when composited over black.

## How a misread looks

| App assumes | File is | What you see |
|---|---|---|
| premultiplied | straight | Edges and semi-transparent areas too bright over dark backgrounds, clipping toward white; the 50% white patch over black reads well above 128. |
| straight | premultiplied | Dark fringes on anti-aliased edges and text; the alpha ramp darkens toward the transparent end; the 50% white patch over black reads below 128. |

Our files are straight, so the second row is what an app that defaults to premultiplied (or that mis-detects) would show.

## Test files

Render the alpha check template once per alpha preset. From the repository root, with the app built (`npm run build`):

```sh
L=tests/e2e/templates
npx electron . --render pulp.test.alpha-check --preset prores-4444    --out renders/alpha-check.mov        --library $L
npx electron . --render pulp.test.alpha-check --preset png-sequence   --out renders/alpha-check-png/frame  --library $L
npx electron . --render pulp.test.alpha-check --preset webm-vp9-alpha --out renders/alpha-check.webm       --library $L
npx electron . --render pulp.test.alpha-check --preset qt-animation   --out renders/alpha-check-anim.mov   --library $L
npx electron . --render pulp.test.alpha-check --preset hevc-alpha     --out renders/alpha-check-hevc.mov   --library $L   # macOS
npx electron . --render pulp.samples.lower-third-bar --preset prores-4444 --out renders/lower-third.mov
```

The template (`tests/e2e/templates/alpha-check`) draws, on a transparent background: a white alpha ramp from 0% to 100% with an opaque tick at the 50% mark; 50% patches of red, green, blue, white and black; 1px white hairlines; and moving amber text with the frame number. `renders/` is ignored by git.

## Checklist, per app

Do this in Premiere Pro, DaVinci Resolve and Final Cut Pro, for each file above. Put each clip on a track above a solid black background and, separately, above a solid white one. Then check:

1. **Import.** The file imports as video with alpha; the app does not ask for or force an alpha interpretation. Note the default interpretation it reports (Premiere Pro: Modify, Interpret Footage, Alpha Channel; Resolve: Clip Attributes, Alpha Mode; Final Cut Pro: shown in the inspector).
2. **Ramp over black.** A plain gray gradient from black to white. Sample at the tick: about 50% gray (128 of 255 or 0.5). Not darker toward the left, not clipped toward the right.
3. **Ramp over white.** Stays white edge to edge.
4. **50% patches over black.** Red reads about (128, 0, 0), white about (128, 128, 128), black stays black. Over white: red about (255, 128, 128).
5. **Hairlines and text.** Clean anti-aliased edges, no dark or bright fringe, over both backgrounds.
6. **Motion.** Scrub: the frame number advances by one per frame, the text moves smoothly, no duplicated or dropped frames (60 frames at 30 fps, 2 seconds).
7. **Color.** The amber text is `#f59e0b`; over black it should sample close to (245, 158, 11) where fully opaque.
8. **Lower third.** The sample's panel is `#111827` at 85%: over black it should read about (14, 20, 33); over white about (53, 59, 71). Text edges clean.

If a step fails only after switching the app's alpha interpretation, record which setting makes it pass. If the app needs the opposite interpretation for a format, that is the case for adding an export setting (milestone 2, straight versus premultiplied).

## Results (2026-10-23)

Method: each test file on V2 over a black solid for the first half and a white solid for the second; each app exported the timeline as PNG frames; values are 5x5 averages at the ramp (x 940, alpha 49%, 125 expected over black), the 50% red patch (290, 400), the 50% black patch (1650, 400) and the lower-third panel (124, 845), compared with the same frame composited in ffmpeg with straight alpha (red (128, 0, 0) over black, (255, 127, 127) over white; panel (14, 20, 32) and (52, 58, 70)). Both apps render the white solid as 253, so values over white run one or two steps low. Whole-frame comparisons showed under 0.1% of pixels more than 8 steps off, all on saturated chroma edges and identical in both apps, which points at chroma decoding, not alpha. "Default" is the alpha interpretation the app chose on import.

| Preset | Premiere Pro 2026 (macOS) | DaVinci Resolve Studio 20.2.3 (macOS) | Final Cut Pro | Windows |
|---|---|---|---|---|
| ProRes 4444 | **Pass.** Default: Straight Alpha. Red (128, 0, 0), ramp 125 with linear compositing off; see the note below for the default. | **Pass.** Default: Straight. Red (127, 0, 0), ramp 124. | not tested | not tested |
| PNG sequence | **Pass.** Default: Straight. Pixel-identical over black. Quirk: imports at 29.97 fps (Premiere's default for image sequences); set 30 in Interpret Footage. | **Pass.** Default: Straight. Pixel-identical over black. Must be imported as a grouped sequence (Media Storage, Frame Display Mode: Sequence). | not tested | not tested |
| QuickTime Animation | **Pass.** Default: Straight. Pixel-identical over black. | **Fails by default, passes with Clip Attributes, Data Levels: Full.** Auto treats the file as video range and scales the alpha by about 255/235 (red 140, black patch 117). The file now carries a `colr` atom declaring full-range RGB; re-check whether Auto honors it. | not tested | not tested |
| HEVC (alpha) | **Fails.** No alpha is read (the Alpha Channel section is greyed out) and the file is decoded with video levels (black 16, white 235). No setting fixes it. | **Fails by default, passes with Clip Attributes, Alpha Mode: Straight.** Default is Premultiplied: the ramp clips to 255 over black, red (255, 1, 0). | not tested (macOS only; the main consumer of HEVC alpha) | not applicable |
| WebM VP9 (alpha) | **Not importable** ("File format not supported"). | **Fails.** Alpha appears binarized: patches opaque, the 50% black patch gone, jagged dark fringes on text over white. Only None and Premultiplied are offered; nothing fixes it. | not tested | not tested |
| Lower third (ProRes 4444) | **Pass.** Panel (14, 20, 32) over black, (52, 58, 71) over white. | **Pass.** Same values; accent (244, 157, 11). | not tested | not tested |

**Linear compositing in Premiere Pro.** New sequences have Composite in Linear Color on by default. With it on, semi-transparent pixels blend in linear light: 50% red over black reads 191 (0.5^(1/2.4) x 255), the 49% ramp 189, and the lower-third panel (15, 22, 36) over black and (116, 116, 118) over white. The alpha is read correctly; this is expected behavior, not a fault in the files. The expected values on this page assume gamma-space blending, which matches Premiere only with that option off. A file misread as premultiplied would clip to 255 over black instead, which did not happen.

**What this settles.** ProRes 4444 and PNG sequences import correctly in both apps with their defaults. QuickTime Animation needs a Resolve setting (or the new tag). HEVC with alpha is unusable in Premiere and needs a Resolve setting. WebM is unusable in both. No premultiplied export option is warranted (ADR 0008).

## Drag-out checklist, per app

Pulp renders into its cache and starts a native file drag from the "Drag to editor" handle, or from a finished job in the queue. In Premiere Pro, DaVinci Resolve and Final Cut Pro (macOS), and Premiere Pro and Resolve (Windows):

1. **Bin / media pool drop.** Drag the handle onto the project bin or media pool. The file imports as a clip with alpha where the preset has it.
2. **Timeline drop.** Drag onto a track above a clip. The app places it at the drop point; note whether it asks about frame rate or scaling.
3. **PNG sequence.** With the PNG sequence preset, the drag carries the first frame. Note whether the app imports the whole sequence (Premiere Pro: Import as Image Sequence may need to be set beforehand; Resolve: frames are grouped in the media pool when "frame display mode" is sequence) or only one still.
4. **Second drag of the same render.** Prepare again (a cache hit) and drag again: the app should treat it as the same file.
5. **Windows.** Repeat 1 to 3; note whether the drop needs the app window to be focused first, and whether Resolve accepts drops from other apps on Windows (older versions did not).

Results (2026-10-23), with the lower third as ProRes 4444 from a finished queue job and from Prepare for drag (byte-identical files); the drops were real mouse drags from Pulp's window to the app's on the same display:

| App | Bin drop | Timeline drop | PNG sequence | Notes |
|---|---|---|---|---|
| Premiere Pro 2026 (macOS) | Pass, from both sources: clip at 30 fps, 6:00. | Pass: lands at the drop point, no dialogs, reuses the bin item. Export: panel RGBA (16, 23, 38, 216), 85% alpha. | not tested | Links to the file, does not copy it. |
| DaVinci Resolve 20.2.3 (macOS) | Pass, from both sources: Alpha Mode Straight, 30 fps, 180 frames. | Pass: lands at the drop point, no frame-rate dialog, reuses the pool item. Render: panel (14, 20, 32) over black. | not tested | Links to the file, does not copy it. |
| Final Cut Pro | not tested | not tested | not tested | not installed on the test Mac |
| Premiere Pro (Windows) | not tested | not tested | not tested | no Windows machine |
| DaVinci Resolve (Windows) | not tested | not tested | not tested | no Windows machine |

Not yet covered: a second drag of the same prepared render (the cache-hit case) and the PNG sequence preset. **Because both apps link to the file, clearing Pulp's render cache or the cache evicting an old file takes the clip offline in the editor**; the app now says so next to Prepare for drag and in the cache section. Prepared files are named after the template (`lower-third-bar.mov`, `lower-third-bar-2.mov`), so clips in the editor carry a readable name.
