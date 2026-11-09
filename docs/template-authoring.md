# Writing a template

You can also start without code: compose on the blank canvas (File → New Blank Canvas) and **File → Save as Template…** writes a folder in this very format — then edit it by hand from there.

A walkthrough from an empty folder to a lower third that works at every shape, stretches to any length, takes a logo, and lets the person using it add their own lines. The finished folder is [`examples/pulp-template/`](../examples/pulp-template/): copy it and change the `id` to start from there instead.

This guide is the path; [`docs/template-format.md`](template-format.md) is the specification, and the [JSON Schema](schema/template.schema.json) is the same shape for your editor. When the two disagree, the specification wins.

## What a template is

A folder with two files:

```
my-lower-third/
  template.json    the manifest: what the template is, what can be set, where its layers live
  index.html       the page: draws one frame when Pulp calls window.pulpRender(state)
```

Pulp opens the page offscreen, hands it a `state` for each frame and captures what it drew. The page draws one whole frame per call, from `state` alone: no clocks, no timers, no randomness. That is the one rule that makes everything else work, because Pulp asks for frames in any order, more than once, at any size.

## Step 1. The manifest

Create `template.json`:

```json
{
  "formatVersion": 1,
  "id": "yourname.lower-third",
  "name": "My Lower Third",
  "version": "1.0.0",
  "license": "CC0-1.0",
  "category": "lower-third",
  "duration": 6,
  "fps": 30,
  "aspects": ["16:9", "9:16", "1:1", "4:5"],
  "alpha": true
}
```

- `id` is yours: lowercase letters and digits, segments joined by `.` or `-`, prefixed with something you own so it never collides with another library's.
- `aspects` says which **shapes** the template draws for. A template is a shape, not a pixel size: the resolution is chosen when it is rendered, and your page learns it from `state.width` and `state.height`. Declare the four and lay out from the frame you are handed, and one template is its own vertical version.
- `alpha: true` means the page leaves the background transparent, so the graphic can sit over footage.

## Step 2. A page that draws

Create `index.html`:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  window.pulpRender = function (state) {
    if (canvas.width !== state.width || canvas.height !== state.height) {
      canvas.width = state.width;
      canvas.height = state.height;
    }
    var W = state.width, H = state.height;
    var u = Math.min(W, H) / 1080;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(W * 0.2, H * 0.72, W * 0.6, 90 * u);
  };
</script>
</body>
</html>
```

Three habits are already in it. The canvas is sized from `state` on every call, only when it changes, so the bitmap is not cleared for nothing. Everything is measured in `u`, a unit taken from the **short side**, so a bar that is 90 units tall is the same proportion of a tall frame as of a wide one. And the frame is cleared before it is drawn, because each call is the whole picture.

Put the folder in one of your library folders (File → Add → Your Media Folder…) and Pulp indexes it on the next scan. Select it: the stage shows the bar at the middle of the timeline, and the Output tab lets you turn it tall or square.

## Step 3. Motion from `state.time`

Animate from `state.time`, seconds on the template's own clock, and `state.duration`, the length you declared. Never from the frame number: `time` is what lets the template be stretched later without being rewritten.

```js
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

var inAt = easeOut(clamp01(state.time / 0.6));
var outAt = easeOut(clamp01((state.time - (state.duration - 0.6)) / 0.6));
var shown = inAt * (1 - outAt);
if (shown <= 0.001) return;
ctx.globalAlpha = shown;
ctx.translate((1 - inAt) * -W * 0.6 + outAt * -W * 0.6, 0);
```

The entrance is timed from the start and the exit from the end. That is deliberate, and the next step is why.

## Step 4. A hold that stretches

A person will want your six-second lower third to run for twenty. Tell Pulp which part may stretch:

```json
"duration": 6,
"structure": { "holdFrom": 1, "holdTo": 5 }
```

The entrance runs from 0 to 1 s, the hold from 1 to 5, the exit from 5 to 6, all on the template's own clock. Asked for twenty seconds, Pulp plays the entrance as designed, holds the frame at 1 s for fifteen seconds, then plays the exit as designed. **Your page needs no code for this**: it keeps drawing against `state.time`, and Pulp decides which moment of your timeline each rendered frame shows.

The promise a hold makes is that nothing moves between `holdFrom` and `holdTo`. Measure it rather than guessing: render the template small, difference each frame against the frame at `holdFrom`, and declare only the stretch where nothing differs. A glow that breathes or confetti that keeps falling disqualifies a graphic, and such a template declares no structure and keeps its fixed length. A background that goes round declares `{ "loop": true }` instead; a wipe that should play faster or slower declares `{ "scale": true }`.

## Step 5. Parameters

What a person may change is declared, and reaches the page resolved:

```json
"parameters": [
  { "id": "bar", "type": "color", "label": "Fill", "default": "#1d4ed8", "element": "Bar" },
  { "id": "accent", "type": "color", "label": "Accent", "default": "#facc15", "element": "Bar" },
  { "id": "inOut", "type": "number", "label": "Animate in and out, seconds", "default": 0.6, "min": 0.2, "max": 1, "step": 0.1, "element": "Layout and timing" }
]
```

In the page, `state.params.bar` is always a valid color and `state.params.inOut` always a number in range: Pulp resolves what the person typed against your declaration before the page sees it. `element` names the **part of the graphic** a setting belongs to, so the Parameters tab can show one card per part; a template that names a hold should not also offer a "Hold, seconds" parameter, since the length is the control for that now.

Types: `text`, `color`, `number`, `boolean`, `select`, `font` and `image`. The last is a slot, below.

## Step 6. Lines of type people can add to

The person's own text is a **layer**, and a template makes room for layers by declaring a **block**: a box per shape, the type the block's lines start from, and the template's own lines as defaults.

```json
"blocks": [
  {
    "id": "strap",
    "label": "Strap",
    "box": {
      "16:9": { "x": 0.2, "y": 0.72, "width": 0.6, "height": 0.16 },
      "default": { "x": 0.08, "y": 0.6, "width": 0.84, "height": 0.16 }
    },
    "gap": 0.01,
    "typography": { "family": "Inter", "size": 0.06, "weight": 700, "color": "#ffffff" },
    "layers": [
      { "id": "name", "type": "text", "label": "Name", "text": "Jane Doe", "required": true, "case": "upper" },
      { "id": "title", "type": "text", "label": "Title", "text": "Reporter", "size": 0.04, "weight": 400, "color": "#dbeafe" }
    ]
  }
]
```

The box is a fraction of the frame, one per aspect with a `default`; on a tall frame the strap moves up and widens. Sizes are fractions of the short side, as everything is. `Inter` is one of nineteen bundled families every template page has (`docs/font-credits.md`); your own drawing code that sets `ctx.font` to one must ask for it first, `document.fonts.load('700 48px Inter')`, or the first frames fall back.

The page draws the block with two helpers Pulp provides:

```js
var laid = window.pulpLayoutBlock(ctx, state, 'strap', {
  each: function (layer, position) {
    var start = 0.15 * position;                 // your stagger
    var a = easeOut(clamp01((state.time - start) / state.params.inOut));
    return { alpha: a, dx: (1 - a) * 40 * u };   // rides this position in the stack
  }
});
window.pulpDrawBlock(ctx, laid);
```

Pulp measures, wraps, shrinks and stacks the lines; `each` is called per layer with its **position in the stack**, and whatever it returns rides that position. That is what lets a line the person adds in the middle move as the middle line of your design does. The laid-out block is readable before it is drawn, `laid.box`, `laid.layers[0].box`, for a panel sized to its words. Per-layer entrances, exits, looks, keyframes and dragging on the stage all come free with the helpers; a block drawn by hand simply does not offer them.

## Step 7. A logo slot

An image slot is yours: the picture goes where the template says, inside its animation.

```json
{ "id": "logo", "type": "image", "label": "Logo", "box": { "x": 0.08, "y": 0.7, "width": 0.1, "height": 0.16 }, "fit": "contain", "margin": 0.1, "fallbackText": "name", "element": "Logo" }
```

```js
if (!window.pulpDrawImage(ctx, state, 'logo')) {
  var logo = state.images.logo;
  ctx.fillText(logo.fallback || '', logo.box.x, logo.box.y + logo.box.height / 2);
}
```

The person picks a library still in the Parameters tab, with treatments (tinted, white, black, a shadow or glow) Pulp applies before the page draws. With nothing chosen the helper returns false and the page draws the fallback, here the name in type where the logo would be. The page never sees a path: it is handed exactly the pictures chosen for its slots, by id, decoded before the first frame.

## Step 8. Check it

- **Every shape.** Turn the preview to each aspect in the Output tab. Nothing should read from `W / 1920` or `H / 1080` alone, and no canvas should carry a fixed `width` or `height` attribute.
- **Another length.** Drag the length handle on the scrub bar, or type a length. The entrance and the exit keep their speed; only the hold grows.
- **An added line.** Add a text layer in the Parameters tab and watch it ride the stagger. Declare the hold with a line added, since a staggered entrance finishes later for each one.
- **The rules.** No `Date.now`, `performance.now`, `requestAnimationFrame` timing, `setTimeout` or unseeded `Math.random` in the page; nothing loaded from the network, which Pulp blocks anyway.
- **The manifest.** The Info tab shows what the validator says; a warning names an unknown field. Point your editor at the schema for the same answers as you type.

## Step 9. Share it

Set `license` to an SPDX identifier that permits redistribution, `CC0-1.0` or `MIT` for most templates; include the license of any font or image you bundle. Several templates that share a look travel as a **pack**: a folder with a `pack.json` naming them (`docs/template-format.md`, "Template packs"), exported from File → Export as Pack… and imported by anyone with File → Add → Templates from a Pack….

## Beyond this

- A **caption style** is a template that draws the caption line Pulp hands it (`"captions": true`; "Caption styles" in the format).
- A **transition** declares `{ "scale": true }` and draws its wipe against `state.progress`.
- An **asset** on transparency, a flame or a burst, is a template that asks for nothing to be typed into it; Pulp draws it to frames and places it as a layer.
- The 358 bundled templates in [`templates/`](../templates/) are CC0 and read well as examples; the four matched sets show how a look is kept across a lower third, a title, an opener and a wipe.
