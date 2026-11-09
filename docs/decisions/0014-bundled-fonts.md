# 0014. Bundled fonts: ten OFL families, served under each page's own origin

Date: 2026-10-25
Status: Accepted

## Context

Milestone 23 lets the person using a template add and restyle layers of text. A layer's family is a property they choose, and a choice only means something if the face exists wherever the template is previewed or rendered. Until now a template's type came from the system (`Helvetica Neue, Arial, sans-serif`) or from font files the template author bundled in the template folder. Neither serves a layer: a user's choice is made in Pulp, not in a template, and a render on another machine must look the same.

Two constraints shape the answer. Template pages run under a Content Security Policy that allows fonts from `'self'` and `data:` only (ADR 0013 keeps that policy closed; it lists no library scheme and no app scheme). And Pulp's code is MIT, while usable fonts almost never are: they come under the SIL Open Font License, which permits bundling but keeps the fonts under their own terms and, for some, reserves their names.

## Decision

**Pulp bundles ten open-license families, taken from their upstreams with their own license files, and serves them to template pages under each template's own origin at a reserved path.**

- **The set:** Inter, Montserrat and Noto Sans (sans), Oswald and Bebas Neue (display), Source Serif 4 and Playfair (serif), JetBrains Mono (mono), Caveat and Dancing Script (script). Two of each kind a lower third or a title is likely to want, one mono, and one of the Noto family because it covers the most scripts. (The bundled Noto Sans is the latin-greek-cyrillic build, which also carries Devanagari but not Arabic or Hebrew; milestone 70 added Noto Sans Arabic, Noto Sans Hebrew and the Notos for Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada and Malayalam beside it, and every text layer's canvas font stack ends with the ten, so those scripts draw the same on every machine whatever family the layer is set in.) Playfair stands where the roadmap said Playfair Display: that family's upstream has become the Playfair superfamily, whose display cut is the large end of its optical-size axis.
- **Licenses are read, not assumed.** Each family's folder holds the license file its upstream ships, and the test confirms from that file that it is the SIL Open Font License 1.1 and reads whether it declares a Reserved Font Name. Two do (Source, Dancing Script); their files are the upstream bytes untouched, which is what the OFL asks of a font that keeps its reserved name, and the files' hashes are in the list the test checks. Nothing is subset, for the same reason and to keep every family's full character set. `docs/font-credits.md` records family, version, license, Reserved Font Name and source, and the test holds it to the list.
- **Delivery to templates fits the CSP rather than widening it.** The template protocol answers for the bundled files under every template at `/__pulp/fonts/<family>/<file>`, which `font-src 'self'` already allows. Only files on the bundled list are served there; a template folder's own `__pulp` is never reachable. The bridge adds an `@font-face` per file beside itself, so every template page knows the families by name without declaring anything.
- **The app window loads the same files through its own scheme**, `pulp-font://`, so the family control can show each family set in itself. Template pages are refused there, as they are by every app scheme.
- **Both routes answer with `Access-Control-Allow-Origin: *`.** A font load is a CORS request even to the page's own origin, and these schemes enforce CORS; the fonts are public under their license, so saying who may read them is simpler and steadier than relying on two custom-scheme origins comparing equal, which did not hold on Windows (docs/platform-notes.md).
- **The bridge loads a face before the frame that uses it.** Canvas text never triggers a font load, so a `@font-face` alone would leave the first frames in a fallback. Before each frame the bridge calls `document.fonts.load` for every text layer's family, weight and style, once per face; a family that is neither bundled nor installed resolves at once and falls back as it always did.

## Reasons

- Serving under `'self'` keeps the template CSP exactly as it was. The alternative, a `pulp-font:` entry in the template CSP, is a second scheme a template page could address; the reserved path is one list of files behind the origin the template already has.
- Taking the files from upstream rather than a font package is what makes the license claim honest: the license file is the one the authors published with those bytes, and the version is theirs.
- Variable fonts give a layer any weight in one file. The set is about 12 MB; that is the price of real italics and full character sets, and it is paid once in the installer, not per template.
- A family the user chooses that is not bundled still works where it is installed and falls back where it is not — exactly as a template's own `font` parameter always has. The bundled set is the part that is the same everywhere.

## Costs

- 12 MB of binaries in the repository and the installer. Shipping subsets would be smaller, and is ruled out above.
- The reserved path is a convention a template author has to know: a template folder cannot have files under `__pulp/`. The format document says so.
- A template's own code that sets `ctx.font` to a bundled family must load it first (`document.fonts.load`), since the bridge loads only what the layers use. The format document says so too.

## Not decided here

Importing a person's own fonts into a managed folder, with a license note, is the milestone's next item (since built): it reuses the same delivery (another folder behind the same reserved path and scheme) and is kept out of exported packs, so sharing a pack can never redistribute a license the sharer does not hold.
