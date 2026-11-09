/**
 * Turning a Lottie into an editable template (milestone 35's last item): the
 * animation becomes a template folder in the open format — a `template.json`
 * a person can change by hand, an `index.html` that is the same generated
 * page a library item plays through, the player script beside it, and the
 * pictures the animation names. The folder is a template like any other:
 * rendered, edited, packed and shared, with no Lottie file behind it — which
 * is also what makes an animation exportable in a pack, where a bare `.lottie`
 * is not.
 *
 * Pure: the files as strings and bytes, and the names. The main process holds
 * the dialog, the player's bytes and the disk (src/main/lottie-service.ts).
 */

import type { LottieInfo } from './lottie-types';
import type { TemplateManifest } from './manifest';
import { lottiePageHtml } from './lottie-page';
import { slug } from './pack';

export interface LottieTemplateInput {
  /** What the template is called: the folder name the person chose. */
  name: string;
  /** The library item's manifest, carried over whole but for its id and name. */
  manifest: TemplateManifest;
  /** What the scan recorded: bindings, themes, which animation of an archive this is. */
  info: LottieInfo;
  /** The animation document as the page should load it (prepareLottieData). */
  data: Record<string, unknown>;
}

export interface LottieTemplateFiles {
  /** The folder-safe name, and the manifest id it makes: custom.<slug>. */
  folder: string;
  templateId: string;
  /** template.json, pretty-printed, and the generated page, which looks for `player.js` beside itself. */
  manifest: string;
  page: string;
}

/** The player's file name inside a saved template folder: beside the page, so the folder is whole on its own. */
export const LOTTIE_TEMPLATE_PLAYER = 'player.js';

/**
 * The files a Lottie item saves as a template folder. The manifest is the
 * item's own with a template id and the chosen name — so the parameters, the
 * structure its markers gave it, its length and its license all carry over —
 * and the page inlines the animation as the library's generated page does,
 * loading the player from `player.js` beside itself rather than the reserved
 * path only a library Lottie is served.
 */
export function lottieTemplateFiles(input: LottieTemplateInput): LottieTemplateFiles {
  const folder = slug(input.name, 'template');
  const templateId = `custom.${folder}`;
  const manifest: Record<string, unknown> = {
    ...(input.manifest as unknown as Record<string, unknown>),
    id: templateId,
    name: input.name,
  };
  const defaults = Object.fromEntries(input.manifest.parameters.map((p) => [p.id, p.default]));
  const page = lottiePageHtml({
    name: input.name,
    data: input.data,
    bindings: input.info.bindings,
    width: input.info.width,
    height: input.info.height,
    fps: input.info.fps,
    totalFrames: Math.max(1, Math.round(input.info.outPoint - input.info.inPoint)),
    ...(input.info.themes ? { themes: input.info.themes } : {}),
    ...(input.info.animation !== undefined ? { animation: input.info.animation } : {}),
    defaults,
    playerSrc: LOTTIE_TEMPLATE_PLAYER,
  });
  return { folder, templateId, manifest: `${JSON.stringify(manifest, null, 2)}\n`, page };
}
