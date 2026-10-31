import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, type LayerLook } from '../src/core/layer-look';
import { DEFAULT_TYPOGRAPHY, newLayer, type Block, type Layer } from '../src/core/layers';
import { buildMenu, EMPTY_MENU_STATE, itemEnabled, LAYER_COMMAND_FLAGS, layerSubmenu, type MenuItemSpec, type MenuState } from '../src/core/menu';
import {
  addedLayer,
  copiedLook,
  duplicateLayer,
  freeLayerId,
  freeLayerLabel,
  hasOwnTreatment,
  insertLayer,
  layerMenuFacts,
  layerWithLook,
  layerWithSpan,
  NEW_TEXT_WORDS,
  NO_LAYER_FACTS,
  pastedLayer,
  removeLayer,
  reorderLayer,
  resetLayer,
  spanWithEnd,
  stageMenu,
  stageMenuCommands,
  STAGE_MENU_ASSETS,
  type LayerMenuFacts,
  type StageAsset,
} from '../src/core/stage-menu';

const BLOCK: Pick<Block, 'typography' | 'align'> = { typography: DEFAULT_TYPOGRAPHY, align: 'center' };

function text(id: string, over: Partial<Layer> = {}): Layer {
  return { ...(newLayer('text', BLOCK, id, id) as Layer), ...over } as Layer;
}

const stackOf = (...ids: string[]): Layer[] => ids.map((id) => text(id));

const facts = (over: Partial<LayerMenuFacts> = {}): LayerMenuFacts => ({ ...NO_LAYER_FACTS, ...over });

/** Every item of a menu, submenus flattened in. */
function every(items: readonly MenuItemSpec[]): MenuItemSpec[] {
  return items.flatMap((i) => [i, ...every(i.submenu ?? [])]);
}
const labels = (items: readonly MenuItemSpec[]) => items.filter((i) => i.type !== 'separator').map((i) => i.label);
const byLabel = (items: readonly MenuItemSpec[], label: string) => every(items).find((i) => i.label === label);

describe('what can be done to a layer', () => {
  it('answers from the stack as it stands', () => {
    const stack = stackOf('a', 'b', 'c');
    const middle = layerMenuFacts({ stack, selected: 'b', canAdd: true, hasCopiedLayer: false, hasCopiedLook: false });
    expect(middle).toEqual(facts({ canAddLayer: true, canEditLayer: true, canDeleteLayer: true, canLayerForward: true, canLayerBackward: true }));
    // The stack draws bottom first, so the last is at the front and cannot go further.
    expect(layerMenuFacts({ stack, selected: 'c', canAdd: true, hasCopiedLayer: false, hasCopiedLook: false })).toMatchObject({ canLayerForward: false, canLayerBackward: true });
    expect(layerMenuFacts({ stack, selected: 'a', canAdd: true, hasCopiedLayer: false, hasCopiedLook: false })).toMatchObject({ canLayerForward: true, canLayerBackward: false });
  });

  it('keeps a required layer, and offers nothing at all with no template', () => {
    const stack = [text('a', { required: true }), text('b')];
    expect(layerMenuFacts({ stack, selected: 'a', canAdd: true, hasCopiedLayer: false, hasCopiedLook: false })).toMatchObject({ canEditLayer: true, canDeleteLayer: false });
    expect(layerMenuFacts({ stack: null, selected: null, canAdd: false, hasCopiedLayer: true, hasCopiedLook: true })).toEqual(NO_LAYER_FACTS);
  });

  it('offers Paste only where something can hold it, and Paste Look only onto a layer', () => {
    const stack = stackOf('a');
    // Something copied, but the template takes no added layers: there is nowhere to put it.
    expect(layerMenuFacts({ stack, selected: 'a', canAdd: false, hasCopiedLayer: true, hasCopiedLook: true })).toMatchObject({ canPasteLayer: false, canPasteLook: true });
    expect(layerMenuFacts({ stack, selected: 'a', canAdd: true, hasCopiedLayer: true, hasCopiedLook: false })).toMatchObject({ canPasteLayer: true, canPasteLook: false });
    // A look copied but nothing selected: nothing to put it on.
    expect(layerMenuFacts({ stack, selected: null, canAdd: true, hasCopiedLayer: true, hasCopiedLook: true })).toMatchObject({ canPasteLayer: true, canPasteLook: false });
  });

  it('offers Reset only where the person has given the layer something of its own', () => {
    const plain = stackOf('a');
    expect(layerMenuFacts({ stack: plain, selected: 'a', canAdd: true, hasCopiedLayer: false, hasCopiedLook: false }).canResetLayer).toBe(false);
    for (const over of [
      { placement: { '16:9': { dx: 0.1, dy: 0, scale: 1, rotate: 0 } } },
      { span: { start: 1, end: null } },
      { look: { ...DEFAULT_LOOK, opacity: 0.5 } },
      { transition: { in: { type: 'fade' as const, seconds: 0.5, direction: 'auto' as const }, out: { type: 'template' as const, seconds: 0.5, direction: 'auto' as const } } },
    ]) {
      const stack = [text('a', over as Partial<Layer>)];
      expect(hasOwnTreatment(stack[0]!), JSON.stringify(Object.keys(over))).toBe(true);
      expect(layerMenuFacts({ stack, selected: 'a', canAdd: true, hasCopiedLayer: false, hasCopiedLook: false }).canResetLayer).toBe(true);
    }
  });
});

describe('the menu itself', () => {
  const assets: StageAsset[] = [
    { id: 'i1', name: 'Logo', kind: 'image' },
    { id: 'v1', name: 'Fire', kind: 'video' },
  ];
  const onLayer = stageMenu({
    template: true,
    layerLabel: 'Title',
    facts: facts({ canAddLayer: true, canEditLayer: true, canDeleteLayer: true, canLayerForward: true, canLayerBackward: true, canResetLayer: true }),
    assets,
  });

  it('offers the layer\'s own edits first, then what can be added where the pointer is', () => {
    expect(labels(onLayer)).toEqual([
      'Cut', 'Copy', 'Paste', 'Duplicate', 'Delete',
      'Order',
      'Copy Look', 'Paste Look',
      'Start at Playhead', 'End at Playhead',
      'Reset Layer',
      'Add Text Here', 'Add Asset Here',
    ]);
    expect(labels(byLabel(onLayer, 'Order')!.submenu!)).toEqual(['Bring Forward', 'Send Backward', 'Bring to Front', 'Send to Back']);
  });

  it('offers only what can be added over bare picture, with Paste the one edit that still means something', () => {
    const empty = stageMenu({ template: true, layerLabel: null, facts: facts({ canAddLayer: true, canPasteLayer: true }), assets });
    expect(labels(empty)).toEqual(['Add Text Here', 'Add Asset Here', 'Paste']);
    expect(byLabel(empty, 'Paste')!.enabled).toBe(true);
  });

  it('shows nothing at all when the stage holds no template', () => {
    expect(stageMenu({ template: false, layerLabel: 'Title', facts: facts({ canEditLayer: true }), assets })).toEqual([]);
  });

  it('greys out exactly what cannot act', () => {
    const atTheFront = stageMenu({
      template: true,
      layerLabel: 'Title',
      facts: facts({ canAddLayer: true, canEditLayer: true, canLayerBackward: true }),
      assets,
    });
    // A required layer at the front of its stack: it can be copied, not cut, and not sent forward.
    expect(byLabel(atTheFront, 'Copy')!.enabled).toBe(true);
    expect(byLabel(atTheFront, 'Cut')!.enabled).toBe(false);
    expect(byLabel(atTheFront, 'Delete')!.enabled).toBe(false);
    expect(byLabel(atTheFront, 'Bring Forward')!.enabled).toBe(false);
    expect(byLabel(atTheFront, 'Send Backward')!.enabled).toBe(true);
    expect(byLabel(atTheFront, 'Reset Layer')!.enabled).toBe(false);
    expect(byLabel(atTheFront, 'Paste Look')!.enabled).toBe(false);
    // The Order submenu itself is dead only when neither way is open.
    expect(byLabel(atTheFront, 'Order')!.enabled).toBe(true);
    const stuck = stageMenu({ template: true, layerLabel: 'Only', facts: facts({ canEditLayer: true }), assets });
    expect(byLabel(stuck, 'Order')!.enabled).toBe(false);
  });

  it('lists the assets it is given, each carrying its own library id, and says plainly when there are none', () => {
    const submenu = byLabel(onLayer, 'Add Asset Here')!.submenu!;
    // A picture and a clip are different layers, and the id rides as the command's argument.
    expect(submenu.map((i) => [i.label, i.command, i.arg])).toEqual([
      ['Logo', 'layer.addImage', 'i1'],
      ['Fire', 'layer.addVideo', 'v1'],
    ]);
    const none = stageMenu({ template: true, layerLabel: null, facts: facts({ canAddLayer: true }), assets: [] });
    const empty = byLabel(none, 'Add Asset Here')!.submenu!;
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({ label: 'No pictures or clips in your library', enabled: false });
    // However many the library holds, the submenu stays readable.
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, name: `Still ${i}`, kind: 'image' as const }));
    const capped = stageMenu({ template: true, layerLabel: null, facts: facts({ canAddLayer: true }), assets: many });
    expect(byLabel(capped, 'Add Asset Here')!.submenu).toHaveLength(STAGE_MENU_ASSETS);
  });
});

describe('one command list with the application menu', () => {
  const everyStageCommand = () => {
    const all = new Set<string>();
    for (const layerLabel of ['Title', null]) {
      for (const f of [NO_LAYER_FACTS, facts({ canAddLayer: true, canEditLayer: true, canDeleteLayer: true, canLayerForward: true, canLayerBackward: true, canPasteLayer: true, canPasteLook: true, canResetLayer: true })]) {
        const assets: StageAsset[] = [{ id: 'i1', name: 'Logo', kind: 'image' }, { id: 'v1', name: 'Fire', kind: 'video' }];
        for (const c of stageMenuCommands(stageMenu({ template: true, layerLabel, facts: f, assets }))) all.add(c);
      }
    }
    return [...all];
  };

  it('names only commands the application menu also offers', () => {
    const appCommands = new Set(
      buildMenu({ mac: false, development: false, appName: 'Pulp', state: EMPTY_MENU_STATE })
        .flatMap((s) => every(s.items))
        .map((i) => i.command)
        .filter(Boolean),
    );
    for (const command of everyStageCommand()) {
      expect(appCommands.has(command as never), `${command} is on the stage menu but not in the application menu`).toBe(true);
    }
  });

  it('enables each command by the same flag on both surfaces', () => {
    const submenu = every(layerSubmenu());
    for (const item of submenu) {
      if (!item.command) continue;
      expect(item.enabledBy, `${item.command} in the Edit menu`).toBe(LAYER_COMMAND_FLAGS[item.command]);
    }
    // And the stage's items were built from the same table, so the two agree item by item.
    const on: MenuState = { ...EMPTY_MENU_STATE, canAddLayer: true, canEditLayer: true, canDeleteLayer: true, canLayerForward: true, canPasteLayer: true };
    const stage = every(stageMenu({ template: true, layerLabel: 'Title', facts: on, assets: [] }));
    for (const item of stage) {
      if (!item.command) continue;
      const inApp = submenu.find((i) => i.command === item.command);
      if (!inApp) continue;
      expect(item.enabled, `${item.command} is enabled differently on the two menus`).toBe(itemEnabled(inApp, on));
    }
  });

  it('covers every layer command the application menu has, so nothing is unreachable from the stage', () => {
    const stage = new Set(everyStageCommand());
    for (const item of every(layerSubmenu())) {
      if (!item.command) continue;
      expect(stage.has(item.command), `${item.command} is in the Edit menu but nowhere on the stage`).toBe(true);
    }
  });
});

describe('the stack edits', () => {
  it('finds a free id and a label no other layer wears', () => {
    const stack = stackOf('text_1', 'text_2');
    expect(freeLayerId(stack, 'text')).toBe('text_3');
    expect(freeLayerId([], 'image')).toBe('image_1');
    const named = [text('a', { label: 'Title' }), text('b', { label: 'Title 2' })];
    expect(freeLayerLabel(named, 'Subtitle')).toBe('Subtitle');
    expect(freeLayerLabel(named, 'Title')).toBe('Title 3');
    // A copy of a copy counts on rather than stacking numbers: "Title 2 2" is nobody's idea of a name.
    expect(freeLayerLabel(named, 'Title 2')).toBe('Title 3');
  });

  it('pastes a copy as the person\'s own, with a name of its own', () => {
    const stack = [text('text_1', { label: 'Title', required: true })];
    const pasted = pastedLayer(stack[0]!, stack);
    expect(pasted).toMatchObject({ id: 'text_2', label: 'Title 2', required: false });
    expect(insertLayer(stack, pasted).map((l) => l.id)).toEqual(['text_1', 'text_2']);
    expect(insertLayer(stack, pasted, 0).map((l) => l.id)).toEqual(['text_2', 'text_1']);
  });

  it('duplicates a layer into the next slot along, keeping everything else about it', () => {
    const stack = [text('a', { label: 'A', look: { ...DEFAULT_LOOK, opacity: 0.4 } }), text('b', { label: 'B' })];
    const made = duplicateLayer(stack, 'a')!;
    expect(made.stack.map((l) => l.id)).toEqual(['a', made.added.id, 'b']);
    expect(made.added.label).toBe('A 2');
    expect(made.added.look).toEqual({ ...DEFAULT_LOOK, opacity: 0.4 });
    expect(duplicateLayer(stack, 'nope')).toBeNull();
  });

  it('removes a layer, but never a required one', () => {
    const stack = [text('a', { required: true }), text('b')];
    expect(removeLayer(stack, 'b').map((l) => l.id)).toEqual(['a']);
    expect(removeLayer(stack, 'a').map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('moves a layer along the stack, and leaves it alone at the ends', () => {
    const stack = stackOf('a', 'b', 'c');
    const ids = (next: Layer[]) => next.map((l) => l.id);
    expect(ids(reorderLayer(stack, 'a', 'forward'))).toEqual(['b', 'a', 'c']);
    expect(ids(reorderLayer(stack, 'c', 'backward'))).toEqual(['a', 'c', 'b']);
    expect(ids(reorderLayer(stack, 'a', 'front'))).toEqual(['b', 'c', 'a']);
    expect(ids(reorderLayer(stack, 'c', 'back'))).toEqual(['c', 'a', 'b']);
    expect(ids(reorderLayer(stack, 'c', 'forward'))).toEqual(['a', 'b', 'c']);
    expect(ids(reorderLayer(stack, 'a', 'backward'))).toEqual(['a', 'b', 'c']);
    expect(ids(reorderLayer(stack, 'nope', 'front'))).toEqual(['a', 'b', 'c']);
  });

  it('resets what the person gave a layer and keeps what it is', () => {
    const dressed = text('a', {
      label: 'Title',
      text: 'Hello',
      placement: { '16:9': { dx: 0.2, dy: 0, scale: 2, rotate: 10 } },
      span: { start: 1, end: 3 },
      look: { ...DEFAULT_LOOK, blur: 0.02 },
      transition: { in: { type: 'fade', seconds: 0.5, direction: 'auto' }, out: { type: 'template', seconds: 0.5, direction: 'auto' } },
    } as Partial<Layer>);
    const plain = resetLayer(dressed);
    expect(plain).toMatchObject({ id: 'a', label: 'Title', text: 'Hello', type: 'text' });
    expect(hasOwnTreatment(plain)).toBe(false);
    // The original is untouched: every edit hands back a new layer.
    expect(hasOwnTreatment(dressed)).toBe(true);
  });

  it('copies a look, and pasting none puts a layer back to the template\'s own drawing', () => {
    const look: LayerLook = { ...DEFAULT_LOOK, glowSize: 0.03 };
    const dressed = text('a', { look } as Partial<Layer>);
    expect(copiedLook(dressed)).toEqual(look);
    expect(copiedLook(text('b'))).toBeUndefined();
    const onto = layerWithLook(text('b'), copiedLook(dressed));
    expect(onto.look).toEqual(look);
    // A copied look is a copy: changing the source afterwards cannot reach into the layer.
    expect(onto.look).not.toBe(dressed.look);
    expect(layerWithLook(onto, undefined).look).toBeUndefined();
  });
});

describe('an end at the playhead', () => {
  it('puts one end where the playhead is and leaves the other', () => {
    expect(spanWithEnd(undefined, 'start', 2, 6)).toEqual({ start: 2, end: null });
    expect(spanWithEnd(undefined, 'end', 4, 6)).toEqual({ start: 0, end: 4 });
    expect(spanWithEnd({ start: 1, end: 5 }, 'start', 2, 6)).toEqual({ start: 2, end: 5 });
    expect(spanWithEnd({ start: 1, end: 5 }, 'end', 3, 6)).toEqual({ start: 1, end: 3 });
  });

  it('keeps the ends apart and inside the graphic', () => {
    // A start dragged past the end stops just short of it, and never goes below zero.
    expect(spanWithEnd({ start: 1, end: 3 }, 'start', 9, 6)!.start).toBeCloseTo(2.95, 2);
    expect(spanWithEnd({ start: 1, end: 3 }, 'start', -4, 6)).toEqual({ start: 0, end: 3 });
    expect(spanWithEnd({ start: 2, end: 4 }, 'end', 0, 6)!.end).toBeCloseTo(2.05, 2);
  });

  it('is no span at all when it comes to the whole graphic, so the layer follows the length', () => {
    // An end at the graphic's end is not a layer pinned to six seconds; it is a layer that runs to the end.
    expect(spanWithEnd({ start: 0, end: 3 }, 'end', 6, 6)).toBeUndefined();
    expect(spanWithEnd({ start: 2, end: null }, 'start', 0, 6)).toBeUndefined();
    const layer = layerWithSpan(text('a', { span: { start: 1, end: 2 } } as Partial<Layer>), undefined);
    expect(layer.span).toBeUndefined();
    expect(layerWithSpan(text('a'), { start: 1, end: null }).span).toEqual({ start: 1, end: null });
  });
});

describe('a layer added where the pointer is', () => {
  it('arrives with words in it, since a layer drawing nothing could not land anywhere', () => {
    const made = addedLayer('text', BLOCK, []);
    expect(made).toMatchObject({ type: 'text', text: NEW_TEXT_WORDS, label: 'Line 1', required: false });
    expect(NEW_TEXT_WORDS.trim()).not.toBe('');
  });

  it('names a layer as the Parameters tab\'s own Add buttons do, and never twice the same', () => {
    const stack = [addedLayer('image', BLOCK, [])];
    expect(stack[0]!.label).toBe('Image 1');
    const second = addedLayer('image', BLOCK, stack);
    expect(second.label).toBe('Image 2');
    expect(second.id).not.toBe(stack[0]!.id);
    expect(addedLayer('video', BLOCK, []).label).toBe('Video 1');
    // A name given — a library item dropped or chosen — is kept, made unique where it clashes.
    expect(addedLayer('image', BLOCK, [], 'Logo').label).toBe('Logo');
    expect(addedLayer('image', BLOCK, [addedLayer('image', BLOCK, [], 'Logo')], 'Logo').label).toBe('Logo 2');
  });
});
