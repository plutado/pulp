# 0015. The transport row: the player's controls leave the stage for one row across the bottom of the window

Date: 2026-10-30
Status: Accepted (amended the same day by milestone 38: the row is two lines now — the scrub bar on its own line, one to one under the picture, the buttons below — and holds the inspector's tabs; ADR 0016)

## Context

Since milestone 12 the player's controls have lived inside the stage: play, frame step, loop, the in and out marks, the timecode, volume and mute, the scrub bar, and from milestone 28 a bar per layer under the scrub bar, all shared the box the picture is drawn in. Three things went wrong with that as the stage filled up.

- **The picture paid for every control.** The stage is a resizable share of the centre column, and its chrome took the height first: with the collection tray open on a small window the transport, the tools and the item row took every pixel and left the preview 2 px tall (`docs/platform-notes.md`, "A squeezed stage left the picture 2 px tall"). The fix gave the picture a floor and let the chrome clip, which is a truce, not an answer.
- **The scrub bar was as wide as the centre column**, and a bar per layer under it had the same width. A timeline is the thing in a window that wants to be wide, and the centre column is the one place in the window that shares its width with two side panels.
- **Milestone 35 (Lottie) and any later timing work want a timeline**, with markers and segments, and building one inside the picture's box would compound the first two problems.

Editors answer this the same way: the picture is a viewer, and the transport and the timeline run across the bottom of the window at its full width.

## Decision

**The player's controls move out of the stage into a transport row of their own across the bottom of the window, above the status bar. The stage keeps only how the picture is viewed.**

- **The row holds** play/pause, frame step both ways, loop, the scrub bar across nearly the full width with the in and out marks, the length handle (milestone 30) and the parts shading over it, the timecode, Set in, Set out and Clear, the rate a frame sequence is read at, volume and mute, and audition mode. Under the scrub bar, in the same grid column so they line up with its time by construction, the lanes hold milestone 28's bar per layer.
- **The stage keeps** the picture, the background toggle, the safe-area and vertical-zone guides, the layer overlay (select, drag, scale, turn), the item row (Add to collection, favorite, tags) and the template's notes. Nothing on it plays or moves through time.
- **From the top, the bottom of the window reads:** the collection tray (a drawer under the centre and right columns, as before), the transport row (the full width), the status bar. The row's DOM order is the same, so the keyboard focus order follows the eye.
- **The row is a pane like the others:** resizable in height from its top edge, with its height in `settings.json` as `layout.transportHeight` (`src/core/layout.ts`), clamped and defaulted like every other setting. The controls keep their own height; what is above the floor is room for the layer bars, which scroll when a template has more layers than the row has room for. It does not collapse: a row that came and went would move everything above it.
- **The layout never jumps.** With nothing chosen the row stays where it is, disabled. A still — a picture, or a layered file — has no time, so the row shows no scrub bar and keeps its place.
- **One transport for everything that plays.** A clip and a sound were played by their elements' own controls, drawn inside the picture; those go, and the row plays, steps, scrubs, loops and marks them as it does a template, counting frames at the rate the Output tab trims them at (`mediaDefaultFps`, `src/core/media-render.ts`) so a mark on the bar is the frame the field shows. The elements' own `play`, `pause` and `ended` events put the row in step, so the row is right whoever started playback — the button, the Playback menu, or audition mode.

## Reasons

- The scrub bar and the bars under it get the window's width, which is what a timeline is for; milestone 35's markers and anything later build on the row rather than on the stage.
- The picture is only the picture: the stage's height is the preview's, and the squeeze that left it 2 px tall cannot recur from the controls, since they are no longer in the same box.
- Two regions, one module. The stage module (`src/renderer/stage.ts`) owns the player — the picture and the row — because a template frame, a sequence frame and a media element's time are all one playhead, and a transport that talked to the stage through its DOM would be the kind of coupling the layout forbids. The row is a region of the layout, not a module of its own; the module's API (show, clear, set parameters) and the `trim` and `transport` signals are unchanged, so the Playback menu, the Output tab and the layer editor did not move.
- The application menu and its shortcuts press the same buttons by the same ids, so the Playback menu followed without a change (`docs/ui-layout.md`, "a second way in, never a second behaviour").

## Costs

- A row of about 92 px at the bottom of the window, always there. On a short window the row gives up its lanes first, down to its 40 px floor, before the centre column or the tray have to; the tray's cap subtracts the height the row really has, so the results keep their floor. Anyone who never uses layers can drag it down to the floor and leave it there. The centre column's own floor came down with it (`--center-min-h`, 464 to 444 px), since the stage's chrome lost two rows of controls.
- Media playback lost the browser's own controls: full-screen, playback rate and picture-in-picture are not offered. None was a feature of Pulp; the first two are the row's to add if wanted.
- The README's screenshot shows the controls in the stage until it is retaken (milestone 8 writes the user guide's screenshots).

## Not decided here

Markers on the scrub bar for Lottie's segments (milestone 35), a cover frame picked on the bar (milestone 20), and stem lanes (milestone 16) are each their own item; this row is where they go.
