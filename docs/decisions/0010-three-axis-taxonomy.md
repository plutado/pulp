# 0010. Categorization on three axes: type, theme, style

Date: 2026-10-23
Status: Accepted

## Context

Milestone 10 adds browsing by what an item is and what it is for. Today a template carries one `category` from a closed six-value list, media items have only folder tags, and there is no notion of theme (corporate, news, sports…) or look (clean, grunge, cinematic…). One axis cannot carry all three meanings: a "grunge sports lower third" is one type, one theme and one style at once, and flattening that into a single list either explodes combinatorially or loses the distinction.

## Decision

Three separate axes, in a pure core module (`src/core/taxonomy.ts`) with a version number:

- **Type** — what the item *is*. Exactly one per item (templates: declared `type` or mapped from the old `category`; media: inferred from kind and folders). Two levels: nine groups (titles and text, backgrounds, transitions, overlays, design elements, video clips, stills, music, sound effects) over 45 types (46 from version 2). The list is **closed**: a type outside it is a validation error, because the browse tree, sample coverage and pack defaults all key on it.
- **Theme** — what it is *about or for*. Zero or more per item. Eight built-in groups (business, media, sports, life events, holidays and seasons, community, world and nature, entertainment) over 50 themes, and **open**: any user word, normalized exactly like a tag ("My Show" → `my-show`), is a valid custom theme. Custom themes are stored like tags (no release needed to add one) and the browse tree shows them in a separate custom group.
- **Style** — how it *looks or sounds*. Zero or more per item, from a **closed** list of eleven (clean, corporate, elegant, high-energy, grunge, retro, tech, cinematic, playful, hand-drawn, organic). Closed because styles are a curated vocabulary for matched sets; a free-for-all here would just duplicate tags.

The old `category` stays valid and maps onto the type list (`lower-third`→lower third, `title`→title, `transition`→wipe, `overlay`→overlay, `background`→animated loop, `other`→no type), so existing templates keep working unchanged and the format change is additive.

Music moods (upbeat, dramatic, calm…) are deliberately left out until milestone 16 brings audio features; they would be a fourth axis with no consumer today.

## A child never repeats its parent

Added October 2026, after the tree showed "Sports › Sports (general)" and "Holidays and seasons › Holiday (general)".

Where a group has a word for the whole subject — `sports`, `holiday` — that theme belongs to **the group's own node**, not to a child of it. A group declares it as `general` and it is left out of the group's children. So:

- an item themed `sports` sits on the **Sports** node itself, and the children are specific (Football, Basketball, Soccer);
- **selecting a group scopes to everything in it**: its own items and all its children alike, which is what `theme:sports` now means in search, the same way `type:transitions` already meant a whole type group;
- a group's count is a count of **items**, not of themes, so something themed both `football` and `soccer` counts once.

A group with no word for itself (Media, Life events) simply has no general theme and no items of its own; its node still scopes to all its children.

This is a change of **labels and tree shape only**. `sports` and `holiday` keep their ids, keep validating, and keep matching anything already tagged with them — the extension rule below holds.

## Extension rule

Within taxonomy version 1, the type and style lists only grow, never rename or remove, and ids are permanent; renames change labels only. `TAXONOMY_VERSION` is bumped when the lists change so stored data can say what it was written against. Themes need no version bump to extend: unknown ids are custom by definition.

### Version 2 (October 2026)

Milestone 22 added `logo-reveal` to the Titles and text group: a piece built around an image slot whose whole job is to bring a logo on. Added under the rule above — nothing renamed, nothing removed — and `TAXONOMY_VERSION` moved to 2.

## Alternatives considered

- **One flat category list, grown.** Where the format started. Cannot say "everything corporate" across lower thirds, backgrounds and stingers, which is the browsing the layout plan is built around.
- **Everything as tags.** Already possible today and kept for free-form use, but tags cannot drive a stable tree with counts, sample-coverage checks ("one per type × theme cell") or pack defaults, because nothing distinguishes a type from a theme from a mood from a show name.
- **User-extendable types and styles too.** Rejected for v1: the tree, the matched-set packs and the sample-coverage goal all assume a shared vocabulary; themes are where personal vocabulary actually lives (shows, clients, projects).

## Costs

- 100+ ids become API the moment packs and manifests use them; hence the ids-are-permanent rule.
- A closed type list will be wrong for someone; `other`-category templates carry no type until their author picks one, and the tree needs an "untyped" place for them.
- Two sources of truth to keep aligned (`category` and `type`) until category can be dropped in a format v2.
