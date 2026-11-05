# Using Pulp

What the window holds, how to make something with it, and the keys and search terms worth knowing. Open it from **Help → User Guide**, or from **Learn** on the start screen.

Pulp makes motion graphics from templates and hands the files to whatever you finish in. Everything runs on your machine: no account, no upload, no network.

## The window

Seven regions, from the left:

- **Browse panel.** Two sections, under the library tools — Add, Rescan, the Record button with its microphone chooser, and the camera button. **Search** at the top — the field, the scope chip under it, the filter chips (Templates, Video, Images, Audio, Vertical, Alpha, Favorites) and the For… and Look narrowing selects. **Browse** below it — the tree of what things are: Lower thirds, Titles and openers, End cards, Matching sets, backgrounds, Overlays and frames, Transitions and wipes, Design elements, Effects, Objects, Stock video, Photos and stills, Music, Sound effects, then Quick access and My folders. Choosing a node **scopes** everything to it; the chip says so, and its × widens back out. The funnel in the Browse heading filters the tree itself as you type.
- **Stage.** The picture, and only the picture: a live preview of the template with your settings, at the shape and size the Output tab is set to. Click a line or a logo to select it, drag it to move it, pull a corner to scale it, nudge it with the arrows. Right-click for the layer edits, adding text, a shape or an asset, and the stage's own background. The first of the four buttons on the stage's corner shows what is behind a transparent graphic — the checkerboard, black, white, gray or a color of your own — and opens a picker to choose another.
- **A blank canvas** (File → New Blank Canvas, Cmd/Ctrl+Shift+N) is a template that draws nothing of its own: one open block covering the frame, for composing a graphic from scratch. Text, **shapes** (a rectangle, ellipse or triangle with its color, size and width-over-height), pictures and clips go on it as layers — placed and sized with the stage's handles, timed with each layer's own start, end, entrance and exit — and what you compose saves in a project like any other work. Any property of what you compose — a line's words, a color, a picture — becomes a **template parameter** by picking it (right-click it on the stage, or the pick button on its card) and giving it a name: it appears under **Template parameters** at the top of the Parameters tab, where its control edits the very property it names. Every layer on the canvas fades in and out to start with; **Animate** on the right-click menu (or **Motion** on the layer's card) gives it a ready-made motion — slide in, rise, pop, wipe on, drift, pulse, spin in — written as the ordinary entrance, exit and keyframes you can then edit, and **Record Keyframes** on the same menu turns keyframe recording on for the selected layer. A layout is kept per shape — turn the Output tab's aspect and lay the tall frame out its own way — and **Use this layout on every shape** (on the layer's Advanced section) hands the one on screen to the shapes not laid out yet. When it is ready, **File → Save as Template…** writes the composition as a template folder in the open format: the picked parameters become its real parameters, the folder joins the library at once, and the new template reopens for editing — or opens in a text editor, since it is the same format every template is written in. A chosen picture, clip or sound stays behind (a template never ships a library id); the layer is saved empty for the next person to fill.
- **Results.** A grid of cards or a list of rows, with the count, the chosen category's description, and the sort, view and size controls in its heading. A card shows how long the item runs in the thumbnail's corner (0:04), its resolution as a tag (HD, Full HD, 4K, or the height, like 1440p — the exact pixels in its tooltip), then icons for transparency, a loop, a tall or square shape, a pack and a sound of its own. Only what is in view is built, so a library of thousands scrolls smoothly. A card is the drag source once it has been rendered.
- **Inspector**, a drawer that rises over the results from three buttons in the transport row: **Parameters** (the template's own settings, organized by part of the graphic, with undo and saved presets), **Output** (preset, aspect and resolution, frame rate, trim, matte, captions, where the file goes) and **Info** (what the item is, its tags, themes and license). The pin keeps it open while you choose other items.
- **Collection tray**, along the bottom, in the window only while it holds something: items gathered while browsing, each with its own output settings, reordered, saved as a file, rendered together. A finished render is a card you drag straight into your editor.
- **Transport row**, under everything: play, frame step, loop, the in and out marks, the timecode, volume and the loudness meter, the scrub bar at the window's width, and under it a bar per layer, the **picture track** — clips over the shots, dropped there at a moment for picture-in-picture or b-roll, then moved, sized, cropped and bordered — and the cut track — the shots of the piece end to end, each with a right-click menu for its transition, its sound, its **speed** (a rate, a ramp between two, smooth slow motion) and a **freeze frame** at the playhead. The status items — the project, FFmpeg, the library's counts, the render cache — sit at the end of its button line.
- **Start screen**, over the window at launch and from File → Home: **New project** leads (with Open beside it, the four shapes as tiles and the platforms as one list), then Continue (your recent projects), Start from an idea (the making choices and the examples, one gallery of real pictures that scrub under the pointer) and Learn. A first launch leads with the set-up checklist and its progress; once set up the checklist moves to **Help → Set-up Checklist**. The screen comes up in the window's appearance.

Every region resizes by the splitter on its edge, collapses from the caret in its heading, and remembers both between sessions. **Theater** (`T`) hides the results and gives the stage the window; **Pop out the stage** puts the picture on a second display.

**Light or dark:** **Settings → Appearance** or **View → Appearance** — System (the default, which follows your computer's setting as it changes), Light or Dark. Every window changes at once, and Pulp opens in it the next time. The checkerboard behind a transparent graphic, on the stage and behind its card in the results, is lighter in Light; a background you choose for the stage — black, white, gray or your own color — and whatever a template draws look the same either way, so for judging a graphic against a set color, choose one.

## Making something

1. **Give Pulp a library.** File → Add → Your Media Folder… indexes a folder where it lies, nothing is copied or moved. Add → Sample Media writes a folder of original CC0 clips, stills, sounds and music if you want something to practice on. Over four hundred bundled templates are there from the start.
2. **Find a template.** Type in the search field, or choose a category in the tree. The cards scrub as you hover them.
3. **Set it up.** Open **Parameters** and fill in the words, the colors and the logo. Add your own lines with Add layer, and drag them where you want them on the stage.
4. **Choose the shape and the format.** In **Output**: a platform preset (TikTok, Reels, YouTube and the rest) sets the aspect, size, rate and encoder in one go, or set them yourself. ProRes 4444 and WebM VP9 keep transparency; H.264 MP4 is for posting.
5. **Render**, from the button or Cmd/Ctrl+R. It appears in the tray.
6. **Hand it over.** Drag the finished card into your editing app, or use Share… and Open upload page.

A session saves as a `.pulp` **project** (Cmd/Ctrl+S), with everything it uses: the template, the layers, the cut track, the sound and the captions.

## Keys worth knowing

The full list, as the menu really has it, is **Help → Keyboard Shortcuts** — these are the ones used most. Cmd on macOS, Ctrl elsewhere.

| Key | What it does |
|---|---|
| `Cmd/Ctrl+F` | Put the caret in the search field, from anywhere |
| `Cmd/Ctrl+N`, `O`, `S` | New project, open, save |
| `Cmd/Ctrl+1`, `2`, `3` | The Parameters, Output and Info drawer |
| `Cmd/Ctrl+Shift+1`…`4` | Show or hide the browse panel, the preview, the results, the tray |
| `Cmd/Ctrl+Return` | Play or pause |
| `Cmd/Ctrl+Shift+,` and `.` | Previous and next frame |
| `Cmd/Ctrl+Shift+I` / `O` | Set the in and out marks |
| `Cmd/Ctrl+R` | Render; `Cmd/Ctrl+Shift+R` renders the whole collection |
| `Cmd/Ctrl+B` | Split the cut under the playhead |
| `Cmd/Ctrl+Z`, `Shift+Z` | Undo and redo a parameter or layer edit |
| `T` | Theater: the stage takes the window |
| `Esc` | Close the drawer, the dialog, or stop what is playing |

**Without a pointer.** Every region is reachable by tabbing and operable by the arrows. A group of controls is one tab stop and the arrows move inside it: the filter chips and the inspector's tabs step with Left and Right, the browse tree with Up and Down (Right opens a node, Left folds it or steps out), the results with the arrows as a grid — one card across, one row down, Page Up and Page Down by a screen, Home and End to the ends — and the tray's cards with Up and Down, Enter to show a render in the file manager. The splitters resize with the arrows. A focused thing always shows a ring.

## Searching

Free text matches names, tags and themes; several words all have to match. Double quotes group words into a phrase. Terms of the form `key:value` narrow it:

| Term | Finds |
|---|---|
| `tag:news` | Items carrying this tag |
| `type:wipe` | A taxonomy type, a type group (`type:sfx`), or `template`, `media`, `video`, `image`, `audio` |
| `theme:wedding` | A theme; a group's name finds everything under it |
| `style:grunge` | Templates declaring this style |
| `mood:calm` | Sounds and music by how they feel: upbeat, calm, dramatic, epic, tense, playful, melancholy, mysterious — from a folder named for one, or the file's own genre, mood or comment tag |
| `category:title` | A template category |
| `pack:newsdesk` | Templates from a pack; `pack:any` for any of them |
| `duration:>5` | Seconds; `<`, `>`, `<=`, `>=`, `=` and ranges like `5-10` |
| `width:>=1920`, `height:1080`, `fps:29.97` | The same comparisons on the picture |
| `res:1080p` | The shorter side; `4k`, `uhd`, `8k`, `hd`, `fhd` work too |
| `codec:prores` | The video codec, as ffprobe names it |
| `alpha:yes` | Transparency; `alpha:no` for the rest |
| `orientation:portrait` | `portrait`, `landscape` or `square`; a template matches when any of its shapes does |
| `favorite:yes` | Favorites; `favorite:no` for the rest |
| `recent:yes` | What you have used, most recent first; `recent:10` for the last ten |

`type:lower-third theme:news duration:<8` is three of them at once. The same language works in every chooser — the picture and clip pickers, the stage's asset list — not only in the search field.

## Where your things are

- **A project file opens in Pulp when you double-click it**, from a file manager or the Dock; a Pulp that is already open takes it in its own window and asks about unsaved changes first.
- **Your media stays where it is.** Pulp indexes folders in place and never moves or copies what is in them, except the pictures and fonts you import, which are copied into a managed folder so a project cannot lose them.
- **Record a voice with one click.** The microphone button in the library tools (or **File → Record Audio**, Cmd/Ctrl+Shift+A) starts recording at once from the system's microphone; a strip shows the level and the time; the button again, its Stop, or Escape ends the take. It lands as a WAV in Pulp's own **Recordings** folder, named by date and time, joins the library selected and ready, and works everywhere a sound does — on the cut track, on a template, in a render, dragged into an editor. The small menu beside the button chooses which microphone and remembers it; a take whose microphone dies mid-way keeps what it has. The first recording asks the system's microphone permission; if it was refused, the strip says so and offers the way to the settings.
- **Record from a camera with one click.** The camera button beside the microphone (or **File → Record Video**) opens a live preview from the system's camera, with its sound; **Record** starts the take, the elapsed time shows over the picture, and Record again — now reading Stop — Escape, or Close ends it. The take lands in **Recordings** beside the voices, named by date and time, as an MP4 (H.264 and AAC) at the camera's own size and a steady frame rate, which every editor opens; it joins the library selected, with a poster and hover scrub like any clip. The preview's **Camera** and **Sound** menus choose which camera and microphone, or **No sound**, and remember the choice. A camera facing you is shown mirrored, as a mirror shows a face; the file is never mirrored. The first time, the system asks for the camera, then the microphone when sound is on; if either was refused, the preview says so and offers the way to the settings. Converting needs FFmpeg (Settings → FFmpeg can fetch it); without it the take is kept as the WebM the window recorded, which Pulp plays but an editor may not open.
- **Made for vertical.** Twenty-two templates are designed for a tall frame first, rather than drawn wide and fitted to one: find them under **Quick access → Made for vertical**, or search for the tag. When the work is tall — a new 9:16 project from the start screen, a platform such as TikTok, or 9:16 chosen in the Output tab — they come first in the results, and the stage shows the zones the short-video apps lay over a tall frame while one is chosen (the **Safe areas** button turns them off for the session). Six **hook titles** (Hook Bold, Question, Keyword, Bar, List and Quote) are headlines for the first second, set large in the top third. Four **caption styles** (Caption One Word, Duo, Sticker and Beside) sit mid-frame or just above where the apps print their own caption, with the spoken word picked out; Caption Beside asks which side the face is on and how high. Four **frame layouts** arrange the picture: a wide clip with its own blur filling the frame behind it, two clips stacked, a face in the corner over a full-frame clip (the face is a clip layer, so move and size it on the stage), and a clip with a caption card. Eight **overlays** — a progress bar, a part tag, a list counter, chat bubbles, a comment reply, a poll, a follow prompt and a place tag — keep clear of the apps' buttons. Where each kind of element belongs, and why, is in `docs/vertical-layouts.md`.
- **Settings, the library index, the render cache and the log** live in Pulp's own folder beside your other applications' data. **Settings…** (Cmd/Ctrl+,) holds what you can change; **Copy diagnostics**, in the status items, puts the facts, a performance section (how big the library is, how long it took to scan and to search, what Pulp's processes weigh) and the log's last lines on the clipboard for a bug report, with your home folder written as `~`.
- **FFmpeg is a program of its own**, which Pulp runs to encode what it renders and does not ship. It finds the one you installed, on your path or at `PULP_FFMPEG_PATH`. If you have none, **Settings → FFmpeg** offers to fetch one: it says which build, from which publisher, how big it is and under what license before anything is fetched, checks what arrives against a published checksum, and keeps it in Pulp's own folder — where it is looked for last, so an FFmpeg of your own always wins (decision record 0022).
- **A render that was cut short is never mistaken for one that finished.** While it renders, a file is `name.partial.mp4`; it takes its real name only when it is whole. If Pulp closes mid-render, the next launch removes the partial file and offers to render it again to the same place.
- **A Pulp panel can sit inside Premiere Pro or DaVinci Resolve Studio**, listing this library and collection without leaving the edit — and dropping into it: a row renders on request with the item's own output settings (alpha kept) and goes into the bin, onto the timeline, or along for a drag; **Open** brings it up in Pulp to change it, and Pulp's render queue shows in the panel as it runs. It is served only while **Settings → Serve the editor panel (local)** is on — off by default — on this machine alone (127.0.0.1), with a token from a file beside your settings asked of every request. Installing the panels: [editor-panels.md](editor-panels.md).
- **Nothing is sent anywhere.** The only requests Pulp ever makes are the ones you ask for by name: the speech model for captions (decision record 0021), the semantic search model (decision record 0024), and a build of FFmpeg where you have none.

## More

- Writing your own templates: [template-authoring.md](template-authoring.md), with the format in [template-format.md](template-format.md).
- What Pulp is built on: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- What is planned: [ROADMAP.md](../ROADMAP.md).
