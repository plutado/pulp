# 0016. A bigger stage: the inspector is a drawer from the transport row, and the right column goes

Date: 2026-10-30
Status: Accepted

## Context

The stage is too small to work in at nearly every window size. At the default 1280 × 788 the picture was about 450 × 250 px: the inspector's column took 350 px of the window's width, and inside the centre the search bar, the stage's own control rows and the results strip took the height. Milestone 37 moved the transport out of the stage; what remained around the picture was still a column and two rows that are *consulted* — the parameters while editing, the output settings before a render, the info now and then — paying for themselves every minute they are visible.

The picture's size is limited by the window's height before its width: a 16:9 frame in a 1280-wide window wants 720 of height and never gets it, so giving the stage height is what makes it bigger. The inspector's tabs are opened in bursts, not watched; they can live in a surface that exists only while it is used.

## Decision

**The inspector's Parameters, Output and Info become three buttons in the transport row. Choosing one opens a drawer that rises from the row over the results — never over the stage. The right column goes; the stage and the results span from the browse panel's edge to the window's right edge.**

- **The drawer** is anchored inside the results region, so by construction it can cover the results and nothing else: taller than the results area, it simply fills it. The picture stays in view while a title is typed, which is the point. Its height is a pane size (`layout.inspectorHeight`), dragged at its top edge like the tray's and the transport row's; its last tab is kept (`layout.inspectorTab`); whether it is open is not kept — it starts closed, since the window's resting state is browsing.
- **Open, switch, close.** A tab button opens the drawer or switches it; the active tab again, the close button, or Esc closes it. Choosing another item in the results closes it — browsing wants the results back — unless the **pin** holds it open through a run of edits. Choosing a collection card opens it on Parameters: that click *is* a request to edit. Cmd/Ctrl+1–3 toggle the three tabs and the View menu lists them; the panels move to the shifted digits (Browse ⇧1, Preview ⇧2, Results ⇧3, Collection Tray ⇧4).
- **A dot on Parameters and on Output** says the shown item has edits behind that closed tab: parameters that differ from the template's defaults, or render options beyond the item's own (a trim, a rate, a custom size, the media extras, a matte, a tint).
- **The stage is the picture.** The background toggle and the safe-area switch become a quiet overlay on the stage's corner — over the letterbox dead space at most sizes — and Add to collection joins the transport row beside audition. The item strip (favorite, tags) moves into the drawer's head; the Info tab has carried the same state since milestone 11, so nothing is lost while the drawer is closed. A note about the picture (a template error) lies over the picture's foot.
- **The results are a strip to pick from.** The default split leans to the stage (`stageShare` 0.72, from 0.6); the results scroll inside their own pane, keep their 160 px floor on a short window, and one key folds them away entirely (`view.results`, with a toggle beside the stage's in the search bar) so the stage takes everything.
- **The window fits at any size.** The page never scrolls (`body { overflow: hidden }`); every region scrolls inside its own pane; nothing draws over the tray, the transport row or the status bar. A UI test at the default 1280 × 788 checks the regions pairwise for overlap, that the document has nothing to scroll, and that the picture gets at least 38% of the window's height.

## The full-width stage, weighed and not taken

A stage spanning the whole window above every column was the other shape considered. It was turned down because it gives a 16:9 picture no more room at common window sizes — the picture is height-limited, and a full-width stage pays for width the picture cannot use by squeezing the browse tree and the results into a short band under it; a 9:16 picture wastes nearly all of that width; and every pane below would reflow whenever the stage resized. Removing the one column the centre shared its width with, and the rows inside the stage, buys the same height without those costs.

## Reasons

- At 1280 × 788 the picture grows from about 450 × 250 to about 590 × 330 — height-limited still, but every pixel of the win is height, which is the scarce direction.
- The drawer is anchored in the results region rather than positioned by arithmetic, so "never over the stage" is a property of the markup, not a calculation that can drift.
- The ids did not move: `#tab-parameters`, `#render`, `#params`, `#add-to-collection` and the rest keep their names, so the application menu — which presses the same buttons — followed without change, and the panes stay in the DOM while closed, readable and pressable, which the end-to-end tests lean on.

## Costs

- Editing needs one more gesture: select, then open Parameters (click or Cmd/Ctrl+1). The pin amortizes it over a run of edits; the collection card opens the drawer itself.
- The drawer covers the results while open. That is the design — the results are what you were choosing from, and the thing you chose is on the stage — but long browsing with the drawer pinned open means scrolling a covered list; closing it is one Esc.
- The favorite star and tag chips are only visible with the drawer open. Both live in the Info tab too, one state in both places, as they always have.
- Keyboard habits move: Cmd/Ctrl+1–3 meant Browse/Preview/Tray since milestone 27 and now mean the tabs; the panels are on the shifted digits. The shortcut list under Help is read off the menu, so it says so itself.

## Not decided here

A separate floating inspector window for two-screen setups, and the drawer remembering per-tab heights, are ideas for `docs/ideas.md` if anyone asks for them.
