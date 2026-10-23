# 0006. Stay with plain DOM for the UI; revisit at the library milestone

Date: 2026-10-23
Status: Accepted

## Context

The UI is plain TypeScript and DOM (`src/renderer/main.ts`) importing pure core modules. Milestone 3 asked whether the parameter editor would outgrow that and whether a component framework should be introduced, with a decision recorded either way. The editor now has composite color controls with alpha and recent colors, sliders with direct entry, character counters, a per-template undo history, and per-field and whole-template reset, all covered by a UI test that drives the real app over the DevTools protocol.

## Decision

Stay with plain DOM through milestone 3. Re-evaluate at milestone 4 (library tagging, filters, media preview), and write the outcome as a new decision then.

## Reasons

- **The hard parts are not view logic.** What took care in the editor was behavior: coalescing typed edits into history steps, leaving text fields their own Ctrl+Z, keeping edits per template, syncing a slider with its entry, measuring what the native color input can hold. Those live in small pure modules (`history.ts`, `color.ts`, `recent-colors.ts`, `timecode.ts`) with unit tests, and a framework would not have written them.
- **The form rebuilds, it does not diff.** Undo, redo and reset replace the whole parameter form from a snapshot. For a form of a dozen fields that is instant and simpler to reason about than reconciled state; the one place a framework earns its keep is incremental updates of large views, which the inspector does not have.
- **A migration would churn tested code for no new capability.** The UI end-to-end test exercises the inspector through real DOM; porting the controls to a framework would rewrite them and their selectors with nothing the roadmap needs in return.
- **Bundle and build stay simple.** electron-vite builds the renderer from one TypeScript entry with no JSX, compiler plugin or runtime dependency.

## Costs

- Each control is hand-wired: element creation, event listeners, and a `show()` that pushes state into the DOM. New controls copy that shape. Keeping them small and keeping logic in core modules is the discipline that makes this bearable.
- Shared UI state is module-level (`state`, `editors`, `recentRows`). It works at this size; it is the thing to watch.

## Revisit if

- Milestone 4 brings views that update incrementally and often: a filterable library list of hundreds of entries with tags, virtualized scrolling, or live media thumbnails. That is where reconciled rendering pays.
- Saved parameter presets or batch rendering (remaining milestone 3 items) turn the inspector into several coordinated panels rather than one form.

If a framework is adopted then, prefer a small one that keeps the current structure (Preact or Svelte) over React, and keep the core modules and the UI end-to-end test as they are; the test should pass unchanged across the port.
