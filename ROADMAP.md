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
| 10. Categorization by type and theme (before 8) | 14-23 h |
| 8. 1.0 hardening and docs | 8-14 h |
| 9. Later (post-1.0) | 12-26 h |
| **Remaining through 1.0 (milestones 1-8 and 10)** | **88-151 h** |
| **Including post-1.0 items** | **100-177 h** |

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

- [x] Automated end-to-end render test that runs when Electron and ffmpeg are available, checking frame count, size and alpha with ffprobe (2-3 h)
- [x] HiDPI: render at device scale 1 explicitly instead of resizing captured frames; verified on a Retina display (2-3 h)
- [x] HiDPI: verify on Windows at 150% scaling. Verified by simulated 150% scaling on Windows CI: the e2e suite renders with Chromium's `--force-device-scale-factor=1.5` (the primary display reports 1.5, as Windows does at 150%) and checks the frames stay pixel-exact; the `windows-latest` job runs the whole suite with `PULP_E2E=1` and passed on ffmpeg 9.0.2 (1 h)
- [x] Large frames: verify 4K and 8K, and portrait sizes for vertical video (1-2 h)
- [x] Throughput: avoid PNG encode/decode by piping raw BGRA (`-f rawvideo -pixel_format bgra`) from `capturePage()`, with `unpremultiply` for alpha templates (ADR 0003 explains why not the `paint` event); benchmarked against the PNG path in `docs/system-design.md` (3-5 h)
- [x] Color: decide and document sRGB/Rec.709 handling: video presets convert with the BT.709 matrix to limited range and tag every frame BT.709 (`scale` + `setparams`), PNG stays sRGB; ADR 0004 (2-3 h)
- [x] Robustness: per-frame timeout for hung templates, delete partial output on cancel or failure, clear errors when a template throws (1-2 h)
- [x] Render queue: several renders in sequence with progress per job (1-2 h)

## 2. Alpha export presets and NLE verification (8-14 h)

- [x] Verify each alpha preset imports with correct transparency in Premiere Pro and DaVinci Resolve on macOS; results in `docs/nle-verification.md`. ProRes 4444 and PNG pass with defaults; QuickTime Animation needs Data Levels: Full in Resolve (now tagged full-range RGB, re-check); HEVC: no alpha in Premiere, Alpha Mode: Straight in Resolve; WebM: not importable in Premiere, broken alpha in Resolve (3-5 h)
- [ ] Verify alpha import in Final Cut Pro (macOS), and in Premiere Pro and Resolve on Windows; check whether Resolve's Data Levels Auto honors the new QuickTime Animation tag (2-3 h)
- [x] Straight versus premultiplied alpha: Chromium captures premultiplied (measured by a probe), every preset is written straight, Premiere and Resolve read ProRes, PNG and Animation as straight; no export option, HEVC's Resolve default documented as a caveat; ADR 0008 (2-3 h)
- [x] Additional presets: QuickTime Animation (qtrle) for older workflows, HEVC with alpha on macOS via VideoToolbox where available; shown as unavailable elsewhere with the reason; ADR 0005 (2-3 h)
- [x] Preset options: frame-rate override from the standard list, background color picker for flattening, in/out points as timecode or frames; in the inspector and as `--fps`, `--background`, `--in-point`, `--out-point`; verified on macOS and Windows CI (1-3 h)

## 3. Parameter editor UI (10-16 h)

- [x] Color picker with alpha (native input has none) and recent colors: alpha slider and `#RRGGBBAA` text field with swatch; eight recent colors shared across templates in `settings.json` (2-3 h)
- [x] Number sliders with direct entry; text fields with character counter for `maxLength` (1-2 h)
- [x] Saved parameter presets per template ("Show A", "Show B") stored in user data: one file per template id, only values that differ from defaults, unknown parameters dropped quietly, replacing asks first (2-3 h)
- [x] Batch: render the same template for a list of names/titles from CSV; headers match id or label ignoring case, unknown columns warned before queuing, one job per row named from the row; also `--batch` headless (3-4 h)
- [x] Undo/redo for parameter edits (per template, typing coalesced, text fields keep their own Ctrl+Z); reset per field and for the whole template, both undoable (1-2 h)
- [x] Evaluate moving the UI to a component framework once the form logic outgrows plain DOM; write an ADR either way. ADR 0006: stay with plain DOM, revisit at milestone 4 (1-2 h)

## 4. Library: tagging, search, media preview (12-20 h)

- [x] User tags on any item, stored in the library database (ADR 0007: `node:sqlite` in user data, `user_items` table that survives offline roots); chips with removal and an add field in the stage, searchable with `tag:` (3-5 h)
- [x] Persistent index with incremental rescans and a file watcher; also rescans on window focus and when a missing root returns, and marks items of missing roots offline instead of deleting them. 5,100 items: 145 ms first scan, 105 ms unchanged rescan (3-4 h)
- [x] Media metadata via ffprobe: duration, resolution, codec, alpha; filter by them (`duration:`, `width:`, `height:`, `fps:`, `res:`, `codec:`, `alpha:`, applied to templates through their manifests too) (2-3 h)
- [x] Thumbnails for templates (poster frame at mid-progress through the renderer) and media (ffmpeg frame grab), cached in user data by item signature, served at `pulp-thumb://<id>/` (2-4 h)
- [x] Media preview in the stage area (video/image/audio) through `pulp-media://<id>/`: by id, real path checked against the root, media types only, ranges for seeking, bare 404s, off limits to templates; refusals tested (1-2 h)
- [x] Favorites and recently used: a toggle on the shown item, `favorite:yes` and `recent:N` filters; selecting or rendering marks an item used (1-2 h)

## 5. Drag-out to editing apps (8-16 h)

- [x] Drag a rendered file from Pulp into an NLE bin or timeline using `webContents.startDrag`: finished queue jobs and the drag handle; only cache files and finished outputs may be dragged (2-3 h)
- [x] "Render and drag": Prepare for drag renders into the cache through the queue (progress, cancel), reuses a cached render with the same key, then arms the drag handle (2-4 h)
- [x] Verify drop behavior in Premiere Pro and DaVinci Resolve on macOS: bin and timeline drops from a queue job and from Prepare for drag all land with alpha intact; both apps link to the file, so cache clearing takes clips offline (warned in the app) (3-6 h)
- [ ] Verify drop behavior in Final Cut Pro (macOS) and in Premiere Pro and Resolve on Windows; also the PNG sequence preset and a second drag of a cached render (2-3 h)
- [x] Render cache management: folder setting, size limit with oldest-first eviction, Clear cache (1-3 h)

## 6. Template packs import (6-10 h)

- [x] Pack format: a folder or `.zip` with `pack.json` (name, author, license, list of templates); in `docs/template-format.md` (1-2 h)
- [x] Import from zip or folder with validation (own ZIP reader with safe names and limits), collision handling (library copies skipped, pack copies kept or replaced) and a preview; installs into the `packs` folder of user data (3-5 h)
- [x] Show license and author per pack and per template; warn on missing, non-open or unknown licenses (1-2 h)
- [x] Export the listed templates as a pack with name, author and license (1 h)

## 7. Packaging and signing (10-18 h)

- [ ] electron-builder config; bundled templates in `resources/templates` (2-3 h)
- [ ] macOS: universal build, hardened runtime, signing and notarization (Apple Developer account required) (3-5 h)
- [ ] Windows: NSIS installer and code signing (certificate required) (2-4 h)
- [ ] Linux: AppImage (1-2 h)
- [ ] Release workflow in GitHub Actions producing draft releases; auto-update (electron-updater) (2-4 h)
- [ ] Decide on ffmpeg distribution: keep "user installs ffmpeg", offer a download helper, or bundle an LGPL build; document license implications (ADR)

## 10. Categorization by type and theme (14-23 h)

Numbered 10 so milestones 1-8 keep their issue numbers, but it comes **before milestone 8**: it changes the template manifest and must land before format v1 is frozen.

- [ ] Taxonomy: built-in, versioned lists of types (grouped on two levels: titles and text, backgrounds, transitions, overlays, design elements, video clips, stills, music, sound effects), themes (corporate, news, sports, holidays and more) and styles (clean, grunge, retro, cinematic and more) in a pure core module; users extend them with their own themes, stored like tags and shown in a separate custom group; ADR for the three axes and the extension rule (2-4 h)
- [ ] Template format: `type` checked against the list, optional `themes` and `styles` arrays; `category` stays valid and maps onto the type list, so existing templates keep working; validator, `docs/template-format.md` and changelog updated (2-3 h)
- [ ] Media files: type from the media kind plus folder names (for example `sfx/whoosh/...`), themes from folder names or assigned by the user; stored per item in the library database, surviving offline roots like tags do (2-3 h)
- [ ] Search: `type:`, `theme:` and `style:` filters, combinable with the existing ones; `type:` keeps matching the media kinds video, image and audio (1-2 h)
- [ ] Browse tree in the sidebar: type group, type, theme, plus packs, each with item counts; selecting a node narrows the list and scopes the search box to it, clearing the selection widens again (3-5 h)
- [ ] Packs: `pack.json` may declare default types, themes and styles for its templates (1 h)
- [ ] Sample templates: original CC0 templates that fill empty type and theme combinations, starting with matched sets (one look shared across lower third, title, transition, overlay and background) for corporate, sports, holiday and news (3-5 h)

## 8. 1.0 hardening and docs (8-14 h)

- [ ] Freeze template format v1 (after milestone 10's manifest changes have landed); add a JSON Schema file generated from or checked against the validator (2-3 h)
- [ ] Template authoring guide with a step-by-step walkthrough and a `pulp-template` starter folder (2-3 h)
- [ ] Accessibility pass: keyboard navigation, focus states, screen reader labels (2-3 h)
- [ ] Crash and error reporting that stays local (log file, "copy diagnostics" button) (1-2 h)
- [ ] Five to ten more original CC0 sample templates, filling type and theme gaps left after milestone 10 (1-3 h)

## 9. Later, after 1.0 (12-26 h)

- [ ] `image` and `media` parameter types (logos, background plates) (3-5 h)
- [ ] Audio in templates (stingers for transitions), muxed into output (2-4 h)
- [ ] Command-line interface as a separate entry point for scripted batch renders (2-4 h)
- [ ] Optional local semantic search over the library (on-device embeddings, off by default, no network) (5-13 h)
