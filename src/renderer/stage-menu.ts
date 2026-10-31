/**
 * The stage's right-click menu in the window (milestone 39, ADR 0017): what it
 * is opened with, the clipboard behind Cut, Copy and Paste, and what each
 * layer command does.
 *
 * Every command here is one the application menu offers too (`layerSubmenu` in
 * src/core/menu.ts), and the window runs both through the one dispatcher in
 * ./menu.ts — so the Edit menu and the right-click menu are two ways of asking
 * for the same list of things. What may be offered is decided in
 * src/core/stage-menu.ts and read by both.
 *
 * Every edit goes through the Parameters tab's own layer editor
 * (./layer-edit.ts), so a cut, a duplicate or a pasted look is one undo step
 * and redraws through the one pipeline, exactly as a drag on the stage does.
 */

import { computed, signal } from '@preact/signals';
import type { LayerLook } from '../core/layer-look';
import type { Layer } from '../core/layers';
import type { MenuCommand } from '../core/menu';
import { searchPlaceable } from '../core/search';
import { framePointIn } from '../core/stage-place';
import {
  copiedLook,
  duplicateLayer,
  insertLayer,
  layerMenuFacts,
  layerWithLook,
  layerWithSpan,
  pastedLayer,
  removeLayer,
  reorderLayer,
  resetLayer,
  spanWithEnd,
  stageMenu,
  STAGE_MENU_ASSETS,
  type LayerMenuFacts,
  type LayerOrder,
  type StageAsset,
} from '../core/stage-menu';
import { runCommand } from './commands';
import { closeContextMenu, openContextMenu } from './context-menu';
import { openInspector } from './inspector-tabs';
import { layerEditor, selectedLayer } from './layer-edit';
import { placeLayerAt } from './stage-layers';
import { DEFAULT_PLAYER, STAGE_BACKGROUNDS, type StageBackground } from '../core/player';
import { appState } from './store';

interface Host {
  /** The template pixels the preview is drawn at. */
  frameSize(): { width: number; height: number };
  /** Where the playhead is, in seconds of the graphic as it is watched. */
  playheadSeconds(): number;
  /** How long the graphic runs for, in seconds; 0 when nothing is on the stage. */
  lengthSeconds(): number;
  /** The layer the pointer is over at a point on the frame, as a click would select. */
  layerAt(point: { x: number; y: number }): { block: string; id: string } | null;
  /** A template, rather than a clip or a still, is on the stage. */
  hasTemplate(): boolean;
  /** Anything at all is on the stage; nothing shown, nothing to offer. */
  hasItem(): boolean;
  /** Where a layer sits on the frame, for a menu opened from the keyboard rather than a pointer. */
  layerCentre(block: string, id: string): { x: number; y: number } | null;
  /** Say something to the person, in the stage's own note. */
  note(text: string): void;
}

let host: Host | null = null;

/**
 * What was cut or copied. A signal, so the menus follow it the moment it
 * changes: Paste is offered because there is something to paste.
 */
const clipboard = signal<{ layer: Layer; block: string } | null>(null);
/**
 * A copied look. Boxed, because "as the template draws it" is a look worth
 * copying — pasting it puts a layer back to the template's own drawing — and
 * that is `undefined`, which an unboxed value could not tell from "nothing
 * copied yet".
 */
const lookboard = signal<{ look: LayerLook | undefined } | null>(null);

/**
 * Where the menu was opened, in frame pixels: where a layer added by it lands.
 * Set only while one of the menu's own commands runs, so the same command from
 * the application menu — where there is no point — adds to the stack instead.
 */
let openedAt: { x: number; y: number } | null = null;

/**
 * What is on the clipboard, as one value to watch. The menus are rebuilt from
 * state the window reads rather than from signals they subscribe to, so this
 * is what tells them a Copy has happened and Paste can be offered.
 */
export const stageClipboard = computed(() => (clipboard.value ? 'layer' : '') + (lookboard.value ? '+look' : ''));

// ---------------------------------------------------------------- what can be done

/** The block an added or pasted layer lands in: the first that takes one. */
function openBlock(): string | null {
  return layerEditor()?.blocks().find((b) => b.open)?.id ?? null;
}

/**
 * What can be done to a layer now, for both menus. Read live rather than
 * published as state of its own: the stack lives in the Parameters tab, and a
 * second copy here would be a second thing to keep in step.
 */
export function currentLayerFacts(): LayerMenuFacts {
  const editor = layerEditor();
  const chosen = selectedLayer.value;
  // Touching the signals makes the menu follow a copy and a selection.
  const copied = clipboard.value;
  const look = lookboard.value;
  if (!editor || !host?.hasTemplate()) return layerMenuFacts({ stack: null, selected: null, canAdd: false, hasCopiedLayer: false, hasCopiedLook: false });
  return layerMenuFacts({
    stack: chosen ? (editor.stack(chosen.block) ?? null) : null,
    selected: chosen?.id ?? null,
    canAdd: openBlock() !== null,
    hasCopiedLayer: copied !== null,
    hasCopiedLook: look !== null,
  });
}

/**
 * The library's pictures and clips, most recently used first: what Add Asset
 * Here offers. Through the one `searchMedia` the choosers use (milestone 40),
 * so what is offered here and what a chooser lists are the same library asked
 * the same way.
 */
function stageAssets(): StageAsset[] {
  return searchPlaceable(appState.value.index, { recentFirst: true, limit: STAGE_MENU_ASSETS })
    .map((m) => ({ id: m.id, name: m.name, kind: m.layer }));
}

// ---------------------------------------------------------------- the commands

/** The selected layer with its stack, or null; every edit below starts here. */
function chosen(): { block: string; id: string; layer: Layer; stack: Layer[] } | null {
  const editor = layerEditor();
  const at = selectedLayer.value;
  if (!editor || !at) return null;
  const stack = editor.stack(at.block);
  const layer = stack?.find((l) => l.id === at.id);
  return stack && layer ? { block: at.block, id: at.id, layer, stack } : null;
}

function order(where: LayerOrder): void {
  const it = chosen();
  if (!it) return;
  layerEditor()!.setStack(it.block, reorderLayer(it.stack, it.id, where));
}

/** Put one end of the selected layer's window at the playhead. */
function endAtPlayhead(which: 'start' | 'end'): void {
  const it = chosen();
  const length = host?.lengthSeconds() ?? 0;
  if (!it || length <= 0) return;
  const span = spanWithEnd(it.layer.span, which, host!.playheadSeconds(), length);
  layerEditor()!.edit(it.block, it.id, (l) => layerWithSpan(l, span), true);
}

/** A layer just added: put it where the menu was opened, select it, and show its card. */
function landed(added: { block: string; id: string } | { refused: string }): void {
  if ('refused' in added) {
    host?.note(added.refused);
    return;
  }
  if (openedAt) placeLayerAt(added.block, added.id, openedAt);
  else selectedLayer.value = { block: added.block, id: added.id };
  // The words of a new line are there to be typed over, so the tab that does it comes forward.
  openInspector('parameters');
}

function paste(): void {
  const editor = layerEditor();
  const copied = clipboard.value;
  if (!editor || !copied) return;
  // Back into the block it came from while that block will still take it, so a cut and a paste
  // put a layer back where it was; otherwise the first block that takes one.
  const blocks = editor.blocks();
  const home = blocks.find((b) => b.id === copied.block && b.open)?.id ?? openBlock();
  if (!home) return;
  const stack = editor.stack(home) ?? [];
  const added = pastedLayer(copied.layer, stack);
  editor.setStack(home, insertLayer(stack, added));
  selectedLayer.value = { block: home, id: added.id };
}

/** Run one layer command. The application menu's dispatcher sends them here, and so does the menu below. */
export function runLayerCommand(command: MenuCommand, arg: string | null): void {
  const editor = layerEditor();
  if (!editor) return;
  switch (command) {
    case 'layer.addText': landed(editor.addLayer('text')); return;
    case 'layer.addImage': case 'layer.addVideo': {
      const type = command === 'layer.addVideo' ? 'video' : 'image';
      // With a library item it shows that item, named after it; with none it is a blank layer,
      // as the Parameters tab's own Add buttons make one. A Lottie is found here too, since it
      // is a template rather than media and plays as a clip (milestone 35).
      const entry = arg ? searchPlaceable(appState.value.index).find((m) => m.id === arg) : undefined;
      if (arg && !entry) return;
      landed(entry ? editor.addLayer(type, entry.name, entry.id) : editor.addLayer(type));
      return;
    }
    case 'layer.copy': {
      const it = chosen();
      if (it) clipboard.value = { layer: it.layer, block: it.block };
      return;
    }
    case 'layer.cut': {
      const it = chosen();
      if (!it || it.layer.required) return;
      clipboard.value = { layer: it.layer, block: it.block };
      selectedLayer.value = null;
      editor.setStack(it.block, removeLayer(it.stack, it.id));
      return;
    }
    case 'layer.paste': paste(); return;
    case 'layer.duplicate': {
      const it = chosen();
      const made = it ? duplicateLayer(it.stack, it.id) : null;
      if (!it || !made) return;
      editor.setStack(it.block, made.stack);
      selectedLayer.value = { block: it.block, id: made.added.id };
      return;
    }
    case 'layer.delete': {
      const it = chosen();
      if (!it || it.layer.required) return;
      selectedLayer.value = null;
      editor.setStack(it.block, removeLayer(it.stack, it.id));
      return;
    }
    case 'layer.forward': order('forward'); return;
    case 'layer.backward': order('backward'); return;
    case 'layer.front': order('front'); return;
    case 'layer.back': order('back'); return;
    case 'layer.copyLook': {
      const it = chosen();
      if (it) lookboard.value = { look: copiedLook(it.layer) };
      return;
    }
    case 'layer.pasteLook': {
      const it = chosen();
      const held = lookboard.value;
      if (!it || !held) return;
      editor.edit(it.block, it.id, (l) => layerWithLook(l, held.look), true);
      return;
    }
    case 'layer.editText': {
      const it = chosen();
      if (it?.layer.type === 'text') editor.editText(it.block, it.id);
      return;
    }
    case 'layer.replaceImage': case 'layer.replaceClip': {
      const it = chosen();
      const wants = command === 'layer.replaceClip' ? 'video' : 'image';
      if (it?.layer.type === wants) editor.choosePicture(it.block, it.id);
      return;
    }
    case 'layer.startHere': endAtPlayhead('start'); return;
    case 'layer.endHere': endAtPlayhead('end'); return;
    case 'layer.reset': {
      const it = chosen();
      if (it) editor.edit(it.block, it.id, resetLayer, true);
      return;
    }
    default: return;
  }
}

// ---------------------------------------------------------------- opening it

/** What the window is doing with the stage, for the items that belong to the picture as a whole. */
function viewFacts(): { theater: boolean; background: StageBackground; canAddToCollection: boolean } {
  const pressed = (id: string) => document.getElementById(id)?.getAttribute('aria-pressed') === 'true';
  const custom = document.getElementById('bg-custom')?.classList.contains('active');
  return {
    theater: pressed('theater'),
    background: custom ? 'custom' : (STAGE_BACKGROUNDS.find((b) => pressed(`bg-${b.id}`))?.id ?? DEFAULT_PLAYER.background),
    canAddToCollection: (document.getElementById('add-to-collection') as HTMLButtonElement | null)?.disabled === false,
  };
}

/**
 * Open the menu at a point on screen, for the layer at `point` on the frame.
 * The layer there is selected first, exactly as a left-click would select it,
 * so the menu's edits act on what was pointed at; nothing there clears the
 * selection, and the menu then offers what can be added and what the stage is
 * doing with the picture as a whole.
 */
function openAt(client: { x: number; y: number }, point: { x: number; y: number } | null, hit: { block: string; id: string } | null): void {
  if (!host) return;
  selectedLayer.value = hit;
  const label = hit ? (layerEditor()?.get(hit.block, hit.id)?.label ?? null) : null;
  const items = stageMenu({
    item: host.hasItem(),
    template: host.hasTemplate(),
    layerLabel: label,
    facts: currentLayerFacts(),
    assets: stageAssets(),
    view: viewFacts(),
  });
  openContextMenu({
    x: client.x,
    y: client.y,
    items,
    // Through the window's one dispatcher, so a command does here exactly what the application
    // menu's item for it does. The point belongs to this menu and to nothing else: it is in hand
    // while the command runs and gone again afterwards, so the Edit menu's Add still adds to the
    // stack rather than to wherever the stage was last right-clicked.
    run: (command, arg) => {
      openedAt = point;
      try {
        runCommand(command, arg);
      } finally {
        openedAt = null;
      }
    },
  });
}

function onContextMenu(el: HTMLElement, e: MouseEvent): void {
  if (!host) return;
  e.preventDefault();
  if (!host.hasItem()) {
    closeContextMenu();
    return;
  }
  const point = framePointIn(el.getBoundingClientRect(), host.frameSize(), { x: e.clientX, y: e.clientY });
  openAt({ x: e.clientX, y: e.clientY }, point, host.hasTemplate() ? host.layerAt(point) : null);
}

/**
 * The menu from the keyboard (milestone 39): Shift+F10 and the Menu key, which
 * is what every platform's own menus answer to. It opens on the **selected**
 * layer — at the middle of what that layer draws, so the menu appears beside
 * the thing it is about — or at the middle of the picture when nothing is
 * selected, which is the menu for bare picture.
 */
function onMenuKey(el: HTMLElement): void {
  if (!host || !host.hasItem()) return;
  const box = el.getBoundingClientRect();
  if (box.width < 1) return;
  const size = host.frameSize();
  const chosen = host.hasTemplate() ? selectedLayer.value : null;
  // Where the layer is drawn, when the frame in hand says; the middle of the picture otherwise —
  // a layer not drawn at this moment is still the selected layer, and the menu is still its own.
  const centre = chosen ? host.layerCentre(chosen.block, chosen.id) : null;
  const point = centre ?? { x: size.width / 2, y: size.height / 2 };
  // The frame point back to the screen, through the picture's own box.
  const client = { x: box.left + (point.x / size.width) * box.width, y: box.top + (point.y / size.height) * box.height };
  openAt(client, point, chosen);
}

/** Is this the key that asks for a context menu? Shift+F10 everywhere, and the key named for it. */
function isMenuKey(e: KeyboardEvent): boolean {
  if (e.key === 'ContextMenu') return true;
  return e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

export function mountStageMenu(el: HTMLElement, stageHost: Host): void {
  host = stageHost;
  el.addEventListener('contextmenu', (e) => onContextMenu(el, e));
  // On the picture rather than on the window: the keys belong to the stage, and a text field
  // elsewhere with the caret in it must keep its own menu key.
  el.addEventListener('keydown', (e) => {
    if (!isMenuKey(e)) return;
    e.preventDefault();
    onMenuKey(el);
  });
}
