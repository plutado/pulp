# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per-frame render timeout (10 seconds by default) and a 30-second load timeout, so a hung template stops the render with a clear message instead of hanging it.
- Headless mode flags `--library <folder>` (extra template folder for one run) and `--frame-timeout <seconds>`.

### Changed

- When a template throws during a render, the error names the template, the frame, the error type and the file and line inside the template.
- The template bridge script is injected on one line so line numbers in template errors match the template's own file.

### Fixed

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
