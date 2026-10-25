/**
 * What the Parameters tab is divided into (milestone 23): one card per **part
 * of the graphic**, not one group per kind of setting.
 *
 * A flat "Colors" group stopped saying anything once the words became layers:
 * "Text color" — which text? — and "Panel color" sat away from everything else
 * about the panel. A template now says which element each parameter belongs to
 * (`element`), its layers are each a part in their own right, and everything
 * about one part is in one place: the panel's two colours together, a line's
 * words with its own type and colour, the logo's well with its treatment.
 *
 * Pure: the renderer turns these cards into elements.
 */

import type { Block, Layer, LayerValues } from './layers';
import type { TemplateManifest, TemplateParameter } from './manifest';

/** The heading over the settings that belong to no one part: position, timing, duration. */
export const REST_CARD_LABEL = 'Layout and timing';

export type ParamCardKind = 'layer' | 'element' | 'rest';

export interface ParamCard {
  /** Stable across rebuilds, so a card stays open: `layer:<block>.<layer>`, `element:<label>`, or `rest`. */
  id: string;
  /** The heading. Empty for the rest of a template that names no elements at all: it is then just a form. */
  label: string;
  kind: ParamCardKind;
  /** The layer this card is, when it is one. */
  layer?: { block: string; layer: Layer; index: number; count: number };
  /** The parameters that belong here, in the order the template declares them. */
  params: TemplateParameter[];
}

const key = (label: string): string => label.trim().toLowerCase();

/**
 * The cards for a template and the layers as they stand.
 *
 * Content first: a card per layer, in block and stack order, since the layers
 * are what the graphic says. Then a card per element the parameters name, in
 * the order they are declared. Then what is left, under "Layout and timing" —
 * or, for a template that names no elements and has no layers, as a plain form
 * with no heading, which is what every template looked like before this.
 *
 * A parameter whose `element` matches a layer's label joins that layer's card,
 * so an author can put a slot's picker beside the words it sits with.
 *
 * A parameter may also name "Layout and timing" itself, which most bundled
 * templates do to say plainly where a setting goes. That names the last card,
 * not a part of the graphic, so it joins the rest and stays at the end: an
 * element declared after it — a slot's card, say — still comes before it.
 */
export function paramCards(manifest: Pick<TemplateManifest, 'parameters' | 'blocks'>, layers: LayerValues): ParamCard[] {
  const cards: ParamCard[] = [];
  const byKey = new Map<string, ParamCard>();

  for (const block of manifest.blocks as readonly Block[]) {
    const stack = layers[block.id] ?? block.layers;
    stack.forEach((layer, index) => {
      const card: ParamCard = {
        id: `layer:${block.id}.${layer.id}`,
        label: layer.label,
        kind: 'layer',
        layer: { block: block.id, layer, index, count: stack.length },
        params: [],
      };
      cards.push(card);
      // First layer of that name wins the name; a second keeps its own card, unjoinable by a parameter.
      if (!byKey.has(key(layer.label))) byKey.set(key(layer.label), card);
    });
  }

  const rest: ParamCard = { id: 'rest', label: REST_CARD_LABEL, kind: 'rest', params: [] };
  // Unless a layer is already called that, in which case the layer keeps the name.
  if (!byKey.has(key(REST_CARD_LABEL))) byKey.set(key(REST_CARD_LABEL), rest);

  for (const param of manifest.parameters) {
    const element = param.element?.trim();
    if (!element) {
      rest.params.push(param);
      continue;
    }
    let card = byKey.get(key(element));
    if (!card) {
      card = { id: `element:${element}`, label: element, kind: 'element', params: [] };
      byKey.set(key(element), card);
      cards.push(card);
    }
    card.params.push(param);
  }

  if (rest.params.length > 0) {
    // Nothing else to show: the template names no elements, so this is simply its form, unheaded.
    if (cards.length === 0) rest.label = '';
    cards.push(rest);
  }
  return cards;
}

/** True when the tab shows cards rather than one plain form. */
export function hasCards(cards: readonly ParamCard[]): boolean {
  return cards.some((c) => c.kind !== 'rest');
}

/**
 * Whether a field's label would only repeat the heading it sits under —
 * "Logo" inside the Logo card, "Panel" inside Panel. A repeat is noise, so the
 * tab leaves such a label unseen and keeps it as the field's accessible name
 * (docs/ui-style.md). Case and surrounding space do not make two labels differ.
 */
export function labelRepeatsHeading(label: string, heading: string | undefined): boolean {
  if (!heading) return false;
  return label.trim().toLowerCase() === heading.trim().toLowerCase();
}
