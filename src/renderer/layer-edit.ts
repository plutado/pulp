/**
 * The one channel between the stage and the Parameters tab for layers
 * (milestone 25): which layer is selected, and how the stage edits one. The
 * Parameters tab owns the layer values, their history and their redraws, so it
 * registers its editor here at mount; the stage calls through it and never
 * reaches into the tab's DOM (docs/ui-layout.md: regions meet through state,
 * not each other's elements).
 */

import { signal } from '@preact/signals';
import type { Layer, LayerType } from '../core/layers';

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
   * Add a layer showing a library item, as a drop on the stage does
   * (milestone 26): the tab picks a block that takes more layers, makes the
   * layer and gives it the picture or clip. Returns where it landed, or null
   * with a reason when nothing can hold it.
   */
  addForItem(type: LayerType, itemId: string, label: string): { block: string; id: string } | { refused: string };
}

let editor: LayerEditor | null = null;

export function registerLayerEditor(e: LayerEditor): void {
  editor = e;
}

export function layerEditor(): LayerEditor | null {
  return editor;
}
