# 0017. The stage's right-click menu is drawn in the window, from the application menu's command list

Date: 2026-10-30
Status: Accepted

## Context

Milestone 39 puts a right-click menu on the stage: add text or an asset where
you click, and on a layer the common edits — cut, copy, paste, duplicate,
delete, layer order, copy and paste look, reset, start or end at the playhead.

Two questions had to be answered together.

**Where does the menu come from?** Electron can pop a native menu
(`Menu.popup`) from the main process, which is what the application menu
already is (milestone 27, `src/main/menu-service.ts`).

**Where does it get its list of things to do?** A context menu that grows its
own list of actions is a second place to add a feature to, and the two drift:
an edit reachable by right-click but not by the menu bar, or enabled in one
and greyed in the other.

## Decision

The menu is **drawn in the window** as a DOM popup
(`src/renderer/context-menu.ts`), and every item it offers names a
`MenuCommand` from `src/core/menu.ts` — the same list the application menu is
built from — enabled by the same `MenuState` flag, and run by the same
dispatcher in `src/renderer/menu.ts`.

Concretely:

- `src/core/menu.ts` gained the `layer.*` commands, the eight flags that say
  what can be done to a layer, a `Layer` submenu in the Edit menu that offers
  them, and `LAYER_COMMAND_FLAGS`: the table saying which flag decides which
  command.
- `src/core/stage-menu.ts` (pure) arranges those same commands for a pointer
  and reads their enabling from that same table.
- Both surfaces run their commands through one function, registered into
  `src/renderer/commands.ts` by `src/renderer/menu.ts`. The popup called only
  the layer commands at first, and the stage's background and theater items
  silently did nothing until an end-to-end test caught it; routing both through
  the one dispatcher is what makes "the same command" true rather than
  intended.
- A unit test fails if the stage names a command the application menu does not
  offer, if the two enable a command by different flags, or if an item reaches
  the Edit menu with no way to it from the stage.

## Reasons

- **One list, held by a test.** The guarantee is not that the two menus share
  an array — their order and labels rightly differ, since a menu bar reads
  top-down and a pointer menu puts the specific thing first — but that neither
  can name a command, or enable one, that the other does not. That is checkable,
  and it is checked.
- **The layer state lives in the window.** The stack being edited belongs to
  the Parameters tab (`src/renderer/layer-edit.ts`), and what can be done to it
  depends on the layer under the pointer, the stack's order and a clipboard. A
  native popup would mean shipping all of that to the main process on every
  right-click and shipping the answer back — a round trip, and a second copy of
  state the renderer already owns, for a menu that must appear instantly.
- **The window already draws its own chrome.** ADR 0006 and 0009 keep the UI
  plain DOM; the inspector drawer (ADR 0016), the tooltip and the family list
  are all drawn in the window. A native popup here would be the one piece of
  chrome that looks like the platform instead of like Pulp.
- **It is testable the way the rest of the window is.** The end-to-end UI test
  right-clicks the real picture over a real template and reads the menu out of
  the DOM. A native menu cannot be driven from the DevTools protocol at all,
  so the behaviour would have gone unchecked.
- **Every edit is an ordinary edit.** The commands go through the Parameters
  tab's own layer editor, so a cut or a pasted look is one undo step and
  redraws through the one pipeline, exactly as a drag on the stage does.

## Costs

- A DOM menu is not the platform's menu: it does not inherit native keyboard
  conventions for free, so the popup implements them itself (Up and Down move,
  Right opens a submenu and Left leaves it, Enter chooses, Escape closes, focus
  returns where it came from).
- It cannot escape the window. A menu opened near the bottom edge is held
  inside the window rather than overhanging it as a native one may.
- The layer commands take no accelerators. The application menu registers its
  accelerators, and a registered key fires inside a text field too (see the
  note at the top of `src/core/menu.ts`), so Delete and Ctrl+C are not offered
  as keys here. The right-click menu is the fast path instead.

## Revisit if

- A context menu is wanted somewhere a native one would clearly be better — the
  window's title bar, or a menu that must overhang the window — or
- the accessibility pass (milestone 8) finds the drawn menu cannot be made to
  behave as a platform menu does for assistive software, in which case the
  native popup is worth its round trip.
