/**
 * The stage's right-click menu (milestone 39, ADR 0017): what it offers where
 * the pointer is, and the stack edits behind it.
 *
 * It is **the application menu's command list, arranged for a pointer**. Every
 * item names a `MenuCommand` from src/core/menu.ts and is enabled by the same
 * `MenuState` flag the Edit and View menus use (`SHARED_COMMAND_FLAGS`),
 * so nothing can be offered here and refused there; the window runs both
 * through one dispatcher (src/renderer/menu.ts). A unit test holds the two
 * surfaces to that.
 *
 * Pure: the facts in, the menu and new stacks out. The popup that draws it is
 * src/renderer/context-menu.ts, and what the commands do is
 * src/renderer/stage-menu.ts.
 */

import type { LayerLook } from './layer-look';
import { isWholeGraphic, MIN_ON_SCREEN, roundSeconds, spanWindow, type LayerSpan } from './layer-time';
import { newLayer, type Block, type Layer, type LayerType } from './layers';
import { backgroundSubmenu, itemChecked, itemEnabled, SHARED_COMMAND_FLAGS, type MenuCommand, type MenuItemSpec, type MenuState } from './menu';

// ---------------------------------------------------------------- what can be done

/** The slice of `MenuState` that says what can be done to a layer; both menus read exactly these. */
export type LayerMenuFacts = Pick<
  MenuState,
  | 'canAddLayer' | 'canEditLayer' | 'canDeleteLayer' | 'canLayerForward' | 'canLayerBackward'
  | 'canPasteLayer' | 'canPasteLook' | 'canResetLayer' | 'canEditText' | 'canReplaceImage'
>;

export const NO_LAYER_FACTS: LayerMenuFacts = {
  canAddLayer: false,
  canEditText: false,
  canReplaceImage: false,
  canEditLayer: false,
  canDeleteLayer: false,
  canLayerForward: false,
  canLayerBackward: false,
  canPasteLayer: false,
  canPasteLook: false,
  canResetLayer: false,
};

export interface LayerMenuInput {
  /** The stack the selected layer belongs to, as it stands; null when nothing is selected. */
  stack: readonly Layer[] | null;
  /** The selected layer's id within that stack. */
  selected: string | null;
  /** A block that takes added layers: without one, nothing can be added or pasted. */
  canAdd: boolean;
  /** A layer has been cut or copied. */
  hasCopiedLayer: boolean;
  /** A look has been copied — which may be "as the template draws it", so this is not "a look exists". */
  hasCopiedLook: boolean;
}

/**
 * What can be done, from the stack as it stands. The one place the question is
 * answered: the application menu asks it, and so does the menu below.
 */
export function layerMenuFacts(input: LayerMenuInput): LayerMenuFacts {
  const at = input.stack && input.selected !== null ? input.stack.findIndex((l) => l.id === input.selected) : -1;
  const layer = at >= 0 ? (input.stack![at] ?? null) : null;
  return {
    canAddLayer: input.canAdd,
    canEditLayer: layer !== null,
    // A layer the template marks required stays, as it does in the Parameters tab.
    canDeleteLayer: layer !== null && !layer.required,
    // The stack draws bottom first, so "forward" is later in the array.
    canLayerForward: layer !== null && at < input.stack!.length - 1,
    canLayerBackward: layer !== null && at > 0,
    canPasteLayer: input.hasCopiedLayer && input.canAdd,
    canPasteLook: input.hasCopiedLook && layer !== null,
    canResetLayer: layer !== null && hasOwnTreatment(layer),
    // What the layer itself holds: words to edit, or a picture to choose another for.
    canEditText: layer?.type === 'text',
    canReplaceImage: layer?.type === 'image',
  };
}

/** Has this layer been placed, timed, given an entrance or a look of its own? Then there is something to reset. */
export function hasOwnTreatment(layer: Layer): boolean {
  return layer.placement !== undefined || layer.span !== undefined || layer.transition !== undefined || layer.look !== undefined;
}

// ---------------------------------------------------------------- the menu

/** A library picture or clip the Add submenu can offer. */
export interface StageAsset {
  id: string;
  name: string;
  kind: 'image' | 'video';
}

/** Assets offered under "Add Asset Here": enough to reach for, few enough to read. */
export const STAGE_MENU_ASSETS = 8;

export interface StageMenuContext {
  /** Something is on the stage. Nothing shown, nothing to offer. */
  item: boolean;
  /** What is shown is a template: only a template has a stack to edit or add to. */
  template: boolean;
  /** The label of the layer under the pointer, which the edits act on; null for bare picture. */
  layerLabel: string | null;
  facts: LayerMenuFacts;
  /** Library pictures and clips, most recently used first; the Add submenu shows the first few. */
  assets: readonly StageAsset[];
  /**
   * What the window is doing with the stage, for the view items on bare
   * picture: the whole `MenuState` is not needed, only what they show.
   */
  view: Pick<MenuState, 'theater' | 'background' | 'canAddToCollection'>;
}

const sep: MenuItemSpec = { type: 'separator' };

/**
 * An item for a command both menus offer, enabled by the one flag that command
 * is always enabled by — or always, where it has none.
 */
function item(command: MenuCommand, label: string, state: MenuState): MenuItemSpec {
  const flag = SHARED_COMMAND_FLAGS[command];
  const spec: MenuItemSpec = { command, label, ...(flag ? { enabledBy: flag } : {}) };
  return { ...spec, enabled: itemEnabled(spec, state) };
}

/** The pictures and clips to add, or one line saying there are none — as Open Recent says it. */
function assetSubmenu(assets: readonly StageAsset[], state: MenuState): MenuItemSpec[] {
  const offered = assets.slice(0, STAGE_MENU_ASSETS);
  if (offered.length === 0) return [{ label: 'No pictures or clips in your library', disabled: true, enabled: false }];
  // A picture and a clip are different layers, so the asset says which; the id rides as the
  // command's argument, the way a recent project's path does.
  return offered.map((a) => ({
    ...item(a.kind === 'video' ? 'layer.addVideo' : 'layer.addImage', a.name, state),
    arg: a.id,
  }));
}

/**
 * The menu for one right-click: the layer's own edits first when the pointer is
 * on one — the specific thing before the general — then what can be added where
 * the pointer is. Returns an empty list when there is nothing to offer, and the
 * window then shows no menu rather than an empty box.
 */
export function stageMenu(context: StageMenuContext): MenuItemSpec[] {
  if (!context.item) return [];
  // `itemEnabled` and `itemChecked` read one field per item, so the facts and the view stand in
  // for the whole state; nothing here asks it for anything else.
  const state = { ...context.facts, ...context.view } as MenuState;
  const items: MenuItemSpec[] = [];
  if (context.template && context.layerLabel !== null) {
    items.push(
      // What this layer itself holds comes first: the words in a line, the picture in a picture.
      ...(state.canEditText ? [item('layer.editText', 'Edit Text', state)] : []),
      ...(state.canReplaceImage ? [item('layer.replaceImage', 'Replace Image…', state)] : []),
      ...(state.canEditText || state.canReplaceImage ? [sep] : []),
      item('layer.cut', 'Cut', state),
      item('layer.copy', 'Copy', state),
      item('layer.paste', 'Paste', state),
      item('layer.duplicate', 'Duplicate', state),
      item('layer.delete', 'Delete', state),
      sep,
      {
        label: 'Order',
        enabled: state.canLayerForward || state.canLayerBackward,
        submenu: [
          item('layer.forward', 'Bring Forward', state),
          item('layer.backward', 'Send Backward', state),
          sep,
          item('layer.front', 'Bring to Front', state),
          item('layer.back', 'Send to Back', state),
        ],
      },
      sep,
      item('layer.copyLook', 'Copy Look', state),
      item('layer.pasteLook', 'Paste Look', state),
      sep,
      item('layer.startHere', 'Start at Playhead', state),
      item('layer.endHere', 'End at Playhead', state),
      sep,
      item('layer.reset', 'Reset Layer', state),
      sep,
    );
  }
  if (context.template) {
    items.push(
      item('layer.addText', 'Add Text Here', state),
      { label: 'Add Asset Here', enabled: state.canAddLayer, submenu: assetSubmenu(context.assets, state) },
    );
    // With no layer under the pointer, Paste is the only edit that still means something.
    if (context.layerLabel === null) items.push(item('layer.paste', 'Paste', state));
  }
  // What the stage is doing with whatever is shown, offered over bare picture only: on a layer
  // the menu is already about that layer, and these belong to the picture as a whole. They are
  // here for a clip or a still too, which have no layers and so are all bare picture.
  if (context.layerLabel === null) {
    if (items.length > 0) items.push(sep);
    items.push(
      item('collection.add', 'Add to Collection', state),
      sep,
      {
        label: 'Background',
        enabled: true,
        submenu: backgroundSubmenu().map((b) => ({ ...b, enabled: true, checked: itemChecked(b, state) })),
      },
      { ...item('view.theater', 'Theater', state), type: 'checkbox', checked: state.theater },
    );
  }
  return items;
}

/** Every command this menu can name, for the test that holds it to the application menu's list. */
export function stageMenuCommands(items: readonly MenuItemSpec[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.command) out.push(item.command);
    if (item.submenu) out.push(...stageMenuCommands(item.submenu));
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------- stack edits

/** A layer id free in this stack, for one being added or pasted. */
export function freeLayerId(stack: readonly Layer[], type: LayerType): string {
  for (let n = stack.length + 1; ; n++) {
    const id = `${type}_${n}`;
    if (!stack.some((l) => l.id === id)) return id;
  }
}

/**
 * A label no other layer in the stack wears: "Title" beside a "Title" becomes
 * "Title 2". A copy that kept the name would leave two cards in the Parameters
 * tab that cannot be told apart.
 */
export function freeLayerLabel(stack: readonly Layer[], label: string): string {
  const taken = new Set(stack.map((l) => l.label));
  if (!taken.has(label)) return label;
  // "Title 2" copied again is "Title 3", not "Title 2 2".
  const base = /^(.*?)\s+(\d+)$/.exec(label);
  const stem = base ? base[1]! : label;
  for (let n = base ? Number(base[2]) + 1 : 2; ; n++) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * A layer on the clipboard, ready to go into a stack: a fresh id and a label of
 * its own, and never required — a copy of the template's own layer is the
 * person's, and can be removed again.
 */
export function pastedLayer(copied: Layer, stack: readonly Layer[]): Layer {
  return { ...copied, id: freeLayerId(stack, copied.type), label: freeLayerLabel(stack, copied.label), required: false } as Layer;
}

/** The stack with a layer put in at a position; past the end appends. */
export function insertLayer(stack: readonly Layer[], layer: Layer, at = stack.length): Layer[] {
  const next = [...stack];
  next.splice(Math.max(0, Math.min(stack.length, at)), 0, layer);
  return next;
}

/**
 * The stack with a copy of one layer right above it, so the copy is next in the
 * stack rather than exactly behind the original. It keeps the original's
 * placement: an offset is measured from where the stack puts a layer, and the
 * stack puts this one in the next slot along.
 */
export function duplicateLayer(stack: readonly Layer[], id: string): { stack: Layer[]; added: Layer } | null {
  const at = stack.findIndex((l) => l.id === id);
  if (at < 0) return null;
  const added = pastedLayer(stack[at]!, stack);
  return { stack: insertLayer(stack, added, at + 1), added };
}

/** The stack without a layer; a required one stays, as the Parameters tab keeps it. */
export function removeLayer(stack: readonly Layer[], id: string): Layer[] {
  return stack.filter((l) => l.id !== id || l.required);
}

export type LayerOrder = 'forward' | 'backward' | 'front' | 'back';

/** The stack with a layer moved along it; a move that would run off an end leaves it alone. */
export function reorderLayer(stack: readonly Layer[], id: string, where: LayerOrder): Layer[] {
  const from = stack.findIndex((l) => l.id === id);
  if (from < 0) return [...stack];
  const to = where === 'forward' ? from + 1 : where === 'backward' ? from - 1 : where === 'front' ? stack.length - 1 : 0;
  if (to === from || to < 0 || to >= stack.length) return [...stack];
  const next = [...stack];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * The layer as the template has it: what the person gave it — where they put
 * it, when it comes and goes, how it arrives, how it looks — taken off, and
 * everything that says what it *is* kept.
 */
export function resetLayer(layer: Layer): Layer {
  const next = { ...layer };
  delete next.placement;
  delete next.span;
  delete next.transition;
  delete next.look;
  return next;
}

/** What "Copy Look" puts on the clipboard: the layer's look, or nothing where it is drawn as the template draws it. */
export function copiedLook(layer: Layer): LayerLook | undefined {
  return layer.look;
}

/** The layer wearing a copied look; an undefined look puts it back to the template's own drawing. */
export function layerWithLook(layer: Layer, look: LayerLook | undefined): Layer {
  if (look === undefined) {
    const next = { ...layer };
    delete next.look;
    return next;
  }
  return { ...layer, look: { ...look } };
}

/**
 * One end of a layer's window moved to a moment of the graphic — the playhead,
 * or a dragged handle — held inside the graphic and clear of the other end.
 * `undefined` means the whole graphic, which is no span at all, so a layer
 * that ends at the end follows the length rather than being pinned to it.
 *
 * Shared by the bar under the scrub bar (src/renderer/stage-bars.ts) and by
 * the menu's Start and End at Playhead: one rule, two ways of asking.
 */
export function spanWithEnd(span: LayerSpan | undefined, which: 'start' | 'end', seconds: number, length: number): LayerSpan | undefined {
  const window = spanWindow(span, length);
  const wanted = roundSeconds(seconds);
  let { from, to } = window;
  if (which === 'start') from = Math.min(Math.max(0, wanted), Math.max(0, to - MIN_ON_SCREEN));
  else to = Math.max(Math.min(length, wanted), Math.min(length, from + MIN_ON_SCREEN));
  const next: LayerSpan = { start: roundSeconds(from), end: to >= length ? null : roundSeconds(to) };
  return isWholeGraphic(next) ? undefined : next;
}

/** The layer with a span, or with none where the span is the whole graphic. */
export function layerWithSpan(layer: Layer, span: LayerSpan | undefined): Layer {
  const next = { ...layer };
  if (span === undefined) delete next.span;
  else next.span = span;
  return next;
}

/**
 * A layer added where the pointer is. Text arrives with words in it: a layer
 * drawing nothing takes no room in the stack, so an empty one could not land
 * where it was asked for, and there would be nothing on the stage to take hold
 * of. The words are what a person types over.
 */
export const NEW_TEXT_WORDS = 'Text';

/** A fresh layer for a block, named so it reads in the stack: "Line 3", "Picture 2". */
export function addedLayer(type: LayerType, block: Pick<Block, 'typography' | 'align'>, stack: readonly Layer[], label?: string): Layer {
  // The words the Parameters tab's own Add buttons use, so a layer added there and one added
  // on the stage are named alike.
  const stem = type === 'text' ? 'Line' : type === 'video' ? 'Video' : 'Image';
  const made = newLayer(type, block, freeLayerId(stack, type), freeLayerLabel(stack, label ?? `${stem} ${stack.length + 1}`));
  return made.type === 'text' ? { ...made, text: NEW_TEXT_WORDS } : made;
}
