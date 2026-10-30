# UI layout: regions and the order they are built

Status: a plan, written 2026-10-23. It describes the window Pulp is heading for and the order in which the milestones in `ROADMAP.md` build it. `docs/system-design.md` describes the code as it is. When the two disagree, this file is the intent and the roadmap is the schedule.

## Today's window

The window in this plan is built. The regions are resizable, collapsible panes with their sizes and collapsed state in `settings.json` (`src/core/layout.ts`, `src/renderer/shell.ts`); the browse panel holds the tree (milestone 10); the inspector has its Parameters, Output and Info tabs; the results are a windowed card grid or list with the grid/list toggle and thumbnail size in the search bar (`src/core/results-view.ts`, `src/core/virtual-list.ts`), cards scrub through a cached frame strip on hover (`src/core/hover-scrub.ts`), the player has loop, frame step, in and out marks, volume, a background toggle and safe areas, and a layer can be selected, dragged, scaled and nudged on the stage itself (milestone 25, `src/renderer/stage-layers.ts`) (`src/core/player.ts`), and audio shows a waveform and can be auditioned with the arrow keys (`src/core/waveform.ts`) — milestone 12. The tray is the collection tray of milestone 13: items gathered with their own output settings, saved and reopened as a file, rendered together, with the finished renders as cards that are themselves the drag source (`src/core/collection.ts`, `src/core/queue-card.ts`). The start screen (milestone 31, `src/renderer/start-screen.ts`) sits over the whole window at launch and from File → Home: get going (new project, blank or by shape, and the bundled examples), recent projects with pins, Learn (the tour, what's new, the shortcuts), the setup checklist and "What are you making?". What the window still lacks arrives with the milestones named below: per-type defaults and the guided setup (14), converting media (15), and stem lanes and the variant picker (16), with the aspect and resolution choice of milestone 19 and the platform presets of milestone 20 landing in the Output tab.

## Target: seven regions

| Region | Where | What it does |
|---|---|---|
| **Browse panel** | left | A find-a-category field over a tree that opens on what things are (milestone 34, `src/core/categories.ts`): Lower thirds, Titles and openers, End cards, Matching sets, Animated backgrounds, Still backgrounds, Overlays and frames, Transitions and wipes, Design elements, Effects, Objects, Stock video, Photos and stills, Music, Sound effects — the taxonomy's types beneath the ones that gather several, packs beneath Matching sets — then Quick access (Favorites, Recently used) and My folders. Themes and styles are not trees: they are the **For…** and **Look** chips in the search bar, narrowing whatever category is chosen. Each node shows an item count and a one-line description on hover. Typing in the field **filters the tree itself** — what no longer matches disappears, what remains keeps its section and group, the matched letters are lit, and every section holding a match is open while the search lasts; clearing restores the tree exactly. The panel shows only where you are: folded to the active category's path, or Quick access alone, and choosing a category folds the tree to it. Selecting a node sets the **scope**: the results and the search are narrowed to it. Clearing the selection widens back to everything. |
| **Search bar** | above the results | Search field; a **scope chip** naming the selected node ("in: Lower thirds › Sports", × to clear); recent searches; filter chips for alpha, loop, duration and resolution; sort; grid/list toggle; thumbnail size. |
| **Results** | center | **Grid of cards**: thumbnail with hover-scrub, name, badges (alpha, loop, duration, resolution, audio variants, pack). **List view** for audio and long lists: name, duration, type, themes, file. **Audition mode**: autoplay with arrow keys. A card can be dragged to the collection tray, to the stage, or straight out to an editor once rendered. |
| **Stage** | center, above the results in a resizable split; collapsible to a thin bar | The player: play/pause, loop toggle, frame step, in and out marks, timecode, volume and mute. A **background toggle** (checkerboard, black, white, custom) for checking alpha. Title-safe and action-safe overlay. A **waveform** under the scrub bar for audio and for templates with sound. **Stem lanes** for layered music, one waveform per layer with mute and solo. A **variant picker** for paired sound effects. |
| **Inspector** | right | Tabs: **Parameters** (the form as today, with undo and presets), **Output** (preset, aspect and output resolution, frame rate, duration and loop extension, speed, alpha type, matte pass, audio embedded or separate, save folder, file-name pattern), **Info** (a property panel: a header card with the item's picture, name, type and favorite, then collapsible sections — About, Format, Categories, Tags, Set, File, Credits and license, Usage — as key–value rows, with tags and themes editable where the item is the user's). |
| **Collection tray** | bottom drawer under the center and right columns; resizable, collapsible to a one-line summary, opens when the first item is added | Items gathered while browsing, as small cards, each with its own output settings. **Apply to all**, save and load as a file, **Render all** with per-item and total progress. It absorbs today's render queue. A finished card **is** the drag source — grip, whole card draggable, hint on hover and focus — and offers Reveal, Copy path and Remove; the file's path is in its tooltip, never in its text (`docs/ui-style.md`). |
| **Guided setup** | modal | Numbered steps: what it is for, size and frame rate, format and alpha, audio, where to save. A live preview over a checkerboard, a settings summary, "save as default for this type", Add to collection. |
| **Status bar** | bottom | ffmpeg found or missing, library counts, cache size, scans and renders in progress, a "copy diagnostics" entry point. |

The guided setup is a modal rather than a layout region; it is listed here because it reuses the stage's player and the Output tab's settings.

## Where today's features go

Nothing is dropped; everything moves into a region.

| Today | Target region |
|---|---|
| Search field | Search bar |
| Add folder, rescan, library summary | Browse panel (My folders) and status bar |
| Pack import and export | Browse panel (Matching sets) |
| Flat result list with thumbnails | Results, list view (the grid is added later) |
| Preview, play, scrub, timecode | Stage |
| Details | Inspector, Info tab |
| Favorite, tag chips | A compact strip under the stage (star, chips, quick-add) and the Info tab; same state in both |
| Parameter form, undo, saved presets | Inspector, Parameters tab |
| Render options, trim, CSV batch, Render | Inspector, Output tab |
| Drag handle, Prepare for drag, render cache | The finished card itself is the drag source; **Prepare for drag** is an action on the item in the Output tab, next to Render; the cache lives in the tray's footer |
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
   - milestone 19 makes templates a shape rather than a pixel size: the Output tab chooses the aspect and the resolution, the search bar gains an orientation chip, cards take a portrait item's own shape, and the stage's safe areas gain vertical zones;
   - milestone 20 adds platform presets and their warnings to the Output tab, a cover image picked on the scrub bar, and a hand-off to the system share sheet from a finished render;
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
| Render cards that are themselves the drag source, with Reveal, Copy path and Remove | 13 |
| Collection tray, save and load, Apply to all, Render all | 13 |
| Defaults per type, guided setup | 14 |
| Converting library media with the same presets; audio-only options | 15 |
| Loop tools: extend a loopable background with a crossfade join, speed | 15 |
| Matte pass: a separate alpha file for codecs and editors without alpha | 15 |
| Recolor at render time for stock media | 15 |
| Aspect and output resolution in the Output tab, for templates drawn to a shape rather than a size | 19 |
| Orientation filter and chip, vertical badge on cards, cards in a portrait item's own shape | 19 |
| Vertical safe zones in the player, described generically | 19 |
| Platform presets in the Output tab, with length and file-size warnings; a cover image from a chosen frame; Share and Open upload page on a finished render | 20 |
| Stems with mute and solo; paired sound effects with variants | 16 |

## What stays true throughout

- Logic lives in `src/core` and is unit tested; regions are thin.
- The UI end-to-end test keeps passing at every commit; it drives the real app over the DevTools protocol and is the proof that a move did not lose a feature.
- Everything works offline. There are no previews of content the user does not have, no content installs, no online updates; a marketplace stays a non-goal (`docs/system-design.md`).
- Pane sizes, collapsed panes, view mode and thumbnail size are per user in `settings.json`, written atomically like the rest.
- Keyboard: every region is reachable and operable without a pointer by milestone 8.
- **The application menu is a second way in, never a second behaviour** (milestone 27). A menu item does what the button for the same thing does — in most cases by pressing that button — and is enabled only when that button is. The menu's state is read off the window's own controls, so the two cannot disagree, and the keyboard-shortcut list under Help is read off the menu, so it cannot drift from the keys. Accelerators are registered by the menu and therefore shadow the window, which rules out the bare transport keys a video tool would like: Space inside a text field has to type a space. Undo and Redo are shown without being registered, because inside a text field the field's own undo must win.

## Decisions on the open layout questions (David, 2026-10-23)

- **Collection tray: bottom drawer**, spanning the center and right columns, resizable and collapsible to a one-line summary ("3 renders · 1 running"). It opens automatically when the first item is added; collapsing it again is remembered.
- **Stage: above the results** in the center column, a resizable vertical split, collapsible to a thin bar; both the split size and the collapsed state are kept in `settings.json`.
- **Default view: per media kind** — grid for visual items, list for audio — and each kind remembers its own grid/list toggle (built in milestone 12 with the grid).
- **Tags and favorite: both places, one state.** A compact strip under the stage keeps the quick actions (favorite star, tag chips, quick-add field); the Info tab holds the full details — metadata, license, pack, and in milestone 10 themes and styles — with favorite and tags editable there too. Both render from the same shared state, so an edit in one place shows in the other at once.
