/**
 * Saving the canvas as a template folder (milestone 55's fifth piece). What
 * was composed on the blank canvas — the layer stacks, the picked parameters,
 * the chosen length — becomes a folder in the open format: a `template.json`
 * that passes the JSON Schema, and an `index.html` that lays the one block out
 * and draws it, with each picked parameter written onto the layer property it
 * was picked from. A template made here is a template like any other:
 * reopened for editing from the library, editable by hand afterwards, rendered
 * and packed as the bundled ones are.
 *
 * One rule shapes what travels: **a template never ships a library id**
 * (ADR 0013). A picture, a clip or a sound chosen from this machine's library
 * stays behind — the layer is saved empty, for the next person to fill — and
 * the save says so rather than quietly dropping anything.
 *
 * Pure: the files as strings, the notes about what could not travel, and the
 * names. The main process holds the dialog and the disk.
 */

import { exposableProps, type ExposedParam } from './expose';
import type { LayerKey } from './layer-keys';
import type { LayerTransition, LayerTransitions } from './layer-time';
import type { Layer, LayerValues } from './layers';
import { pruneExpose } from './expose';
import type { TemplateManifest, TemplateParameter } from './manifest';
import { slug } from './pack';

export interface CanvasSaveInput {
  /** What the template is called: the folder name the person chose. */
  name: string;
  /** The composed stacks, as the editor holds them. */
  layers: LayerValues;
  /** The picked parameters (milestone 55's second piece); the dead ones are pruned here. */
  expose: readonly ExposedParam[];
  /** How long the graphic runs now: the saved template's own duration. */
  length: number;
  /** The canvas the composition was made on: its block, aspects, fps and alpha are the saved template's. */
  canvas: TemplateManifest;
}

export interface CanvasTemplateFiles {
  /** The folder-safe name, and the manifest id it makes: custom.<slug>. */
  folder: string;
  templateId: string;
  /** template.json, pretty-printed, and the generated page. */
  manifest: string;
  page: string;
  /** What could not travel, said plainly: library-chosen pictures, clips, sounds. */
  notes: string[];
}

const round = (n: number, places = 4): number => Math.round(n * 10 ** places) / 10 ** places;

function transitionJson(t: LayerTransition): Record<string, unknown> {
  return { type: t.type, seconds: round(t.seconds), direction: t.direction };
}

function transitionsJson(t: LayerTransitions): Record<string, unknown> {
  return { in: transitionJson(t.in), out: transitionJson(t.out) };
}

function keyJson(k: LayerKey): Record<string, unknown> {
  return {
    at: round(k.at), dx: round(k.dx), dy: round(k.dy), scale: round(k.scale), rotate: round(k.rotate), opacity: round(k.opacity),
    easing: k.easing, ...(k.easing === 'curve' && k.curve ? { curve: k.curve.map((c) => round(c)) } : {}),
  };
}

/** One layer as the manifest declares it: everything it carries, less the library ids a template cannot ship. */
function layerJson(layer: Layer, notes: string[]): Record<string, unknown> {
  const common: Record<string, unknown> = {
    id: layer.id,
    label: layer.label,
    type: layer.type,
    ...(layer.required ? { required: true } : {}),
    ...(layer.hidden ? { hidden: true } : {}),
    ...(layer.spaceBefore ? { spaceBefore: round(layer.spaceBefore) } : {}),
    ...(layer.transition ? { transition: transitionsJson(layer.transition) } : {}),
    ...(layer.span ? { span: { ...(layer.span.start !== undefined ? { start: round(layer.span.start) } : {}), ...(layer.span.end !== undefined ? { end: layer.span.end === null ? null : round(layer.span.end) } : {}) } } : {}),
    ...(layer.look ? { look: { ...layer.look } } : {}),
    ...(layer.keys && layer.keys.length > 0 ? { keys: layer.keys.map(keyJson) } : {}),
    ...(layer.placement && Object.keys(layer.placement).length > 0
      ? { placement: Object.fromEntries(Object.entries(layer.placement).map(([aspect, p]) => [aspect, { dx: round(p.dx), dy: round(p.dy), scale: round(p.scale), rotate: round(p.rotate) }])) }
      : {}),
  };
  if (layer.type === 'text') {
    return {
      ...common, text: layer.text, maxLines: layer.maxLines,
      family: layer.family, size: round(layer.size), weight: layer.weight, italic: layer.italic, case: layer.case,
      letterSpacing: round(layer.letterSpacing), kerning: layer.kerning, lineHeight: round(layer.lineHeight),
      color: layer.color, align: layer.align, overflow: layer.overflow,
    };
  }
  if (layer.type === 'shape') {
    return { ...common, shape: layer.shape, color: layer.color, size: round(layer.size), ratio: round(layer.ratio), align: layer.align };
  }
  if (layer.type === 'audio') {
    if (layer.sound) notes.push(`${layer.label}: its sound stays behind — a template never ships a library id. The layer is saved silent, for the next person to fill.`);
    return common;
  }
  const chosen = layer.type === 'image' ? layer.image : layer.clip;
  if (chosen) {
    const what = layer.type === 'image' ? 'picture' : 'clip';
    notes.push(`${layer.label}: its ${what} stays behind — a template never ships a library id. The layer is saved empty, for the next person to fill.`);
  }
  return { ...common, size: round(layer.size), align: layer.align };
}

/** The picked parameters as the manifest declares them, each defaulting to the value it was picked at. */
function parameterJson(exposure: ExposedParam, layer: Layer, notes: string[]): TemplateParameter | null {
  if (exposure.prop === 'text' && layer.type === 'text') {
    return { id: exposure.id, type: 'text', label: exposure.label, default: layer.text, element: layer.label } as TemplateParameter;
  }
  if (exposure.prop === 'color' && (layer.type === 'text' || layer.type === 'shape')) {
    return { id: exposure.id, type: 'color', label: exposure.label, default: layer.color, element: layer.label } as TemplateParameter;
  }
  if (exposure.prop === 'image') {
    notes.push(`${exposure.label}: a picture parameter cannot travel yet — the saved layer takes its picture at use time instead.`);
  }
  return null;
}

/** The generated page: the canvas block laid out and drawn, the picked parameters written onto their layers first. */
function pageFor(name: string, blockId: string, picks: readonly { layer: string; field: 'text' | 'color'; param: string }[]): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
  // Made with Pulp's template editor (milestone 55). The composition is the
  // manifest's own block and layers; this page lays them out and draws them,
  // and writes each parameter onto the layer property it was picked from.
  // Edit template.json by hand as you like: this page only draws what it says.
  'use strict';
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var PICKS = ${JSON.stringify(picks)};

  window.pulpRender = function (state) {
    if (canvas.width !== state.width || canvas.height !== state.height) {
      canvas.width = state.width;
      canvas.height = state.height;
    }
    ctx.clearRect(0, 0, state.width, state.height);
    var block = state.blocks && state.blocks[${JSON.stringify(blockId)}];
    if (block && block.layers && state.params) {
      for (var i = 0; i < PICKS.length; i++) {
        var pick = PICKS[i];
        var value = state.params[pick.param];
        if (value === undefined) continue;
        for (var j = 0; j < block.layers.length; j++) {
          if (block.layers[j].id === pick.layer) { block.layers[j][pick.field] = value; break; }
        }
      }
    }
    var laid = window.pulpLayoutBlock(ctx, state, ${JSON.stringify(blockId)}, {});
    window.pulpDrawBlock(ctx, laid);
  };
</script>
</body>
</html>
`;
}

export type CanvasTemplateResult = { ok: true; files: CanvasTemplateFiles } | { ok: false; message: string };

export function canvasTemplateFiles(input: CanvasSaveInput): CanvasTemplateResult {
  const name = input.name.trim();
  if (name === '') return { ok: false, message: 'The template needs a name: the folder it is saved as.' };
  const block = input.canvas.blocks[0];
  if (!block) return { ok: false, message: 'The canvas declares no block to save.' };
  const folder = slug(name, 'template');
  const templateId = `custom.${folder}`;
  const stack = input.layers[block.id] ?? [];
  if (stack.length === 0) return { ok: false, message: 'Nothing is on the canvas yet: add a layer before saving it as a template.' };

  const notes: string[] = [];
  const live = pruneExpose(input.expose, input.layers);
  const picks: { layer: string; field: 'text' | 'color'; param: string }[] = [];
  const parameters: TemplateParameter[] = [];
  for (const exposure of live) {
    const layer = stack.find((l) => l.id === exposure.layer);
    if (!layer || !exposableProps(layer).includes(exposure.prop)) continue;
    const parameter = parameterJson(exposure, layer, notes);
    if (!parameter) continue;
    parameters.push(parameter);
    picks.push({ layer: exposure.layer, field: exposure.prop as 'text' | 'color', param: exposure.id });
  }

  const duration = round(Math.max(0.1, input.length), 2);
  const manifest = {
    formatVersion: 1,
    id: templateId,
    name,
    description: 'Made with Pulp’s template editor: one block of layers, laid out and drawn by the standard layer machinery. Edit template.json by hand as you like.',
    version: '1.0.0',
    // The work is the person's own; the id is required by the format and theirs to change in the file.
    license: 'CC0-1.0',
    category: 'other',
    tags: ['custom', 'canvas'],
    duration,
    structure: { loop: true },
    fps: input.canvas.fps,
    aspects: [...input.canvas.aspects],
    alpha: input.canvas.alpha,
    entry: 'index.html',
    parameters,
    blocks: [
      {
        id: block.id,
        label: block.label,
        box: block.box,
        direction: block.direction,
        gap: round(block.gap),
        align: block.align,
        verticalAlign: block.verticalAlign,
        open: true,
        ...(block.transition ? { transition: transitionsJson(block.transition) } : {}),
        typography: { ...block.typography },
        layers: stack.map((layer) => layerJson(layer, notes)),
      },
    ],
  };

  return {
    ok: true,
    files: { folder, templateId, manifest: `${JSON.stringify(manifest, null, 2)}\n`, page: pageFor(name, block.id, picks), notes },
  };
}
