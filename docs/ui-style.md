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
| Search bar | Magnifier in the field; sort icon on the sort control; chips with icon + short label; the scope chip carries its node's icon |
| Results | Type icon as the empty-thumbnail placeholder; badges as small icons with tooltips (alpha, loop, audio) |
| Stage | Play/pause, loop, frame step, in/out marks, background toggle, safe areas as icon buttons; star outline/fill for favorite |
| Inspector tabs | Sliders (Parameters), export (Output), info circle (Info) — icon plus label |
| Tray | State icons on jobs (queued, running, done, failed); drag dots on the handle; trash on Clear finished |
| Status bar | Check or warning for ffmpeg, hard drive for the cache, spinner while scanning or rendering |

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

- **Section headings are not rows.** Quick access, Types, Themes, Styles, Packs, Folders are supporting text (12 px, 600, muted) with space above and a thin rule between sections, and a chevron that folds the section. They never highlight on hover and are never selected — there is nothing to select.
- **A row that holds children** gets a disclosure twisty (caret right folded, caret down open) in a fixed gutter before its icon, then its icon, label and count.
- **A row with nothing under it** keeps the icon and label and leaves the gutter empty, so every icon at that level lines up whether or not the row folds.
- **Children indent one step** behind a thin vertical guide line running down the middle of the parent's icon, and **do not repeat the parent's icon** — the group already said what they are. Their labels align with the parent's label, and they sit one text role quieter (`--muted` against `--text-secondary`) until hovered or selected.
- **Selection and hover highlight the full width of the row**, gutter included, so the target matches what the eye reads as a row. The current row also carries the accent as an inset left edge and a semibold label — `--accent` still marks exactly one thing.
- **Counts** are right-aligned supporting text, tabular figures. A fixed row with nothing in it (Favorites at zero, an empty folder) dims its label and count rather than disappearing; a taxonomy row with nothing in it is left out of the tree entirely.
- **Collapsed to an icon rail**, only the levels that have an icon survive: headings, counts, twisties and the children fold away, and the rows that remain show their icon with the label as a tooltip.

## Enforcement

A unit test, not a hope: it reads `index.html` and the display-name tables and fails on ALL CAPS display text, three-dot ellipses, raw ids in display strings, icon-only buttons without an `aria-label`, and `font-size` literals outside the token block in `styles.css`. Milestone 8's accessibility pass audits icon buttons and focus rings against this guide.
