# Translating Pulp

How the interface's words are kept, and how a language is added (milestone 59). The interface reads its words from a **message catalog** keyed by id. US English is the source (`src/locales/en-US.ts`). Every other language holds only what it says differently, and falls back to US English for the rest.

The first language after the source is British English (`src/locales/en-GB.ts`), which is a few dozen spellings: colour, grey, centre, favourite, theatre, licence, customise. A person chooses the language in **Settings → Language**. "Same as the system" is the default, and English (US) and English (UK) are listed first.

## Where the words are

- **The window's markup** (`src/renderer/index.html`) carries no words of its own. An element names its message: `data-i18n="id"` for its text, `data-i18n-attr="aria-label:id;data-tip:id"` for its attributes, and `data-i18n-rich="id"` for text with `<strong>`, `<em>` or `<code>` inside. `data-i18n-at="start"` or `"end"` puts a label's words before or after the control it holds. `src/renderer/i18n.ts` puts them all in place, in this window and in the popped-out stage, and again whenever the language changes.
- **The application menu** (`src/core/menu.ts`) is built through a translator. The main process builds it in the chosen language and rebuilds it when the language changes.
- **Words built in code** read `t('id', { values })` from `src/renderer/i18n.ts`. Read inside an effect, they follow a change of language.

Not every word has moved yet. `tests/i18n-baseline.json` lists, per file, the words still written straight into the code (about 960 of them, in labels, tooltips, tray lines and hints). The test only lets that list shrink: a new word written into code fails it, and a file whose words move must lower its count. Until a file's words are in the catalog, they show in US English whatever language is chosen.

## What a message id means

An id names **where** a string sits, not what it says, so it stays put when the words change:

| Id | Where |
|---|---|
| `ui.<element id>` | The text of the markup element with that id: `ui.settings-title`. |
| `ui.<container>.<slug>` | Text of an element with no id of its own, inside the nearest container that has one: `ui.settings-dialog.play-a-sound-when-it-is-chosen`. The slug was the first words when it was written; it is a name now, not a quotation. |
| `….<attribute>` | That element's tooltip or accessible name: `ui.rescan.aria-label`, `ui.library-add.data-tip`. |
| `menu.<command>` | The application menu item for a command: `menu.project.new`. `.alt` is what it reads while toggled (`menu.record.audio.alt` is "Stop Recording"), and `.list` is how the shortcut list names it. |
| `menu.role.<role>` | An item the system provides, such as Quit or Close Window. `-app` takes the app's name: `menu.role.quit-app` is "Quit {app}". |
| `settings.…`, `window.…` | Words built in code for a dialog or a window. |

## What a message may hold

- **Placeholders.** `{name}` is filled from the values passed: `'Quit {app}'`. A translation must use exactly the same placeholders. The test compares them.
- **Plural forms.** `{ one: '{count} item', other: '{count} items' }`. The form is chosen by `Intl.PluralRules` for the locale from `count`, so a language with more forms (`few`, `many`) only needs to give them.
- **Inline emphasis**, in a `data-i18n-rich` message only: `<strong>…</strong>`, `<em>…</em>` and `<code>…</code>`. They are built as elements, never parsed as HTML.
- **Syntax stays as typed.** The search field's filter keywords (`favorite:`, `type:`, `duration:`) are what a person types, so they are the same in every language. So are keyboard shortcuts, timecode, frame rates and file formats.

## Adding a language

1. Make `src/locales/<locale>.ts` exporting a `Catalog`, and add only the messages that differ from US English. For a language other than English, that is all of them.
2. Add it to `LOCALES` in `src/core/i18n.ts`, labeled with its own name for itself ("Deutsch", not "German"), with its direction (`ltr` or `rtl`), and to `CATALOGS` there.
3. If its speakers' systems report a region that should come to it, `resolveLocale` is where the system's languages are matched.
4. Run `npx vitest run tests/i18n.test.ts`. It checks that every id the catalog holds is one the source has, that each says something different, and that placeholders match. It also checks that the markup names only ids the source has, and that every source id is read somewhere, so a removed string's message does not linger.
5. Ask a fluent speaker to read it in the window before it ships.
