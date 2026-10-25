# Ideas

Where work waits before it is on the roadmap. `ROADMAP.md` is the plan; this file is what comes before it: suggestions not yet decided, decisions not yet scheduled into a milestone, and known issues not yet fixed.

## How an idea moves

1. **Idea.** Anyone may suggest one. It goes under [Ideas](#ideas) with a line on what it is and why.
2. **Decided.** When the maintainer agrees to it, it moves to [Decided](#decided), with what was decided and what "done" looks like.
3. **Scheduled.** When a request schedules it, it is written into `ROADMAP.md` (a new milestone, or items in an existing one) and removed from this file in the same commit. A new milestone takes the next milestone number and gets its own GitHub issue, whose number the roadmap gives beside it (see CONTRIBUTING.md).

Known issues follow the same path: a bug found and understood goes under [Known issues](#known-issues), and leaves when it is fixed or scheduled.

Each move is a commit, so the history shows when an idea was decided and where it went.

## Suggested order

The maintainer's intended sequence for what is decided here and what is already on the roadmap (milestones 23, 24 and 25 are done). Scheduling follows it unless a request says otherwise.

1. **Quick wins from Decided:** the category search filters the tree; the tree shows only where you are; ghost slots throughout the results grid; element cards for every bundled template; the Festival themes; browse tree counts for screen readers.
2. **Protection before the larger work:** CI on every platform (macOS, Linux end to end, dependency audit) and visual regression tests for the bundled templates.
3. **Milestone 26:** assets on the stage, with the generated asset library (scheduled; the categories and the first generated examples are in).
4. **Milestone 27:** projects and the application menu.
5. **Milestone 20:** social-ready export.
6. **Milestone 8:** 1.0 hardening and docs, taking in third-party notices and the release basics, and whichever of the settings window, reliability, security review and template versions in saved work have been decided by then.
7. **Last:** milestone 17 (unsigned builds and the app icon), then milestone 7 (signing and auto-update).

## Decided

1. **Ghost slots throughout the results grid** (milestone 12's area). Faint card outlines show today only when there are no results. They should also fill the unused cells after the last card and the rows below it down to the bottom of the region, at the current card size, in grid and rows view; and a card whose thumbnail hasn't drawn yet shows the same outline instead of a blank box, so a loading grid reads as slots waiting to fill. A very subtle cue: a hairline in the border colour at low opacity, no fill, no shimmer or motion, out of the tab order and hidden from screen readers.

2. **Parameters tab by element, for every bundled template** (milestone 23). The card-per-element tab (an `element` field beside `group`) is in place, but only Title Card and Lower Third Bar name their elements. Every other bundled template should do the same (Panel, Title, Subtitle, Logo, Background and so on), with its text colour on its text layers, so no template keeps the flat "Colors" group.

3. **Windows checks in milestones 2 and 5: a VM, not "hardware-blocked".** Both milestones' Windows items say they need a Windows machine and that milestone 17's builds make it easy. The plan now is a local Windows 11 VM on the maintainer's Mac, used for these checks and for debugging Windows-only failures. Reword both items to say so; if Premiere Pro or DaVinci Resolve can't run in the VM, the checks wait for a real Windows machine and stop blocking 1.0.

4. **Milestone 9's "command-line interface as a separate entry point": redefine it.** Pulp already renders without its window through `--render`, `--param` (including `@layers`), `--collection` and CSV batch. Redefine the item as packaging those as a proper `pulp` command (its own entry point, `pulp render …` and `pulp collection …`, help text, exit codes, documented in the README) rather than building a second interface, and re-estimate it.

5. **The Festival samples carry every celebration theme.** Its templates are tagged with all the holiday themes at once, so they turn up under each one. Give each Festival piece the one or two themes it fits, as the other sets do (ADR 0010's rule that a child theme never repeats its parent still holds), and keep the coverage test passing.

6. **Browse tree counts for screen readers** (milestone 8's accessibility pass). The tree's item counts are `aria-hidden`, so a screen reader hears "Lower third" with no count. Counts should read as part of each node's name, for example "Lower third, 5 items".

7. **The category search filters the tree itself** (a change to milestone 24's find field, now done; schedule it as an item in milestone 25 or on its own). Today typing in the browse panel's find field lists matches in a dropdown, and choosing one only unfolds the path to it, so a category near the end of the tree can still be thousands of pixels down. Instead, as each letter is typed, every node that no longer matches disappears from the tree; matching categories stay under their section heading (Types, Themes, Styles, Packs, Folders) and group so it is clear where each lives, and because everything else is hidden they sit at the top of the panel with no scrolling. The matched letters are highlighted. While a search is active, every section holding a match stays open (overriding one-section-at-a-time); clearing the field restores the tree exactly as it was, folds included. Clicking a remaining category, or Enter for the first, selects it and scopes the results as now; "No category matches" when nothing does. Keyboard first, as before.

8. **The browse tree shows only where you are** (refines milestone 24's one-section-open item). Today the tree starts fully open, the accordion folds others only once a section is opened, and choosing a category from the find field only opens its path ("a find is a jump, not a reorganisation"). Instead, with the accordion setting on (the default): on launch every section and group is folded except the path to the active category, or Quick access alone when nothing is active; choosing a category, by click or through the find field, opens its path and folds everything else. While a find is being typed, the tree-filter behaviour (item 7) shows every section holding a match; once one is chosen the tree folds back to just its path. With the setting off, folding stays free as today.

9. **Projects and the application menu.** A new milestone, **27**, placed right after 26 (placed layers and assets are what a project most needs to keep). Today there is no menu code: macOS shows Electron's default menu, named "Electron", and Windows a bare default bar; nothing in them is Pulp's. And a `.pulpcollection` file can be saved and opened, but nothing saves a session as a whole.
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

10. **CI on every platform.** CI runs Ubuntu (unit tests only; the end-to-end suite skips there for want of a display) and Windows, and has no macOS job, though macOS is the main development platform and the only one with the VideoToolbox HEVC path. Add a macOS job running the full suite including HEVC with alpha; run the Linux end-to-end suite under a virtual display (Xvfb); add a dependency audit that fails on known high-severity issues. Each job keeps the bounded processes, per-test reporter and timeouts the Windows job has.

11. **Visual regression tests for the bundled templates.** Every bundled template rendered at each aspect it declares, at a few fixed frames, and compared in CI against approved reference images (small PNGs or perceptual hashes) with a stated tolerance, so a change that alters how a template looks fails with the template, aspect and frame named. Updating references is a deliberate, reviewed step with its own command. Covers default parameters first; layers, motion overrides and image slots after.

12. **Third-party notices, release process and project basics.** A third-party notices file covering Electron and Chromium, the npm dependencies, the bundled fonts and ffmpeg if it is ever bundled, shown in an "Acknowledgements" screen reached from About, and checked in CI so a new dependency cannot ship unlisted; required before any build is distributed (milestone 17). A release process: version numbers, release notes drawn from the changelog's Unreleased section, a tag per release. Issue and pull request templates, a code of conduct, and a `SECURITY.md` saying how to report a vulnerability.

## Known issues

- **The sample-media end-to-end test is close to its time limit.** `tests/e2e/render.e2e.test.ts` ("makes the whole sample-media folder…") generates the whole catalogue, now about 250 files, inside a 9-minute bound. Run alone it passes; inside a full `npm test` on a busy machine it ran out of time once (2026-10-25). Make it fit comfortably: generate in parallel where the generator allows, or check a representative subset end to end and the full catalogue in a separate, longer job.


(Fixed: clicking a layer on the stage missed it on Windows — the overlay could hit-test a report that lagged the frame on screen, and asked for a pixel-exact hit on a preview 157 px wide; see `docs/platform-notes.md`. Before that, results rows taller than wide cards needed — a mixed grid now lays out at 16:9 and takes the taller pitch only when everything shown is square or taller, `gridRatio` in `src/core/results-view.ts`. Before that, the Windows-only layers failures were a throttled renderer that ran no animation frames on the CI runner; `73b7c17`, see `docs/platform-notes.md`.)

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
