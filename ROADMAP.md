# Roadmap

Estimates are working hours for one developer, including tests and docs. They are rough; the total range reflects that. Checked items are done.

Milestones keep the number they were given when they were added, so GitHub issues #1 to #18 stay aligned with the milestones. The table and the sections below are in **planned order**, which is not numeric order. The window layout that the UI milestones build, and why they come in this order, is in `docs/ui-layout.md`.

| Milestone | Estimate |
|---|---|
| 0. Foundation | done |
| 1. Headless frame renderer, production quality | 12-20 h |
| 2. Alpha export presets and NLE verification | 8-14 h |
| 3. Parameter editor UI | 10-16 h |
| 4. Library: tagging, search, media preview | 12-20 h |
| 5. Drag-out to editing apps | 8-16 h |
| 6. Template packs import | 6-10 h |
| 11. UI shell: regions and the framework decision | 14-24 h |
| 18. Visual polish: labels, icons and hierarchy | 8-13 h |
| 10. Categorization by type and theme | 14-23 h |
| 12. Browse and preview | 13-21 h |
| 13. Collections | 8-14 h |
| 17. Unsigned builds and releases | 7-12 h |
| 7. Signing and auto-update (blocked on accounts) | 4-7 h |
| 8. 1.0 hardening and docs | 9-16 h |
| 14. Defaults per type and guided setup (post-1.0) | 6-10 h |
| 15. Convert library media (post-1.0) | 8-12 h |
| 16. Audio: stems, variants and pairing (post-1.0) | 8-14 h |
| 9. Later (post-1.0) | 10-22 h |
| **Total through 1.0 (milestones 1-8, 10-13, 17 and 18)** | **133-226 h** |
| **Still open through 1.0 (unticked items only)** | **34-58 h** |
| **Total including post-1.0 items** | **165-284 h** |

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
- [ ] On the test Mac: re-check whether Resolve's Data Levels Auto honors the new full-range QuickTime Animation tag, and verify alpha import in Final Cut Pro once it is installed (1-2 h)
- [ ] Hardware-blocked: verify alpha import in Premiere Pro and Resolve on Windows; needs a Windows machine with the apps — milestone 17's unsigned builds make the session easy when one is available (1 h)
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
- [ ] On the test Mac: the PNG sequence preset and a second drag of a cached render in Premiere Pro and Resolve, and drop behavior in Final Cut Pro once it is installed (1-2 h)
- [ ] Hardware-blocked: drop behavior in Premiere Pro and Resolve on Windows, including whether the target window must be focused and whether Resolve accepts drops from other apps there (1 h)
- [x] Render cache management: folder setting, size limit with oldest-first eviction, Clear cache (1-3 h)

## 6. Template packs import (6-10 h)

- [x] Pack format: a folder or `.zip` with `pack.json` (name, author, license, list of templates); in `docs/template-format.md` (1-2 h)
- [x] Import from zip or folder with validation (own ZIP reader with safe names and limits), collision handling (library copies skipped, pack copies kept or replaced) and a preview; installs into the `packs` folder of user data (3-5 h)
- [x] Show license and author per pack and per template; warn on missing, non-open or unknown licenses (1-2 h)
- [x] Export the listed templates as a pack with name, author and license (1 h)

## 11. UI shell: regions and the framework decision (14-24 h)

First of the UI milestones. ADR 0006 deferred the plain DOM question to the library milestone, which has since been built in plain DOM; the decision is made here, before the big UI build rather than halfway through it. Once the regions exist, milestone 10's browse tree and milestone 12's player upgrades slot straight in. The regions, where today's features move, and the shared state are in `docs/ui-layout.md`.

- [x] ADR 0009, superseding ADR 0006: Preact with signals, ported region by region with the UI end-to-end test green at every commit, parameter controls kept inside host components, shared state as a pure `src/core/app-state.ts` module with unit tests. Decided by a go/no-go spike with criteria fixed and committed before it ran (lint and types clean, tests pass with no edits under `tests/`, CSP unchanged, bundle growth under 30 kB, the component no longer than the code it replaces); Preact 11 missed the bundle bar by 1 kB, Preact 10 passed at +29.27 kB and is pinned. The spike's port of the results list is the shell's first region (2-4 h)
- [x] Shell: the regions from `docs/ui-layout.md` (browse panel, search bar, results, stage, inspector, collection tray, status bar) as resizable, collapsible panes (splitters with pointer and arrow keys), sizes and collapsed state in `settings.json` through a pure `src/core/layout.ts` with unit tests; the tray collapses to a one-line summary and opens itself when the first job arrives (3-5 h)
- [x] Move today's features into the regions with no loss: folders, rescan and pack import and export into the browse panel; the result list into the results region as list view; preview and transport into the stage; parameters, presets, render options, trim and CSV batch into the inspector's Parameters and Output tabs, details, tags and favorite into Info with the favorite star and tag chips also in a strip under the stage, both editing the same state; queue, drag handle and cache into the collection tray, still working as the queue until milestone 13. The UI end-to-end test passed unchanged through every move (4-6 h)
- [x] Each region a module rendering from the shared state, never reaching into another region's DOM: results, browse panel, search bar, status bar, shell chrome, item info (one component in the stage strip and the Info tab), the tray (queue as a keyed component over the jobs state, drag target and its job-following in core, cache controls), the stage (preview, playback, transport behind an API), and the inspector's Parameters and Output tabs as the imperative host modules ADR 0009 allows, talking through the `selectedTemplate` and `renderBlocked` signals. `main.ts` went from 1,600 lines to 320 of orchestration (library, selection, packs, boot) (2-4 h)
- [x] Search bar: browse nodes (Favorites, Recently used, one per library folder; folder scopes matched by root, not query text) set a scope shown as a chip with × to clear; sort by relevance, name, recently used or duration; filter chips for templates, video, images, audio, alpha and favorites; the last eight committed searches kept in `settings.json` and offered on the search field. Logic in `src/core/app-state.ts` and `src/core/recent-searches.ts` with unit tests; the end-to-end test covers the scope chip and a filter chip (2-3 h)
- [x] Status bar: ffmpeg found or missing, library counts, cache size, scans in progress and renders in progress (1-2 h)

## 18. Visual polish: labels, icons and hierarchy (8-13 h)

Before milestone 10, so the browse tree, cards and badges are born with icons and display names instead of being retrofitted. The rules live in `docs/ui-style.md`; the icon set is Phosphor (ADR 0011, license confirmed MIT on the registry).

- [x] Style guide `docs/ui-style.md`: sentence case everywhere, display names from one module, humanized tags, writing rules (one ellipsis character, units in display form), icon rules and map, design tokens, the enforcement plan (1-2 h)
- [x] Display-name module (`src/core/display.ts`) with tests, used everywhere a stored value is shown: category and type ids ("Lower third"), media kinds, extensions ("MOV") and codecs ("ProRes", "H.264", "PCM 16-bit"), resolutions ("1920 × 1080"), rates, durations ("6 s"), sizes, humanized tags and themes ("my-show" → "My show", stored normalized for search), "Built-in templates" for the bundled root (the index now says which root that is); one ellipsis character on Render… (2-3 h)
- [x] Phosphor icons: license file verified MIT in the installed package, `@phosphor-icons/core` added, only the used SVGs inlined at build time through one `Icon` helper (16/20/24, `currentColor`, regular/fill for state, `data-icon` for static markup); the Unicode stand-ins replaced (toggles, clear, favorite, thumbnail placeholders, play/pause); icon-only buttons carry `aria-label`s with tooltips on hover and keyboard focus after 500 ms; tabs, chips, toolbar, tray and status bar carry icons; the collapsed browse panel is an icon rail with labels as tooltips (2-4 h)
- [x] Design tokens in `:root` (type scale 11/12/13/15/18, 4 px spacing grid, radii, one focus ring on `:focus-visible`; icon sizes live in the Icon helper) and every font size in `styles.css` moved onto them; region titles are 15 px weight 600 in sentence case — the ALL CAPS transforms on "Library" and "Parameters" are gone; the status bar says "FFmpeg 8.0" and the cache limit reads "2 GB", through the display module (2-3 h)
- [x] Enforcement test (`tests/ui-style.test.ts`): fails on uppercase transforms or font-size literals in the stylesheet, three-dot ellipses or ALL CAPS text in the markup, icon-only buttons without an accessible name, and raw ids in the taxonomy and chip label tables (1 h)

## 10. Categorization by type and theme (14-23 h)

After milestone 11 (the browse panel it fills) and before milestone 8: it changes the template manifest and `pack.json`, and must land before format v1 is frozen. Housekeeping for the first commit: fold `main.ts`'s remaining `state.index` into the shared state, so the index lives in one place before the tree builds on it.

- [x] Taxonomy: built-in, versioned lists of types (nine groups over 45 types), themes (eight groups over 50, user-extendable: any tag-normalized word is a custom theme, shown in a separate group) and styles (eleven, closed) in a pure core module (`src/core/taxonomy.ts`) with membership, normalization and category mapping helpers, unit tested; ADR 0010 records the three axes, what is open and closed, and the ids-are-permanent extension rule (2-4 h)
- [x] Template format: optional `type` checked against the list, `themes` (normalized; unknown ids are custom, not errors) and `styles` (built-in only, errors otherwise); `category` stays valid and maps onto the type list, so existing templates keep working; validator with tests, `docs/template-format.md` and changelog updated (2-3 h)
- [x] Media files: type inferred from the media kind plus folder names (`sfx/whoosh/…` → whoosh; type ids, labels and plurals all match; no folder means no type rather than a guess), built-in themes collected along the path (`Sports/Hockey/…`); user themes — built-in or custom — editable in the Info tab next to the tags, stored in `user_items` like tags (schema migration keeps existing user data) and surviving offline roots; the Info details line names the type (2-3 h)
- [x] Search: `type:` takes a taxonomy type or a type group as well as the media kinds (several `type:` terms are alternatives), `theme:` matches manifest, folder and custom themes (all terms required), `style:` matches a template's declared styles; all combine with the existing filters, free text finds types and themes by id, and the filters are listed in the search field's hint. The filter chips stay as decided — media kinds, alpha, favorites — so the chips and the taxonomy never offer competing "type" vocabularies (1-2 h)
- [x] Browse tree in the browse panel (`src/core/browse-tree.ts`, pure and tested), replacing milestone 11's flat node list: Quick access (Favorites, Recently used), Types (group → type, with an Untyped node for templates of category "other" and media no folder typed), Themes (built-in groups plus a Custom group), Styles and Folders ("Built-in templates" first), each node with a count. Counts follow the typed query and the chips but not the scope, so selecting a node never zeroes the others; empty taxonomy nodes are hidden rather than dimmed (the tree maps what the library has), while the fixed places — Favorites, Recently used, Untyped, folders — are always shown and dim at zero. Type-group icons from the style guide's map, humanized labels, full folder path in the tooltip; headings fold; Up/Down/Home/End move, Left folds or steps out to the parent and Right unfolds or steps in, Enter selects. The three levels are told apart by structure, not type size (`docs/ui-style.md`): sections are headings over a rule and are not rows, rows that hold children get a twisty in a fixed gutter before their icon, and children indent behind a guide line without repeating the icon. Selecting a node sets the scope chip and narrows the results, clearing widens; the end-to-end test selects a type node and checks the chip, the results and the count. Packs join the tree when pack defaults land (3-5 h)
- [x] Packs: `pack.json` may declare a default `type`, `themes` and `styles` for its templates (validated like a manifest; a template's own type wins, themes and styles join); any folder with a `pack.json` counts as a pack during the scan, its templates remember it, `pack:<slug>` searches it, and the tree has a Packs section with counts; spec and tests updated (1 h)
- [x] Sample templates: four matched sets as original CC0 packs in `templates/`, one look shared across a lower third, title, transition, overlay and background — Boardroom (corporate · clean), Newsdesk (news · high-energy), Matchday (sports · high-energy, with a score bug) and Festival (holiday · playful, year-round; the theme list gained a general "holiday" leaf). Each pack declares its theme and style once and the templates inherit them; all canvas-drawn with system fonts, deterministic, backgrounds opaque and looping, the rest transparent. The samples test validates every pack and template and the type coverage per set; the render test covers one template per set; the tree shows all four packs with their counts (3-5 h)

## 12. Browse and preview (13-21 h)

Fills the results region and the stage described in `docs/ui-layout.md`.

- [x] Results grid: cards with a thumbnail, the name and badges (alpha, loop, duration, resolution and pack as small icons or short text, with tooltips; "loop" is the taxonomy's animated-loop type, so templates and folder-typed media badge alike); grid/list toggle and a four-step thumbnail size in the search bar, kept per kind in `settings.json` — grid for anything visual, list for audio-only results, each remembering its own toggle; list view with name, duration, type, themes and file columns. The geometry (column count, card height) comes from a pure `src/core/results-view.ts` with unit tests, so the stylesheet and the windowing math below share one set of numbers (3-4 h)
- [x] Virtualized results: only the rows and cards in view are in the DOM, with a spacer above and below so the scrollbar still measures the whole list; both views window through the same pure `src/core/virtual-list.ts`. The 500-item cap is gone — `deriveResults` returns every match. Keys are the entries', so an item that stays in view keeps its element and its loaded thumbnail while the window moves. A new search returns to the top; a rescan or a thumbnail arriving does not move the view. The UI end-to-end test scrolls to an item before touching it, through helpers named in `CONTRIBUTING.md` (2-3 h)
- [x] First DOM-level component tests, which ADR 0009 defers until a region needs them — the virtualized grid is that region: `tests/dom/results.test.ts` mounts the real region under happy-dom and checks what the DOM holds at a scroll position, the spacers measuring the rest of the list, the window stopping at the last item, keyed elements surviving a scroll, the list view's own row height and the return to the top on a new search. `tests/dom` is typechecked by the web project (where the DOM types are) and excluded from the node one; the other regions stay covered by the end-to-end test (1-2 h)
- [x] Hover-scrub: an eight-frame strip per video and template, tiled into one PNG beside the thumbnails and keyed by the item's size and mtime, stepped by pointer position over the card. Template strips capture all eight frames through one offscreen window (`captureTemplateFrames`), not one render per frame; the frame-rate override could not express "eight frames across this duration" because it only takes standard rates. Strips are made when a card is first rested on rather than for the whole library up front, and served at `pulp-strip://<id>/` under the same rules as thumbnails. The sprite arithmetic is a pure `src/core/hover-scrub.ts` with unit tests; the end-to-end test makes both kinds and steps them (2-3 h)
- [x] Player: loop toggle (off stops on the last frame), frame step both ways, in and out marks set from the playhead and drawn on the scrub bar with the trimmed range dimmed, volume and mute (following the native media controls too); background toggle (checkerboard, black, white, custom colour) and a title-safe and action-safe overlay at the broadcast insets. The marks and the Output tab's trim are one fact in a shared `trim` signal, set from either side. What the controls mean — playhead, step, marks, safe insets and the preferences kept in `settings.json` — is a pure `src/core/player.ts` with unit tests; the end-to-end test drives all of it (2-4 h)
- [ ] Waveforms: peak data per audio file computed once with ffmpeg, cached in user data, drawn under the scrub bar and in list rows (2-3 h)
- [ ] Audition mode for audio lists: autoplay, arrow keys move to the next item, Escape stops (1-2 h)

## 13. Collections (8-14 h)

Turns the queue in the collection tray into collections; the separate queue panel goes away.

- [ ] Collection tray: add items from the results, the stage or by drag; small cards with their own output settings (preset, size, frame rate, trim, and parameters for templates); remove, reorder, Apply to all (2-4 h)
- [ ] Save and load a collection as a file: items by library id with their settings; missing or offline items flagged on load, so a collection also serves as a project archive (2-3 h)
- [ ] Render all: every item through the render queue with per-item and total progress, one save folder for all or per item; finished items keep their drag handle (3-5 h)
- [ ] Headless: `--collection file` renders a saved collection (1-2 h)

## 17. Unsigned builds and releases (7-12 h)

The buildable half of the old "Packaging and signing" milestone; signing is milestone 7, blocked on account decisions. Unsigned artifacts also make the hardware-blocked verification sessions in milestones 2 and 5 easier to run when a machine is available.

- [ ] electron-builder config; bundled templates in `resources/templates`, labeled "Built-in templates" in the library (2-3 h)
- [ ] macOS: universal build with hardened runtime, unsigned (1-2 h)
- [ ] Windows: NSIS installer, unsigned (1-2 h)
- [ ] Linux: AppImage (1-2 h)
- [ ] Release workflow in GitHub Actions producing draft releases with the unsigned artifacts (2-3 h)
- [ ] Decide on ffmpeg distribution: keep "user installs ffmpeg", offer a download helper, or bundle an LGPL build; document license implications (ADR)

## 7. Signing and auto-update (4-7 h)

**Blocked on David's account decisions** (Apple Developer account, Windows code-signing certificate). Builds come from milestone 17.

- [ ] macOS: signing and notarization (2-3 h)
- [ ] Windows: code signing (1-2 h)
- [ ] Auto-update (electron-updater; needs signed builds on macOS) (1-2 h)

## 8. 1.0 hardening and docs (9-16 h)

- [ ] Freeze template format v1 and pack format (`pack.json`) v1, after milestone 10's manifest and pack changes have landed; add a JSON Schema file generated from or checked against the validator (2-3 h)
- [ ] Template authoring guide with a step-by-step walkthrough and a `pulp-template` starter folder (2-3 h)
- [ ] Accessibility pass across every region: keyboard navigation for the browse tree and nodes, the grid, the player, the tray, the inspector tabs (arrow keys, roving tabindex), the filter chips and the scope chip; splitter keyboard resizing kept; focus states and screen reader labels throughout (2-3 h)
- [ ] Crash and error reporting that stays local (log file, "copy diagnostics" in the status bar) (1-2 h)
- [ ] Five to ten more original CC0 sample templates, filling type and theme gaps left after milestone 10 (1-3 h)
- [ ] User guide for the window: regions, keyboard shortcuts, search syntax; README and screenshots updated for the new layout (1-2 h)

## 14. Defaults per type and guided setup (6-10 h, after 1.0)

- [ ] "Save as default for this type" in the Output tab; new items of that type (a template type, video, image or audio) start from it (2-3 h)
- [ ] Guided setup: a modal with numbered steps (what it is for, size and frame rate, format and alpha, audio, where to save), a live preview over a checkerboard, a settings summary, a save-as-default checkbox, and Add to collection at the end (4-7 h)

## 15. Convert library media (8-12 h, after 1.0)

- [ ] Output tab for media items: transcode video, stills and audio with the same presets; audio-only options (sample rate, channels, bit depth); works in collections and Render all (3-4 h)
- [ ] Loop tools for loopable backgrounds: extend to any duration with a crossfade join; speed control (2-3 h)
- [ ] Matte pass: a separate alpha matte file next to the render, for codecs and editors without alpha (HEVC in Premiere Pro, WebM) (2-3 h)
- [ ] Recolor: a tint at render time for stock media, next to template color parameters (1-2 h)

## 16. Audio: stems, variants and pairing (8-14 h, after 1.0)

Takes over "audio in templates" from the Later list. Manifest additions are optional fields.

- [ ] Audio in templates (stingers for transitions), muxed into the output or written as a separate file (2-4 h)
- [ ] Paired sound effects with variations on transitions: declared by the template or the pack, chosen in the stage's variant picker, shown as badges on cards, embedded on render (2-4 h)
- [ ] Stems: layered music as several files or a stem manifest; one lane per layer with waveform and mute and solo in the stage; render the selected mix or one file per stem (4-6 h)

## 9. Later, after 1.0 (10-22 h)

- [ ] `image` and `media` parameter types (logos, background plates) (3-5 h)
- [ ] Command-line interface as a separate entry point for scripted batch renders (2-4 h)
- [ ] Optional local semantic search over the library (on-device embeddings, off by default, no network) (5-13 h)
