# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
