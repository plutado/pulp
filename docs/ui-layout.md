# UI layout: regions and the order they are built

Status: a plan, written 2026-10-23. It describes the window Pulp is heading for and the order in which the milestones in `ROADMAP.md` build it. `docs/system-design.md` describes the code as it is. When the two disagree, this file is the intent and the roadmap is the schedule.

## Today's window

The window in this plan is built. The regions are resizable, collapsible panes with their sizes and collapsed state in `settings.json` (`src/core/layout.ts`, `src/renderer/shell.ts`); the browse panel holds the tree (milestone 10); the inspector has its Parameters, Output and Info tabs; the results are a windowed card grid or list with the grid/list toggle and thumbnail size in the results' own heading (`src/core/results-view.ts`, `src/core/virtual-list.ts`), cards scrub through a cached frame strip on hover (`src/core/hover-scrub.ts`), the player has loop, frame step, in and out marks, volume, a background toggle and safe areas (`src/core/player.ts`), a layer can be selected, dragged, scaled and nudged on the stage itself (milestone 25, `src/renderer/stage-layers.ts`), and audio shows a waveform and can be auditioned with the arrow keys (`src/core/waveform.ts`) — milestone 12. The player's controls — play, step, loop, the marks, the timecode, volume, the scrub bar and milestone 28's bar per layer under it — are the **transport row** across the bottom of the window, above the status bar (milestone 37, ADR 0015). The inspector is a **drawer** from that row (milestone 38, ADR 0016): Parameters, Output and Info are three buttons in the row, the drawer rises over the results and never over the stage, and the right column is gone, so the stage and the results span from the browse panel's edge to the window's right edge. The stage is the picture, with the background toggle and the guides as a quiet overlay on its corner. The tray is the collection tray of milestone 13: items gathered with their own output settings, saved and reopened as a file, rendered together, with the finished renders as cards that are themselves the drag source (`src/core/collection.ts`, `src/core/queue-card.ts`). The start screen (milestone 31, `src/renderer/start-screen.ts`) sits over the whole window at launch and from File → Home: get going (new project, blank or by shape, and the bundled examples), recent projects with pins, Learn (the tour, what's new, the shortcuts), the setup checklist and "What are you making?". What the window still lacks arrives with the milestones named below: per-type defaults and the guided setup (14), converting media (15), and stem lanes and the variant picker (16), with the aspect and resolution choice of milestone 19 and the platform presets of milestone 20 landing in the Output tab.

## Target: eight regions

| Region | Where | What it does |
|---|---|---|
| **Left panel** | left | Two sections under the library toolbar (milestone 41, ADR 0018). **Search**, at the top: the field that finds items ("Search templates and media", Cmd/Ctrl+F from anywhere, a search icon on the folded rail), a **scope chip** under it naming the selected node ("in: Lower thirds", × to clear), recent searches, the filter chips (Templates, Video, Images, Audio, Vertical, Alpha, Favorites) in one compact row — icon-only in a panel of the default width, labels when it is wider — and the **For…** and **Look** selects on a row under them, narrowing whatever category is chosen. **Browse**, below it under its own heading: the tree that opens on what things are (milestone 34, `src/core/categories.ts`): Lower thirds, Titles and openers, End cards, Matching sets, Animated backgrounds, Still backgrounds, Overlays and frames, Transitions and wipes, Design elements, Effects, Objects, Stock video, Photos and stills, Music, Sound effects — the taxonomy's types beneath the ones that gather several, packs beneath Matching sets — then Quick access (Favorites, Recently used) and My folders. Each node shows an item count and a one-line description on hover. A **funnel** in the Browse heading opens an inline "Filter categories" field that **filters the tree itself** — what no longer matches disappears, what remains keeps its section and group, the matched letters are lit, and every section holding a match is open while the filter lasts; closing it restores the tree exactly. The panel shows only where you are: folded to the active category's path, or Quick access alone, and choosing a category folds the tree to it. Selecting a node sets the **scope**: the results and the search are narrowed to it. Clearing the selection widens back to everything. |
| **Results** | center | Its heading row holds the count, the chosen category's description, and how the results are shown — **sort**, **grid or list**, **thumbnail size** — with the stage and results toggles after them (milestone 41). **Grid of cards**: thumbnail with hover-scrub, name, badges (alpha, loop, duration, resolution, audio variants, pack). **List view** for audio and long lists: name, duration, type, themes, file. **Audition mode**: autoplay with arrow keys. A card can be dragged to the collection tray, to the stage, or straight out to an editor once rendered. |
| **Stage** | center, from the window's top edge, above the results in a resizable split that leans to the stage; collapsible | The picture: what the workspace and the output show, and only that — its box is all picture (milestone 38). The **background toggle** (checkerboard, black, white, custom), the safe-area switch and the **theater** button — the browse panel to its rail, the results and the drawer away, everything back as it was when toggled off; also the bare `T` — are a quiet overlay on the stage's corner; title-safe, action-safe and the vertical zones draw over the picture. Layers selected, dragged, scaled and turned on the picture itself. A **waveform** as the picture of a sound. A **variant picker** for paired sound effects. |
| **Transport row** | bottom, the full width of the window, between the collection tray and the status bar; resizable in height, never collapsed | The player's controls (milestone 37), on two lines (milestone 38). The first line is the **scrub bar** alone, its ends one to one under the picture's edges — halfway along the bar is halfway along the picture, following it through every resize and aspect, with a 320 px floor centred under a tall picture — with the in and out marks, the parts shading and the length handle over it, and under it the lanes with **a bar per layer** (milestone 28) at the bar's width, draggable at either end — a small timeline. The second line holds the buttons in three clusters: play, step and loop on the left; the timecode, Set in, Set out, Clear and the rate a frame sequence is read at in the middle; volume and mute, audition, Add to collection and the inspector's three tabs on the right. **Stem lanes** for layered music go in the lanes too, one waveform per layer with mute and solo. With nothing chosen the row stays, disabled; a still shows no scrub bar but keeps the row, so the layout never jumps. |
| **Inspector** | a drawer from the transport row, over the results and never over the stage; its height and last tab remembered, open state not — it starts closed (milestone 38, ADR 0016) | Three buttons in the transport row — **Parameters** (the form as today, with undo and presets), **Output** (preset, aspect and output resolution, frame rate, duration and loop extension, speed, alpha type, matte pass, audio embedded or separate, save folder, file-name pattern), **Info** (a property panel: a header card with the item's picture, name, type and favorite, then collapsible sections — About, Format, Categories, Tags, Set, File, Credits and license, Usage — as key–value rows, with tags and themes editable where the item is the user's). The active tab again, the close button or Esc closes it; a **pin** keeps it open through a run of edits; choosing a collection card opens it on Parameters; a **dot** on Parameters and Output says the shown item has edits. The drawer's head carries the item strip (favorite star, tag chips). |
| **Collection tray** | bottom drawer under the center and right columns; resizable, collapsible to a one-line summary, opens when the first item is added | Items gathered while browsing, as small cards, each with its own output settings. **Apply to all**, save and load as a file, **Render all** with per-item and total progress. It absorbs today's render queue. A finished card **is** the drag source — grip, whole card draggable, hint on hover and focus — and offers Reveal, Copy path and Remove; the file's path is in its tooltip, never in its text (`docs/ui-style.md`). |
| **Guided setup** | modal | Numbered steps: what it is for, size and frame rate, format and alpha, audio, where to save. A live preview over a checkerboard, a settings summary, "save as default for this type", Add to collection. |
| **Status bar** | bottom | ffmpeg found or missing, library counts, cache size, scans and renders in progress, a "copy diagnostics" entry point. |

The guided setup is a modal rather than a layout region; it is listed here because it reuses the stage's player and the Output tab's settings.

## Where today's features go

Nothing is dropped; everything moves into a region.

| Today | Target region |
|---|---|
| Search field | Left panel, the Search section |
| Add folder, rescan, library summary | Browse panel (My folders) and status bar |
| Pack import and export | Browse panel (Matching sets) |
| Flat result list with thumbnails | Results, list view (the grid is added later) |
| Preview | Stage |
| Favorite, tag chips (quick strip) | The drawer's head, and the Info tab; same state in both |
| Play, scrub, timecode | Transport row |
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
   - milestone 37 moves the player's controls out of the stage into the transport row across the bottom of the window (ADR 0015), so the stage is only the picture and the scrub bar and the bars per layer get the window's width; milestone 35's markers and later timing work build on the row;
   - milestone 38 makes the inspector a drawer from that row and removes the right column (ADR 0016), so the stage and the results take the window's full width, the split leans to the stage, one key folds the results away, and the window fits at every size: the page never scrolls and the picture keeps its share, held by a UI test at 1280 × 788;
   - after 1.0, milestone 14 adds the guided setup and per-type defaults in the Output tab, milestone 15 adds media conversion, loop tools, matte pass and recolor to the Output tab, and milestone 16 adds stem lanes to the transport row and the variant picker to the stage.
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
| The transport row: the player's controls and the scrub bar with the bars per layer, across the window's width above the status bar, resizable and remembered; the stage keeps only the picture and how it is viewed | 37 |
| The inspector as a drawer from the transport row, over the results only; the right column removed; the view controls on the stage's corner; the results fold away on one key; the window fits at any size, nothing overlaps, the page never scrolls | 38 |
| A right-click menu on the stage: add text or an asset where you click; on a layer cut, copy, paste, duplicate, delete, order, copy and paste look, reset, start or end at the playhead, edit its words, replace its picture; on bare picture the background (with mid-grey), theater and add to collection; opened by pointer or by Shift+F10 and the Menu key — the application menu's own commands, arranged for a pointer (ADR 0017) | 39 |
| One search wherever you search: a picture or clip chooser takes the search bar's own query language and ranking, through one chooser built once | 40 |
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
- **Transport row: the full width, between the tray and the status bar** (2026-10-30, milestone 37, ADR 0015). From the top, the bottom of the window reads: the collection tray, the transport row, the status bar. The row resizes from its top edge and keeps its height in `settings.json`; it never collapses and never leaves, so nothing above it moves when the selection changes. The stage module owns the row as well as the picture: two regions of the layout, one playhead.
- **The transport row is two lines; the scrub bar is the picture's own timeline; theater** (2026-10-30, milestone 38). The scrub bar's ends sit one to one under the picture's edges: the stage measures the picture's box and the row follows it, with a 320 px floor centred under a tall picture; the buttons sit on a second line in three clusters. Theater — a button by the stage and the bare `T`, a window listener because a bare menu accelerator would shadow typing — folds the browse panel to its rail, hides the results and closes the drawer, and puts all three back as they were. The results region clips and the category cards yield to its room, so nothing in it can run under the collection tray.
- **Inspector: a drawer from the transport row; the right column goes** (2026-10-30, milestone 38, ADR 0016). The drawer is anchored inside the results region, so it covers the results and nothing else; its height and last tab live in `settings.json`, its open state does not. Cmd/Ctrl+1–3 are the tabs; the panels moved to the shifted digits. The stage keeps nothing but the picture — the view controls overlay its corner — and the window is held to fit at every size by a UI test at the default 1280 × 788.
- **Search and Browse are two sections of the left panel; the row above the stage goes** (2026-10-31, milestone 41, ADR 0018). The search field, the scope chip, the filter chips and the For… and Look selects move into the panel under a Search heading; the tree sits under a Browse heading with "Find a category" turned into a funnel that opens a "Filter categories" field over it; sort, grid or list, the thumbnail size and the two region toggles move into the results' heading; the stage starts at the window's top edge. Merging the search field and the category filter into one field was turned down: they do different jobs, and one field doing both would hide which is happening.
- **Tags and favorite: both places, one state.** A compact strip under the stage keeps the quick actions (favorite star, tag chips, quick-add field); the Info tab holds the full details — metadata, license, pack, and in milestone 10 themes and styles — with favorite and tags editable there too. Both render from the same shared state, so an edit in one place shows in the other at once.
