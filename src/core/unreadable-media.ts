/**
 * What is out of scope is said, not hidden (milestone 32): a file in the
 * library that Pulp cannot read — a motion-graphics project, a 3D scene, a
 * disc image only its own browser could convert, camera raw video — is listed
 * as an item anyway, with a plain note of what it needs and its preview where
 * one exists, rather than skipped.
 *
 * - **Which files**: formats people keep beside their stock media, by
 *   extension. A file of no known kind at all (a license, a readme) is still
 *   not media and is left alone.
 * - **The note** is kept as a format key, said in the interface's language
 *   whenever it is shown (`unreadableNote`).
 * - **The preview**: a picture or clip beside it with the same name ("Title
 *   Reveal.aep" + "Title Reveal.jpg", or "… preview.mp4"), or the thumbnail a
 *   file carries inside itself — a Motion Graphics template, a Sketch file and
 *   a Procreate canvas are zips with one.
 *
 * Listed, an item like this is refused for use everywhere an offline one is:
 * there is nothing Pulp can draw from it but its preview.
 */

import { tr, type MessageId } from './i18n';
import type { MediaKind } from './library-types';

interface UnreadableFormat {
  /** What the results browse it as, so a project shows with the clips and a design with the stills. */
  kind: MediaKind;
  what: MessageId;
  needs: MessageId;
}

/** By extension (lowercase, with the dot). The design formats keep milestone 33's words. */
export const UNREADABLE_FORMATS: Readonly<Record<string, UnreadableFormat>> = {
  '.aep': { kind: 'video', what: 'unreadable.aep.what', needs: 'unreadable.aep.needs' },
  '.aet': { kind: 'video', what: 'unreadable.aep.what', needs: 'unreadable.aep.needs' },
  '.prproj': { kind: 'video', what: 'unreadable.prproj.what', needs: 'unreadable.prproj.needs' },
  '.mogrt': { kind: 'video', what: 'unreadable.mogrt.what', needs: 'unreadable.mogrt.needs' },
  '.motn': { kind: 'video', what: 'unreadable.motion.what', needs: 'unreadable.motion.needs' },
  '.moef': { kind: 'video', what: 'unreadable.motion.what', needs: 'unreadable.motion.needs' },
  '.moti': { kind: 'video', what: 'unreadable.motion.what', needs: 'unreadable.motion.needs' },
  '.motr': { kind: 'video', what: 'unreadable.motion.what', needs: 'unreadable.motion.needs' },
  '.drp': { kind: 'video', what: 'unreadable.drp.what', needs: 'unreadable.drp.needs' },
  '.c4d': { kind: 'video', what: 'unreadable.c4d.what', needs: 'unreadable.scene.needs' },
  '.blend': { kind: 'video', what: 'unreadable.blend.what', needs: 'unreadable.scene.needs' },
  '.iso': { kind: 'video', what: 'unreadable.disc.what', needs: 'unreadable.disc.needs' },
  '.dmg': { kind: 'video', what: 'unreadable.disc.what', needs: 'unreadable.disc.needs' },
  '.toast': { kind: 'video', what: 'unreadable.disc.what', needs: 'unreadable.disc.needs' },
  '.r3d': { kind: 'video', what: 'unreadable.r3d.what', needs: 'unreadable.raw.needs' },
  '.braw': { kind: 'video', what: 'unreadable.braw.what', needs: 'unreadable.raw.needs' },
  '.ari': { kind: 'video', what: 'unreadable.ari.what', needs: 'unreadable.raw.needs' },
  '.afdesign': { kind: 'image', what: 'layered.unreadable.afdesign.what', needs: 'layered.unreadable.afdesign.export-as' },
  '.afphoto': { kind: 'image', what: 'layered.unreadable.afphoto.what', needs: 'layered.unreadable.afphoto.export-as' },
  '.xcf': { kind: 'image', what: 'layered.unreadable.xcf.what', needs: 'layered.unreadable.xcf.export-as' },
  '.sketch': { kind: 'image', what: 'layered.unreadable.sketch.what', needs: 'layered.unreadable.sketch.export-as' },
  '.procreate': { kind: 'image', what: 'layered.unreadable.procreate.what', needs: 'layered.unreadable.procreate.export-as' },
  '.eps': { kind: 'image', what: 'layered.unreadable.eps.what', needs: 'layered.unreadable.eps.export-as' },
};

/** A preview: a file beside the item, or an image inside it (the item is a zip). */
export type UnreadablePreview = { file: string } | { zip: string; member: string };

export function unreadableFormat(fileName: string): (UnreadableFormat & { ext: string }) | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = fileName.slice(dot).toLowerCase();
  const f = UNREADABLE_FORMATS[ext];
  return f ? { ...f, ext } : null;
}

/**
 * The note a person reads, in the interface's language now: what it is, and what it needs. A
 * file inside a password-protected archive (milestone 32) needs the archive unpacked with its
 * password, whatever its format.
 */
export function unreadableNote(fileName: string, ext: string, encrypted?: boolean): string {
  if (encrypted) return tr('unreadable.encrypted.note', { file: fileName });
  const f = UNREADABLE_FORMATS[ext.toLowerCase()];
  if (!f) return '';
  return tr('unreadable.note', { file: fileName, what: tr(f.what), needs: tr(f.needs) });
}

const PICTURE = /\.(png|jpe?g|webp|gif|tiff?|bmp)$/i;
const CLIP = /\.(mp4|mov|m4v|webm)$/i;

/**
 * The file beside `fileName` that shows it, from the folder's names: the same name with a picture
 * or clip's extension, or that name with "preview", "thumb", "poster" or "thumbnail" after it.
 * A picture is preferred to a clip, as a still poster is what a card shows.
 */
export function sidecarPreview(fileName: string, siblings: readonly string[]): string | null {
  const dot = fileName.lastIndexOf('.');
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase();
  const base = (n: string) => {
    const d = n.lastIndexOf('.');
    return (d > 0 ? n.slice(0, d) : n).toLowerCase().replace(/[\s_\-.]*(preview|thumb|thumbnail|poster)$/, '');
  };
  const candidates = siblings.filter((n) => n !== fileName && base(n) === stem && (PICTURE.test(n) || CLIP.test(n)));
  return candidates.find((n) => PICTURE.test(n)) ?? candidates[0] ?? null;
}

/** The image inside a zip-based file that shows it: one named like a thumbnail, else its only picture. */
export function embeddedPreview(members: readonly string[]): string | null {
  const pictures = members.filter((m) => PICTURE.test(m));
  return pictures.find((m) => /(thumb|preview|poster)/i.test(m)) ?? (pictures.length === 1 ? pictures[0]! : null);
}
