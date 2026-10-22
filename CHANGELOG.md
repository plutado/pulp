# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
