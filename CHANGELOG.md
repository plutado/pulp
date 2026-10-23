# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Recent colors: each color field shows up to eight recently used colors, shared across templates and kept in `settings.json`; a committed color edit moves it to the front, and clicking a swatch applies it to that field.
- Parameter editing: number parameters with a range get a slider with direct entry; text parameters with a maximum length show a character counter. Undo and Redo (buttons, Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z or Ctrl+Y) record committed edits per template, with typing coalesced into one step; inside a text or number field the shortcut stays with the field's own undo. Each changed field shows a Reset, and Reset all clears the template; both are undoable. Edits and history are kept per template for the session.
- `docs/platform-notes.md`: the Electron, Chromium, ffmpeg, Windows and macOS findings behind the renderer (stale captures and the 60 Hz begin-frame cost, device scale, bitmap layout, ffmpeg 8.1+ alpha modes, color tags, Windows CI handling) with causes and fixes, so they are not re-solved.
- Color parameters have an alpha control. The native color input could only edit the RGB part and the alpha a template declared was kept but could not be seen or changed; each color field now has a slider for the alpha as a percentage, a text field for the whole `#RRGGBB` or `#RRGGBBAA` value, and a swatch over a checkerboard. A UI test drives the running app and reads the preview's pixels to confirm the alpha reaches the template.
- Render options, in the inspector and as headless flags: a frame-rate override (`--fps`) picked from the standard list (23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120) that samples the template at another rate over the same duration; the background color alpha templates are flattened over in presets without alpha (`--background #RRGGBB`); and in/out points (`--in-point`, `--out-point`), inclusive frames at the output rate entered as timecode `HH:MM:SS:FF` (three frame digits from 100 fps, semicolons for NTSC drop-frame), a frame number, or seconds such as `2.5s`. PNG sequences are numbered with the frame indices they hold. The inspector shows the resulting frames, rate and range, or the reason an entry is refused, and the queue validates before asking where to save. The preview's time display is timecode.
- `docs/nle-verification.md`: what is established about alpha (capture is premultiplied, every alpha preset is written straight), how a misread looks, a checklist for Premiere Pro, DaVinci Resolve and Final Cut Pro with a results table, and an alpha check test template (`tests/e2e/templates/alpha-check`) with an alpha ramp, 50% color patches, hairlines and moving text.
- Two output presets. "QuickTime Animation (alpha)": lossless RLE .mov with alpha for older workflows, full-range sRGB like PNG. "HEVC (alpha, macOS only)": .mov with an HEVC alpha layer through Apple VideoToolbox at quality 80 and alpha quality 0.9, tagged `hvc1` and Rec.709. Presets whose encoder the installed ffmpeg lacks are listed as unavailable with the reason, so HEVC shows why it cannot be used on Windows and Linux. Decision record 0005 explains why the HEVC encoder is fed 4:4:4 Y'CbCr rather than BGRA.
- Render queue: clicking Render asks where to save and queues the job, so several renders can be lined up and run one after another. Each job shows its own progress, result or error, and can be cancelled; finished jobs stay listed until cleared.
- Per-frame render timeout (10 seconds by default) and a 30-second load timeout, so a hung template stops the render with a clear message instead of hanging it.
- Headless mode flags `--library <folder>` (extra template folder for one run) and `--frame-timeout <seconds>`.
- End-to-end render test (`npm run test:e2e`, also part of `npm test`): renders the samples to ProRes 4444, VP9 WebM, PNG sequence and H.264 and checks frame count, size and alpha with ffprobe, plus the error and timeout paths. Skipped when Electron, ffmpeg or ffprobe is missing.
- Size verification at 4K (3840x2160), 8K (7680x4320) and portrait 1080x1920 for vertical video. Three size-probe fixture templates under `tests/e2e/templates` render as PNG sequences and the test reads pixels back to confirm dimensions, orientation and that the frame was captured at full size; 8K ProRes 4444 and portrait H.264 cover the video presets at those sizes.
- End-to-end check that frames stay pixel-exact with the display scaled to 150% (Chromium's `--force-device-scale-factor=1.5`), and a CI job on `windows-latest` that installs ffmpeg and runs the whole suite including the end-to-end tests. `PULP_E2E=1` makes the suite fail instead of skipping when a tool is missing. The job passes on Windows with ffmpeg 9.0.2, which verifies the renderer there: scale 1 capture, raw frames, Rec.709 output and the 150% scaling check.
- End-to-end check that a 2x offscreen surface (simulated with `PULP_OFFSCREEN_SCALE=2`) fails the render with the capture-size message instead of producing resized frames.

### Changed

- Video presets (ProRes 4444, ProRes 422 HQ, H.264, VP9) now convert to Rec.709 with the BT.709 matrix at limited range and tag the output BT.709 primaries, transfer and matrix, limited range. Before, files carried no color information and ffmpeg used its BT.601 default, which shifted saturated colors in editors. Alpha templates are composited over the background in RGB before the conversion. PNG sequences stay full-range sRGB. Decision record 0004 has the reasoning, including why the transfer is tagged BT.709 rather than sRGB.
- Frames travel to ffmpeg as raw BGRA pixels instead of PNG images, removing a PNG encode in the app and a decode in ffmpeg per frame. Frames from alpha templates are unpremultiplied in ffmpeg, so semi-transparent edges keep their color. `--frame-format png` keeps the old path for comparison, and headless mode prints elapsed time and frames per second. Measurements are in `docs/system-design.md`; the reasoning is in decision record 0003.
- The offscreen render window is created at device scale factor 1 on purpose (Electron's `offscreen.deviceScaleFactor`), so templates see `devicePixelRatio` 1 and frames are captured at exactly the declared size on HiDPI displays. A capture at any other size now fails the render with a clear message instead of being silently resampled.
- When a template throws during a render, the error names the template, the frame, the error type and the file and line inside the template.
- The template bridge script is injected on one line so line numbers in template errors match the template's own file.

### Fixed

- The first captured frame could be blank or one frame stale on slow machines (seen on Windows CI with trimmed and flattened renders). The template bridge now resolves two animation frames after drawing, and the renderer forces a repaint and waits for the paint event before each capture, so the capture always holds the frame that was just drawn. The offscreen window's begin-frame rate is raised to 240 so the extra waits cost about 4 ms, which makes renders faster than before the fix (lower third: 67 frames/s raw against 54).
- Raw frames with ffmpeg 8.1 and later. Those versions negotiate an alpha mode on filter links and treat untagged raw input as straight alpha, so ffmpeg premultiplied the already premultiplied frames before the unpremultiply step: semi-transparent pixels came out dark (a white 85% panel read 216 instead of 255) and every color one step low. The renderer now detects alpha mode support and tags raw frames with their measured layout first. Verified with ffmpeg 8.0 and 9.0.2; found by the Windows CI job.
- Raw frames no longer depend on assumptions about the capture bitmap. The renderer measures the byte order and premultiplication of `toBitmap()` output with a probe page before the first render (Electron documents the layout as platform-dependent), passes the result to ffmpeg, and falls back to PNG frames with a warning if the bytes fit no known layout. The unpremultiply step is fed planar RGB explicitly so format negotiation cannot pick a lossy Y'CbCr intermediate.
- Cancelled or failed renders no longer leave partial output files behind. Files that existed before a render without overwrite are kept.

## [0.1.0] - 2026-10-18

### Added

- Template format version 1: `template.json` manifest plus HTML/Canvas entry page driven by `window.pulpRender(state)`. Specification in `docs/template-format.md`.
- Core package (`src/core`): manifest validation, parameter resolution, frame timing, runtime bridge injection, library indexer, search, ffmpeg detection and render planning for five output presets.
- Electron shell: library list with search, live preview with play and scrub, generated parameter form, render with progress and cancel.
- Offscreen frame renderer that pipes PNG frames to ffmpeg, plus a headless `--render` command-line mode.
- Three original sample templates under CC0 1.0: Lower Third Bar, Title Card, Diagonal Wipe.
- Unit tests (Vitest), ESLint and TypeScript checks, GitHub Actions CI.
- Documentation: README, roadmap, system design, template format spec, architecture decision records.

[Unreleased]: https://github.com/plutado/pulp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/plutado/pulp/releases/tag/v0.1.0
