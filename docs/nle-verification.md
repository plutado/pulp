# Alpha in editing apps: what is established, what to verify

Status: the renderer side is settled and tested. The import side (how each editing app interprets the files) has not been checked yet; this page carries the checklist and the test files for doing it, and a table to record the results.

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

## Results

| Preset | Premiere Pro | DaVinci Resolve | Final Cut Pro | Notes |
|---|---|---|---|---|
| ProRes 4444 | | | | |
| PNG sequence | | | | |
| WebM VP9 (alpha) | | | | |
| QuickTime Animation | | | | |
| HEVC (alpha) | | | | macOS only |

Fill in app version, default alpha interpretation, and pass/fail per checklist step. Record anything that needed a setting change.
