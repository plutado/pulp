# 0019. The stage pops out by moving its elements into a window that shares the page

Date: 2026-10-31
Status: Accepted

## Context

Milestone 43 lets the stage leave the main window and float free on any
display — a second screen for the picture, the main one for browsing, as in
Adobe's apps. The roadmap set one requirement above the rest: the stage
**moves rather than mirrors**. It is in one place at a time, and everything
that edits on it — dragging a layer, the right-click menu, the bar per layer,
dropping a picture onto it — must keep working in the floating window. A
view-only copy would suit a client watching and nobody else.

The stage is a thousand lines of renderer code wired to a few dozen elements
and to the rest of the window's state through signals: the layer editor, the
inspector's parameters, the transport, the context menu built from the
application menu's own command list (ADR 0017). In Electron a second window
is normally a second renderer process with a page of its own, and the obvious
design — a stage page in that window, the state synchronised over IPC — would
mean rebuilding every one of those wires across a process boundary, and
keeping them in step forever after. That is the mirror the roadmap ruled out,
dressed as a move.

## Decision

The stage's elements **move into a child window that shares the renderer's
own page**. The renderer opens the window itself, with `window.open` under a
known name, as an `about:blank` page. An `about:blank` document inherits its
opener's origin, so the opener may script it fully, and Chromium keeps such a
window in the opener's process so that scripting is synchronous. The renderer
then appends the stage's own elements to that document — the region with the
picture, the layer overlay and the corner controls, and the transport row's
first line, the scrub bar with the lanes under it — which adopts them.

Nothing is copied. The elements are the same objects they were, so every
listener attached to them, every module holding a reference to them, and
every signal that paints them is still attached, still holds, still paints.
Pointer events arrive in the window the elements are in, and the elements
measure themselves in that same window, so dragging a layer and placing the
scrub bar one to one under the picture work by the same arithmetic as before.

What belongs to a **window** rather than to an element is the one list that
has to be told where the stage went: the window's resize and a
`ResizeObserver` of the window's own; the template page's `postMessage`
replies, which reach the window the iframe is in; tooltips; what closes the
right-click menu; the bare `T` for theater. Each of these is re-homed through
one notification when the stage moves, and moved back the same way. Moving an
iframe reloads its page, so the preview starts again from "ready" and is
handed its stills and clips again, which the stage already knew how to do.

The main process does only what the main process can: it lets exactly this
window open and places it where it was last — on a display that is still
connected, else at its size alone, centred by the platform; it remembers where
the window goes; it holds the window's close until the renderer has put the
stage back, so the picture is never lost with its window; and it fills a
display with the window for theater. At launch the stage comes back out if it
was left out, unless its display has gone, in which case it stays in the main
window and the remembered place is dropped, so nothing opens off-screen.

The main window takes the room: with the stage out, the results fill the
centre and the transport row is its buttons line, so the main monitor is a
large browsing view. The buttons — play, the marks, volume, the drawer's tabs
and the status — stay in the main window, where the browsing is; the scrub
bar goes with the picture it is lined up under.

## Consequences

- One stage, one set of wires. There is no second implementation to keep in
  step and no state that can disagree between windows. A feature added to the
  stage works in the popped-out stage without being told about it.
- The pop-out is a renderer concern, and the main process's part is small and
  pure where it can be (`src/core/stage-window.ts` decides where the window
  opens and what happens when its display is gone, and is unit tested).
- Anything new that is wired to the **window** rather than to a stage element
  — a global key, a `document`-level listener, a measurement against the main
  window's viewport — must listen for the stage moving, or it will stop
  working in the popped-out stage. The stage's own module shows the shape.
- The stylesheet is shared by linking it into the child document; it is
  serialised into the document if the link fails, so the window is never
  unstyled.
- A view-only copy for a client monitor is not this. If one is wanted later,
  it is a picture of the stage — a capture — rather than a second stage, and
  a different decision.
