# Translating Pulp

How the interface's words are kept, how a language is added, and how a catalog is checked (milestone 59).

Every word the window and the menus show is read from a **message catalog** keyed by id. US English is the source: 2,344 messages in `src/locales/en-US/`. Every other language is a catalog of its own, and a person chooses one in **Settings → Language**. "Same as the system" is the default, and English (US) and English (UK) are listed first. A change redraws every window and the menus at once, with no restart.

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
| `content` | Library content: template manifests' names, descriptions and parameter labels, and the manifest Pulp writes for a Lottie file; the sample-media catalog's names and notes; words drawn into a picture; font provenance; the first words of a new text layer; a language's own name ("English (UK)"). | The template's or the file's, not the window's. Templates are translated, if at all, by their authors. |
| `technical` | SQL, CSS classes and selectors, MIME types, FFmpeg filter graphs, FCPXML, HTML, SVG or JavaScript in strings; ids and stored values; file and folder names on disk (`Recordings`, `Sample media`). | Not words. A name on disk must stay the same whatever language wrote it. |

Also never translated: the search field's filter keywords (`favorite:`, `type:`, `duration:`), keyboard shortcuts, timecode, frame rates and file format names. These are typed or read as editors expect them, and the same in every language.

Not yet covered: the editor panels inside Premiere Pro and DaVinci Resolve (`panels/`), which have their own interface and follow their host; and dates, numbers and file sizes, which still use US forms. "Formats that follow the locale" is the next item of milestone 59.

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
5. Check it (next section), then ask a fluent speaker to read it in the window before it ships.

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
