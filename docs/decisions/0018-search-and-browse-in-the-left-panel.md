# 0018. Search and Browse are two sections of the left panel, and the row above the stage goes

Date: 2026-10-31
Status: Accepted

## Context

Until milestone 41 the window had a search bar across the top of the centre
column: the field that finds items, the scope chip, the filter chips, the
For… and Look selects, sort, grid or list, the thumbnail size, and the two
toggles that hide the stage or the results. Under it, the stage; under that,
the results. The left panel held "Find a category" over the tree.

Two things were wrong with it.

**Two fields that looked the same did different things.** "Search the
library" above the results and "Find a category" in the panel were both a
text field at the top of a column. One found items; the other narrowed the
list of categories. A person could not tell which to type into, and the
search bar's own row said nothing about what it was for.

**The row took the stage's height.** The stage is why the window is open, and
milestones 37 and 38 had already moved the player's controls and the
inspector off it. The search bar was the last row above the picture, and on a
short window its chips wrapped to a second line and squeezed the stage under
its floor until the shell learned to measure the bar's height.

## Decision

Everything in the row moves into the left panel as **two clearly different
sections**, and the row goes.

- **Search**, at the top: the field that finds items, labelled "Search
  templates and media", with the scope chip under it, the filter chips in one
  compact row, and For… and Look on a row under them. It is the field
  Cmd/Ctrl+F puts the caret in, from anywhere; the folded rail carries a
  search icon that unfolds the panel with the caret in it.
- **Browse**, below it, under its own heading: the category tree. "Find a
  category" became a **funnel icon in the Browse heading** that opens an
  inline "Filter categories" field over the tree, so it reads as narrowing the
  list below rather than as a second search. It has no key of its own.
- **How the results are shown goes with the results**: sort, grid or list and
  the thumbnail size move into the results' own heading row, and so do the two
  region toggles. The results therefore collapse to that heading — a thin bar
  under the stage, which keeps the way back in it — except in theater, which
  wants the picture alone and hides it too.
- The **stage starts at the window's top edge**. The centre column is the
  stage, the splitter and the results, and the space budget no longer counts a
  search bar.

## The merge that was turned down

One field for both — type, and it finds items *and* categories, perhaps with
categories listed above the items — was tried on paper and not taken. The two
do different jobs: a search answers with things to put on the stage, a
category filter answers by changing the tree the person is about to click in.
One field doing both hides which is happening, and a result list that mixes
"Lower thirds (32)" with thirty-two lower thirds is a longer list to read than
either alone. Milestone 40 had just made every *item* chooser one search; this
is the other half of that thought — one search, and one thing that is not a
search, told apart by where they sit and what they are called.

## Reasons

- **The panel reads top to bottom as "what, then where".** Search is the quick
  way in; Browse is the slow one. Putting them in one column, each under its
  own small heading, says that without a sentence.
- **The picture gets the row.** At the default 1280 × 788 the stage starts at
  the top of the window; the end-to-end test holds it there.
- **What is left above the results is about the results.** Sort and the view
  controls act on the list under them, and nothing else; they sit in its
  heading as the tray's controls sit in the tray's.
- **Nothing is dropped.** Every control keeps its id and its behaviour, so the
  application menu's items, the start screen's "What are you making?", the
  tour and the tests follow the elements to their new places.

## Costs

- The filter chips are icon-only in a panel of the default width, named by
  their tooltips; the labels come back when the panel is widened past 360 px.
- The left panel is taller before the tree starts. The tree scrolls inside its
  own section, as the results do inside theirs.
- Hiding the results no longer frees their heading's height — about 32 px —
  except in theater.

## Revisit if

- A library grows a second axis that wants a field of its own (a tag field
  beside the category filter, say), at which point the panel's sections are the
  pattern to extend rather than the search bar to bring back.
