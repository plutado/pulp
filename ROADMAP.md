# Roadmap

Estimates are working hours for one developer, including tests and docs. They are rough; the total range reflects that. Checked items are done.

| Milestone | Estimate |
|---|---|
| 0. Foundation | done |
| 1. Headless frame renderer, production quality | 12-20 h |
| 2. Alpha export presets and NLE verification | 8-14 h |
| 3. Parameter editor UI | 10-16 h |
| 4. Library: tagging, search, media preview | 12-20 h |
| 5. Drag-out to editing apps | 8-16 h |
| 6. Template packs import | 6-10 h |
| 7. Packaging and signing (macOS, Windows, Linux) | 10-18 h |
| 8. 1.0 hardening and docs | 8-14 h |
| 9. Later (post-1.0) | 12-26 h |
| **Remaining through 1.0 (milestones 1-8)** | **74-128 h** |
| **Including post-1.0 items** | **86-154 h** |

## 0. Foundation (done)

- [x] Project setup: Electron, TypeScript, electron-vite, Vitest, ESLint, CI
- [x] Template format v1 spec and validator
- [x] Parameter resolution, frame timing, runtime bridge
- [x] Library indexer and search
- [x] Render planner for five presets and ffmpeg detection
- [x] Minimal UI: list, preview, parameter form, render button
- [x] Three original CC0 sample templates

## 1. Headless frame renderer, production quality (12-20 h)

A first renderer works (offscreen window, PNG frames to ffmpeg). This milestone makes it dependable.

- [ ] Automated end-to-end render test that runs when Electron and ffmpeg are available, checking frame count, size and alpha with ffprobe (2-3 h)
- [ ] HiDPI: render at device scale 1 explicitly instead of resizing captured frames; verify on a Retina display and on Windows at 150% scaling (2-3 h)
- [ ] Large frames: verify 4K and 8K, and portrait sizes for vertical video (1-2 h)
- [ ] Throughput: avoid PNG encode/decode by piping raw RGBA (`-f rawvideo -pix_fmt bgra`) from the offscreen `paint` event; benchmark against the current path (3-5 h)
- [ ] Color: decide and document sRGB/Rec.709 handling (tags in ProRes/H.264 output, `colorspace` filter) (2-3 h)
- [ ] Robustness: per-frame timeout for hung templates, delete partial output on cancel or failure, clear errors when a template throws (1-2 h)
- [ ] Render queue: several renders in sequence with progress per job (1-2 h)

## 2. Alpha export presets and NLE verification (8-14 h)

- [ ] Verify each alpha preset imports with correct transparency in Premiere Pro, DaVinci Resolve and Final Cut Pro; record results in docs (3-5 h)
- [ ] Straight versus premultiplied alpha: confirm what Chromium captures and what each NLE expects; add a setting if needed (2-3 h)
- [ ] Additional presets: QuickTime Animation (qtrle) for older workflows, HEVC with alpha on macOS via VideoToolbox where available (2-3 h)
- [ ] Preset options: frame-rate override, background color picker for flattening, start/end trim (1-3 h)

## 3. Parameter editor UI (10-16 h)

- [ ] Color picker with alpha (native input has none) and recent colors (2-3 h)
- [ ] Number sliders with direct entry; text fields with character counter for `maxLength` (1-2 h)
- [ ] Saved parameter presets per template ("Show A", "Show B") stored in user data (2-3 h)
- [ ] Batch: render the same template for a list of names/titles from CSV (3-4 h)
- [ ] Undo/redo for parameter edits; reset to defaults (1-2 h)
- [ ] Evaluate moving the UI to a component framework once the form logic outgrows plain DOM; write an ADR either way (1-2 h)

## 4. Library: tagging, search, media preview (12-20 h)

- [ ] User tags on any item, stored in a library database (SQLite via better-sqlite3, or JSON per root; ADR) (3-5 h)
- [ ] Persistent index with incremental rescans and a file watcher (3-4 h)
- [ ] Media metadata via ffprobe: duration, resolution, codec, alpha; filter by them (2-3 h)
- [ ] Thumbnails for templates (render a poster frame) and media (ffmpeg frame grab), cached (2-4 h)
- [ ] Media preview in the stage area (video/image/audio) (1-2 h)
- [ ] Favorites and recently used (1-2 h)

## 5. Drag-out to editing apps (8-16 h)

- [ ] Drag a rendered file from Pulp into an NLE bin or timeline using `webContents.startDrag` (2-3 h)
- [ ] "Render and drag": render to a cache folder on drag start, with progress, for short templates (2-4 h)
- [ ] Verify drop behavior in Premiere Pro, DaVinci Resolve and Final Cut Pro on macOS, and Premiere Pro and Resolve on Windows; document quirks (3-6 h)
- [ ] Render cache management: location setting, size limit, cleanup (1-3 h)

## 6. Template packs import (6-10 h)

- [ ] Pack format: a folder or `.zip` with `pack.json` (name, author, license, list of templates); add to the spec (1-2 h)
- [ ] Import from zip with validation, collision handling for template ids, and a preview of what will be installed (3-5 h)
- [ ] Show license and author per pack; warn on missing or non-open licenses (1-2 h)
- [ ] Export a template or a set of templates as a pack (1 h)

## 7. Packaging and signing (10-18 h)

- [ ] electron-builder config; bundled templates in `resources/templates` (2-3 h)
- [ ] macOS: universal build, hardened runtime, signing and notarization (Apple Developer account required) (3-5 h)
- [ ] Windows: NSIS installer and code signing (certificate required) (2-4 h)
- [ ] Linux: AppImage (1-2 h)
- [ ] Release workflow in GitHub Actions producing draft releases; auto-update (electron-updater) (2-4 h)
- [ ] Decide on ffmpeg distribution: keep "user installs ffmpeg", offer a download helper, or bundle an LGPL build; document license implications (ADR)

## 8. 1.0 hardening and docs (8-14 h)

- [ ] Freeze template format v1; add a JSON Schema file generated from or checked against the validator (2-3 h)
- [ ] Template authoring guide with a step-by-step walkthrough and a `pulp-template` starter folder (2-3 h)
- [ ] Accessibility pass: keyboard navigation, focus states, screen reader labels (2-3 h)
- [ ] Crash and error reporting that stays local (log file, "copy diagnostics" button) (1-2 h)
- [ ] Five to ten more original CC0 sample templates covering each category (1-3 h)

## 9. Later, after 1.0 (12-26 h)

- [ ] `image` and `media` parameter types (logos, background plates) (3-5 h)
- [ ] Audio in templates (stingers for transitions), muxed into output (2-4 h)
- [ ] Command-line interface as a separate entry point for scripted batch renders (2-4 h)
- [ ] Optional local semantic search over the library (on-device embeddings, off by default, no network) (5-13 h)
