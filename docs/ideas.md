# Ideas

Where work waits before it is on the roadmap. `ROADMAP.md` is the plan; this file is what comes before it: suggestions not yet decided, decisions not yet scheduled into a milestone, and known issues not yet fixed.

## How an idea moves

1. **Idea.** Anyone may suggest one. It goes under [Ideas](#ideas) with a line on what it is and why.
2. **Decided.** When the maintainer agrees to it, it moves to [Decided](#decided), with what was decided and what "done" looks like.
3. **Scheduled.** When a request schedules it, it is written into `ROADMAP.md` (a new milestone, or items in an existing one) and removed from this file in the same commit. A new milestone takes the next milestone number and gets its own GitHub issue, whose number the roadmap gives beside it (see CONTRIBUTING.md).

Known issues follow the same path: a bug found and understood goes under [Known issues](#known-issues), and leaves when it is fixed or scheduled.

Each move is a commit, so the history shows when an idea was decided and where it went.

## Decided

1. **Ghost slots throughout the results grid** (milestone 12's area). Faint card outlines show today only when there are no results. They should also fill the unused cells after the last card and the rows below it down to the bottom of the region, at the current card size, in grid and rows view; and a card whose thumbnail hasn't drawn yet shows the same outline instead of a blank box, so a loading grid reads as slots waiting to fill. A very subtle cue: a hairline in the border colour at low opacity, no fill, no shimmer or motion, out of the tab order and hidden from screen readers.

2. **Parameters tab by element, for every bundled template** (milestone 23). The card-per-element tab (an `element` field beside `group`) is in place, but only Title Card and Lower Third Bar name their elements. Every other bundled template should do the same (Panel, Title, Subtitle, Logo, Background and so on), with its text colour on its text layers, so no template keeps the flat "Colors" group.

3. **Windows checks in milestones 2 and 5: a VM, not "hardware-blocked".** Both milestones' Windows items say they need a Windows machine and that milestone 17's builds make it easy. The plan now is a local Windows 11 VM on the maintainer's Mac, used for these checks and for debugging Windows-only failures. Reword both items to say so; if Premiere Pro or DaVinci Resolve can't run in the VM, the checks wait for a real Windows machine and stop blocking 1.0.

4. **Milestone 9's "command-line interface as a separate entry point": redefine it.** Pulp already renders without its window through `--render`, `--param` (including `@layers`), `--collection` and CSV batch. Redefine the item as packaging those as a proper `pulp` command (its own entry point, `pulp render …` and `pulp collection …`, help text, exit codes, documented in the README) rather than building a second interface, and re-estimate it.

5. **The Festival samples carry every celebration theme.** Its templates are tagged with all the holiday themes at once, so they turn up under each one. Give each Festival piece the one or two themes it fits, as the other sets do (ADR 0010's rule that a child theme never repeats its parent still holds), and keep the coverage test passing.

6. **Browse tree counts for screen readers** (milestone 8's accessibility pass). The tree's item counts are `aria-hidden`, so a screen reader hears "Lower third" with no count. Counts should read as part of each node's name, for example "Lower third, 5 items".

## Known issues

None open. (The Windows-only layers failures were a throttled renderer that ran no animation frames on the CI runner; fixed in `73b7c17`, see `docs/platform-notes.md`.)

## Ideas

- **Display names for library folders**: let a person rename how a folder shows in the browse tree, without renaming it on disk.
- **"All caps" as a template option**: the Newsdesk set forces capitals; this would make it a parameter, on by default.
- **Music moods**: a fourth taxonomy axis for audio (upbeat, dramatic, calm…). ADR 0010 leaves it for milestone 16.
