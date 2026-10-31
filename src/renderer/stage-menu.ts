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
import { closeContextMenu, openContextMenu } from './context-menu';
import { openInspector } from './inspector-tabs';
import { layerEditor, selectedLayer } from './layer-edit';
import { placeLayerAt } from './stage-layers';
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

/** The library's pictures and clips, most recently used first: what Add Asset Here offers. */
function stageAssets(): StageAsset[] {
  const media = appState.value.index?.media ?? [];
  return media
    .filter((m) => !m.offline && (m.mediaKind === 'image' || m.mediaKind === 'video'))
    .sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') || a.name.localeCompare(b.name))
    .slice(0, STAGE_MENU_ASSETS)
    .map((m) => ({ id: m.id, name: m.name, kind: m.mediaKind === 'video' ? 'video' : 'image' }));
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
      // as the Parameters tab's own Add buttons make one.
      const entry = arg ? appState.value.index?.media.find((m) => m.id === arg) : undefined;
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

/**
 * Right-clicking the picture opens the menu where the pointer is. The layer
 * under the pointer is selected first, exactly as a left-click would select
 * it, so the menu's edits act on what was pointed at; right-clicking bare
 * picture clears the selection, and the menu then offers only what can be
 * added there.
 */
function onContextMenu(el: HTMLElement, e: MouseEvent): void {
  if (!host) return;
  e.preventDefault();
  if (!host.hasTemplate()) {
    closeContextMenu();
    return;
  }
  const point = framePointIn(el.getBoundingClientRect(), host.frameSize(), { x: e.clientX, y: e.clientY });
  const hit = host.layerAt(point);
  selectedLayer.value = hit;
  const facts = currentLayerFacts();
  const label = hit ? (layerEditor()?.get(hit.block, hit.id)?.label ?? null) : null;
  const items = stageMenu({ template: true, layerLabel: label, facts, assets: stageAssets() });
  openContextMenu({
    x: e.clientX,
    y: e.clientY,
    items,
    // The point belongs to this menu and to nothing else: it is in hand while the command
    // runs and gone again afterwards, so the Edit menu's Add still adds to the stack.
    run: (command, arg) => {
      openedAt = point;
      try {
        runLayerCommand(command, arg);
      } finally {
        openedAt = null;
      }
    },
  });
}

export function mountStageMenu(el: HTMLElement, stageHost: Host): void {
  host = stageHost;
  el.addEventListener('contextmenu', (e) => onContextMenu(el, e));
}
