# Translating Pulp

How the interface's words are kept, how a language is added, and how a catalog is checked (milestones 59 and 68).

Every word the window and the menus show is read from a **message catalog** keyed by id. US English is the source: 2,344 messages in `src/locales/en-US/`. Every other language is a catalog of its own, and a person chooses one in **Settings → Language**. "Same as the system" is the default, and English (US) and English (UK) are listed first. A change redraws every window and the menus at once, with no restart.

Beyond English (milestone 68) there are **German** (`src/locales/de.ts`, offered as Deutsch) and **Simplified Chinese** (`src/locales/zh-CN.ts`, offered as 中文（简体）), each a complete catalog with its own user guide. They were picked to stretch the interface in opposite directions: Chinese is short and needs its own fonts and line breaking; German has long compound words that find any label too narrow for them. Both are **previews** until a fluent speaker has read them in the window (see "Previews" below).

The first language after the source is British English (`src/locales/en-GB.ts`). It is a *variant* of the source: 106 messages in British spelling (colour, grey, centre, favourite, theatre, licence, customise, cancelled), falling back to US English for the rest.

## What is translated, and what is not

**Translated: the interface.** Anything the window or the menus present to the person using Pulp:

- labels, buttons, tooltips, accessible names, headings, notes, empty states and prompts;
- tray and status lines, and dialog titles and buttons, including the native file dialogs;
- the names of things the interface offers: the taxonomy, categories, presets, platforms, motion presets and frame rates;
- the in-app user guide;
- errors written for a person, such as "That file could not be read." or "Pulp may not use the camera."

**Not translated: four kinds of words**, each kept in the code for a stated reason. A test holds the code to this (see "How the code is checked").

| Reason | What it covers | Why it stays |
|---|---|---|
| `terminal` | The command line's help, usage errors and reports (`pulp render`, `pulp safe-box`); the release script. | Read in a shell and parsed by scripts. The command line always runs in US English. |
| `diagnostic` | Detail for a template's author or a bug report: manifest, layer, look, timing, XML, zip and PNG validation; "ffmpeg exited with …"; Copy Diagnostics; the log. | Read by the people who fix things, and searched for on the web. Where the window shows one, it sits inside a translated sentence ("parameter {id}: {detail}"). |
| `content` | Library content in the code: a template manifest as it is read, and a Lottie file's own names (layers, markers, the file's name); the sample-media catalog's names and notes; words drawn into a picture; font provenance; the first words of a new text layer; a language's own name ("English (UK)"). | The template's or the file's, not the window's. A template from anywhere else is translated, if at all, by its author. The **bundled** library is Pulp's and is translated (see "The library" below). |
| `technical` | SQL, CSS classes and selectors, MIME types, FFmpeg filter graphs, FCPXML, HTML, SVG or JavaScript in strings; ids and stored values; file and folder names on disk (`Recordings`, `Sample media`). | Not words. A name on disk must stay the same whatever language wrote it. |

Also never translated: the search field's filter keywords (`favorite:`, `type:`, `duration:`), keyboard shortcuts, timecode, frame rates and file format names. These are typed or read as editors expect them, and the same in every language.

## The library

The bundled templates' words are translated too: every name, description, parameter label and help text, card heading, dropdown option and matching set under `templates/`. So is everything Pulp writes about a Lottie file. 

- **The bundled templates** are translated in a library catalog per language (`src/locales/library/de.ts`, `zh-CN.ts`), keyed by the US English the manifest says. A string many templates share ("Accent color") is translated once. A word that reads the same in both languages ("Logo") is in the catalog too, so a missing one can be told apart. `tests/library-words.test.ts` fails on a bundled word with no entry and on an entry no template uses any more, so a new or changed template asks for its words.
- **A Lottie file** keeps its own names: its layers, its markers, and the name made from its file. What Pulp says around them is in the interface catalog as `lottie.*` messages: the description ("A Lottie animation: 512 × 512, 60 frames at 30 fps."), what the player cannot draw, the labels Pulp gives ("Text", "{name} fill", "Layer 3"), and the Fit setting. The scan keeps these as messages and their values (`LottieNote`), so they are said again in whatever language the window is in. A bundled Lottie's file name is translated through the library catalog.
- **Only in the window.** The manifests on disk, the library store, renders, exports and file names keep the US English. A project saved in one language opens in another: ids and option values are never translated.
- **Search** reads an item's words in the window's language and its US English, which ranks as its name too, so a typed English word still finds things in German or Chinese.
- **A template from anywhere else** (a pack, a folder) stays as its author wrote it.

## Numbers, sizes and dates

Numbers, file sizes, durations in seconds and dates are written the way the interface's language writes them (`src/core/locale-format.ts`, with `Intl`). German writes "1.234", "1,5 MB", "1,5 s" and "1. November 2026". Chinese writes "2026年11月1日". US English writes "November 1, 2026", and British English "1 November 2026".

- **In a message**, a `{count}` is written as the locale writes numbers. Every other value is filled as it is given, so a size, a duration or a date passes through `formatNumber`, `sizeLabel`, `durationLabel`, `formatDate` or `formatDateTime` first. A catalog never spells out a month or a date's order: the locale's own format does.
- **Never localized:** timecode, frame rates ("29.97 fps"), resolutions ("1920 × 1080"), aspect ratios, codecs and file formats. Editors read these the same everywhere.
- **Words the main process writes for the window** (the render cache's summary) are made in the window from their numbers instead, so they follow a change of language too.
- **A name Pulp stored for a template** (a collection item's, a render job's) is the template's English name. Every window shows it in its own language (`shownTemplateName`), and a name a person typed is shown as they typed it.

Not yet covered: the editor panels inside Premiere Pro and DaVinci Resolve (`panels/`), which have their own interface and follow their host.

## Where the words are

- **The catalog.** `src/locales/en-US/` has one file per part of the interface. `markup.ts` is the window's markup, `menu.ts` the application menu, and `inspector.ts`, `library.ts`, `stage.ts`, `app.ts` and `main-process.ts` hold the words built in code for those areas. `index.ts` puts them together. An id is defined once, in one part.
- **The window's markup** (`src/renderer/index.html`) carries no words of its own. An element names its message:
  - `data-i18n="id"` for its text;
  - `data-i18n-attr="aria-label:id;data-tip:id"` for its attributes;
  - `data-i18n-rich="id"` for text with `<strong>`, `<em>` or `<code>` inside;
  - `data-i18n-at="start"` or `"end"` to put a label's words before or after the control it holds.

  `src/renderer/i18n.ts` puts them in place in the main window and the popped-out stage, and again on every change of language.
- **Words built in code** read `t('id', { values })` in the window (`src/renderer/i18n.ts`), and `tr('id', { values })` in core and in the main process (`src/core/i18n.ts`). Both read the language the interface is in now.
- **Tables of names** (the taxonomy, categories, presets, platforms, stage backgrounds) read their `label` through a getter, `get label() { return tr('…'); }`, so a label is always the current language's. What a module works out from a label once at load stays US English. That is on purpose for search: a typed English word still finds things in any language.
- **The user guide** is a document, not catalog messages: `docs/user-guide.md`. A language that is translated in full brings `docs/user-guide.<locale>.md` and registers it in `GUIDES` in `src/renderer/user-guide.ts`. British English is the source guide in British spelling, made by the same rules as the British catalog. There is one guide to keep, and only the words that differ.

## What a message id means

An id names **where** a string sits, not what it says, so it stays put when the words change.

| Id | Where |
|---|---|
| `ui.<element id>` | The text of the markup element with that id: `ui.settings-title`. |
| `ui.<container>.<slug>` | Text of an element with no id of its own, inside the nearest container that has one: `ui.settings-dialog.play-a-sound-when-it`. The slug was the first words when it was written; it is a name now, not a quotation. |
| `….<attribute>` | That element's tooltip or accessible name: `ui.rescan.aria-label`, `ui.library-add.data-tip`. |
| `menu.<command>` | The application menu item for a command: `menu.project.new`. `.alt` is what it reads while toggled (`menu.record.audio.alt` is "Stop Recording"), and `.list` is how the shortcut list names it. The stage's right-click menu uses the same ids for the same commands. |
| `menu.role.<role>` | An item the system provides, such as Quit or Close Window. `-app` takes the app's name: `menu.role.quit-app` is "Quit {app}". |
| `<area>.<thing>[.<detail>]` | A word built in code, by the part of the interface it belongs to. Examples: `params.presets.none`, `output.platform.none`, `taxonomy.type.lower-third`, `queue.status.cancelled`, `render.canceled`, `camera.record.stop`, `speech.language.de`. An id may keep an internal value's spelling (`cancelled` is a stored render status); what it *says* is the catalog's. |

## What a message may hold

- **Placeholders.** `{name}` is filled from the values passed: `'Saved as {name}.'`. A translation must use exactly the same placeholders, and a test compares them. Placeholder names are never translated, not even by the British spelling rules.
- **Plural forms.** `{ one: '{count} file', other: '{count} files' }`. The form is chosen by `Intl.PluralRules` for the locale from `count`, so a language with more forms (`few`, `many`) gives them and needs nothing else.
- **Inline emphasis**, in a `data-i18n-rich` message only: `<strong>…</strong>`, `<em>…</em>` and `<code>…</code>`. They are built as elements, never parsed as HTML.
- **Whole sentences.** A message is a whole sentence with placeholders, never a fragment glued to another in code, because word order differs between languages. A few lines are still lists joined in code, such as "Done · 120 frames · 2 warnings" and the start screen's library line. Their parts are messages, but the separator and the order are the code's. Those are worth reworking as each new language shows what it needs.

## Adding a language

1. Make `src/locales/<locale>.ts` exporting a `Catalog`. For a variant of the source, such as another English, add only what it says differently. For any other language, translate every message.
2. Add it to `LOCALES` in `src/core/i18n.ts`, with:
   - its label in its own language ("Deutsch", not "German"), marked `i18n-exempt(content)` as the two English ones are;
   - its direction (`ltr` or `rtl`);
   - `variant: true` only if it falls back to the source by design.

   Then add it to `CATALOGS` in the same file.
3. If its speakers' systems report a region that should come to it, `resolveLocale` is where the system's languages are matched.
4. If it is not a variant, translate the user guide as `docs/user-guide.<locale>.md` and register it in `GUIDES` in `src/renderer/user-guide.ts`.
5. Add it with `preview: true` and a `previewLabel` in its own language (see "Previews"), and give Pulp's terms their words in the glossary.
6. Check it (below), add it to the end-to-end language test, then ask a fluent speaker to read it in the window. Their check is what turns `preview` off.

## Previews

A complete catalog is not yet a checked one. A language is offered as a **preview** (`preview: true` in `LOCALES`) until a fluent speaker has read it in the window, every screen and dialog, and corrected it:

- Settings → Language lists previews apart, under "Previews, not yet checked by a fluent speaker", each named as a preview in its own language (`previewLabel`: "Deutsch (Vorschau)", "中文（简体）（预览）").
- "Same as the system" never comes to a preview. A person gets one only by choosing it, so nobody is put into an unchecked translation they did not ask for.
- When the speaker's check is done, set `preview: false`. From then on a system in that language gets it: German for any German-speaking region (Germany, Austria, Switzerland and the rest: German has one standard written form), Simplified Chinese for `zh-Hans`, mainland China and Singapore. A system set to Traditional Chinese (`zh-Hant`, Taiwan, Hong Kong, Macau) is never given Simplified: it goes on to its next language, or English, until a Traditional catalog exists. `resolveLocale` in `src/core/i18n.ts` holds these rules, and `tests/i18n.test.ts` checks them with `{ previews: true }`.

## Glossary

Pulp's own terms are translated the same way everywhere. A translator adding or changing a message uses these, and `tests/i18n.test.ts` holds the catalogs to the first four.

| English | Deutsch | 中文（简体） |
|---|---|---|
| template | Vorlage | 模板 |
| lower third | Bauchbinde | 下方字幕条 |
| layer | Ebene | 图层 |
| safe area | sicherer Bereich | 安全区域 |
| render (verb / noun) | rendern / Rendering | 渲染 |
| alpha, alpha channel | Alpha, Alphakanal | Alpha、Alpha 通道 |
| pack (template pack) | Paket, Vorlagenpaket | 模板包 |
| matching set | passendes Set | 配套组合 |
| stage | Bühne | 舞台 |
| inspector | Inspektor | 检查器 |
| collection | Sammlung | 合集 |
| tray | Ablage | 收集栏 |
| project | Projekt | 项目 |
| library | Bibliothek | 素材库 |
| clip | Clip | 片段 |
| keyframe | Keyframe | 关键帧 |
| preset | Vorgabe | 预设 |
| poster (a result's picture) | Vorschaubild | 封面图 |
| caption | Untertitel | 字幕 |
| frame (of video) | Frame | 帧 |
| aspect | Seitenverhältnis | 画面比例 |
| favorite | Favorit | 收藏 |
| Polished / Playful (the looks) | Edel / Verspielt | 精致 / 活泼 |
| File / Edit / View / Window / Help | Datei / Bearbeiten / Ansicht / Fenster / Hilfe | 文件 / 编辑 / 视图 / 窗口 / 帮助 |

**German** addresses the person as "Sie", follows the conventions of German software (Datei, Bearbeiten, Ansicht, Abbrechen, Speichern), and uses „…" quotes. A plural message gives `one` and `other`.

**Simplified Chinese** uses full-width punctuation (，。：；！？“ ”（）), one plural form (`other` only), and a space around Latin words and placeholders ("已保存为 {name}。"). It is never set in italic.

## Right-to-left languages

A language declared `rtl` in `LOCALES` mirrors the window (milestone 70): `<html dir>` follows the language, the panels and menus read from the right, and the stylesheet says start and end rather than left and right wherever it means the interface. Three things are decided one by one and **stay left to right** in every language, because time runs rightward in every editing tool: the **transport row** — the scrub bar and the lanes under it, the playback buttons in their order, the marks, the volume, the inspector's tabs and the status — the **picture** on the stage with everything drawn over it (the layer handles, the safe areas), and the **hover scrub** on a card, which reads time across the thumbnail. They are pinned by `dir="ltr"` in the markup; the scrub line and the lanes carry the pin themselves, since the stage's own window takes them along.

What moves with the direction: the browse panel to the right and its splitter's keys with it (Left widens a panel on the right), submenus opening to the left with their caret turned, a menu hung from a button hanging from its right edge, the tour's card on the far side of its highlight, carets and disclosure triangles pointing into the row, and the arrows inside a row or grid of controls trading places so the key follows the eye. The tree's Right and Left do the same: the key that points into the tree unfolds.

No right-to-left language is translated yet. **English (mirrored)**, `en-XB`, is the tool for looking at the mirrored window before one is: US English declared `rtl`, a variant with nothing of its own, never offered in Settings and never the system's. Reach it with `window.pulp.setLanguage('en-XB')` in the developer tools, or `"language": "en-XB"` in `settings.json`. The end-to-end suite switches to it at 1280 × 788 and 960 × 600 ("right to left (milestone 70)" in `tests/e2e/ui.e2e.test.ts`). A real right-to-left catalog follows "Adding a language" above with `dir: 'rtl'`, and the window is already mirrored for it.

## Room for the words

German makes labels long, and Chinese needs its own face. The window allows for both:

- **Chinese is drawn in the system's Chinese face:** PingFang SC on macOS, Microsoft YaHei on Windows, Noto Sans CJK SC on Linux (CI installs `fonts-noto-cjk`). The face comes first in the stack under `:lang(zh)`, so it draws the Latin in a label too and no label mixes two faces. Lines break between characters and never start with closing punctuation (`line-break: strict`). Nothing is synthesized (`font-synthesis: none`), and there is no letter spacing.
- **German is hyphenated by the page's language** (`hyphens: auto` under `:lang(de)`; `<html lang>` is the interface's language), and buttons grow rather than cut their words.
- **The end-to-end suite switches to each language** at 1280 × 788 and 960 × 600 and fails on a label, button, tab, chip or heading that is cut, runs out of a box that clips it, or overlaps its neighbor ("Chinese and German (milestone 68)" in `tests/e2e/ui.e2e.test.ts`). The suite itself runs in US English.

## How a catalog is checked

All in `npx vitest run tests/i18n.test.ts tests/spelling.test.ts tests/dom/i18n-markup.test.ts`:

- **Missing.** A catalog that is not a variant holds every message the source has. To see what is left to translate in one language, run `I18N_LOCALE=de npx vitest run tests/i18n.test.ts -t complete`, which lists every id not yet translated.
- **Unused.** A catalog holds no id the source does not have. The source holds no id that nothing reads: not the markup, not a literal `t('id')`, and not a type-checked template of ids such as `` `start.shape.${shape}` ``. A removed string's message does not linger.
- **Placeholders.** A translation uses the same placeholders as the source.
- **The markup.** It holds no words of its own, names only ids the source has, and reads in whichever language is put in place.
- **British English.** Each entry is exactly the source in British spelling by the rules in `src/core/spelling.ts`. There is an entry wherever the rules change a message, and none where they don't. The British guide has no US spelling left in its prose. To add a word the rules should change, add it to `WORDS` there, run the tests, and add the entries they ask for.
- **Following a change of language.** A word bound in code, a table's label and a line an effect writes all change with the language. A line an effect writes stays in place over the markup's default, not under it.

## How the code is checked

`tests/i18n.test.ts` parses every source file with the TypeScript compiler (`tests/i18n-scan.ts`) and fails on any word for the interface still written in the code. It looks for:

- a sentence anywhere;
- any word where the interface reads it: an element's text, a `label`, `title`, `hint`, `detail` or `description`, an accessible name or tooltip, a tray line, or JSX text.

Imports, logging, selectors, CSS classes, comparisons, literal types and property names are left alone.

A word that is not the interface's is exempt for one of the four reasons:

- **A whole file:** list it in `tests/i18n-exempt.json` with its reason and why. A listed file with nothing left to exempt fails, so the list does not go stale.
- **One string:** add `// i18n-exempt(<reason>)` on its line or the line before.

Today there are 26 whole files and 445 single strings: 347 diagnostic, 49 technical, 34 content and 15 terminal.

The scan cannot see a one-word label held in a variable before it is shown (`const word = on ? 'Stop' : 'Record'`). Read words through `t()` where they are made, and reviewers watch for this.

### Writing code that shows words

- In a Preact component or an `effect`, `t('id')` is enough: it is drawn again when the language changes.
- An element built or filled once (at start-up, or when a dialog opens): `bindText(el, 'id', values)` and `bindAttr(el, 'data-tip', 'id', values)` set the words and stamp the element, so a change of language rewrites it with the rest.
- A repaint called when its own state changes: use `bindText` inside it, or register it once with `whenLocaleChanges(paint)`.
- A table of names: give the entry a getter, `get label() { return tr('id'); }`. Don't copy a label into a constant, a Map or a spread at load if it is shown.
- The main process: `tr()` when the message is made. Its language is kept current by `src/main/language-service.ts`.
- Narrow the check while you work: `I18N_ONLY=src/renderer/stage.ts,src/core/ npx vitest run tests/i18n.test.ts -t "are none"`.

What does not follow a change of language until it is made again: a tray line already showing (it fades), an error already on a queue card, and the notes Pulp reads from a layered file (PSD, KRA, SVG, PDF), which are kept with the decoded file until it changes or Pulp restarts.
