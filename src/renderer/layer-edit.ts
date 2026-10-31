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
  addLayer(type: LayerType, label?: string, itemId?: string): { block: string; id: string } | { refused: string };
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
}

let editor: LayerEditor | null = null;

export function registerLayerEditor(e: LayerEditor): void {
  editor = e;
}

export function layerEditor(): LayerEditor | null {
  return editor;
}
