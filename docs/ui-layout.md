# UI layout: regions and the order they are built

Status: a plan, written 2026-10-23. It describes the window Pulp is heading for and the order in which the milestones in `ROADMAP.md` build it. `docs/system-design.md` describes the code as it is. When the two disagree, this file is the intent and the roadmap is the schedule.

## Today's window

Three columns, built in plain DOM (`src/renderer/main.ts`, ADR 0006):

- **Sidebar** (left): search field, add folder, rescan, pack import and export, a flat result list with thumbnails, a library summary.
- **Stage** (center): preview of a template or media item, play and scrub with timecode, details, favorite toggle and tag chips.
- **Inspector** (right): parameter form with undo and saved presets, render options and trim, CSV batch, Render, the drag handle and render cache, the render queue, pack export.

It is close in spirit to the target. What it lacks: a way to browse by type and theme, a grid, a richer player, a place to gather several items and render them together, output settings per item, and a guided path for first use.

## Target: seven regions

| Region | Where | What it does |
|---|---|---|
| **Browse panel** | left | A tree with sections: Types (group → type), Themes, Styles, Packs, Folders, Favorites, Recent. Each node shows an item count. Selecting a node sets the **scope**: the results and the search are narrowed to it. Clearing the selection widens back to everything. |
| **Search bar** | above the results | Search field; a **scope chip** naming the selected node ("in: Lower thirds › Sports", × to clear); recent searches; filter chips for alpha, loop, duration and resolution; sort; grid/list toggle; thumbnail size. |
| **Results** | center | **Grid of cards**: thumbnail with hover-scrub, name, badges (alpha, loop, duration, resolution, audio variants, pack). **List view** for audio and long lists: name, duration, type, themes, file. **Audition mode**: autoplay with arrow keys. A card can be dragged to the collection tray, to the stage, or straight out to an editor once rendered. |
| **Stage** | center, above the results in a resizable split | The player: play/pause, loop toggle, frame step, in and out marks, timecode, volume and mute. A **background toggle** (checkerboard, black, white, custom) for checking alpha. Title-safe and action-safe overlay. A **waveform** under the scrub bar for audio and for templates with sound. **Stem lanes** for layered music, one waveform per layer with mute and solo. A **variant picker** for paired sound effects. |
| **Inspector** | right | Tabs: **Parameters** (the form as today, with undo and presets), **Output** (preset, size, frame rate, duration and loop extension, speed, alpha type, matte pass, audio embedded or separate, save folder, file-name pattern), **Info** (metadata, license, pack, tags, favorite, themes and styles, editable where the item is the user's). |
| **Collection tray** | right column below the inspector, or a bottom drawer; collapsible | Items gathered while browsing, as small cards, each with its own output settings. **Apply to all**, save and load as a file, **Render all** with per-item and total progress. It absorbs today's render queue. |
| **Guided setup** | modal | Numbered steps: what it is for, size and frame rate, format and alpha, audio, where to save. A live preview over a checkerboard, a settings summary, "save as default for this type", Add to collection. |
| **Status bar** | bottom | ffmpeg found or missing, library counts, cache size, scans and renders in progress, a "copy diagnostics" entry point. |

The guided setup is a modal rather than a layout region; it is listed here because it reuses the stage's player and the Output tab's settings.

## Where today's features go

Nothing is dropped; everything moves into a region.

| Today | Target region |
|---|---|
| Search field | Search bar |
| Add folder, rescan, library summary | Browse panel (Folders section) and status bar |
| Pack import and export | Browse panel (Packs section) |
| Flat result list with thumbnails | Results, list view (the grid is added later) |
| Preview, play, scrub, timecode | Stage |
| Details, favorite, tag chips | Inspector, Info tab |
| Parameter form, undo, saved presets | Inspector, Parameters tab |
| Render options, trim, CSV batch, Render | Inspector, Output tab |
| Drag handle, Prepare for drag, render cache | Collection tray (finished items keep a drag handle) |
| Render queue | Collection tray (stays the queue until collections replace it) |
| ffmpeg status, counts | Status bar |

## Shared state

Regions render from one shared state and write to it through a small set of actions. They never reach into one another's DOM. The state is:

- **scope**: the selected browse node, or none;
- **query**: the search text and parsed filters, plus sort and view mode;
- **results**: the items matching scope and query;
- **shown item**: what the stage and inspector display;
- **collection**: the gathered items with their settings;
- **jobs**: queued, running and finished renders;
- **library status**: roots, scans in progress, ffmpeg detection, cache size.

This contract holds whatever renders the regions. The plain DOM versus component framework question (below) is about how a region turns state into elements, not about this list.

## Build order and why

1. **The framework decision first (ADR 0009).** ADR 0006 kept plain DOM through milestone 3 and said to revisit at milestone 4, the library milestone. Milestone 4 has since been built in plain DOM, with a filterable list, thumbnails and media preview, and the UI file is about 1,600 lines. The revisit is due, and it has to come before the shell is built, not halfway through it: the shell is the largest UI change the project will make, and porting it later would churn tested code twice. The ADR is a time-boxed spike, one region built both ways, with the decision recorded either way. The UI end-to-end test (`tests/e2e/ui.e2e.test.ts`) must pass across whichever port follows; selectors may move, behavior may not.
2. **The shell (milestone 11).** The seven regions as resizable, collapsible panes with sizes kept in `settings.json`, and today's features moved into them as the table above says. At the end of this milestone the app does what it does today, arranged as the target.
3. **Slot-ins.** Once the regions exist, later milestones fill them without changing the layout:
   - milestone 10 puts the type, theme and style tree into the browse panel and lights up the scope chip;
   - milestone 12 turns the list into a grid of cards, upgrades the player, adds waveforms and audition mode;
   - milestone 13 turns the queue in the tray into collections with save, load and Render all;
   - after 1.0, milestone 14 adds the guided setup and per-type defaults in the Output tab, milestone 15 adds media conversion, loop tools, matte pass and recolor to the Output tab, and milestone 16 adds stem lanes and the variant picker to the stage.
4. **Hardening (milestone 8)** runs its accessibility pass and documentation against the finished layout, so keyboard navigation covers the tree, the grid, the player and the tray.

## Features the layout implies

Each of these is a checklist item in the milestone named.

| Feature | Milestone |
|---|---|
| Browse tree with counts, scope chip, `type:`, `theme:` and `style:` filters, themes and styles editable in Info | 10 |
| Grid of cards with badges, list view, grid/list toggle, thumbnail size | 12 |
| Hover-scrub thumbnails: a cached sprite strip per video or template, stepped by pointer position | 12 |
| Player: loop, frame step, in and out marks, background toggle, safe-area overlay | 12 |
| Waveforms: peak data computed once per audio file, cached like thumbnails | 12 |
| Audition mode for audio lists | 12 |
| Collection tray, save and load, Apply to all, Render all | 13 |
| Defaults per type, guided setup | 14 |
| Converting library media with the same presets; audio-only options | 15 |
| Loop tools: extend a loopable background with a crossfade join, speed | 15 |
| Matte pass: a separate alpha file for codecs and editors without alpha | 15 |
| Recolor at render time for stock media | 15 |
| Stems with mute and solo; paired sound effects with variants | 16 |

## What stays true throughout

- Logic lives in `src/core` and is unit tested; regions are thin.
- The UI end-to-end test keeps passing at every commit; it drives the real app over the DevTools protocol and is the proof that a move did not lose a feature.
- Everything works offline. There are no previews of content the user does not have, no content installs, no online updates; a marketplace stays a non-goal (`docs/system-design.md`).
- Pane sizes, collapsed panes, view mode and thumbnail size are per user in `settings.json`, written atomically like the rest.
- Keyboard: every region is reachable and operable without a pointer by milestone 8.

## Open questions, to settle in milestone 11

- Collection tray: below the inspector in the right column, or a drawer along the bottom that spans the window. The drawer gives wider cards and room for progress; the column keeps the center for results. Prototype both in the shell and pick one.
- Stage split: the stage above the results (the preview stays large) or the results filling the center with the stage as a resizable pane that can collapse. Default to the split with a remembered size.
- Default view: grid for visual items and list for audio, or one setting for all. Default to per kind.
- Whether Info (tags, favorite) also keeps a compact strip under the stage, as today, or lives only in the tab.
