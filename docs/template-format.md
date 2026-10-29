# Pulp template format, version 1

Status: draft. Version 1 may still change in incompatible ways before Pulp 1.0. After 1.0, incompatible changes require a new `formatVersion`. There is no plan to freeze the format at 1.0; it stays versioned and documented instead.

**A template is a shape, not a pixel size** (ADR 0012). The manifest declares the aspect ratios the template draws for (`aspects`), and the output resolution is chosen when it is rendered. Draw from the `width` and `height` in the state you are handed, never from a hard-coded size. Manifests that declare `width` and `height` keep working: the aspect is inferred from them and the size becomes that template's default resolution.

This document is the specification. The validator in `src/core/manifest.ts` implements it, and the two must agree; when they disagree, that is a bug in one of them.

## Overview

A template is a folder:

```
my-lower-third/
  template.json      required: the manifest
  index.html         required: the entry page (name configurable)
  thumbnail.png      optional
  ...                any other files the page uses (scripts, fonts, images)
```

The entry page draws one frame of the animation when the host calls `window.pulpRender(state)`. The host decides which frame to draw. For preview it calls this in real time; for rendering it steps through every frame, captures the page, and encodes the result.

Templates are offline documents. They must not load anything from the network, and the host blocks network access with a Content Security Policy.

## The manifest: `template.json`

A UTF-8 JSON object.

| Field | Type | Required | Description |
|---|---|---|---|
| `formatVersion` | integer | yes | Must be `1`. |
| `id` | string | yes | Stable identifier. Lowercase letters and digits in segments separated by `.` or `-`, e.g. `studio.news.lower-third`. Must be unique within a library. Prefix with something you own (a name or domain) to avoid collisions. |
| `name` | string | yes | Display name. |
| `description` | string | no | One or two sentences. |
| `version` | string | yes | Semantic version of the template, e.g. `1.2.0`. |
| `author` | string | no | Person or group that made it. |
| `license` | string | yes | SPDX identifier for the template itself, e.g. `CC0-1.0`, `CC-BY-4.0`, `MIT`. |
| `category` | string | yes | One of `lower-third`, `title`, `transition`, `overlay`, `background`, `other`. When no `type` is declared, the category maps to one (`transition` → `wipe`, `background` → `animated-loop`, the rest keep their name; `other` maps to no type). |
| `type` | string | no | What the template is, from the built-in type list (see below). More specific than `category`; one per template. |
| `themes` | string[] | no | What it is about or for: built-in theme ids such as `corporate`, `news`, `sports`, `christmas`, or your own words. Normalized like tags (`"My Show"` → `my-show`); unknown ids are custom themes, not errors. |
| `styles` | string[] | no | How it looks, from the built-in style list only: `clean`, `corporate`, `elegant`, `high-energy`, `grunge`, `retro`, `tech`, `cinematic`, `playful`, `hand-drawn`, `organic`. Unknown styles are errors. |
| `tags` | string[] | no | Search tags. Normalized to lowercase and de-duplicated. |
| `duration` | number | yes | Length in seconds, greater than 0 and at most 600. |
| `fps` | number | yes | Frames per second, greater than 0 and at most 240. Use `23.976`, `29.97` or `59.94` for NTSC rates; the renderer converts them to exact rationals. |
| `aspects` | string[] | yes, unless `width` and `height` are given | The shapes the template draws for, from `16:9`, `9:16`, `1:1` and `4:5`; at least one, the first is the default. The pixel size is chosen at render time from a standard list per aspect (720p, 1080p, 1440p, 4K, and 8K for 16:9) or as an exact size; without a choice a template renders at its first aspect's 1080-class size (1920 × 1080, 1080 × 1920, 1080 × 1080, 1080 × 1350). |
| `width`, `height` | integer | no | A default size in pixels, 16 to 8192, both or neither. Alone, it also declares the aspect: the built-in one it is within 1% of, or else its reduced ratio (`4:3`), at which the template renders at this one size. With `aspects`, it must be of one of them. Use even numbers: H.264, ProRes 422 and VP9 cannot encode odd sizes. |
| `alpha` | boolean | no | `true` if the template draws on a transparent background and is meant to be composited. Default `false`. |
| `entry` | string | no | Path to the HTML entry page, relative to the folder. Default `index.html`. Must not be absolute or contain `..`. |
| `thumbnail` | string | no | Relative path to a poster image. |
| `parameters` | object[] | no | Editable parameters, see below. Default `[]`. |
| `blocks` | object[] | no | Blocks where layers live, see **Blocks and layers** below. Default `[]`. |

Unknown top-level fields produce a warning. Put custom data in fields whose names start with `x-` (for example `x-studio-notes`); these are ignored without warnings.

Frame count is `round(duration * fps)`, minimum 1.

### Types

The built-in types, grouped (the canonical list with labels is `src/core/taxonomy.ts`, version 2; ids are permanent):

- **Titles and text:** `lower-third`, `title`, `opener`, `end-card`, `callout`, `social`, `logo-reveal`
- **Backgrounds:** `animated-loop`, `still-background`, `texture`
- **Transitions:** `wipe`, `reveal`, `flash`, `glitch`
- **Overlays:** `overlay`, `frame`, `light-particles`, `film-grunge`, `logo-bug`, `vignette`
- **Design elements:** `shapes`, `icons`, `arrows`, `infographic`, `counter`, `countdown`
- **Video clips:** `stock-footage` · **Stills:** `photo`, `illustration`, `layered-graphic`
- **Music:** `full-mix`, `stems`, `sting`
- **Sound effects:** `ambience`, `impact`, `whoosh`, `ui-tech`, `alarm`, `nature-weather`, `animals`, `vehicles`, `crowd`, `foley`, `explosion`, `sci-fi`, `musical-phrase`

The built-in themes live in the same module: eight groups (business, media, sports, life events, holidays and seasons, community, world and nature, entertainment). Themes you invent are fine; they are yours, not errors.

### Parameters

Each parameter has:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Key used in `state.params`. Letters, digits and `_`, not starting with a digit. Unique within the template. |
| `type` | string | yes | `text`, `color`, `number`, `boolean`, `select` or `font`. |
| `label` | string | yes | Label shown in the parameter form. |
| `default` | depends on type | yes | Value used when the user has not changed it. Must itself be valid. |
| `description` | string | no | Help text. |
| `group` | string | no | Consecutive parameters with the same group are shown under one heading. Used only by a template that names no `element`. |
| `element` | string | no | The part of the graphic this setting belongs to — `"Panel"`, `"Logo"` — so the Parameters tab can put everything about one part in one card. See **Settings by element** below. |

Type-specific rules:

| Type | `default` | Extra fields | Notes |
|---|---|---|---|
| `text` | string | `maxLength` (positive integer), `multiline` (boolean) | Longer input is truncated. Line breaks are replaced by spaces unless `multiline` is true. |
| `color` | `#RRGGBB` or `#RRGGBBAA` | | Values reach the template in lowercase. The value can be passed straight to Canvas `fillStyle`. |
| `number` | number | `min`, `max`, `step` | Input is snapped to `step` (counted from `min`, or 0) and clamped to `[min, max]`. |
| `boolean` | boolean | | |
| `select` | string | `options`: `[{ "value": string, "label": string }]` | Values must be unique; `default` must be one of them. |
| `font` | CSS font-family string | `options`: string[] | If `options` is given the value must be one of them. Bundle font files in the template folder and load them with `@font-face`, or use families that exist on every target system. |
| `image` | none (`null`); the user picks a library still | `box` (required), `fit`, `align`, `margin`, `fallbackText` | An **image slot**: see below. The value the template receives is `null` or `{ id, treatment, tint, effect, hidden }`, where `id` is a library item id, never a path. |

### Settings by element

The Parameters tab is organised by **part of the graphic**, not by kind of setting: one collapsible card per part, holding everything about it. A flat "Colors" group says little once a template has layers — *which* text is "Text color" about? — so a parameter names the part it belongs to:

```json
{ "id": "panel", "type": "color", "label": "Fill", "element": "Panel" },
{ "id": "accent", "type": "color", "label": "Accent bar", "element": "Panel" }
```

The cards, in order:

1. **A card per layer**, in block and stack order, headed by the layer's label: its words and type, or its picture, with what can be done to it (hide, reorder, remove) beside the heading. Layers a person adds appear here in the same pattern as the template's own.
2. **A card per element** the parameters name, in the order they are declared. A parameter whose `element` matches a layer's label joins **that layer's card**, which is how a slot's picker can sit beside the words it goes with.
3. **"Layout and timing"**, holding every parameter that named no element: what belongs to the whole graphic — position, animate in and out, duration.

A template that names no element and declares no blocks gets the plain form it always had, with its `group` headings. `group` is ignored inside a card: the card is the group.

### Image slots

An image slot is a box in the layout that a chosen library still — a logo, a mark, a portrait — is drawn into **inside the template's own animation**, so it follows every move, fade, mask and wipe the template makes. The user picks the image in the Parameters tab; the template only says where it goes and how.

| Field | Type | Required | Description |
|---|---|---|---|
| `box` | object | yes | `{ "x", "y", "width", "height" }` as fractions of the frame, inside it. Either one box for every shape, or one per aspect id (`"16:9"`, `"9:16"`, …) with an optional `"default"`; the host picks the box for the frame being drawn. |
| `fit` | `contain` or `cover` | no | `contain` (default) fits the whole image inside the box; `cover` fills the box and crops. |
| `align` | string | no | Where a smaller image sits in the box: `center` (default), `left`, `right`, `top`, `bottom`, `top-left`, `top-right`, `bottom-left`, `bottom-right`. |
| `margin` | number | no | Kept clear on every edge, as a fraction (0 to 0.45) of the box's shorter side. Default 0. |
| `fallbackText` | string | no | The id of a `text` parameter — or of a text layer of one of this template's blocks — whose words stand in when no image is chosen: the company name set in type where the logo would be. |

An image parameter has no `default`: with nothing chosen the slot is empty and the template draws its fallback, or nothing. **Treatments travel with the choice**, not with the template: the user picks original colours, tinted (with a colour), white or black for contrast, and an optional shadow or glow; the host applies the treatment before the template draws, so the template never handles pixels. PNG and SVG with alpha are the normal case; any library still is accepted.

In `pulpRender`, `state.images[id]` describes every slot for the current frame — its pixel `box`, `fit`, `align`, `margin`, the chosen `id` or `null`, and the resolved `fallback` text — and the host adds `bitmap` to the chosen ones, decoded **before the first frame** so no frame is drawn with a half-loaded logo. The bridge provides one helper:

```js
// Draws the slot's image into its box (or into `box`, if the slot should ride something the
// template is animating), with the fit, alignment, margin, treatment and effect the slot carries.
// Returns false when no image is chosen, so the template can draw the fallback instead.
if (!window.pulpDrawImage(ctx, state, 'logo', { x: panelX + 20, y: panelY + 20, width: 110, height: 110 })) {
  ctx.fillText(state.images.logo.fallback || '', textX, textY);
}
```

`window.pulpFitBox(box, imageWidth, imageHeight, fit, align, margin)` returns the placement without drawing, for templates that want to animate the image themselves; `state.images[id].bitmap` is a canvas they may draw directly.

**What a template may load.** Templates are blocked from the library, and image slots do not change that: the host reads exactly the stills chosen for a template's slots, by id, and hands the page their bytes for the length of a preview or a render (ADR 0013). The template never gets a URL into the library — `pulp-media://` refuses every request from a template page, and the template CSP lists no library scheme — so it cannot read a chosen image's neighbour, or any image when none is chosen.

### Blocks and layers

An image slot is the author's: a logo goes where the template says. A **layer** is the user's: another line of text or a second mark that the person using the template adds, and that still rides the animation. A template makes room for them by declaring **blocks**, and layers stack inside a block — the template's own layers as the defaults, then whatever is added — taking their part of the template's movement from their **position in the stack**, so a line added in the middle moves as the middle line of the design does.

A block:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Letters, digits and `_`, not starting with a digit. Unique among the blocks. |
| `label` | string | yes | Shown where layers are added. |
| `box` | object | yes | Where the block is, as an image slot's `box`: `{ "x", "y", "width", "height" }` as fractions of the frame, one for every shape or one per aspect id with an optional `"default"`. |
| `direction` | `column` or `row` | no | Layers stack top to bottom (`column`, the default) or left to right. |
| `gap` | number | no | Room between layers, as a fraction of the frame's short side. Default 0. |
| `align` | `left`, `center`, `right` | no | Where layers sit across the box, and the alignment its text layers start from. Default `left`. |
| `verticalAlign` | `top`, `middle`, `bottom` | no | Where the stack sits in the box's height; in a row, where each layer sits in the row. Default `top`. |
| `open` | boolean | no | Whether layers may be added beyond the template's own. Default `true`; `false` marks a block that is full. |
| `typography` | object | no | What the block's text layers start from; any of the text properties below. Unnamed properties take the built-in defaults (Inter, 0.06, 400, white, wrap). |
| `layers` | object[] | no | The template's own layers, in stack order. Default `[]`: a block the user fills. |

A layer has an `id` (unique within its block, same form as a block id), a `label`, a `type` of `text`, `image` or `video`, and optionally `required` (it cannot be removed; default `false`), `hidden` (kept but not drawn, the stack closing up; default `false`), `spaceBefore` (room before it along the stack, as a fraction of the frame's short side; default 0) and `transition` (how it arrives and how it leaves; see **A layer's own entrance and exit** below) and `span` (when it comes and goes; see **A layer's own start and end**). A text layer has its `text` and any of the text properties, each of which overrides the block's typography:

| Property | Type | Description |
|---|---|---|
| `family` | string | A font family name or CSS font stack. The ten bundled families (see **Fonts**, below) are available in every template page by name; anything else works where it is installed and falls back where it is not. |
| `size` | number | The type size as a fraction of the frame's short side, so it holds at every resolution and shape. |
| `weight` | integer | 100 to 900. |
| `italic` | boolean | |
| `case` | `none`, `upper`, `lower`, `title` | |
| `letterSpacing` | number | In em of the size; may be negative. |
| `kerning` | boolean | |
| `lineHeight` | number | A multiple of the size. |
| `color` | `#RRGGBB` or `#RRGGBBAA` | |
| `align` | `left`, `center`, `right` | |
| `overflow` | `wrap`, `shrink`, `truncate` | What happens when the text does not fit the block: wrap onto more lines, shrink to fit, or cut with an ellipsis. |
| `maxLines` | integer | Lines a `wrap` layer may take before it is set smaller instead; 1 to 20, default 3. |

An image layer has a `size` (the picture's height as a fraction of the frame's short side; the width follows the picture's shape and is capped by the block) and an `align`, and no font properties. It carries no `image` of its own, for the reason an image slot has no default: a template cannot ship a library id. The picture is chosen at use time, with milestone 22's picker, grant and treatments; with none chosen the layer draws nothing and takes no room.

```json
"blocks": [
  {
    "id": "strap",
    "label": "Strap",
    "box": { "16:9": { "x": 0.08, "y": 0.72, "width": 0.6, "height": 0.2 }, "default": { "x": 0.08, "y": 0.6, "width": 0.84, "height": 0.2 } },
    "gap": 0.01,
    "typography": { "family": "Oswald", "size": 0.07, "weight": 600 },
    "layers": [
      { "id": "name", "type": "text", "label": "Name", "text": "Jane Doe", "required": true, "case": "upper" },
      { "id": "title", "type": "text", "label": "Title", "text": "Reporter", "size": 0.045, "weight": 400, "color": "#cfd8e3" }
    ]
  }
]
```

### Length and structure

A template is designed at a length — its `duration` — and a person may want the graphic to run for another. A template says which part of itself may be stretched by declaring a `structure` beside its duration:

```json
{ "duration": 6, "structure": { "holdFrom": 1, "holdTo": 5 } }
```

Both are seconds on the template's **own** clock: the entrance runs from 0 to `holdFrom`, the hold from `holdFrom` to `holdTo`, and the exit from `holdTo` to `duration`. The hold must be at least 0.05 s long and both must lie inside the duration, or the manifest is refused.

Two other kinds of graphic stretch differently, and say so instead of naming a hold:

```json
{ "structure": { "loop": true } }    // a background or overlay: it goes round
{ "structure": { "scale": true } }   // a transition: the whole thing plays faster or slower
```

A **loop** repeats for as long as it is asked to, so its last moment must meet its first: whatever moves must be back where it started by `duration`. It may be asked for less than its own duration as well as more. A **scale** keeps every proportion and changes only how fast it plays, which is what a wipe or a flash wants — it is bounded to between a quarter and four times its designed speed, so it can never become a still or a flicker. A structure may be one of the three and no more than one.

The host then maps every moment of the chosen length back to a moment of the template's own time: the entrance and the exit play at the speed they were designed at, and only the hold stretches or shrinks. **A template needs no code for this** — it keeps drawing against `state.time` and its own `state.duration`, exactly as it always did. A template that declares no `structure` has nothing to stretch, keeps its fixed length, and is refused a `--length` rather than quietly ignoring it.

A template that declares a structure should not also offer a "Hold, seconds" parameter: the length is the control now, and two ways to set the same thing would fight.

#### Choosing `holdFrom` and `holdTo`

The hold is what the graphic **settles into**, and the declaration is a promise about the pictures between those two moments: stretching them must change nothing but how long they are on screen. Three things decide where they go.

**The hold must really hold.** Measure it rather than reading it off the easings: render the template small, difference each frame against the first frame of the stretch, and keep only a stretch where nothing differs. Ambient motion disqualifies a graphic even though it looks still frame to frame — a glow that breathes, confetti that keeps falling, a second hand that ticks. Stretched, such a graphic would play that motion in slow motion, which is exactly what a declared hold promises not to do. A pause at the turn of a drift is not a hold either: look for the stretch a graphic settles into, not the moment its movement changes direction.

**A parameter that moves the parts moves them for every value it can take.** A structure is fixed in the manifest while a parameter is chosen per use, so an "Animate in/out (seconds)" that runs from 0.2 to 2 must not be able to push the entrance past `holdFrom`. Declare the hold that holds at **every** value in the range — in practice the one measured at the slowest in and out — and the shorter settings simply spend longer sitting still inside the declared entrance, which looks the same either way. The alternative, narrowing the parameter to fit the structure, takes a published range away from the people using the template.

**Allow for a line being added.** A block that is `open` takes layers the template never shipped, and a stack whose entrance is staggered per layer finishes later for each one. Declare the hold the design settles into with a line added to every open block, not the one it reaches with the layers it ships.

Where no stretch survives all three, the template declares no structure and keeps its fixed length. That is the right answer for a countdown, for a graphic that drifts throughout, and for anything whose whole duration is movement. The end-to-end suite checks the promise on a bundled template of each kind, at the settings that squeeze its hold hardest (`tests/e2e/render.e2e.test.ts`).

#### Video layers

A `video` layer plays a clip inside the graphic (milestone 26). It takes its room exactly as an image layer does — `size` is a height as a fraction of the frame's short side, the width follows the clip's shape, and `align` places it across the block — and like an image layer it carries **no clip of its own**: a template ships no library ids, so `clip` is left out or `null` and the person using the template chooses one.

What they choose carries the clip's id with how it plays: an in point and an out point in clip frames, `loop` or `once` at the end, a `speed` (1 is the recorded rate) and a `delay` in seconds before it starts. The host decides which frame of the clip belongs to each moment of the graphic and hands the page that frame; a clip played `once` **clears** when it reaches its out point rather than freezing on the last frame, and a layer that is not playing takes no room at all, so the stack closes up around it. Templates need no code for any of this: a block drawn with `pulpLayoutBlock` and `pulpDrawBlock` plays its video layers already.

#### A layer's own entrance and exit

By default a layer takes the movement of the **position it is in** — that is the whole point of a block, and it is what lets a line added in the middle move as the middle line of the design does. A layer may instead carry a `transition` of its own, which the person using the template sets in the Parameters tab under **Advanced**. It has an `in` and an `out`, chosen separately, each of:

| Field | Type | Description |
|---|---|---|
| `type` | `template`, `fade`, `slide`, `scale`, `wipe`, `none` | `template` (the default) leaves that end to the template, as above. The rest are the layer's own: fade, slide into place, scale up, uncover with a wipe, or arrive and leave with no movement at all. |
| `seconds` | number | How long that end takes; 0.05 to 10, default 0.5. |
| `direction` | `auto`, `top`, `bottom`, `left`, `right` | Which edge a slide travels from and a wipe opens from — and for the exit, where it goes back to, so a layer leaves the way it came. `auto`, the default, is the way the stack goes: up from below in a `column`, in from the left in a `row`. Nothing to a fade, a scale or none. |

Three rules keep a layer of one's own inside the author's design, and a template needs no code for any of them:

- **The entrance replaces the template's movement for that layer; the exit is multiplied into it.** So one end can be the person's and the other the template's, which is what choosing them separately means.
- **Whatever is chosen still goes when the graphic goes.** All of it is multiplied by the block's *envelope* — the most the template is showing any of that block's layers at this frame, which is what the `each` hook already says. While a template staggers its lines in, its leading line is already at full, so a layer with an entrance of its own is free to show from the first frame; when the graphic clears, every layer's alpha falls and the layer goes with it. **No layer can be left on screen after the graphic has gone.**
- **Both ends finish inside the layer's own time on screen.** A two-second entrance on a layer that is there for one second would never finish, so when the two ends together ask for more room than there is they are shortened in proportion rather than one eating the other.

A slide travels the layer's own size — a line's type size, a picture's height — so it reads the same at every resolution and on type of any size. A scale grows from 0.8. A **wipe** does not fade at all: the layer is drawn whole and clipped to the part that has been uncovered, so it reads on any background, and it is clipped to what the layer draws rather than to the slot it sits in, for the same reason a turn goes about the ink box. An entrance of the person's replaces the whole of the template's movement for that layer, including any letter spacing the template was animating.

`window.pulpLayoutBlock` applies all of this from the frame state it is already given, so **a template that uses blocks supports this without changing a line**. A template that lays a block out by hand, without the helper, is simply not offering the feature.

A stack saved before this carried a `motion` — an entrance-only `type` with a `delay` — and still works: the type is read as `transition.in` over the half second it always took, and the delay as the layer's own `start`, which is the same moment on the same clock. Nothing writes a `motion` any more.

#### A layer's own start and end

A layer is drawn for the whole of the graphic unless it carries a `span` of its own (milestone 28), set in the Parameters tab under **Advanced**:

| Field | Type | Description |
|---|---|---|
| `start` | number | Seconds at which the layer appears; 0, the default, is the first frame. |
| `end` | number or `null` | Seconds at which it leaves — the moment it has gone, so a layer ending at 3 is not drawn at 3. `null`, the default, runs it to the end of the graphic. |

Both are seconds of the graphic **as it is watched** — milestone 30's chosen length — not of the template's own clock. The two differ as soon as a length is asked for: someone who wants a line five seconds into a lower third stretched to twenty means five seconds into the twenty they are watching, so that is what a span counts, and the same stored span is right at every length. A video layer's `delay` is timed this way too.

Two rules hold a span to shortening a layer's time on screen rather than taking it away:

- **A layer never outlasts the graphic.** An end past the graphic's length is its length, which is what no end at all means too.
- **A layer is always on screen for a moment.** A start past the end of the graphic, or an end at or before the start, is held back to leave 0.05 s — the same reasoning as the entrance always finishing inside the template, and as milestone 30's least hold. A layer that should not be there at all is **hidden**, which is a different thing and says so.

The span is the last word: outside it the layer is not drawn, whether the movement for that frame was the template's own or the layer's. Both ends of the layer's own transition are timed against it — the entrance from the start, the exit into the end — so moving either moves them with it. The layout is untouched — a layer waiting its turn keeps the room the stack gave it — so a design does not reflow as layers come and go. A layer with no span serializes exactly as it always did, and `"span": null` in a stored stack puts it back to the whole graphic.

#### A layer's own placement

A layer may carry a `placement`: where the person using the template put it, set by dragging it on the stage (milestone 25). It is an object keyed by aspect id (or `"default"`), each entry any of:

| Field | Type | Description |
|---|---|---|
| `dx`, `dy` | number | The offset from where the block stacked the layer, as fractions of the frame's width and height; −1 to 1, default 0. |
| `scale` | number | About the layer's own centre; 0.05 to 10, default 1. |

The host applies a placement **around the template's own draw** of that layer — the offsets add to whatever the template (or the layer's own motion) asked for the frame, the scales multiply, and the angles add (`rotate`, in degrees clockwise about the layer's centre; milestone 29) — so a placed layer still enters, moves and leaves with the design, and **templates need no changes**. Keeping it per aspect means a layout placed at 16:9 never moves what was placed at 9:16: a frame answers with its own aspect's entry, then `"default"`, then nothing. The stack's layout is untouched — the layer's slot stays where the block put it, and "Reset position" simply drops the placement.

Like every layer value it rides in the same bag as the parameters, so presets, collections, CSV batches, `--param '@layers={…}'` and the render cache key all carry it.

#### Assets

**Assets** (milestone 26) are not templates: they are isolated elements on transparency — a flame, a puff of smoke, a burst of confetti — that a person places on a frame, as distinct from an overlay, which covers the whole frame. They live in the taxonomy's own **Assets** group, indexed from folders like any other media, and the browse tree types them from their folder names (`Assets/Fire and flames/…`).

The bundled examples are generated, never committed: recipes in the sample generator draw each one on a transparent canvas over its own time and write it as a WebM with alpha (VP9) for the moving version and a PNG for the still, seeded so every generation is identical. A category's assets loop where that is natural — a flame, a wisp of steam, falling rain — and play once where it is not, like a splash or a shockwave.

### Fonts

Pulp bundles ten families under the SIL Open Font License 1.1 — **Inter, Montserrat, Oswald, Bebas Neue, Source Serif 4, Playfair, JetBrains Mono, Caveat, Dancing Script, Noto Sans** — so a layer can be set in a face that exists on every machine (`docs/font-credits.md`, decision record 0014). Every template page has them: the bridge declares an `@font-face` for each file beside itself, and the template protocol serves the files under the template's own origin at the reserved path `/__pulp/fonts/`, which is what `font-src 'self'` allows. A template folder therefore cannot have files under `__pulp/`.

A text layer set in a bundled family is drawn in it with no work from the template: the bridge loads the face (family, weight and style) before the frame that uses it, because canvas text never triggers a font load on its own. That wait is bounded at three seconds, so a face that cannot be fetched costs a frame in the fallback rather than no frame at all. A template's **own** drawing code that sets `ctx.font` to a bundled family must load it first — `document.fonts.load('600 16px Oswald')` once, before drawing — or the first frames fall back. Fonts a template bundles in its folder keep working as before.

**Where the values live.** The stacks a person builds ride in the same bag of raw values as the parameters, under the key `@layers` — a parameter id cannot start with `@`, so the two can never collide. That is why layers go wherever parameters already go: the undo history, a saved preset, a collection card and file, the render cache key, and a render request.

Two routes take them as text:

- **A CSV batch column** may name a text layer, by its id or its label, as it may a parameter. The row carries the template's stack with that layer's words changed, and is named by the first such column when there is no name column.
- **`--param` on the command line** takes the stacks as JSON: `--param '@layers={"strap":[{"id":"name","text":"Ada Lovelace"},{"type":"text","text":"A third line"}]}'`. What is given **patches** the template's layers — naming one changes that one, an entry with a `type` is added at the end, and everything else stays as the template has it. To leave a line out of a render, hide it (`{"id":"title","hidden":true}`) rather than dropping it from the list. Text that is not an object of stacks, a block the template does not declare, or a layer it does not have is an error that names what the template does have; nothing is rendered. A **stored** stack — a preset, a collection item — is the whole stack and replaces the template's, which is how a removed layer stays removed.

**Use-time values.** What a person builds is a stack per block: the template's layers with the fields they changed, the layers they added (to open blocks only), in their order, with `hidden` for what is kept but not drawn. The host resolves it against the template (`resolveLayers` in `src/core/layers.ts`): a field that is wrong falls back to the template's and is reported, `type` and `required` are the template's and never change, a required layer that was dropped comes back where the template had it, and an addition to a full block is dropped. "Reset layers" is the template's own stacks again.

**Drawing.** `state.blocks[id]` describes a block for the current frame: its `box` in pixels, `direction`, `gap`, `align`, `verticalAlign`, and `layers` — the layers that are drawn, in stack order, each with its `position`, its sizes in pixels and its properties. Hidden layers are left out, so a layer's `position` is where it sits in the stack as drawn.

The host finishes the layout and the drawing, so every template treats a long name the same way:

```js
// Measure, wrap or shrink, stack and place. `each` is called per layer with its stack position,
// and what it returns rides that position: a layer added in the middle takes the middle's movement.
var card = window.pulpLayoutBlock(ctx, state, 'card', {
  each: function (layer, position) {
    var start = 0.7 * position;                       // the template's own stagger
    return { alpha: fade(state.time - start), dy: (1 - fade(state.time - start)) * 20 };
  }
});
// The laid-out block is readable before it is drawn, so the design can follow the stack:
// card.layers[0].box, .lines[i].baseline, .size (the size it ended up at, after any shrinking).
window.pulpDrawBlock(ctx, card);
```

`each` may return `alpha`, `dx`, `dy`, `scale` — applied when the layer is drawn — and `letterSpacing` in em, which **replaces** the layer's own for this frame and is therefore what the text is measured and wrapped with. A template animating its tracking passes it here. An optional `box` on the options lays the block out somewhere else, for a template animating the block itself, and an optional `align` aligns every layer that way this time, for a design the template mirrors (a strap that sits on the right). A template that needs the stack's size before it knows where to put it — a panel sized to its words — lays the block out once to measure and once more in place; widths do not depend on the box's position.

Text is drawn at its baselines with the layer's family, size, weight, italic and colour. With no letter spacing and kerning on, each line is one `fillText`; otherwise the characters are drawn one at a time with the spacing between them, which is also how they are measured, so the two always agree. A picture is contained and centred in the room the stack gave it.

The arithmetic is `src/core/layer-layout.ts`, unit tested, and the bridge carries the same algorithm; the two are mirrors and change together.

### Parameter resolution

When rendering, the host merges user input with defaults (`src/core/params.ts`):

- Missing values use the default.
- Values of the wrong type, or outside the allowed options, fall back to the default and are reported.
- Numbers given as strings (`"42"`) and booleans given as `"true"`/`"false"` are accepted.
- Unknown keys are ignored and reported.

The template can therefore rely on every parameter being present with the declared type.

## Runtime contract

### What the template provides

The entry page must define a global function:

```js
window.pulpRender = function (state) {
  // draw the frame described by state
};
```

It may return a Promise; the host waits for it to settle before capturing.

`state` contains:

| Field | Type | Description |
|---|---|---|
| `frame` | integer | Zero-based frame index of the **render**. |
| `time` | number | Seconds on the **template's own** clock, from 0 to `duration`. At the template's own length this is `frame / fps`; under a chosen length (see **Length and structure**) it is the moment of the template that this frame of the render shows. |
| `progress` | number | `time / duration`, clamped to 0..1. |
| `fps`, `duration` | number | From the manifest: the rate frames are sampled at, and the length the template was **designed** at. |
| `totalFrames` | integer | Frames in this render, which is more than the manifest's own when a longer length was asked for. |

**Animate from `time` or `progress`, not from `frame / totalFrames`.** They are the same thing at the template's own length, and they part company as soon as a person asks for a different one: `time` stays on the clock the template was drawn against, which is what lets it be stretched without being rewritten.
| `width`, `height` | integer | The canvas for this render in pixels: the chosen aspect and resolution, not anything from the manifest. Size the canvas from these on every call, since the same template is drawn tall, square and wide. |
| `params` | object | Resolved parameter values keyed by parameter id. An image parameter's value is `null` or `{ id, treatment, tint, effect }`. |
| `images` | object | One entry per image slot (see Image slots): `{ id, box, fit, align, margin, treatment, tint, effect, fallback, bitmap? }`, the box in pixels of this frame. Draw them with `window.pulpDrawImage`. |
| `blocks` | object | One entry per block (see Blocks and layers): the box in pixels and the layers that are drawn, in stack order. Lay one out with `window.pulpLayoutBlock` and draw it with `window.pulpDrawBlock`. |

### Rules for templates

1. **Deterministic.** The pixels for a frame must depend only on `state` and the template's own files. Do not use `Date.now()`, `performance.now()`, `requestAnimationFrame` timing, `setTimeout`/`setInterval`, or unseeded `Math.random()` to drive animation. Frames may be requested in any order and more than once.
2. **Complete per call.** Each call draws the whole frame. Clear or repaint the canvas first.
3. **Transparent background when `alpha` is true.** Leave `html` and `body` with a transparent background and clear the canvas with `clearRect`. Semi-transparent colors are preserved in alpha outputs.
4. **Fill the viewport.** The host sizes the page to the render's `width` x `height` and scales it in the preview. Set the canvas's `width` and `height` attributes from the state (only when they change, so the bitmap is not cleared needlessly) and give it CSS `width: 100%; height: 100%`; lay the frame out from those numbers, not from constants, so a lower third sits in the right place at 1920 × 1080 and at 1080 × 1920.
5. **Offline.** Only files inside the template folder can be loaded. Network requests are blocked.
6. **Ready means loaded.** The host waits for the window `load` event and `document.fonts.ready` before the first call. Load fonts and images before that point (for example with `@font-face` in CSS or `<img>` tags in the page).
7. **Fast and finite.** When rendering, the page has 30 seconds to load and each frame has 10 seconds by default. A template that runs over, or that throws (or rejects, if `pulpRender` returns a Promise), stops the render with an error naming the frame and, where available, the file and line.
8. **Colors are sRGB.** Pick colors as you would for the web and draw in the Canvas default color space. Video outputs are converted to Rec.709 (BT.709 matrix, limited range) and tagged as such, so editors show the colors you chose; PNG sequences keep full-range sRGB. No conversion is needed inside the template.

DOM and CSS animation are possible as long as they are driven from `state` (for example, setting styles inside `pulpRender`), but Canvas 2D is recommended for predictable output.

### What the host provides

The host serves the template folder at `pulp-template://<id>/` and injects a small bridge script as the first script in the entry page. The bridge:

- exposes `window.__pulp.ready` (a Promise) and `window.__pulp.render(state)`, used by the renderer;
- answers `postMessage` requests of the form `{ type: "pulp:render", id, state }` with `{ type: "pulp:rendered", id }` or `{ type: "pulp:error", id, message }`, used by the preview;
- posts `{ type: "pulp:ready" }` to the parent frame once ready.

Templates do not need to call or include the bridge. Its source is `BRIDGE_SCRIPT` in `src/core/runtime.ts`. The bridge also decodes the images handed over for a template's image slots (`window.__pulp.prepare`) and exposes `window.pulpDrawImage`, `window.pulpFitBox`, `window.pulpLayoutBlock` and `window.pulpDrawBlock`.

Every response carries this Content Security Policy:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' pulp-template: data:; media-src 'self' blob:;
connect-src 'none'; frame-src 'none'; form-action 'none'
```

(`font-src` names `pulp-template:` as well as `'self'` so the bundled fonts at `/__pulp/fonts/` are reachable however a custom scheme's origin is computed; a template page can already read its own folder, so this allows nothing new.)

## Minimal example

`template.json`:

```json
{
  "formatVersion": 1,
  "id": "example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "license": "CC0-1.0",
  "category": "title",
  "duration": 2,
  "fps": 30,
  "aspects": ["16:9", "9:16"],
  "alpha": true,
  "parameters": [
    { "id": "text", "type": "text", "label": "Text", "default": "Hello" },
    { "id": "color", "type": "color", "label": "Color", "default": "#ffffff" }
  ]
}
```

`index.html`:

```html
<!doctype html>
<html>
<head>
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  window.pulpRender = function (s) {
    if (canvas.width !== s.width || canvas.height !== s.height) {
      canvas.width = s.width;
      canvas.height = s.height;
    }
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.globalAlpha = Math.min(1, s.time / 0.5);
    ctx.fillStyle = s.params.color;
    // Scale type with the short side, so it reads the same tall or wide.
    ctx.font = Math.round(Math.min(s.width, s.height) / 9) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.params.text, s.width / 2, s.height / 2);
  };
</script>
</body>
</html>
```

## Licensing templates

The `license` field describes the template, not Pulp. When you share templates, include any font or image licenses they depend on in the folder. Pulp shows the license in the UI; it does not enforce it.

## Template packs

A pack is a folder, or a `.zip` of that folder, holding a `pack.json` and one folder per template:

```
news-pack/
  pack.json
  strap/
    template.json
    index.html
  bug/
    template.json
    index.html
```

`pack.json`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `formatVersion` | `1` | yes | |
| `name` | string | yes | Shown when importing; also the pack's folder name after install (lowercased, dashes). |
| `version` | string | no | |
| `author` | string | no | Shown when importing. |
| `license` | string | yes | SPDX identifier for the pack as a whole. Templates carry their own `license`. Pulp warns, but does not refuse, when a license is missing, `UNLICENSED`, or not in its list of open licenses (CC0, CC BY, CC BY-SA, MIT, ISC, Apache-2.0, BSD, Unlicense, OFL, Zlib, MPL). |
| `description` | string | no | |
| `type` | string | no | Default type for the pack's templates, from the built-in type list; a template that declares its own `type` keeps it. |
| `themes` | string[] | no | Themes added to every template in the pack (built-in ids or your own words, normalized like tags). |
| `styles` | string[] | no | Styles added to every template in the pack, from the built-in style list only. |
| `homepage` | string | no | |
| `templates` | string[] | yes | Folder names inside the pack, one per template. Each must hold a valid `template.json` and its entry file. |

A zip may wrap everything in one top-level folder. Entry names must be relative paths without `..`; the archive is read with limits (5,000 entries, 512 MiB unpacked) and anything else is refused.

Importing shows a preview first: pack name, author and license, and for each template its id, license, size and what will happen. A template whose id already exists in the user's own library folders is skipped; one whose id exists from an earlier pack install can be kept or replaced. Installed packs live in the `packs` folder of the app's user data, never in library folders, and that folder is part of the library. Exporting writes a pack from the templates currently listed, with a `pack.json` from the fields the user fills in.

## Planned additions (not part of version 1)

Tracked in ROADMAP.md: the drawing side of blocks and layers (`state.blocks` and a bridge helper, milestone 23), a `media` parameter type (a video plate from a library clip), audio tracks, localized labels, and an optional seeded random number generator provided by the bridge.
