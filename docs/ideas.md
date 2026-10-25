# Ideas

Where work waits before it is on the roadmap. `ROADMAP.md` is the plan; this file is what comes before it: suggestions not yet decided, decisions not yet scheduled into a milestone, and known issues not yet fixed.

## How an idea moves

1. **Idea.** Anyone may suggest one. It goes under [Ideas](#ideas) with a line on what it is and why.
2. **Decided.** When the maintainer agrees to it, it moves to [Decided](#decided), with what was decided and what "done" looks like.
3. **Scheduled.** When a request schedules it, it is written into `ROADMAP.md` (a new milestone, or items in an existing one) and removed from this file in the same commit. A new milestone takes the next milestone number and gets its own GitHub issue, whose number the roadmap gives beside it (see CONTRIBUTING.md).

Known issues follow the same path: a bug found and understood goes under [Known issues](#known-issues), and leaves when it is fixed or scheduled.

Each move is a commit, so the history shows when an idea was decided and where it went.

## Suggested order

The maintainer's intended sequence for what is decided here and what is already on the roadmap (milestones 23, 24 and 25 are done; **26 is the one in progress**). Scheduling follows it unless a request says otherwise.

1. **Quick wins from Decided:** all done — ghost slots, element cards for every bundled template, the Festival themes, and browse tree counts for screen readers. (The category search filtering the tree, and the tree showing only where you are, are done — milestone 24.)
2. **Protection before the larger work:** done — every bundled template is hashed at each aspect and a few fixed frames (`tests/e2e/visual.e2e.test.ts`, 124 templates in `tests/visual/references.json`). It runs locally only until the cross-platform known issue above is settled. CI runs on Windows, macOS and Linux with a dependency audit.
3. **Milestone 26: assets on the stage** — *in progress.* The Assets type group and the first two generated examples per category are in; what remains is six per category plus the Objects kind, asset libraries, Video layers, drop-onto-the-stage, and the rights-and-performance item. This is where a new session picks up.
4. **Rotate layers on the stage** (Decided item 7).
5. **Timing: any length, set while editing** (Decided item 5).
6. **Milestone 27:** projects and the application menu.
7. **The start screen:** examples, recent projects, a tour and a dashboard (Decided item 6).
8. **Milestone 20:** social-ready export.
9. **Milestone 8:** 1.0 hardening and docs, taking in third-party notices and the release basics, and whichever of the settings window, reliability, security review and template versions in saved work have been decided by then.
10. **Last:** milestone 17 (unsigned builds and the app icon), then milestone 7 (signing and auto-update).

## Decided

1. **Windows checks in milestones 2 and 5: a VM, not "hardware-blocked".** Both milestones' Windows items say they need a Windows machine and that milestone 17's builds make it easy. The plan now is a local Windows 11 VM on the maintainer's Mac, used for these checks and for debugging Windows-only failures. Reword both items to say so; if Premiere Pro or DaVinci Resolve can't run in the VM, the checks wait for a real Windows machine and stop blocking 1.0.

2. **Milestone 9's "command-line interface as a separate entry point": redefine it.** Pulp already renders without its window through `--render`, `--param` (including `@layers`), `--collection` and CSV batch. Redefine the item as packaging those as a proper `pulp` command (its own entry point, `pulp render …` and `pulp collection …`, help text, exit codes, documented in the README) rather than building a second interface, and re-estimate it.

3. **Projects and the application menu.** A new milestone, **27**, placed right after 26 (placed layers and assets are what a project most needs to keep). Today there is no menu code: macOS shows Electron's default menu, named "Electron", and Windows a bare default bar; nothing in them is Pulp's. And a `.pulpcollection` file can be saved and opened, but nothing saves a session as a whole.
   - **The `.pulp` project file**, a superset of the collection file: the collection with every item's parameters, layers, stage positions (milestone 25) and placed assets (milestone 26), the output settings, the render folder, and which library folders it draws from. New, Open, Save, Save As and Open Recent; the window title shows the project's name with a mark for unsaved changes, and closing asks before discarding them. Autosave with recovery after a crash. Media that moved or went missing is flagged, not failed (references by library id and by path, as collections keep them), with a way to relink it. Existing `.pulpcollection` files still open and can be saved as `.pulp`. Written atomically like every other file; versioned with a compatibility rule like the template format.
   - **The application menu**, Pulp's own on every platform (the macOS menu bar; a menu bar in the window on Windows and Linux):
     - **Pulp** (macOS): About Pulp, Settings, Hide, Quit.
     - **File:** New project, Open…, Open Recent, Save, Save As, Close; Add library folder…, Add sample media, Import font…; Render, Render all; Export pack….
     - **Edit:** Undo and Redo wired to Pulp's own history; Cut, Copy, Paste, Select All; Find category.
     - **View:** show or hide the browse panel, stage, inspector and tray; grid or rows; card size; full screen. Developer tools only in development builds.
     - **Playback:** play/pause, step a frame, set in, set out, loop.
     - **Window** and **Help:** the keyboard shortcut list, the user guide (milestone 8), copy diagnostics.
     - Every item has its keyboard shortcut, the same as the buttons that do the same thing, and is enabled only when it can act.
   - Opening a `.pulp` file by double-clicking it needs the packaged app, so the file association lands with milestone 17.

4. **Third-party notices, release process and project basics.** A third-party notices file covering Electron and Chromium, the npm dependencies, the bundled fonts and ffmpeg if it is ever bundled, shown in an "Acknowledgements" screen reached from About, and checked in CI so a new dependency cannot ship unlisted; required before any build is distributed (milestone 17). A release process: version numbers, release notes drawn from the changelog's Unreleased section, a tag per release. Issue and pull request templates, a code of conduct, and a `SECURITY.md` saying how to report a vulnerability.

5. **Timing: any length, set while editing.** A new milestone placed right after milestone 26 and before 27 (a saved project has to keep it). Today a template's length is fixed in its manifest (mostly 5-8 seconds); Set in and Set out only shorten it, the frame rate changes how many frames are drawn but not how long, and only a few templates expose pacing parameters ("Animate in/out", "Hold, seconds", speeds). A lower third that should stay up for twenty seconds can't. Instead:
   - **Templates declare their structure:** an animate-in part, a hold, and an animate-out part (documented and validated in the format). The host remaps time so the entrance and exit keep their designed speed and only the hold stretches or shrinks; a template that declares no structure keeps its fixed length, as now.
   - **Length is set while editing, not only on output:** a Length control in the Parameters tab's "Layout and timing" card (seconds or timecode, with a minimum of entrance plus exit), and a scrub bar that shows the in, hold and out parts as shaded segments, whose end and hold edges can be dragged. The preview plays at the new length at once.
   - **Everything downstream picks it up:** the Output tab shows it (and trims within it), and presets, collections, CSV batch, the render cache key and the command line (`--length`) carry it.
   - **Backgrounds and loops repeat seamlessly** to any length (bringing forward milestone 15's loop item); **transitions** keep their designed length, with an optional speed control.
   - The bundled templates declare their parts; titles, lower thirds, callouts and overlays first. Undo covers every length change.

6. **A start screen: examples, recent projects, a tour and a dashboard.** A new milestone placed right after milestone 27 (it needs `.pulp` projects). Shown at launch and from File → Home, with a "Show at startup" switch.
   - **Get going:** New project, blank or by shape (16:9, 9:16, 1:1, 4:5), and by platform once milestone 20 exists. **Example projects:** a handful of ready-made `.pulp` files built from the bundled samples, each showing something Pulp does well (an interview with a lower third and a logo, a sports-highlight opener, a vertical social clip, a wedding title, a news package with ticker and bug, a product launch with layers and motion); opening one opens a copy, so the example stays as it was.
   - **Recent projects** with thumbnails, last-opened dates and pinning; a missing file shows as missing, with a way to relink it.
   - **Learn:** "Take the tour", a short guided walkthrough of the window (browse panel, stage, Parameters tab, collection tray) with highlights and Next / Skip, offered on first launch and replayable from Help; "What's new" from the changelog's latest release; keyboard shortcuts and the user guide (milestone 8).
   - **Set up and status:** a first-run checklist (ffmpeg found, a library folder added, sample media made), each item a button that does it; the library at a glance (template and media counts, most-used categories, favourites); quick actions (add a library folder, import a pack, import a font). Milestone 14's "guided setup" can fold into the checklist.

7. **Rotate layers on the stage** (extends milestone 25's placement; placed right after milestone 26). Placement is move and scale only today. Add rotation: a rotate handle just above the selected layer's outline turns it about its centre, Shift snaps to 15° steps, and an angle field in the layer's card sets it exactly; "Reset position" clears rotation with offset and scale. Stored with the placement per aspect, in degrees, so a 16:9 layout's rotation doesn't move the 9:16 one. The host applies it around the template's own draw of the layer, like offset and scale, so templates need no changes and the layer's motion still plays, rotated. Selection, hit-testing and snapping follow the rotated outline. Presets, collections, CSV, the cache key and undo carry it.

## Known issues

- **Linux CI: 8K frames are clipped by one pixel** (CI run 40240858897 on `fb2b3a5`, `render-linux`): the virtual screen is exactly 7680 × 4320, and an offscreen window is kept inside it, so the 8K test captured 7679 × 4319. The CI virtual screen is now 8192 × 4608, larger than any render; the underlying clipping is the Linux issue above.
- **Linux CI: colours one step off** (same run): three render tests read 218 where they expect exactly 217. Ubuntu's ffmpeg is 6.1, while Windows and macOS have 8 or 9, and it rounds the colour conversion a shade differently. Install a current ffmpeg on the Linux job, or allow a one-step tolerance in those checks.
- **macOS CI: a blank frame can still slip through** (same run, `render-macos`): "renders between in and out points…" read 0 where it expected 217. `7d819f9` (draining the load's paints before the first frame) made the macOS job green once, so the stale-capture cause is narrowed but not gone.

- **Linux: a render is clipped to the screen.** On Linux an offscreen render window is kept inside the screen, so on a 1920 × 1080 display a 1080p frame was captured at 1919 × 1079 and the render refused it (CI run 40240070884, `render-linux`, before its virtual screen was enlarged). CI now uses a 7680 × 4320 virtual screen, but a person on a 1080p Linux desktop would still hit it, and 4K or 8K renders on a smaller screen likewise. Make offscreen windows independent of the screen size on Linux, or size the capture another way, and test it on a small virtual screen.

- **Visual regression references only match the machine that made them.** `tests/visual/references.json` holds perceptual hashes made on the maintainer's Mac; on CI's Windows runner, its macOS virtual machine and Linux, frames differ by 7 to 64 bits against `HASH_TOLERANCE` = 6 (CI run 40237022619), so `tests/e2e/visual.e2e.test.ts` is skipped on CI and runs locally only. Make references work across platforms: references per platform (approved from each platform's own run), or a comparison tuned so that rendering differences between machines pass and a moved, recoloured or missing element still fails, then run it on CI again.

- **The macOS blank-first-frame fix is unconfirmed on the runner.** The CSV batch render coming out blank for the row with a logo was traced to a paint left over from the page load satisfying the first frame's wait, and fixed by draining those paints (`drainPaints` in `src/main/render.ts`, `docs/platform-notes.md`). It never reproduced locally — not under `--disable-gpu --disable-gpu-compositing`, not under repeats on a loaded machine — so the cause is established by elimination from the pixel geometry rather than by a failing-then-passing run. A macOS CI run on `7d819f9` or later closes this; if `render-macos` fails the same way again, the reasoning in the platform note is where to start.

(Fixed: the sample-media end-to-end test ran close to its nine-minute bound — the generator made its 304 files one at a time, and now runs the sounds several at a time alongside the drawn files, 54 s against 121 s. Before that, the Parameters tab put a slot's card after "Layout and timing" — a parameter naming that card as its element made a card of it where it was declared, and now joins the last card instead. Before that, the collection tray kept stale confirmations — they fade now and go when the collection changes, while an error waits to be read. Before that, a squeezed stage left the picture 2 px tall and hidden, so a click on Windows had nothing to hit — the picture keeps a floor now and the stage's chrome yields; see `docs/platform-notes.md`. Before that, clicking a layer on the stage missed it on Windows — the overlay could hit-test a report that lagged the frame on screen, and asked for a pixel-exact hit on a preview 157 px wide; see `docs/platform-notes.md`. Before that, results rows taller than wide cards needed — a mixed grid now lays out at 16:9 and takes the taller pitch only when everything shown is square or taller, `gridRatio` in `src/core/results-view.ts`. Before that, the Windows-only layers failures were a throttled renderer that ran no animation frames on the CI runner; `73b7c17`, see `docs/platform-notes.md`.)

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
