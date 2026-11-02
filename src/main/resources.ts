/**
 * Where the things Pulp ships with live (milestone 17): the bundled
 * templates and fonts, the example projects, and the two libraries whose
 * build files are read at run time rather than bundled into the main
 * process — pdf.js's, which the rasterizer loads as text into a sandboxed
 * page (milestone 33), and lottie-web's player, which the template protocol
 * serves to a Lottie's page (milestone 35).
 *
 * In a checkout they are in the repository, beside `node_modules`; in a
 * packaged app electron-builder copies each into `Resources/` (its
 * `extraResources`, see `electron-builder.yml`). One module answers for all
 * of them, so a thing that is bundled cannot be found in a checkout and
 * missing from the app — the way `app.isPackaged ? … : …` written out four
 * times eventually goes wrong.
 */

import { app } from 'electron';
import { join } from 'node:path';

/**
 * A folder shipped beside the app. `fallback` is where it is in a checkout
 * when that is not simply the repository root — the two libraries, which are
 * under `node_modules` there and flattened into `Resources/` here.
 */
function bundled(name: string, fallback?: string[]): string {
  if (app.isPackaged) return join(process.resourcesPath, name);
  return join(app.getAppPath(), ...(fallback ?? [name]));
}

/** The sample templates shipped with the app; the library shows this root as "Built-in templates". */
export function bundledTemplatesDir(): string {
  return bundled('templates');
}

/** The bundled fonts (src/core/fonts.ts, ADR 0014), beside the bundled templates. */
export function bundledFontsDir(): string {
  return bundled('fonts');
}

/** The example projects the start screen offers, each opened as a copy. */
export function bundledExamplesDir(): string {
  return bundled('examples');
}

/** pdf.js's build folder: `pdf.min.mjs` and `pdf.worker.min.mjs`, read as text (src/main/rasterize.ts). */
export function pdfJsBuildDir(): string {
  return bundled('pdfjs', ['node_modules', 'pdfjs-dist', 'build']);
}

/** lottie-web's light player, served to a Lottie's own page (src/main/lottie-service.ts). */
export function lottiePlayerFile(): string {
  return join(bundled('lottie', ['node_modules', 'lottie-web', 'build', 'player']), 'lottie_light.min.js');
}
