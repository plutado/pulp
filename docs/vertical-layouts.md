# Layouts made for vertical video

Where each kind of element sits in a 9:16 frame, and why (milestone 65). Most bundled templates were designed wide and drawn tall afterwards: a lower third in the bottom-left corner, a title across the middle. A tall frame on a phone is not a wide frame turned on its side. The short-video apps lay their own furniture over it, and viewers read it in the first second or not at all. The templates made for vertical are designed tall first, to the measures below, and carry the **`made-for-vertical`** tag.

As with milestone 19's safe zones, nothing here is named after or drawn from any one app, and no app's logo or interface is copied. The measures are generic and describe what every app has in common.

## The measures

All are fractions of the frame, given in pixels at 1080 × 1920, the size the apps publish their guides for.

**The vertical zones** (milestone 19, `VERTICAL_ZONES` in `src/core/player.ts`) are what the stage draws when Safe areas are on at a tall shape:

| Zone | Where | At 1080 × 1920 | What sits there |
|---|---|---|---|
| Header strip | across the top, 12% | y 0–230 | the account name, a follow button, the app's tabs |
| Controls column | down the right, 18% wide, from 42% to 86% down | x 886–1080, y 806–1651 | the reactions, comments, share and sound buttons |
| Caption band | across the bottom, 22%, stopping short of the column | x 0–886, y 1498–1920 | the app's own caption, the sound's name, the progress bar |

**The safe box** is about 900 × 1400, centered (x 90–990, y 260–1660; `VERTICAL_SAFE_BOX` in `src/core/vertical-layout.ts`). The published guides bear the zones out. They put the blocked areas at roughly 5–12% across the top, 8–14% down the right and 13–25% across the bottom, and they agree on a centered box of about this size that no app covers.

**The box is not clear on its own.** It is a rectangle and the furniture is not. The controls column reaches about 100 px into the box's right side from mid-frame down, and the caption band reaches about 160 px into its bottom. A word inside the box can still sit under a button. So the words of a template made for vertical keep to **both**: inside the box, and out of every zone. What is left is the clear area:

- full width of the box (x 90–990) from y 260 down to the top of the column at y 806;
- then x 90–886 down to the top of the caption band at y 1498.

Pictures, bars and shades may run to the edges. A full-bleed bar across the top is a design, not a word, so only the words are held to the clear area.

## Where each kind of element goes

| Element | Where | Why |
|---|---|---|
| **Hook title** | The top third, under the header strip: y 260–800, centered, at most 864 px wide. | The eye lands on the top of a tall frame first, and this part of the frame is clear at full width, above where the column starts. A hook is read in the first second, so it is the first thing there. |
| **Captions** | Mid-frame (about 56% down), or just above the caption band (bottom near y 1475). Kept between 18% and 82% of the width. | The bottom of the frame is the app's. A caption set where a wide video puts it lands under the app's own. Mid-frame sits beside the face, where the viewer is already looking. Above the band is the closest to the traditional place that stays clear. The 18–82% column keeps clear of the controls column and stays centered. |
| **A caption beside a face** | The side away from the face, at the face's height, between y 290 and 1420. | It follows the speaker without covering them. On the right it stops at 80%, short of the column. |
| **Lower third** | Not at the bottom. A name strap on a tall frame goes above the caption band, on the left, as the bundled Lower Third Bar re-lays itself at 9:16. | The bottom-left corner of a wide frame is the caption band of a tall one. |
| **Small overlays** (a part tag, a list counter, a reply-to card, a place tag) | The top-left of the clear area (y 280 onward, x from 108), or mid-left. Never the right half below mid-frame. | The column owns the lower right, and the top left is read first. |
| **Conversation and polls** (chat bubbles, a poll card) | The middle of the frame, 10–80% of the width: bubbles alternate sides inside that. | They are read like the frame's main content, so they sit where the eye rests; the right-hand bubbles stop short of the column. |
| **An end prompt** (follow for more) | Low in the middle, its bottom at 75%, centered on the clear width (10–82%), never wider than it. | Just above where the app prints its own caption, the last thing the eye passes on the way down, as the video ends. |
| **A progress bar** | The very top edge, full width, a few pixels tall. | It has no words to read and nothing to tap, so it may sit in the header strip; along the top is where a viewer expects one. |
| **The picture itself** (frame layouts) | A wide clip in a full-width 16:9 band from 27% to 59%, the same clip blurred behind it; two clips each covering half; a face in the top left over a full-frame clip. | A tall frame shows a wide clip as a strip with bars, which the apps then crop or letterbox badly. Blurring the clip into the bars fills the frame with its own colors; covering crops rather than shrinks. |

## Type at arm's length

A phone is held about 40 cm from the eye, and a 1080-pixel frame is about 6.5 cm across on it. Every size is a fraction of the frame's short side, the unit a text layer's `size` is in (`ARM_LENGTH_TYPE`):

- **A headline is 7% or more** (76 px at 1080, about 4.5 mm on the phone). This is what a hook is read at in its first second.
- **Nothing a viewer must read is under 4%** (43 px): a kicker, an attribution, a caption at its smallest setting.

A long headline shrinks rather than overflowing (the bridge's `wrap` and `shrink`), so the default copy is what is held to these sizes. A person typing a paragraph into a hook gets a smaller hook, inside the box.

## How it is checked

`pulp safe-box` (`npm run build && npx electron . safe-box`) draws every bundled template made for vertical at 1080 × 1920. A title that holds is drawn at the start, middle and end of its hold, where a viewer reads it, not mid-entrance. A caption style is drawn with a long line and the first, a middle and the last word being spoken, each a twentieth of a second in, while a word that pops is at its largest. Each moment is drawn **twice**, the second time with every letter of every word moved one along the alphabet. The words are wherever the two pictures differ, which sees exactly what is drawn (an outline, a pop, a chip sized to its word) on a canvas that has no DOM to ask. The extent must be inside the safe box and out of every zone, to within 2 px for antialiasing. The command prints a line for each moment out of place and exits 1 on any.

The end-to-end suite runs it on every platform (`tests/e2e/vertical.e2e.test.ts`); it measures positions rather than comparing pictures, so another platform's fonts do not fail it. The rules a manifest can show — tagged, drawn at 9:16, block boxes inside the safe box, type sizes at arm's length — are unit tests (`tests/vertical-layout.test.ts`). It caught one flaw the first time it ran: Caption One Word fitted a long word to the room and then popped it 18% larger as it was spoken, into the controls column for a tenth of a second.

## The templates made for vertical

**Hook titles** (`category: title`, a hold from 1.2 s to 4.4 s, every line in by 1.04 s even with lines added):
Hook Bold (two heavy lines over a shade), Hook Question (a card sized to the question, with a badge), Hook Keyword (a marker sweeps behind the word named in Keyword), Hook Bar (a meme-style bar across the top), Hook List (a big number in a ring that draws itself), Hook Quote (an oversized quotation mark, the quote, who said it).

**Caption styles** (`captions: true`, docs/template-format.md "Caption styles"):
Caption One Word (the spoken word alone, mid-frame), Caption Duo (two short rows on a card just above the band, paging as it is said), Caption Sticker (a tilted sticker, three rows at a time), Caption Beside (a column beside the speaker, on the side and at the height its parameters give).

**Frame layouts** (`category: overlay`, `type: frame`, opaque, `alpha: false`): they arrange the picture itself. Each has media slots set to `cover`, so a clip fills its box with no black bars, and a flat color stands in while none is chosen. Their words do not move, so they loop for any length and only the clip plays.
Frame Wide Clip (a wide clip sharp in a 16:9 band across the middle, the same clip blurred behind it, a title above and a line under it, then room for the project's captions), Frame Stacked (two clips, top and bottom, each with a label), Frame Corner Face (a face in the top left over a full-frame clip), Frame Caption Card (a full-frame clip with a card sized to its words).

The corner face is a **video layer**, not a media slot. A video layer is milestone 57's second picture track: the face shows on the picture track, takes the stage's handles, and has its own crop, border, span and sound.

**Overlays for short video** (`category: overlay`, transparent). Each is generic, drawn after no one app's interface:
Progress Bar Top, Part Tag ("Part 2 of 3"), List Counter ("2 / 5" with a row of dots), Chat Bubbles (a block of lines that arrive one by one, alternating sides; a line added is the next bubble), Comment Reply (the comment a video answers, with who asked), Poll Card (a question, two answers and their shares filling in), Follow Prompt (an end-of-video "follow for part 3" with a plus that turns to a tick) and Place Tag (a pin and a place, or a bag and a product).

All but the progress bar come in, **hold** and go, each hold measured with a line added to every open block. The progress bar is the one loop that does not meet its first frame: it draws against `state.frame` over `state.totalFrames`, the length it is asked for, so a 45-second video's bar takes 45 seconds to fill. A bar that repeated every ten seconds would say nothing about how far through the video a viewer is. Its words-free picture is why `pulp safe-box` reports it checked with no moment to place.

A fresh set of captions still starts on the first by name of the styles drawn for every shape, so a wide project is never started on one placed for a tall frame alone.

## Found first when the work is tall

The templates made for vertical have a **Made for vertical** node under Quick access in the browse panel, and they lead the results when the work is tall (`workIsTall` and `verticalFirst` in `src/core/vertical-layout.ts`):

- **The work is tall** when the session leans to a tall shape (the start screen's 9:16 tile, or a tall platform such as TikTok), or a tall shape was **chosen** in the Output tab for a template that draws more than one. A template that draws only one shape, a media file, or nothing on the stage says nothing either way and the last answer stands. Clicking a hook that draws only 9:16 must not reorder the results under the click.
- **They lead under the default order with no words typed**, each group in its own order, as the polished set leads inside its categories. A chosen sort, or a ranking by typed words, is left alone.
- **The stage shows the safe areas** while a template made for vertical is on it, since the zones it is designed around are the point of it. Turned off by hand, they stay off for the rest of the session. The saved preference is not changed either way.
