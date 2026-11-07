/**
 * The one channel between the stage and the Parameters tab (milestone 25, and
 * the graphic's length since milestone 30): which layer is selected, and how
 * the stage edits one. The
 * Parameters tab owns the layer values, their history and their redraws, so it
 * registers its editor here at mount; the stage calls through it and never
 * reaches into the tab's DOM (docs/ui-layout.md: regions meet through state,
 * not each other's elements).
 */

import { signal } from '@preact/signals';
import type { CaptionsValue } from '../core/captions';
import type { CutTrack } from '../core/cut-track';
import type { Block, Layer, LayerType } from '../core/layers';

/** The selected layer, shared by the stage and the Parameters tab; null is nothing selected. */
export const selectedLayer = signal<{ block: string; id: string } | null>(null);

export interface LayerEditor {
  /** Change one layer; `commit` makes it one undo step (a gesture's end), false is a live preview. */
  edit(block: string, id: string, change: (layer: Layer) => Layer, commit: boolean): void;
  /** The layer as it stands, so a gesture starts from the truth. */
  get(block: string, id: string): Layer | undefined;
  /** Commit whatever live edits are pending as one undo step. */
  commit(): void;
  /**
   * Add a layer, as a drop on the stage does (milestone 26) and as the stage's
   * right-click menu does (milestone 39): the tab picks a block that takes more
   * layers and makes the layer there. With `itemId` it is a picture or a clip
   * showing that library item; without one it is a blank layer of that type.
   * Returns where it landed, or a reason when nothing can hold it.
   */
  /**
   * Add a layer to the first open block; `fitted` says a clip was sized to fit the frame
   * (milestone 32: a clip set, a frame sequence or a transparent clip is a whole-frame graphic),
   * so what placed it leaves it centered rather than moving it to a point.
   */
  addLayer(type: LayerType, label?: string, itemId?: string): { block: string; id: string; fitted?: true } | { refused: string };
  /** One block's layers as they stand, for an edit that acts on the stack rather than on one layer. */
  stack(block: string): Layer[] | undefined;
  /** The template's blocks, with whether each takes added layers; the first open one is where things land. */
  blocks(): Pick<Block, 'id' | 'label' | 'open'>[];
  /** Replace one block's stack as one undo step (milestone 39: cut, paste, duplicate, order). */
  setStack(block: string, layers: readonly Layer[]): void;
  /**
   * Bring the Parameters tab forward on this layer's card and put the caret in
   * its words (milestone 39's Edit Text). The tab owns its own elements, so the
   * stage asks for this rather than reaching for the field itself.
   */
  editText(block: string, id: string): void;
  /**
   * The same for a layer that shows something chosen from the library — a
   * picture or a clip: the card forward with its chooser open. One method for
   * both, since both wear the same well and the same chooser (Replace Image…
   * and Replace Clip…).
   */
  choosePicture(block: string, id: string): void;
  /**
   * Set how long the graphic runs for (milestone 30), as the handle on the
   * scrub bar does; `undefined` is the length the template was designed at.
   * `commit` makes it one undo step, false is a live drag.
   */
  setLength(length: number | undefined, commit: boolean): void;
  /** The cut track as it stands (milestone 49); null when the project has none. */
  track(): CutTrack | null;
  /** How long the graphic runs now (milestone 30), which a motion preset spreads its keys over. */
  length(): number;
  /** Whether keyframe recording is on for a layer (milestone 51), and the switch (milestone 55's stage menu). */
  keyframing(block: string, id: string): boolean;
  toggleKeyframing(block: string, id: string): void;
  /** The raw parameter bag as it stands — the values, the layers, the length and the track ride together. */
  params(): Record<string, unknown>;
  /**
   * Replace the cut track, as the lane's gestures do (src/renderer/cut-track.ts);
   * null removes it. `commit` makes it one undo step — a drop, a split, a
   * delete, the end of a trim or a move — false is a live drag.
   */
  setTrack(track: CutTrack | null, commit: boolean): void;
  /** The project's captions as they stand (milestone 50); null when it has none. */
  captions(): CaptionsValue | null;
  /**
   * Replace the captions, as the card's edits do (src/renderer/captions.ts);
   * null takes them off the project. `commit` makes it one undo step, which
   * every caption edit is: there is no live drag here.
   */
  setCaptions(captions: CaptionsValue | null, commit: boolean): void;
}

let editor: LayerEditor | null = null;

export function registerLayerEditor(e: LayerEditor): void {
  editor = e;
}

export function layerEditor(): LayerEditor | null {
  return editor;
}
