# UI style: labels, icons, hierarchy

Status: the guide milestone 18 builds to, written 2026-10-23. Rules here are binding for new UI work; milestone 18 brings the existing window onto them and adds the enforcement test. Icons are Phosphor (ADR 0011).

## Labels

**Sentence case everywhere.** Capitalize the first word and proper nouns only: "Add folder", "Recently used", "Lower third", "ProRes 4444". One style across the app beats matching any one platform, and sentence case reads calmer in a dense tool. **No ALL CAPS** — hierarchy comes from size, weight and color, never from capitalization (the `text-transform: uppercase` heading styles go away).

**No stored value is a label.** Everything the user reads goes through the display-name module (`src/core/display.ts`, unit tested), which maps:

- category and type ids: `lower-third` → "Lower third"
- media kinds: `video` → "Video"; extensions: `mov` → "MOV"; codecs: `prores` → "ProRes", `h264` → "H.264"
- resolutions: "1920 × 1080" (multiplication sign, spaces), with the short alias ("1080p") where it helps
- rates, durations, sizes: "29.97 fps", "6 s" or timecode, "12 MB"
- folder roots: the bundled root is "Built-in templates"; a user folder's name is humanized like a tag ("media-library" → "Media library"; "News Pack" stays as it is), with the full path in the tooltip
- **tags and themes: stored normalized (lowercase, dashes) for search; displayed humanized** — dashes and underscores become spaces, sentence case: `lower-third` → "Lower third", `my-show` → "My show"

**Official styling wins over sentence case.** Proper names and initialisms keep the form their owners use; this is the one list, and the style test reads it as its set of exceptions:

```official-styling
FFmpeg
ProRes
H.264
HEVC
macOS
DaVinci Resolve
Premiere Pro
QuickTime
Motion JPEG
PCM
VP9
VP8
AV1
DNxHD
AAC
MP3
FLAC
ALAC
CSV
MOV
PNG
JPEG
GB
MB
KB
kHz
fps
SPDX
```

File extensions shown through the display module ("MOV", "WAV") are initialisms by definition and always uppercase.

Search syntax is the exception by design: what you type in the search field (`tag:lower-third`, `type:wipe`) stays the stored id — it is an address, not a label.

**Writing rules:**

- One ellipsis character (…), only on commands that open a dialog or need more input before acting: "Import pack…", "Render…".
- Units in display form after a space: "6 s", "12 MB", "29.97 fps".
- Editors' jargon is fine where editors use it ("ProRes 4444", "alpha", "timecode"); standards jargon ("SPDX") lives in tooltips, not labels.
- Tooltips: sentence case; no trailing period on short ones; keyboard shortcut at the end in parentheses.

## Icons

**Set: Phosphor** (MIT, ADR 0011), imported at build time as inline SVG — no icon font, no network, the CSP untouched. One `Icon` component, three sizes (16, 20, 24 px), stroke and fill from `currentColor`. Phosphor's weights carry state: regular for off, fill for on (favorite, pressed chip, active tab).

**Rules:**

- One icon per idea, app-wide: the same star means favorite in the tree, the chip, the strip and the card.
- Icon-only buttons are for frequent or secondary toolbar actions. Primary actions keep their text (Render, Prepare for drag, Install).
- Every icon-only button has an `aria-label` and a tooltip that also appears on keyboard focus after a short delay, with the shortcut when there is one.
- Labels may shrink or hide where the icon is unambiguous; the collapsed browse panel becomes an icon rail with labels as tooltips.
- The Unicode stand-ins (`⟨`, `⌃`, `⌄`, `×`, `★`, `☆`, `T`, `♫`) are replaced by icons.

**Icon map** (first pass; milestone 10's type groups each get one):

| Region | Icons |
|---|---|
| Browse panel | Star (Favorites), clock (Recently used), package (Built-in templates), folder (user folders); one per type group when the tree lands |
| Browse toolbar | Folder-plus (Add folder), arrow-clockwise (Rescan), download (Import pack…), upload (Export…) |
| Left panel, Search | Magnifier in the field (and on the folded rail); chips icon-only at the default width, icon + short label when the panel is wider; the scope chip carries its node's icon |
| Left panel, Browse | A funnel in the heading opens the category filter; lit while a filter is in force |
| Results heading | Sort icon on the sort control; squares-four and rows for grid or list; carets for the stage and results toggles |
| Results | Type icon as the empty-thumbnail placeholder; badges as small icons with tooltips (alpha, loop, audio) |
| Stage | Background toggle, safe areas and theater (corners-out, corners-in when on) as icon buttons, a quiet overlay on the stage's corner |
| Transport row | Two lines: the scrub bar alone on the first, one to one under the picture; the buttons on the second in three clusters. Play/pause, loop, frame step, mute, audition and Add to collection as icon buttons (play at 24, the rest at 20); Set in, Set out and Clear as text buttons; the timecode in monospace; the inspector's three tabs at the row's end, an accent dot when the shown item has edits |
| Inspector drawer | Pin and close as icon buttons at 16 in the drawer's head; star outline/fill for favorite in the head's item strip |
| Inspector tabs | Sliders (Parameters), export (Output), info circle (Info) — icon plus label |
| Tray | State icons on jobs (queued, running, done, failed); drag dots on the handle; trash on Clear finished |
| Status bar | Check or warning for ffmpeg, hard drive for the cache, spinner while scanning or rendering |

## Cards that carry a file

The render tray is the worked example; anything that hands a file to another application follows it.

- **One drag affordance, not two.** The card *is* the drag source: a grip icon on it, the whole card draggable, and a short hint — "Drag to your editor" — that appears on hover and on keyboard focus. A separate handle beside the thing it drags leaves the reader to work out which one is real.
- **No raw path, no file name, in a card's text.** A card says what the item is: its display name, the preset as a badge, and one line of status. The path lives in the card's tooltip and behind **Reveal in Finder / Show in Explorer** and **Copy path**. Someone scanning the tray is looking for *which render*, not for where it landed. A failure's own reason is the exception — an error that hides where it happened cannot be acted on.
- **Say what it is, not what to do to it.** "Drag to your editor", not "drag me into your editor": the interface is not a character. No first person anywhere.
- **Dragging needs a pointer, so the file needs a keyboard route too.** A focused card reveals with Enter and copies its path with the copy shortcut; the actions it offers are buttons, reachable by tab, not hover-only affordances.
- **A warning that is always on screen stops being read.** A standing caveat becomes an info icon with a tooltip, plus a one-time notice the first time the thing it warns about actually happens, dismissed and remembered.

The style test enforces the two that can be checked: no first-person wording and no raw path or file name in visible text or in a card's fields.

## No label repeats the heading it sits under

"Logo" as a card's title and "Logo" again as the one field inside it reads "Logo, Logo" over the image well. When a field's label matches its card's title — or, in a plain form, its group heading — case and surrounding space aside, the label is **not shown**: the heading already said it. The text stays as the field's accessible name, so a screen reader still hears "Logo". The same holds for any heading-and-label pair across the inspector. The rule is one function, `labelRepeatsHeading` in `src/core/param-cards.ts`, and the style test holds every bundled template's Parameters tab to it.

## Settings by element, not by kind

The Parameters tab is the worked example; anything that edits a thing with parts follows it.

- **One card per part, holding everything about that part.** The panel's fill and its accent bar together; a line of type with its words, its face and its own colour; the logo's well with its treatment. A reader looking for "the colour of the subtitle" looks at the subtitle.
- **A group named after a kind of setting is a group that says nothing.** "Colors" tells you what the controls are, which you can already see, and not what they affect. The only grouping that survives is by element.
- **What belongs to no part goes last**, under a heading that says so: "Layout and timing" for position, timing and duration.
- **A part is one card whether the template declared it or the person added it.** An added line of type looks and behaves like the template's own.
- **Cards fold, and remember.** The heading is the control: a caret and the part's name, not a button to press.

## Property panels

The Info tab is the worked example; anything that shows what an item *is* follows it.

- **A header card, not a heading.** A panel titled "Info" inside a tab called Info says nothing. The header is the item: its picture (poster, hover-scrub while pointed at, waveform for a sound), its name, its type with that type's icon, and the favorite star beside the name.
- **Collapsible sections with small headings**, their open state remembered. The facts people reach for are open by default; the rest wait to be asked for. An empty section is left out, not shown empty.
- **One fact per row, in a key–value grid**: a muted label column of fixed width so the values line up and can be scanned without reading the labels. The badge icons from the cards — alpha, loop, duration — are reused here, so the same idea looks the same everywhere.
- **Say nothing rather than "Unknown".** A row whose value the app has not been told is left out. Where absence is itself the answer, say it in words a reader can act on: "No tags yet", "None yet", not an empty box.
- **The path is not a value.** A location shows where the item sits *inside its library folder*; the whole path is the tooltip, and Reveal and Copy path are what hand it over — the same rule as a card (above).
- **A long description is clamped** to a few lines with "More", so one wordy item cannot push everything else off the panel.
- **A chip row ends with its own add control**, not a separate field further down: the place you add a tag is where the tags are.

## Fonts are credited dependencies

A font is code someone else wrote, under a licence of its own. Pulp bundles ten families under the SIL Open Font License 1.1 (`docs/font-credits.md`, ADR 0014) and the rule for them, and for any added later, is the same as for a library:

- **Taken from upstream, with its licence file**, which is read, not assumed. The credits file names the family, the version, the licence, any Reserved Font Name and the source, and a test holds the files, their hashes and the credits to one list.
- **Shipped unmodified.** No subsetting, no renaming: a Reserved Font Name requires it, and every family keeps its full character set.
- **Shown in its own face** wherever a family is chosen, so the choice is the look and not a name.
- **Never redistributed on someone's behalf.** A pack exported from Pulp carries no font files but a template's own; a family a person imports stays in their managed folder and is named by the template, not shipped with it.

## Tokens

All in `:root`; literal values outside the token block are a defect the enforcement test catches.

- **Type scale:** 11 px (captions, badges), 12 (secondary), 13 (body, the default), 15 (region titles), 18 (dialog titles); weights 400 and 600 only.
- **Text roles:** `--text`, `--text-secondary`, `--muted` (hints, disabled); `--accent` marks the one current thing (selection, active tab, pressed chip) and nothing else; `--danger` for errors.
- **Spacing:** a 4 px grid — 4, 8, 12, 16, 24.
- **Radii:** 4 px controls, 8 px cards and dialogs.
- **Focus:** one ring, 2 px accent with 2 px offset, on `:focus-visible` everywhere.
- **Icon sizes:** 16 (inline, chips), 20 (toolbar), 24 (transport).

**Three levels per region:** region title (15 px, 600), content (13 px), supporting text (11–12 px, muted). If a region needs a fourth level, the region is doing too much.

## Hierarchy in a list or tree

Depth is shown by **structure, not by type size**. Every row that can be selected is body size (13 px); shrinking the text to mean "deeper" burns the type scale on something indentation already says, and leaves the deepest rows the hardest to read.

The browse panel is the worked example; anything with the same shape follows it.

- **Section headings are not rows.** Quick access and My folders are supporting text (12 px, 600, muted) with space above and a thin rule between sections, and a chevron that folds the section. They never highlight on hover and are never selected — there is nothing to select. The categories at the top of the panel (milestone 34) have no heading at all: they are the panel's top level, not a section of it.
- **A row that holds children** gets a disclosure twisty (caret right folded, caret down open) in a fixed gutter before its icon, then its icon, label and count.
- **A row with nothing under it** keeps the icon and label and leaves the gutter empty, so every icon at that level lines up whether or not the row folds.
- **Children indent one step** behind a thin vertical guide line running down the middle of the parent's icon, and **do not repeat the parent's icon** — the group already said what they are. Their labels align with the parent's label, and they sit one text role quieter (`--muted` against `--text-secondary`) until hovered or selected.
- **Selection and hover highlight the full width of the row**, gutter included, so the target matches what the eye reads as a row. The current row also carries the accent as an inset left edge and a semibold label — `--accent` still marks exactly one thing.
- **Counts** are right-aligned supporting text, tabular figures. A fixed row with nothing in it (Favorites at zero, an empty folder) dims its label and count rather than disappearing; a taxonomy row with nothing in it is left out of the tree entirely.
- **Collapsed to an icon rail**, only the levels that have an icon survive: headings, counts, twisties and the children fold away, and the rows that remain show their icon with the label as a tooltip.
- **A child never repeats its parent.** "Sports › Sports (general)" is a tree admitting it has nowhere to put something. Where a vocabulary has a word for the whole of a group, that word belongs to the group's own row — items carrying it sit there, and the children are the specific ones. A parent row is therefore selectable and covers everything beneath it, so its count is never smaller than a child's (ADR 0010).

## Enforcement

A unit test, not a hope: it reads `index.html` and the display-name tables and fails on ALL CAPS display text, three-dot ellipses, raw ids in display strings, icon-only buttons without an `aria-label`, and `font-size` literals outside the token block in `styles.css`. Milestone 8's accessibility pass audits icon buttons and focus rings against this guide.
