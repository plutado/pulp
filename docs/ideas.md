# Ideas

Where work waits before it is on the roadmap. `ROADMAP.md` is the plan; this file is what comes before it: suggestions not yet decided, decisions not yet scheduled into a milestone, and known issues not yet fixed.

## How an idea moves

1. **Idea.** Anyone may suggest one. It goes under [Ideas](#ideas) with a line on what it is and why.
2. **Decided.** When the maintainer agrees to it, it moves to [Decided](#decided), with what was decided and what "done" looks like.
3. **Scheduled.** When a request schedules it, it is written into `ROADMAP.md` (a new milestone, or items in an existing one) and removed from this file in the same commit. A new milestone takes the next milestone number and gets its own GitHub issue; both are written here as soon as they exist, and the roadmap repeats the issue number beside the milestone when it is scheduled (see CONTRIBUTING.md). The numbers are assigned in the order milestones are decided, so they are rarely the order they are built in.

Known issues follow the same path: a bug found and understood goes under [Known issues](#known-issues), and leaves when it is fixed or scheduled.

Each move is a commit, so the history shows when an idea was decided and where it went.

## Suggested order

The maintainer's intended sequence for what is decided here and what is already on the roadmap (milestones 23, 24, 25, 26, 28, 29 and 30 are done). Scheduling follows it unless a request says otherwise.

Every milestone decided here now has its number and its GitHub issue, so the two cannot drift: **27** projects and the application menu (#30), **28** per-layer timing, transitions and looks (#29), **29** rotate layers on the stage (#31), **30** timing: any length, set while editing (#32), **31** a start screen (#33), **32** stock library import (#34), **33** layered Photoshop graphics (#35). The numbers are the order they were decided in, not the order they are built in — the list below is the order, as `ROADMAP.md`'s is (CONTRIBUTING.md).

1. **Quick wins from Decided:** all done — ghost slots, element cards for every bundled template, the Festival themes, and browse tree counts for screen readers. (The category search filtering the tree, and the tree showing only where you are, are done — milestone 24.)
2. **Protection before the larger work:** done — every bundled template is hashed at each aspect and a few fixed frames (`tests/e2e/visual.e2e.test.ts`, 124 templates in `tests/visual/references.json`). It runs locally only until the cross-platform known issue above is settled. CI runs on Windows, macOS and Linux with a dependency audit.
3. **Milestone 26: assets on the stage** — *done.* The Assets type group is filled (six per Effects category, ten Objects categories, every theme three assets deep, taxonomy version 4); asset libraries read transparency from ProRes 4444, VP9, HEVC's auxiliary layer and folders of numbered frames; video layers play a clip on the template's own time; a picture or clip dropped on the preview becomes a layer; and clips are proxied, cached and never copied.
4. **Milestone 29: rotate layers on the stage** — *done* (GitHub issue #31), and in `ROADMAP.md`. It finished milestone 25's placement: a layer can now be moved, resized and turned.
5. **Milestone 30: timing — any length, set while editing** — *done* (GitHub issue #32), and in `ROADMAP.md`. It also gives a frame sequence somewhere to say what rate it plays at, which milestone 26 had to state rather than ask.
6. **Milestone 28: per-layer timing, transitions and looks** — *done* (GitHub issue #29), and in `ROADMAP.md`. After 30, whose length and structure a layer's own start and end are set within, and before 27, which has to save all of it.
7. **Milestone 27: projects and the application menu** — *in progress,* now in `ROADMAP.md` (GitHub issue #30).
8. **Milestone 31: a start screen** — examples, recent projects, a tour and a dashboard (Decided item 4; GitHub issue #33).
9. **Milestone 32: stock library import** (Decided item 5; GitHub issue #34).
10. **Milestone 33: layered Photoshop graphics** (Decided item 6; GitHub issue #35).
11. **Milestone 20:** social-ready export.
12. **Milestone 8:** 1.0 hardening and docs, taking in third-party notices and the release basics, and whichever of the settings window, reliability, security review and template versions in saved work have been decided by then.
13. **Last:** milestone 17 (unsigned builds and the app icon), then milestone 7 (signing and auto-update).

## Decided

1. **Windows checks in milestones 2 and 5: a VM, not "hardware-blocked".** Both milestones' Windows items say they need a Windows machine and that milestone 17's builds make it easy. The plan now is a local Windows 11 VM on the maintainer's Mac, used for these checks and for debugging Windows-only failures. Reword both items to say so; if Premiere Pro or DaVinci Resolve can't run in the VM, the checks wait for a real Windows machine and stop blocking 1.0.

2. **Milestone 9's "command-line interface as a separate entry point": redefine it.** Pulp already renders without its window through `--render`, `--param` (including `@layers`), `--collection` and CSV batch. Redefine the item as packaging those as a proper `pulp` command (its own entry point, `pulp render …` and `pulp collection …`, help text, exit codes, documented in the README) rather than building a second interface, and re-estimate it.

3. **Third-party notices, release process and project basics.** A third-party notices file covering Electron and Chromium, the npm dependencies, the bundled fonts and ffmpeg if it is ever bundled, shown in an "Acknowledgements" screen reached from About, and checked in CI so a new dependency cannot ship unlisted; required before any build is distributed (milestone 17). A release process: version numbers, release notes drawn from the changelog's Unreleased section, a tag per release. Issue and pull request templates, a code of conduct, and a `SECURITY.md` saying how to report a vulnerability.

4. **A start screen: examples, recent projects, a tour and a dashboard.** Milestone **31** (GitHub issue #33), built after 27 (it needs `.pulp` projects). Shown at launch and from File → Home, with a "Show at startup" switch.
   - **Get going:** New project, blank or by shape (16:9, 9:16, 1:1, 4:5), and by platform once milestone 20 exists. **Example projects:** a handful of ready-made `.pulp` files built from the bundled samples, each showing something Pulp does well (an interview with a lower third and a logo, a sports-highlight opener, a vertical social clip, a wedding title, a news package with ticker and bug, a product launch with layers and motion); opening one opens a copy, so the example stays as it was.
   - **Recent projects** with thumbnails, last-opened dates and pinning; a missing file shows as missing, with a way to relink it.
   - **Learn:** "Take the tour", a short guided walkthrough of the window (browse panel, stage, Parameters tab, collection tray) with highlights and Next / Skip, offered on first launch and replayable from Help; "What's new" from the changelog's latest release; keyboard shortcuts and the user guide (milestone 8).
   - **Set up and status:** a first-run checklist (ffmpeg found, a library folder added, sample media made), each item a button that does it; the library at a glance (template and media counts, most-used categories, favourites); quick actions (add a library folder, import a pack, import a font). Milestone 14's "guided setup" can fold into the checklist.

5. **Stock library import.** Milestone **32** (GitHub issue #34), built after 30 and 28, whose in, hold and out parts and per-layer looks it uses. Large collections of stock graphics, clips and music, hundreds of gigabytes on external drives or in archives, often delivered as sets of files that belong together and with an index of their own, brought in as they were organised. Milestone 26's asset libraries already read plain media where it lies; this makes a whole collection browsable at once and keeps its structure.
   - **Previews before full media:** a very large library is indexed from small previews and thumbnails first, so it can be browsed and searched straight away; the full-quality file is read only when an item is placed or rendered. The index records where each full file lives and says plainly when its drive or archive is not available.
   - **Known as well as owned:** a library can list everything a catalog or index says exists, with items whose files are not on this computer shown greyed out, so a person sees the whole collection and what is missing from it.
   - **Importing an existing catalog's organisation:** when a library comes with its own index (names, categories, keywords, thumbnails), Pulp reads it so the imported items browse and search the way they were organised, mapped onto Pulp's taxonomy, rather than only by folder names.
   - **Clip sets as one asset:** separate entry, loop and exit files that belong together are recognised as one item that stretches: the entry plays once, the loop repeats for as long as the chosen length needs, then the exit plays — milestone 30's parts, with the files supplying them instead of a template.
   - **Several layers in one clip set:** a set can carry more than one layer that moves together (a main graphic and a flare, say), each with its own entry, loop and exit, placed and timed as one item while each layer keeps its own look (milestone 28).
   - **Rights:** imported media stays where it is, referenced in place, never copied into packs, exports or the repository; tests use generated fixtures only.

6. **Layered Photoshop graphics.** Milestone **33** (GitHub issue #35): read a `.psd` as a stack of layers, so a layered still from a stock library can be browsed and used without flattening it first.
   - **Reading:** layers, their names, order, visibility, opacity and blend modes where the file has them; groups shown as groups. Reading only, no editing of the file in Pulp.
   - **Browsing:** a flattened preview for the grid and the stage, with the layer list shown in the Info tab.
   - **Showing and hiding layers** in the preview, kept with the item like any other edit (presets, collections, undo, the render cache key).
   - **Placing:** as one picture, or as separate image layers that keep their positions, then moved and styled with milestones 25 and 28.
   - **Limits stated plainly:** layer effects, smart objects and adjustment layers Pulp can't reproduce are named rather than silently dropped; the flattened composite stored in the file is the fallback.
   - **Tests** on generated `.psd` fixtures only.

7. **Output presets per kind of asset:** an item for milestone 14, defaults per type and guided setup (GitHub issue #14): one-click export settings suited to a type of asset (a transparent overlay, a full-screen background, a sound-paired wipe), offered when one is chosen, alongside "Save as default for this type" and the guided setup.

## Known issues

- **The tray's resize bar reaches past the tray into the browse panel.** `#split-tray` sits directly inside `.tray`, which has no side padding, but `.tray .splitter.h { margin: 0 -12px; }` in `src/renderer/styles.css` still pulls it 12 px left of the tray's edge, so the horizontal line above the collection crosses the vertical divider and runs 6 px into the browse panel (seen on macOS). Drop the negative margin so the bar spans the tray exactly, and add a UI end-to-end check that the bar's left and right edges match the tray's.

- **A saved "Hold, seconds" is dropped, not carried into a length.** Milestone 30 removed the `inOut` parameter ("Hold, seconds") from eleven bundled templates — the citation callout, the city lights and civic openers, the donation, fitness and lap counters, the handle and profile cards, the poll strip, the hairline lower third and the kicker title — since the length is the control now. A preset, collection item, `.pulpcollection` file, CSV row or `--param` that still carries a value for it renders with the template's own hold, and the value is only reported as an unknown parameter (`resolveParams` in `src/core/params.ts`). Translate it instead: for those eleven, an old `inOut` becomes the matching `@length` (the declared entrance and exit plus the saved hold, within the length's limits) when no length is set, with a unit test per kind of saved work.

- **Linux CI: 8K frames are clipped by one pixel** (CI run 40240858897 on `fb2b3a5`, `render-linux`): the virtual screen is exactly 7680 × 4320, and an offscreen window is kept inside it, so the 8K test captured 7679 × 4319. The CI virtual screen is now 8192 × 4608, larger than any render; the underlying clipping is the Linux issue above.

- **Linux: a render is clipped to the screen.** On Linux an offscreen render window is kept inside the screen, so on a 1920 × 1080 display a 1080p frame was captured at 1919 × 1079 and the render refused it (CI run 40240070884, `render-linux`, before its virtual screen was enlarged). CI now uses a 7680 × 4320 virtual screen, but a person on a 1080p Linux desktop would still hit it, and 4K or 8K renders on a smaller screen likewise. Make offscreen windows independent of the screen size on Linux, or size the capture another way, and test it on a small virtual screen.

- **Visual regression references only match the machine that made them.** `tests/visual/references.json` holds perceptual hashes made on the maintainer's Mac; on CI's Windows runner, its macOS virtual machine and Linux, frames differ by 7 to 64 bits against `HASH_TOLERANCE` = 6 (CI run 40237022619), so `tests/e2e/visual.e2e.test.ts` is skipped on CI and runs locally only. Make references work across platforms: references per platform (approved from each platform's own run), or a comparison tuned so that rendering differences between machines pass and a moved, recoloured or missing element still fails, then run it on CI again.


(Fixed: "Animate in/out" and a declared structure disagreeing — a fixed `structure` could not allow for a parameter that makes the entrance slower, and capping the parameter would have taken a published range away; declaring instead the hold that holds at *every* value the parameter can take costs nothing, since the shorter settings only sit still for longer inside the declared entrance, and the thirty templates it held up now declare their parts. Before that, the macOS runner's blank single-frame renders — the Boardroom lower third at frame 90 read alpha 0 where its backing tint is, CI run 40244410162, after `7d819f9` had drained the load's paints — the drain could finish before its own paint arrived on a slow machine, and now waits for it first; see `docs/platform-notes.md`, "A paint left over from the page load". Before that, the sample-media end-to-end test ran close to its nine-minute bound — the generator made its 304 files one at a time, and now runs the sounds several at a time alongside the drawn files, 54 s against 121 s. Before that, the Parameters tab put a slot's card after "Layout and timing" — a parameter naming that card as its element made a card of it where it was declared, and now joins the last card instead. Before that, the collection tray kept stale confirmations — they fade now and go when the collection changes, while an error waits to be read. Before that, a squeezed stage left the picture 2 px tall and hidden, so a click on Windows had nothing to hit — the picture keeps a floor now and the stage's chrome yields; see `docs/platform-notes.md`. Before that, clicking a layer on the stage missed it on Windows — the overlay could hit-test a report that lagged the frame on screen, and asked for a pixel-exact hit on a preview 157 px wide; see `docs/platform-notes.md`. Before that, results rows taller than wide cards needed — a mixed grid now lays out at 16:9 and takes the taller pitch only when everything shown is square or taller, `gridRatio` in `src/core/results-view.ts`. Before that, the Windows-only layers failures were a throttled renderer that ran no animation frames on the CI runner; `73b7c17`, see `docs/platform-notes.md`.)

## Ideas

- **Display names for library folders**: let a person rename how a folder shows in the browse tree, without renaming it on disk.
- **"All caps" as a template option**: the Newsdesk set forces capitals; this would make it a parameter, on by default.
- **Music moods**: a fourth taxonomy axis for audio (upbeat, dramatic, calm…). ADR 0010 leaves it for milestone 16.
- **A settings window:** every setting now kept only in `settings.json` (one section open at a time, cache limit, default folders, the ffmpeg location, card size and more) reachable in a window opened from the application menu's Settings (milestone 27), with reset to defaults.
- **Reliability under real use:** the render queue survives a restart or a crash; a failed job can be retried and says why it failed in plain words; running out of disk space, or a missing ffmpeg on first run, is handled with a clear message rather than an error (ties to milestone 17's ffmpeg decision).
- **Scale and speed:** performance tests on a generated library of 10,000 or more items (indexing, search, thumbnails, memory, startup time, render speed at 4K), with budgets that fail CI when they slip; milestone 26's asset libraries make this matter.
- **Security review:** a threat model for templates and packs as untrusted code (a decision record), an audit of Electron's hardening (context isolation, sandbox, content security policy, protocol handlers, navigation and new windows), and automatic dependency update alerts.
- **Template versions in saved work:** presets, collections and `.pulp` projects record which version of each template they used, so updating a bundled template never silently changes a saved project; part of milestone 8's format-versioning work.
- **Localisation** (after 1.0): UI strings moved out of the code so they can be translated; right-to-left and complex scripts in text layers (Noto Sans is bundled).
- **Light and high-contrast themes** (after 1.0), following the system setting; Pulp is dark-only today.
- **Customisable keyboard shortcuts** (after 1.0), once the application menu exists.
