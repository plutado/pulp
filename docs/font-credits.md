# Font credits

Pulp bundles ten font families so a layer of text can be set in a face that exists on every machine (milestone 23, decision record 0014). Every one is under the **SIL Open Font License 1.1**, confirmed from the licence file shipped beside the fonts — the file each upstream publishes, copied as it is — not from a package listing. The fonts live in `fonts/<family>/`, each with that licence file; `src/core/fonts.ts` is the list the app reads, and `tests/fonts.test.ts` checks this page, the files and their hashes against it.

Pulp's own code is MIT. The fonts are not: they stay under the OFL, which lets them be bundled, used, and passed on with their licence, and forbids selling them on their own. Two families declare a **Reserved Font Name**; the OFL lets an unmodified font keep its name, so those files are the upstream bytes untouched (no subsetting, no renaming) and the hashes in the list are how the test knows.

| Family | Version | Licence | Reserved Font Name | Source | Files |
|---|---|---|---|---|---|
| Inter | 4.1 (release v4.1; the files say 4.001) | OFL 1.1 (`LICENSE.txt`) | none | https://github.com/rsms/inter | `InterVariable.ttf`, `InterVariable-Italic.ttf`, variable weight 100–900 |
| Montserrat | 9.000 (master, commit 555facfb2a18, 2026-03-27) | OFL 1.1 (`OFL.txt`) | none | https://github.com/JulietaUla/Montserrat | `Montserrat[wght].ttf`, `Montserrat-Italic[wght].ttf`, variable weight 100–900 |
| Oswald | 4.103 (main, commit 89795261ac9e, 2024-05-29) | OFL 1.1 (`OFL.txt`) | none | https://github.com/googlefonts/OswaldFont | `Oswald[wght].ttf`, variable weight 200–700 |
| Bebas Neue | 2.000 (master, commit 46e72cec95ee, 2022-07-04) | OFL 1.1 (`OFL.txt`) | none | https://github.com/dharmatype/Bebas-Neue | `BebasNeue-Regular.ttf`, the 2018 Dharma Type cut, one weight |
| Source Serif 4 | 4.005 (release 4.005R) | OFL 1.1 (`LICENSE.md`) | Source (Adobe) — shipped unmodified | https://github.com/adobe-fonts/source-serif | `SourceSerif4Variable-Roman.ttf`, `SourceSerif4Variable-Italic.ttf`, variable weight 200–900 with an optical-size axis |
| Playfair | 2.202 roman, 2.203 italic (master, commit b869b3a82f71, 2025-05-08) | OFL 1.1 (`OFL.txt`) | none | https://github.com/clauseggers/Playfair | `PlayfairRomanVF.ttf`, `PlayfairItalicVF.ttf`, variable weight 300–900 with width and optical-size axes |
| JetBrains Mono | 2.304 (release v2.304) | OFL 1.1 (`OFL.txt`) | none | https://github.com/JetBrains/JetBrainsMono | `JetBrainsMono[wght].ttf`, `JetBrainsMono-Italic[wght].ttf`, variable weight 100–800 |
| Caveat | 2.000 (main, commit 59745e818ef7, 2020-10-01) | OFL 1.1 (`OFL.txt`) | none | https://github.com/googlefonts/caveat | `Caveat[wght].ttf`, variable weight 400–700 |
| Dancing Script | 3.000 (master, commit 09b7abf420f2, 2024-08-12) | OFL 1.1 (`OFL.txt`) | Dancing Script — shipped unmodified | https://github.com/impallari/DancingScript | `DancingScript-Regular.otf`, `-Medium.otf`, `-SemiBold.otf`, `-Bold.otf`, four static weights |
| Noto Sans | 2.015 (release NotoSans-v2.015) | OFL 1.1 (`OFL.txt`) | none | https://github.com/notofonts/latin-greek-cyrillic | `NotoSans[wght].ttf`, `NotoSans-Italic[wght].ttf`, the "slim" weight-only variable fonts, 100–900 |

## Notes on the set

- **Playfair Display is Playfair now.** The roadmap named Playfair Display. Its upstream repository redirects to `clauseggers/Playfair`, whose current fonts are the Playfair 2.2 superfamily: one variable font with weight, width and optical-size axes, where the display cut is the large end of the optical-size axis. Pulp ships that family, under its own name. Set large, as titles are, it is the Playfair Display design; set small it becomes the text and agate cuts the old family never had.
- **Dancing Script** is shipped as its four current static faces. The upstream keeps its variable font in a `legacy` folder, so the statics are what it publishes today.
- **Inter's** release is v4.1; the files inside carry the version string 4.001, which is how that project numbers its builds.
- **Italics.** Where upstream publishes an italic, it is bundled, so an italic layer is set in a drawn italic rather than a slanted roman. Oswald, Bebas Neue, Caveat and Dancing Script have no italic; a layer set italic in them is slanted by the renderer.
- **Weights.** A variable font covers its whole range in one file, so a layer may ask for any weight in it. Outside the range — weight 100 in Oswald, say — the renderer uses the nearest the font has.
- **Nothing is subset.** The files are the upstream ones; the hashes in `src/core/fonts.ts` are checked by the test. This matters for the two Reserved Font Names and keeps every family's full character set.

## How they reach a page

A template page may load fonts only from its own origin (`font-src 'self'`). The template protocol therefore answers for these files under every template at the reserved path `/__pulp/fonts/<family>/<file>`, and the bridge declares an `@font-face` for each file beside itself, so a layer set in Oswald finds Oswald in any template. The app window loads the same files through its own `pulp-font://` scheme, which is how the family control shows each face in itself. Canvas text never triggers a font load, so the bridge loads the face of every text layer before the frame that draws it. Decision record 0014 has the reasoning.

## Adding a family

Take the files and the licence file from the family's own repository or release, read the licence file, note any Reserved Font Name, add an entry to `src/core/fonts.ts` with the files' SHA-256 hashes, and add a row here. The test will not pass until all three agree.
