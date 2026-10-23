# Platform notes

Findings about Electron, Chromium, ffmpeg, macOS and Windows that cost real time to establish. Check here before re-investigating a symptom; each entry says what was seen, what the cause was, and what the code does about it. Dates are when the finding was made; versions are what it was made on (Electron 44, Chromium 152, ffmpeg 8.0 and 9.0.2, macOS 15 on Apple Silicon, `windows-latest` on GitHub Actions).

## Offscreen rendering and capture

### The capture can be one frame stale (fixed, October 2026)

**Seen.** On Windows CI, a trimmed PNG sequence was numbered correctly (00060 onward) but the first file held the start of the template, and a flattened H.264 render's first frame was pure background with no markers. macOS never showed it.

**Cause.** `capturePage()` on an offscreen window returns the last *painted* frame, not a fresh one. The template bridge resolved inside the first `requestAnimationFrame` callback, which runs *before* Chromium commits the frame that contains the draw. On a slow machine the capture could grab the previous, empty surface. It stayed invisible for a long time because most tests read later frames, and the size fixtures draw the same picture every frame, so a one-frame shift changes nothing they check. Only tests that look at frame content at the very first frame can see it.

**Fix.** Two parts, both in place: the bridge resolves on the *second* animation frame (after the commit), and `captureFrame` calls `webContents.invalidate()` and waits for one `paint` event before `capturePage()`, with a 500 ms fallback so a window that never paints degrades to the old behavior rather than hanging. The paint event is used only as a sync signal; frames still come from `capturePage()` (ADR 0003).

**Side effect and its fix.** The two waits ran at the offscreen window's default begin-frame cadence of 60 Hz and cost two intervals per frame, halving renders to about 28 frames/s. Measured per phase, the paint wait itself is 0.1 ms; the interval was the whole cost. `webContents.setFrameRate(240)` (Electron's maximum) raises the cadence and brings the waits down to about 4 ms; `webPreferences.offscreen.frameRate` has no effect, `setFrameRate` does. Renders are now faster than before the fix (lower third 1080p: 67 frames/s raw against 54). The higher cadence applies only to the hidden render window, which is destroyed when the render ends, so CPU use is higher only while a render runs.

### Device scale factor

- The offscreen window's scale comes from `webPreferences.offscreen.deviceScaleFactor`, default 1 "for consistent behavior". It is set to 1 explicitly so the intent is in the code, not in a default. `--force-device-scale-factor` changes what `screen` reports but not the offscreen window, which is why the 150% scaling test can use that switch to simulate a Windows desktop.
- A capture that is not exactly the template's size fails the render with a message naming both sizes. Frames are never resampled; that would hide a platform problem by softening every frame. `PULP_OFFSCREEN_SCALE` renders at another scale so a test can prove the refusal.
- `enableDeviceEmulation` *before* the page loads segfaults Electron. After load it changes only the page's `devicePixelRatio`, not the capture size, so it is no use for this.

### Windows enforces a minimum window size

A 16x16 offscreen probe window came back as 32x39 on `windows-latest`. Even frameless offscreen windows are subject to the minimum. The capture-format probe is 256x256 for that reason; keep any probe or fixture window well above that.

### Bitmap layout of `toBitmap()`

Electron documents the layout as platform-dependent. Measured: BGRA, premultiplied, tightly packed (width x height x 4 bytes) on macOS and on Windows CI. The renderer does not rely on that: a probe page with half-transparent red and opaque blue is captured once per process and classified (`src/core/capture-format.ts`), the measured byte order and premultiplication go to ffmpeg, and an unknown layout falls back to PNG frames with a warning. Headless mode prints the answer as `frames: raw (bgra, premultiplied alpha)`.

### The color input has no alpha

Chromium's `<input type=color>` holds `#rrggbb` only. An 8-digit value collapses to six, and the `alpha` attribute is not supported in Electron 44. Color parameters therefore use a composite control: native picker for RGB, a slider for alpha, a text field for the whole value (`colorField` in the renderer).

## ffmpeg

### 8.1 and later negotiate an alpha mode (fixed, October 2026)

**Seen.** Identical failures on ffmpeg 8.1.2 and 9.0.2 (Windows CI), reproduced on macOS with a static 9.0.2 build: every opaque color one step low (254 for 255) and semi-transparent pixels dark (a white panel at 85% read 216 instead of 255, 39 steps). ffmpeg 8.0 was fine.

**Cause.** From 8.1, filter links carry an alpha mode. Untagged raw input counts as straight, and because `unpremultiply` asks for premultiplied input, the graph auto-inserts `premultiply_dynamic` first. The frames get premultiplied a second time, the filter undoes only that, and the output stays premultiplied with ffmpeg's `(v * a + 128) >> 8` rounding on top. The arithmetic matches exactly: 217 to 184 to 216, 255 to 254 to 254, green 64 at alpha 128 to 32 to 63.

**Fix.** `detectFfmpeg` checks whether `ffmpeg -h filter=setparams` lists `alpha_mode`; when it does, the first filter is `setparams=alpha_mode=premultiplied` (or `straight`), matching the probe's measurement. 8.0 rejects that option, so it is a detected capability. Pinning CI to 8.1.2 was a useful experiment: it ruled out "ffmpeg 9" as the cause.

**Not the cause.** An earlier guess blamed a Y'CbCr intermediate in format negotiation. It was wrong for this symptom. The explicit `format=gbrap` before `unpremultiply` stays as a guard, because the filter is planar-only and negotiation is free to choose otherwise.

### Color tags must be set on frames

ffmpeg 7 and later take color properties from the frames leaving the filter graph. `-color_primaries`, `-color_trc` and `-colorspace` as output options left transfer and primaries unknown in the files; `setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv` on the frames set all four in every container, and the MOV `colr` atom appeared without the experimental `write_colr` flag. Put `setparams` *before* the final `format` filter: with `range=tv` immediately before an `[out]` label the graph fails to parse.

### VideoToolbox from BGRA leaves the matrix untagged

`hevc_videotoolbox` accepts BGRA and converts internally with BT.709, but writes `colr` with matrix 0 (unspecified). A decoder falling back to BT.601 then reads pure red as (233, 0, 1). Feeding `ayuv` (4:4:4 Y'CbCr with alpha) that the Rec.709 steps converted and tagged gives `nclc` 1/1/1 and an exact round trip (ADR 0005). The encoder exists only in macOS builds.

### Small things that bit

- `crop=1:1` on 4:2:0 video rounds the crop to zero and fails; convert with `format=rgba` first when reading single pixels.
- The rawvideo demuxer's option is `-pixel_format`; using `-pix_fmt` for input would collide with the output `-pix_fmt` when scanning arguments.
- `-start_number` is an image2 *output* option and sets the first file's number; it does not affect timestamps or content.
- ffmpeg 8.0 and later decode the HEVC alpha layer; older builds return the base layer only (reads as fully opaque). The e2e test skips its alpha assertion in that case and says so.
- Versions seen: Homebrew formula 8.0 then 9.0.2; Chocolatey `ffmpeg` has 8.0.0 through 8.1.2 and 9.0.0 through 9.0.2 and installs 9.0.2 by default. Local Mac testing of another version: a static build from `ffmpeg.martin-riedl.de` in a scratch folder, pointed to with `PULP_FFMPEG_PATH`, and deleted afterwards.

## Windows CI

- GitHub's `windows-latest` runner has a desktop session; Electron offscreen rendering works there without extra setup.
- `PULP_E2E=1` makes the end-to-end suite fail instead of skipping when a tool is missing, so the job cannot go green by skipping. Verified by pointing detection at a fake ffmpeg with no ffprobe beside it.
- PowerShell pipes are text streams and corrupt binary output. Write ffmpeg's raw pixels to a file and `Format-Hex` the file.
- The job has an always-run step that prints the ffmpeg version and the `frames:` line, so a log says which ffmpeg produced the bytes and what the capture bitmap looked like even when tests fail.
- `choco install ffmpeg -y --no-progress` installs the current version; `--version=8.1.2` pins when a comparison is needed.

## macOS

- A Retina display reports scale 2 while the offscreen window stays at 1; this is the implicit default made explicit above.
- GUI apps do not inherit the shell `PATH`; `detectFfmpeg` checks the Homebrew locations as well.
- QuickTime's documented `nclc` transfer values are 1 (BT.709), 7 (SMPTE 240M) and 2 (unknown), with 8 and above reserved (Apple TN2162). An sRGB transfer tag is handled unevenly, which is why video output is tagged BT.709 (ADR 0004).
- `hevc_videotoolbox` and `prores_videotoolbox` exist only here.

## Test design lessons

- Read pixels from the *first* frame somewhere, not only from later ones, and use at least one fixture whose frames differ. The stale-capture bug hid for weeks behind tests that read `frames[1]` and fixtures that draw the same picture every frame.
- When a job passes unexpectedly, check that the path under test actually ran: the first "fixed" Windows run had silently fallen back to PNG frames because the capture probe failed. The `frames:` line and the raw-path assertion exist for that.
- Reproduce a platform failure locally before theorizing. The static ffmpeg 9 build settled "ffmpeg or Windows" in minutes both times; once it was ffmpeg, once it was not.
