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
| `group` | string | no | Consecutive parameters with the same group are shown under one heading. |

Type-specific rules:

| Type | `default` | Extra fields | Notes |
|---|---|---|---|
| `text` | string | `maxLength` (positive integer), `multiline` (boolean) | Longer input is truncated. Line breaks are replaced by spaces unless `multiline` is true. |
| `color` | `#RRGGBB` or `#RRGGBBAA` | | Values reach the template in lowercase. The value can be passed straight to Canvas `fillStyle`. |
| `number` | number | `min`, `max`, `step` | Input is snapped to `step` (counted from `min`, or 0) and clamped to `[min, max]`. |
| `boolean` | boolean | | |
| `select` | string | `options`: `[{ "value": string, "label": string }]` | Values must be unique; `default` must be one of them. |
| `font` | CSS font-family string | `options`: string[] | If `options` is given the value must be one of them. Bundle font files in the template folder and load them with `@font-face`, or use families that exist on every target system. |
| `image` | none (`null`); the user picks a library still | `box` (required), `fit`, `align`, `margin`, `fallbackText` | An **image slot**: see below. The value the template receives is `null` or `{ id, treatment, tint, effect }`, where `id` is a library item id, never a path. |

### Image slots

An image slot is a box in the layout that a chosen library still — a logo, a mark, a portrait — is drawn into **inside the template's own animation**, so it follows every move, fade, mask and wipe the template makes. The user picks the image in the Parameters tab; the template only says where it goes and how.

| Field | Type | Required | Description |
|---|---|---|---|
| `box` | object | yes | `{ "x", "y", "width", "height" }` as fractions of the frame, inside it. Either one box for every shape, or one per aspect id (`"16:9"`, `"9:16"`, …) with an optional `"default"`; the host picks the box for the frame being drawn. |
| `fit` | `contain` or `cover` | no | `contain` (default) fits the whole image inside the box; `cover` fills the box and crops. |
| `align` | string | no | Where a smaller image sits in the box: `center` (default), `left`, `right`, `top`, `bottom`, `top-left`, `top-right`, `bottom-left`, `bottom-right`. |
| `margin` | number | no | Kept clear on every edge, as a fraction (0 to 0.45) of the box's shorter side. Default 0. |
| `fallbackText` | string | no | The id of a `text` parameter of this template whose value stands in when no image is chosen: the company name set in type where the logo would be. |

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
| `frame` | integer | Zero-based frame index. |
| `time` | number | Seconds from the start: `frame / fps`. |
| `progress` | number | `time / duration`, clamped to 0..1. |
| `fps`, `duration`, `totalFrames` | number | From the manifest. |
| `width`, `height` | integer | The canvas for this render in pixels: the chosen aspect and resolution, not anything from the manifest. Size the canvas from these on every call, since the same template is drawn tall, square and wide. |
| `params` | object | Resolved parameter values keyed by parameter id. An image parameter's value is `null` or `{ id, treatment, tint, effect }`. |
| `images` | object | One entry per image slot (see Image slots): `{ id, box, fit, align, margin, treatment, tint, effect, fallback, bitmap? }`, the box in pixels of this frame. Draw them with `window.pulpDrawImage`. |

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

Templates do not need to call or include the bridge. Its source is `BRIDGE_SCRIPT` in `src/core/runtime.ts`. The bridge also decodes the images handed over for a template's image slots (`window.__pulp.prepare`) and exposes `window.pulpDrawImage` and `window.pulpFitBox`.

Every response carries this Content Security Policy:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:;
connect-src 'none'; frame-src 'none'; form-action 'none'
```

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

Tracked in ROADMAP.md: `image` and `media` parameter types (user-supplied logos or clips), audio tracks, localized labels, and an optional seeded random number generator provided by the bridge.
