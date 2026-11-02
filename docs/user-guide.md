# Using Pulp

What the window holds, how to make something with it, and the keys and search terms worth knowing. Open it from **Help → User Guide**, or from **Learn** on the start screen.

Pulp makes motion graphics from templates and hands the files to whatever you finish in. Everything runs on your machine: no account, no upload, no network.

## The window

Seven regions, from the left:

- **Browse panel.** Two sections. **Search** at the top — the field, the scope chip under it, the filter chips (Templates, Video, Images, Audio, Vertical, Alpha, Favorites) and the For… and Look narrowing selects. **Browse** below it — the tree of what things are: Lower thirds, Titles and openers, End cards, Matching sets, backgrounds, Overlays and frames, Transitions and wipes, Design elements, Effects, Objects, Stock video, Photos and stills, Music, Sound effects, then Quick access and My folders. Choosing a node **scopes** everything to it; the chip says so, and its × widens back out. The funnel in the Browse heading filters the tree itself as you type.
- **Stage.** The picture, and only the picture: a live preview of the template with your settings, at the shape and size the Output tab is set to. Click a line or a logo to select it, drag it to move it, pull a corner to scale it, nudge it with the arrows. Right-click for the layer edits, adding text or an asset, and the stage's own background.
- **Results.** A grid of cards or a list of rows, with the count, the chosen category's description, and the sort, view and size controls in its heading. Only what is in view is built, so a library of thousands scrolls smoothly. A card is the drag source once it has been rendered.
- **Inspector**, a drawer that rises over the results from three buttons in the transport row: **Parameters** (the template's own settings, organised by part of the graphic, with undo and saved presets), **Output** (preset, aspect and resolution, frame rate, trim, matte, captions, where the file goes) and **Info** (what the item is, its tags, themes and licence). The pin keeps it open while you choose other items.
- **Collection tray**, along the bottom, in the window only while it holds something: items gathered while browsing, each with its own output settings, reordered, saved as a file, rendered together. A finished render is a card you drag straight into your editor.
- **Transport row**, under everything: play, frame step, loop, the in and out marks, the timecode, volume and the loudness meter, the scrub bar at the window's width, and under it a bar per layer and the cut track. The status items — the project, FFmpeg, the library's counts, the render cache — sit at the end of its button line.
- **Start screen**, over the window at launch and from File → Home: get going, recent projects, examples, Learn, and the setup checklist.

Every region resizes by the splitter on its edge, collapses from the caret in its heading, and remembers both between sessions. **Theater** (`T`) hides the results and gives the stage the window; **Pop out the stage** puts the picture on a second display.

## Making something

1. **Give Pulp a library.** File → Add → Your Media Folder… indexes a folder where it lies, nothing is copied or moved. Add → Sample Media writes a folder of original CC0 clips, stills, sounds and music if you want something to practise on. The 358 bundled templates are there from the start.
2. **Find a template.** Type in the search field, or choose a category in the tree. The cards scrub as you hover them.
3. **Set it up.** Open **Parameters** and fill in the words, the colours and the logo. Add your own lines with Add layer, and drag them where you want them on the stage.
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

- **Your media stays where it is.** Pulp indexes folders in place and never moves or copies what is in them, except the pictures and fonts you import, which are copied into a managed folder so a project cannot lose them.
- **Settings, the library index, the render cache and the log** live in Pulp's own folder beside your other applications' data. **Settings…** (Cmd/Ctrl+,) holds what you can change; **Copy diagnostics**, in the status items, puts the facts and the log's last lines on the clipboard for a bug report, with your home folder written as `~`.
- **FFmpeg is a program of its own**, which Pulp runs to encode what it renders and does not ship. It finds the one you installed, on your path or at `PULP_FFMPEG_PATH`. If you have none, **Settings → FFmpeg** offers to fetch one: it says which build, from which publisher, how big it is and under what licence before anything is fetched, checks what arrives against a published checksum, and keeps it in Pulp's own folder — where it is looked for last, so an FFmpeg of your own always wins (decision record 0022).
- **Nothing is sent anywhere.** The only requests Pulp ever makes are the two you ask for by name: the speech model for captions (decision record 0021), and a build of FFmpeg where you have none.

## More

- Writing your own templates: [template-authoring.md](template-authoring.md), with the format in [template-format.md](template-format.md).
- What Pulp is built on: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- What is planned: [ROADMAP.md](../ROADMAP.md).
