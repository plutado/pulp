/** Library index data types. Pure; shared with the renderer over IPC. */

import type { StockLibraryState } from './stock-library';
import type { ClipSetFiles } from './clip-set';
import type { MediaPreview } from './library-preview';
import type { UnreadablePreview } from './unreadable-media';
import type { TemplateManifest, ValidationIssue } from './manifest';
import type { MediaMetadata } from './media-meta';
import type { MediaSequence } from './media-sequence';
import type { LottieInfo } from './lottie-types';

export type { MediaMetadata } from './media-meta';

export type MediaKind = 'video' | 'image' | 'audio';

export interface TemplateEntry {
  kind: 'template';
  /** Unique key within the index (derived from the path). */
  key: string;
  /** Opaque library id, stable for the item while it exists; used to address it without exposing its path. */
  id: string;
  /** pulp-thumb://<id>/ once a thumbnail exists for the item as it is now. */
  thumbnail?: string;
  /** Tags the user added; also merged into `tags`. */
  userTags?: string[];
  favorite?: boolean;
  /** ISO time the item was last selected or rendered. */
  lastUsed?: string;
  /** How many times a render of this item has finished. */
  renderCount?: number;
  /** True when the item's library root is not reachable right now; the item is kept so user data survives. */
  offline?: boolean;
  /** Manifest themes plus the user's; themes the user added; both like tags. */
  themes?: string[];
  userThemes?: string[];
  dir: string;
  root: string;
  /** Bytes the template folder holds, and the newest file in it; for the Info tab's File section. */
  size?: number;
  mtimeMs?: number;
  /** The pack this template was found under (a folder with a pack.json), if any. */
  pack?: { name: string; slug: string };
  manifest: TemplateManifest;
  /**
   * The manifest's US English name and description, set when the window shows the entry in
   * another language (src/core/library-words.ts), so search still finds it by its English words.
   */
  source?: { name: string; description: string };
  /** Manifest tags plus folder-derived tags. */
  tags: string[];
  warnings: ValidationIssue[];
  /**
   * Set when the item is a Lottie animation read as a template (milestone 35):
   * a single `.json` or `.lottie` file, with no folder of its own. `dir` is then
   * the folder it sits in and `manifest.entry` is answered by a generated page.
   */
  lottie?: LottieInfo;
}

export interface MediaEntry {
  kind: 'media';
  key: string;
  id: string;
  thumbnail?: string;
  userTags?: string[];
  favorite?: boolean;
  lastUsed?: string;
  /** How many times a render of this item has finished. */
  renderCount?: number;
  offline?: boolean;
  /** From the built-in taxonomy, named by a folder on the item's path; absent when no folder says. */
  type?: string;
  /** Folder-inferred themes plus the user's; themes the user added. */
  themes?: string[];
  /** How it feels (milestone 16's moods), inferred from folder names; the file's own metadata adds more through `meta`. */
  moods?: string[];
  userThemes?: string[];
  path: string;
  root: string;
  name: string;
  mediaKind: MediaKind;
  ext: string;
  size: number;
  mtimeMs: number;
  /** Folder-derived tags. */
  tags: string[];
  /** From ffprobe, once probed; absent until then or when ffprobe could not read the file. */
  meta?: MediaMetadata;
  /**
   * Set when this entry is a run of numbered frames read as one clip rather
   * than a single file (milestone 26). `path` is then its first frame, and
   * `mediaKind` is `video` however the frames are stored.
   */
  sequence?: MediaSequence;
  /**
   * Set when this entry is a clip set (milestone 32): an intro, a loop and an outro in separate
   * files that play as one item that stretches. Full paths; `path` is then the loop's, which
   * makes its poster, and `meta.parts` says how long each part runs once probed.
   */
  clipSet?: ClipSetFiles;
  /**
   * Set when this entry is a file inside a zip archive (milestone 32), listed without unpacking it.
   * `path` is where it is unpacked to — beside the archive, in a folder named after it — which
   * happens the first time it is used (src/main/archive-service.ts); `unpacked` says it is there now.
   */
  archive?: { zip: string; member: string; unpacked: boolean };
  /**
   * Music and sound effects (milestone 32). `partOf` marks a file that is one cut or one stem of a
   * group item: it stays in the library, with its own id, for whatever plays it, but the results
   * show the group once. A group item lists its members: `versions`, a track's cuts, longest
   * first, of which the one that fits the work is played (`pickVersion`); or `stemParts`, a song's
   * stems, placed as one audio layer whose stems switch on and off. `pairedSound` is the id of a
   * sound made for this clip — a transition's whoosh — which plays with it.
   */
  /**
   * Known but not on this computer (milestone 32): listed by the library's own catalog, its file
   * not there. Shown grayed out, refused for use as an offline item is (the index flags it
   * offline too), and the same item — same key — once the file arrives.
   */
  missing?: true;
  /**
   * A file Pulp cannot read (milestone 32) — a motion-graphics project, a disc image, camera raw —
   * listed rather than skipped: `ext` names the format, whose note says what it needs
   * (src/core/unreadable-media.ts), and `preview` what shows it, where something does. Refused for
   * use as an offline item is (the index flags it offline).
   */
  unreadable?: { ext: string; preview?: UnreadablePreview };
  partOf?: string;
  versions?: { id: string; label: string; seconds?: number }[];
  stemParts?: { id: string; label: string }[];
  pairedSound?: string;
  /**
   * The small preview and thumbnail the library carries for this item (milestone 32): a picture
   * beside it or in a preview folder, a small clip or sound, or what its catalog names. Browsing —
   * the thumbnail, the length, the hover-scrub strip, the stage — reads these in place of the full
   * file, which is read only when the item is placed or rendered (src/core/library-preview.ts).
   */
  preview?: MediaPreview;
  /**
   * The library's own category for this item (milestone 32), as its catalog spells it, outermost
   * first ("Backgrounds", "Fire"). Normalized into `tags` for search, fed to the taxonomy beside
   * the folder names, and listed under the library's node in the browse tree, so the collection
   * browses the way it was organized.
   */
  category?: string[];
}

export type LibraryEntry = TemplateEntry | MediaEntry;

export interface LibraryProblem {
  path: string;
  message: string;
  issues?: ValidationIssue[];
}

export interface LibraryIndex {
  roots: string[];
  templates: TemplateEntry[];
  media: MediaEntry[];
  problems: LibraryProblem[];
  builtAt: string;
  /** The root holding the bundled sample templates, shown as "Built-in templates". */
  builtInRoot?: string;
  /** The stock libraries added (milestone 32), each with whether it can be reached now. */
  stockLibraries?: StockLibraryState[];
}

