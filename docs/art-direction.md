# Art direction: the Polished look (milestone 61)

Pulp bundles two looks for its own art, and a piece belongs to one of them.
The **Playful** look is the flat, bright, cartoon-like drawing the bundled
objects, icon sets and the cut-paper design elements were made in: flat fills,
bold outlines, primary colors, bouncing entrances. It is right for a birthday
clip, a kids' channel, a street-party recap — and it stays exactly as it is,
found and filtered by its own name. The **Polished** look, defined here, is
the second set, drawn for the work the playful one is wrong for: a corporate
piece, a news package, a product launch. Nothing is removed or redrawn;
polished pieces are new drawings, not recolors of the old ones.

"Polished" is a set of rules, not a mood. A piece either follows all of them
or it is not in the set.

## One light

Every polished piece is lit from **one direction**, and everything on the
piece agrees about it: the bright face, the falling shadow, the specular
catch and the darker underside all answer to the same light. The default is
**upper left, about 35° off vertical** — the direction every reference render
uses — and a piece offers its light direction as a parameter (`Light from`:
left, top, right), because a graphic composed over footage should take the
footage's light. Changing the light moves the highlights and the shadows
together; it never changes the colors.

The light is **soft**. A large source, not a point: highlights are gradients
that roll off, never hard-edged white shapes; shadow edges blur with distance
from the contact.

## Shadows

Two shadows, and both are offered as one `Shadow` parameter (soft / contact
only / none, defaulting to soft):

- A **contact shadow**: a tight dark ellipse where the object meets the
  ground, strongest directly under the contact, gone within half the object's
  width. This is what makes a piece sit *on* something instead of floating.
- A **soft drop shadow**: cast away from the light, wide and weak
  (blur ≥ offset, alpha ≤ 0.3). It separates the piece from the footage
  behind it without drawing an outline around it.

Shadows are **neutral and transparent** — black at low alpha, never a painted
gray shape — so they darken whatever video is behind them instead of covering
it. A piece drawn for transparency must look right over a bright clip, a dark
one and the checkerboard alike.

## Depth

Where the playful set is flat fills, the polished set is **layered**: a piece
reads as a few surfaces at different distances, each told apart by light
rather than by outline. The tools, in order of restraint:

- **Gradients along the light**: every surface larger than a detail carries a
  gradient from its lit side to its shaded side, two or three stops, close in
  hue. Flat fill is for small details only.
- **An occlusion shade** where one surface sits over another: a soft dark
  band at the join, as the contact shadow is to the ground.
- **A specular catch**: at most one or two small bright touches per piece,
  placed by the light, strongest on glass and polished metal, almost absent
  on matte plastic and paper.

## Materials

A polished piece is made of named materials, and `Material` is a parameter
where the object's body plausibly comes in more than one finish. The bundled
vocabulary:

| Material | How it is drawn |
| --- | --- |
| **Frosted glass** | Translucent white over the accent (alpha 0.35-0.55), a soft vertical gradient, a bright 1-unit light-catching edge on the lit side, no visible texture |
| **Clear glass** | Like frosted at lower alpha (0.15-0.3), plus one strong specular streak |
| **Brushed metal** | A neutral gray gradient banded with fine parallel strokes at 2-4% alpha, a broad soft highlight, low saturation |
| **Polished metal** | A high-contrast gradient — bright band, dark band, bright band — across the form, a sharp specular dot, reflections implied by value, never by drawn scenery |
| **Matte plastic** | A gentle two-stop gradient of the piece's own color, wide soft highlight, no specular dot |
| **Paper** | Flat, very slightly warm white with a soft edge shadow where it lifts; the one material that may be nearly flat |

## Palette

Polished art **follows the project's palette instead of bringing its own**.
Each piece exposes one `Accent` color parameter (sometimes a second where the
object honestly has two) and derives everything else from it: shades and
tints of the accent for the lit and shaded faces, neutral grays for metal,
neutral transparent black for shadows. Defaults are restrained — a desaturated
slate blue (`#3b5f7f` territory), never a primary. Saturation stays under
roughly 60%; a polished piece should never be the loudest thing in the frame.

## Line

**Thin or no outlines.** Form is separated by value and shadow, not by
stroke. Where a line is needed (a seam, a stand, a fine-line accent) it is
a single thin stroke — 1 to 1.5 units in the 100-unit box — in a shade of the
surface it sits on, never black.

## Motion

Entrances are **light and settled**: a soft pop that eases to rest with at
most a few percent of overshoot, a rise or drop that decelerates, a fade, a
draw-on. No bounce, no rubbery squash. The same five entrance choices as the
playful objects (pop, drop, rise, draw, fade) so the two sets drive the same
way — the difference is the easing, not the menu.

## Over video

Every polished piece draws on transparency and is judged over footage: the
shadows transparent-neutral (above), the gradients smooth at 8-bit over a
moving background, the light-catching edges thin enough not to shimmer. The
piece's silhouette must read at 10% of frame height, since objects are
dropped on frames as layers and scaled down.

## Geometry

The same conventions as every bundled object: a vector drawing in a
**100-unit box** scaled to the frame, sharp at any size; centered; drawn with
`pulpRender` from the state alone. Five seconds with a hold (enter ≈ 0.8 s,
leave ≈ 0.6 s), all four aspects, CC0.

## What carries the look

A polished piece's manifest carries the **`polished`** style (and only one of
`playful`/`polished`, never both); `Light from`, `Material` and `Shadow` as
parameters; an `Accent` color; the five-entrance select; and **`posterAt: 2.5`**,
the set's one poster moment. The browse panel's Look filter lists Polished
beside the other looks.

## Glass and depth pieces

Panels, cards, chips and tags float **over** the picture rather than stand on
a ground, so they cast a floating shadow — the shape's own outline, blurred
and offset away from the light — in place of the contact ellipse. It is drawn
from a copy of the shape moved off the frame, with only the shadow brought
back, so a translucent panel never shows an opaque copy of itself through its
glass. Flat glass carries a **tint of the accent** washed into it, strongest
away from the light: frosted white over transparency is otherwise nearly
colorless, and a panel must carry the project's palette and not only its
accent bar. A chip or a tag sizes itself to its one word.

## In the results

The polished set's cards are drawn on one **neutral studio backdrop** — a soft
key from above falling off to the floor, in both appearances — instead of the
category's tint, and every polished poster takes the same centered crop
(half the frame's short side tall, at 16:9; `studioCrop` in
`src/core/polished.ts`) instead of being cropped to what it draws, so every
piece reads at the size it shares with the others. Within Objects and Design
elements, under the default order and with nothing typed, the polished pieces
**lead**; any other order, a search, and the rest of the library are left as
they are.

## References

The polished set (`templates/polished-*`, and Boardroom's glass panel) is
the reference: made to this document, approved into
`tests/visual/references.json` and held there like every bundled template, so
later polished work is measured against it. Twenty-four objects — business and
data (the column chart, the pie chart, the laptop, the smartphone, the report
document, the ID badge, the desk calendar, the idea bulb), media (the studio
microphone, the mirrorless camera, the studio headphones, the studio speaker),
places and travel (the map pin, the globe, the airliner, the travel case),
sports (the trophy cup, the match ball, the timing stopwatch, the winner's
medal) and the seasons (the crystal snowflake, the spring tulip, the summer
sun, the autumn leaf) — and seven glass and depth design elements (the
frosted glass panel, the glass card, chip and tag, the gradient orbs, the soft
forms and the fine-line accents). `tests/sample-coverage.test.ts` holds every
polished piece to the manifest rules above, and `tests/polished.test.ts` its
framing and its lead.
