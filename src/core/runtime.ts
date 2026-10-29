/**
 * The host side of the template runtime contract (see docs/template-format.md,
 * "Runtime contract").
 *
 * A template page defines `window.pulpRender(state)`. The host injects a small
 * bridge script into the template's HTML entry point; the bridge exposes
 * `window.__pulp` for direct calls (offscreen rendering via
 * executeJavaScript) and answers `postMessage` requests (the preview iframe).
 */

import type { Size } from './aspect';
import { fontFaceCss, TEMPLATE_FONTS_PATH } from './fonts';
import { imageSlots, type ImageSlotState } from './image-slot';
import { blockStates, layerTexts, type BlockState } from './layer-layout';
import type { Block, LayerValues } from './layers';
import type { TemplateManifest, TemplateParameter } from './manifest';
import type { ResolvedParams } from './params';
import type { ClipSource } from './video-layer';
import { lengthFrameCount, resolveLength, templateTimeAt, type TemplateStructure } from './timing';

export interface FrameState {
  /** Zero-based frame index. */
  frame: number;
  /** Time in seconds at the start of this frame: frame / fps. */
  time: number;
  /** time / duration, clamped to [0, 1]. */
  progress: number;
  fps: number;
  duration: number;
  totalFrames: number;
  width: number;
  height: number;
  params: ResolvedParams;
  /** The template's image slots laid out for this frame; the bridge attaches the decoded picture to each chosen one. */
  images: Record<string, ImageSlotState>;
  /**
   * The template's blocks for this frame, by block id: the box in pixels and the layers that are
   * drawn, in stack order, with their sizes in pixels (src/core/layer-layout.ts). `window.pulpLayoutBlock`
   * finishes the job — measuring, wrapping and stacking — and `window.pulpDrawBlock` draws the result.
   */
  blocks: Record<string, BlockState>;
}

/**
 * The state for one frame. `size` is the canvas the template is handed this
 * time — the render's chosen resolution, the preview's, the thumbnail's — not
 * anything the manifest says: a template draws for a shape, and learns the
 * pixel size from here (docs/template-format.md, ADR 0012).
 */
export function frameState(
  manifest: Pick<TemplateManifest, 'duration' | 'fps'> & { structure?: TemplateStructure; parameters?: readonly TemplateParameter[]; blocks?: readonly Block[] },
  frame: number,
  params: ResolvedParams,
  size: Size,
  /** The layers the person using the template built; the template's own defaults when not given. */
  layers: LayerValues = {},
  /** What the host measured about each chosen clip, by library id; only video layers need it. */
  clips: Record<string, ClipSource> = {},
  /**
   * Seconds the graphic is to run for (milestone 30), when a person has asked
   * for a length other than the one the template was designed at. Only a
   * template that declares a structure can be asked; for every other, and when
   * nothing is asked, this is its own duration and nothing below changes.
   */
  askedLength?: number,
): FrameState {
  const structure = manifest.structure ?? null;
  const length = resolveLength(manifest.duration, structure, askedLength);
  const totalFrames = lengthFrameCount(length, manifest.fps);
  const f = Math.min(Math.max(0, Math.floor(frame)), totalFrames - 1);
  // Where this frame sits in the graphic as it will be watched, and where that lands on the
  // template's own timeline: the entrance and the exit as designed, the hold stretched.
  const elapsed = f / manifest.fps;
  const time = templateTimeAt(elapsed, manifest.duration, structure, length);
  // A video layer plays against the graphic a person sees, so its own time is the elapsed one:
  // a clip delayed five seconds starts five seconds in, however the hold is stretched.
  const blocks = manifest.blocks ? blockStates({ blocks: manifest.blocks as Block[] }, layers, size, { time: elapsed, sources: clips }) : {};
  return {
    frame: f,
    time,
    progress: Math.min(1, Math.max(0, time / manifest.duration)),
    fps: manifest.fps,
    duration: manifest.duration,
    totalFrames,
    width: size.width,
    height: size.height,
    params,
    images: manifest.parameters ? imageSlots(manifest.parameters, params, size, layerTexts(blocks)) : {},
    blocks,
  };
}

/**
 * Content-Security-Policy applied to every template response. Templates are
 * offline documents: they may load files from their own folder and use inline
 * scripts and styles, but cannot reach the network.
 */
export const TEMPLATE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // The bundled fonts are served under each template's own origin at a reserved path (ADR 0014).
  // `pulp-template:` is named as well as 'self' so they are reachable however a custom scheme's
  // origin is computed; it widens nothing, since a template page can already read its own folder.
  "font-src 'self' pulp-template: data:",
  "media-src 'self' blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Source of the bridge script. Kept as plain ES2017 so it runs in any Chromium.
 * No line comments: it is injected on a single line (see injectBridge).
 */
export const BRIDGE_SCRIPT = `(function () {
  'use strict';
  var ready = new Promise(function (resolve) {
    function done() {
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      fonts.then(function () { resolve(true); });
    }
    if (document.readyState === 'complete') done();
    else window.addEventListener('load', done, { once: true });
  });
  var MAX_SIDE = 4096;
  var pictures = {};
  /* A video layer's frames, by library id: the window the host handed over, in order. The page
     never learns the clip's own numbering, only which of these to draw (milestone 26). */
  var clips = {};
  function requestKey(r) { return r.id + '|' + r.treatment + '|' + (r.treatment === 'tinted' ? r.tint : ''); }
  function loadPicture(r) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Image ' + r.id + ' could not be decoded')); };
      if (!r.src) { reject(new Error('Image ' + r.id + ' was not handed to the template')); return; }
      img.src = r.src;
    }).then(function (img) {
      var w = img.naturalWidth || 1, h = img.naturalHeight || 1;
      var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      var x = c.getContext('2d');
      x.drawImage(img, 0, 0, c.width, c.height);
      if (r.treatment !== 'original') {
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = r.treatment === 'white' ? '#ffffff' : r.treatment === 'black' ? '#000000' : r.tint;
        x.fillRect(0, 0, c.width, c.height);
      }
      return c;
    });
  }
  function loadFrame(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('a clip frame could not be decoded')); };
      img.src = src;
    });
  }
  /* A clip's frames, decoded once and kept: a render asks for a different one every frame, and
     decoding per frame would cost more than drawing does. */
  function loadClip(r) {
    return Promise.all((r.srcs || []).map(loadFrame)).then(function (frames) { return frames; });
  }
  function prepare(requests) {
    return ready.then(function () {
      return Promise.all((requests || []).map(function (r) {
        if (r.kind === 'clip') {
          if (!clips[r.id]) {
            var clip = loadClip(r);
            clip.then(function (f) { clip.value = f; }, function () { clip.value = null; });
            clips[r.id] = clip;
          }
          return clips[r.id];
        }
        var key = requestKey(r);
        if (!pictures[key]) {
          var entry = loadPicture(r);
          entry.then(function (c) { entry.value = c; }, function () { entry.value = null; });
          pictures[key] = entry;
        }
        return pictures[key];
      }));
    }).then(function () { return true; });
  }
  function attachPictures(state) {
    var images = state && state.images ? state.images : {};
    var pending = [];
    Object.keys(images).forEach(function (slotId) {
      var slot = images[slotId];
      if (!slot.id) return;
      var p = pictures[requestKey(slot)];
      if (!p) return;
      pending.push(p.then(function (c) { slot.bitmap = c; }, function () { slot.bitmap = null; }));
    });
    return Promise.all(pending);
  }
  function fitBox(box, iw, ih, fit, align, margin) {
    var inset = Math.max(0, Math.min(0.45, margin || 0)) * Math.min(box.width, box.height);
    var innerW = Math.max(1, box.width - inset * 2), innerH = Math.max(1, box.height - inset * 2);
    var scale = fit === 'cover' ? Math.max(innerW / iw, innerH / ih) : Math.min(innerW / iw, innerH / ih);
    var w = iw * scale, h = ih * scale;
    var a = align || 'center';
    var ax = a === 'left' || /-left$/.test(a) ? 0 : a === 'right' || /-right$/.test(a) ? 1 : 0.5;
    var ay = /^top/.test(a) ? 0 : /^bottom/.test(a) ? 1 : 0.5;
    return { x: box.x + inset + (innerW - w) * ax, y: box.y + inset + (innerH - h) * ay, width: w, height: h };
  }
  var ASCENT = 0.8, SHRINK_STEP = 0.92, SHRINK_TRIES = 12;
  function applyCase(text, how) {
    if (how === 'upper') return text.toUpperCase();
    if (how === 'lower') return text.toLowerCase();
    if (how === 'title') return text.replace(/\\S+/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); });
    return text;
  }
  var GENERIC = { serif: 1, 'sans-serif': 1, monospace: 1, cursive: 1, fantasy: 1, 'system-ui': 1, 'ui-serif': 1, 'ui-sans-serif': 1, 'ui-monospace': 1, 'ui-rounded': 1, math: 1, emoji: 1, fangsong: 1, inherit: 1, initial: 1 };
  /* Mirrors cssFontFamily in src/core/fonts.ts: every name quoted unless generic, since ctx.font ignores an invalid string. */
  function cssFamily(stack) {
    return String(stack).split(',').map(function (p) { return p.trim().replace(/^["']|["']$/g, ''); }).filter(Boolean)
      .map(function (p) { return GENERIC[p.toLowerCase()] ? p : '"' + p.replace(/"/g, '\\"') + '"'; }).join(', ');
  }
  function layerFont(layer, size) { return (layer.italic ? 'italic ' : '') + layer.weight + ' ' + size + 'px ' + cssFamily(layer.family); }
  function textWidth(ctx, text, layer, size, spacingEm) {
    ctx.font = layerFont(layer, size);
    var spacing = spacingEm * size;
    if (spacing === 0 && layer.kerning) return ctx.measureText(text).width;
    var total = 0;
    for (var i = 0; i < text.length; i++) total += ctx.measureText(text[i]).width + (i < text.length - 1 ? spacing : 0);
    return total;
  }
  function wrapWords(ctx, text, maxWidth, layer, size, spacingEm) {
    var words = text.split(/\\s+/).filter(Boolean), lines = [], line = '', ok = true;
    for (var i = 0; i < words.length; i++) {
      var candidate = line ? line + ' ' + words[i] : words[i];
      if (!line || textWidth(ctx, candidate, layer, size, spacingEm) <= maxWidth) line = candidate;
      else { lines.push(line); line = words[i]; }
      if (textWidth(ctx, line, layer, size, spacingEm) > maxWidth) ok = false;
    }
    if (line) lines.push(line);
    return { lines: lines, ok: ok };
  }
  function layoutText(ctx, layer, maxWidth, spacingEm) {
    var text = applyCase(layer.text, layer['case']);
    if (text.replace(/\\s+/g, '') === '') return { size: layer.fontSize, lines: [] };
    if (layer.overflow === 'shrink') {
      var w = textWidth(ctx, text, layer, layer.fontSize, spacingEm);
      return { size: w > maxWidth && w > 0 ? layer.fontSize * maxWidth / w : layer.fontSize, lines: [text] };
    }
    if (layer.overflow === 'truncate') {
      if (textWidth(ctx, text, layer, layer.fontSize, spacingEm) <= maxWidth) return { size: layer.fontSize, lines: [text] };
      var cut = text;
      while (cut.length > 0 && textWidth(ctx, cut + '…', layer, layer.fontSize, spacingEm) > maxWidth) cut = cut.slice(0, -1);
      return { size: layer.fontSize, lines: [cut.replace(/\\s+$/, '') + '…'] };
    }
    var size = layer.fontSize, wrapped = wrapWords(ctx, text, maxWidth, layer, size, spacingEm);
    for (var tries = 1; tries < SHRINK_TRIES && !(wrapped.ok && wrapped.lines.length <= layer.maxLines); tries++) {
      size *= SHRINK_STEP;
      wrapped = wrapWords(ctx, text, maxWidth, layer, size, spacingEm);
    }
    return { size: size, lines: wrapped.lines };
  }
  function alignedX(align, boxX, boxWidth, width) {
    if (align === 'left') return boxX;
    if (align === 'right') return boxX + boxWidth - width;
    return boxX + (boxWidth - width) / 2;
  }
  function crossStart(v, boxY, boxHeight, extent) {
    if (v === 'top') return boxY;
    if (v === 'bottom') return boxY + boxHeight - extent;
    return boxY + (boxHeight - extent) / 2;
  }
  function pictureFor(layer) {
    if (layer.type === 'video') {
      /* Nothing to draw before the clip starts, or after one that plays once has ended: the host
         says so with a null frame, and the layer then takes no room at all. */
      if (!layer.clip || !layer.clip.id || layer.clip.hidden || layer.frame === null || layer.frame === undefined) return null;
      var c = clips[layer.clip.id];
      var frames = c && c.value ? c.value : null;
      if (!frames || frames.length === 0) return null;
      var i = Math.max(0, Math.min(frames.length - 1, Math.floor(layer.frame)));
      return frames[i];
    }
    if (!layer.image || !layer.image.id || layer.image.hidden) return null;
    var p = pictures[requestKey(layer.image)];
    return p && p.value ? p.value : null;
  }
  /* Mirrors layerDraws and motionDraw in src/core/layer-layout.ts and src/core/layer-motion.ts, the
     copies with unit tests: change both or neither. What the template asked for each position, and
     then, for a layer the person gave a motion of its own, what that says instead -- multiplied by
     the block's envelope, the most the template is showing any of its layers now, so an overridden
     layer cannot be left on screen after the graphic has gone. */
  var MOTION_IN = 0.5, SLIDE_DISTANCE = 1, SCALE_FROM = 0.8;
  function easeInOutSine(x) { return (1 - Math.cos(Math.PI * x)) / 2; }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function motionDraw(motion, time, duration, distance, column) {
    if (!motion || motion.type === 'template') return null;
    var over = Math.min(MOTION_IN, Math.max(0, duration));
    var delay = Math.max(0, motion.delay || 0);
    var start = Math.min(delay, Math.max(0, duration - over));
    if (motion.type === 'none') return { alpha: time >= start ? 1 : 0, dx: 0, dy: 0, scale: 1 };
    var eased = easeInOutSine(over <= 0 ? (time >= start ? 1 : 0) : clamp01((time - start) / over));
    if (motion.type === 'fade') return { alpha: eased, dx: 0, dy: 0, scale: 1 };
    if (motion.type === 'slide') {
      var travel = (1 - eased) * SLIDE_DISTANCE * distance;
      return column ? { alpha: eased, dx: 0, dy: travel, scale: 1 } : { alpha: eased, dx: -travel, dy: 0, scale: 1 };
    }
    if (motion.type === 'scale') return { alpha: eased, dx: 0, dy: 0, scale: SCALE_FROM + (1 - SCALE_FROM) * eased };
    return null;
  }
  function layerDraws(block, state, options, column) {
    var asked = block.layers.map(function (layer, position) {
      var draw = { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0 };
      var over = options.each ? options.each(layer, position) : null;
      if (over) for (var k in over) if (over[k] !== undefined) draw[k] = over[k];
      return draw;
    });
    var envelope = 0, i;
    for (i = 0; i < asked.length; i++) envelope = Math.max(envelope, asked[i].alpha);
    return block.layers.map(function (layer, position) {
      var own = motionDraw(layer.motion, state.time, state.duration, layer.type === 'text' ? layer.fontSize : layer.size, column);
      var draw = asked[position];
      if (own) { own.alpha = own.alpha * envelope; draw = own; }
      /* The person's placement (milestone 25) wraps whatever the template or the override asked:
         offsets add, scales multiply, so a placed layer still rides the design. Mirrors layerDraws
         in src/core/layer-layout.ts: change both or neither. */
      var placed = layer.placement;
      if (placed && (placed.dx || placed.dy || placed.scale !== 1 || placed.rotate)) {
        draw = { alpha: draw.alpha, dx: draw.dx + placed.dx, dy: draw.dy + placed.dy, scale: draw.scale * placed.scale, rotate: (draw.rotate || 0) + (placed.rotate || 0), letterSpacing: draw.letterSpacing };
      }
      return draw;
    });
  }
  /* Mirrors layoutBlock in src/core/layer-layout.ts, which is the copy with unit tests: change both or neither. */
  function layoutBlock(ctx, state, blockId, options) {
    var block = state && state.blocks ? state.blocks[blockId] : null;
    if (!block) return null;
    options = options || {};
    var box = options.box || block.box;
    var column = block.direction !== 'row';
    var draws = layerDraws(block, state, options, column);
    var measured = block.layers.map(function (layer, position) {
      var draw = draws[position];
      if (layer.type === 'text') {
        var spacing = draw.letterSpacing === undefined ? layer.letterSpacing : draw.letterSpacing;
        var laid = layoutText(ctx, layer, box.width, spacing);
        var widths = laid.lines.map(function (line) { return textWidth(ctx, line, layer, laid.size, spacing); });
        var height = laid.lines.length === 0 ? 0 : (laid.lines.length - 1) * laid.size * layer.lineHeight + laid.size;
        var width = widths.reduce(function (a, b) { return Math.max(a, b); }, 0);
        return { layer: layer, draw: draw, size: laid.size, lines: laid.lines, widths: widths, width: width, height: height, extent: column ? height : width, cross: column ? width : height };
      }
      var picture = pictureFor(layer);
      if (!picture) return { layer: layer, draw: draw, size: 0, lines: [], widths: [], width: 0, height: 0, extent: 0, cross: 0 };
      var aspect = Math.max(0.01, picture.width / picture.height);
      var w = Math.min(box.width, layer.size * aspect), h = w / aspect;
      return { layer: layer, draw: draw, size: 0, lines: [], widths: [], width: w, height: h, picture: picture, extent: column ? h : w, cross: column ? w : h };
    });
    var total = 0, drawn = 0, i;
    for (i = 0; i < measured.length; i++) {
      if (measured[i].extent <= 0) continue;
      if (drawn > 0) total += block.gap;
      total += measured[i].layer.spaceBefore + measured[i].extent;
      drawn++;
    }
    var along = column ? box.height : box.width;
    var place = column ? block.verticalAlign : block.align;
    var offset = place === 'top' || place === 'left' ? 0 : place === 'bottom' || place === 'right' ? along - total : (along - total) / 2;
    var cursor = (column ? box.y : box.x) + offset, placed = 0, layers = [];
    for (i = 0; i < measured.length; i++) {
      var m = measured[i], layer = m.layer, out;
      if (m.extent <= 0) {
        out = { box: { x: box.x, y: box.y, width: 0, height: 0 }, size: m.size, lines: [], draw: m.draw };
        for (var key0 in layer) out[key0] = out[key0] === undefined ? layer[key0] : out[key0];
        layers.push(out);
        continue;
      }
      if (placed > 0) cursor += block.gap;
      cursor += layer.spaceBefore;
      var laidBox = column
        ? { x: box.x, y: cursor, width: box.width, height: m.extent }
        : { x: cursor, y: crossStart(block.verticalAlign, box.y, box.height, m.cross), width: m.extent, height: m.cross };
      out = { draw: m.draw, size: m.size, lines: [] };
      var align = options.align || layer.align;
      if (layer.type === 'text') {
        var step = m.size * layer.lineHeight;
        out.box = laidBox;
        out.lines = m.lines.map(function (text, li) {
          return { text: text, width: m.widths[li], x: alignedX(align, laidBox.x, laidBox.width, m.widths[li]), baseline: laidBox.y + li * step + ASCENT * m.size };
        });
      } else {
        out.box = { x: alignedX(align, laidBox.x, laidBox.width, m.width), y: laidBox.y, width: m.width, height: m.height };
        out.picture = m.picture;
      }
      for (var key in layer) if (out[key] === undefined) out[key] = layer[key];
      layers.push(out);
      cursor += m.extent;
      placed++;
    }
    /* What was laid, compactly, for the stage's handles (milestone 25): each layer's slot and
       what it will be drawn with, which together are where it really lands on the frame. */
    window.__pulp.laid.frame = state && state.frame;
    window.__pulp.laid.blocks[blockId] = {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      layers: layers.map(function (l) {
        var ink = inkBox(l);
        return {
          id: l.id, type: l.type,
          box: { x: l.box.x, y: l.box.y, width: l.box.width, height: l.box.height },
          ink: { x: ink.x, y: ink.y, width: ink.width, height: ink.height },
          draw: { alpha: l.draw.alpha, dx: l.draw.dx || 0, dy: l.draw.dy || 0, scale: l.draw.scale === undefined ? 1 : l.draw.scale, rotate: l.draw.rotate || 0 }
        };
      })
    };
    return { id: block.id, box: box, layers: layers };
  }
  /* What a laid layer really draws, as against the slot it was given. Mirrors inkBox in
     src/core/layer-layout.ts, the copy with unit tests: change both or neither. */
  function inkBox(layer) {
    if (layer.type !== 'text' || !layer.lines || layer.lines.length === 0) return layer.box;
    var left = Infinity, right = -Infinity, i;
    for (i = 0; i < layer.lines.length; i++) {
      var line = layer.lines[i];
      if (line.width <= 0) continue;
      if (line.x < left) left = line.x;
      if (line.x + line.width > right) right = line.x + line.width;
    }
    if (!isFinite(left) || right <= left) return layer.box;
    return { x: left, y: layer.box.y, width: right - left, height: layer.box.height };
  }
  /* Draws a block laid out by layoutBlock: each layer with the alpha, offset and scale the template gave it. */
  function drawBlock(ctx, laid) {
    if (!laid) return false;
    for (var i = 0; i < laid.layers.length; i++) {
      var layer = laid.layers[i], d = layer.draw || {};
      if (!layer.box || layer.box.width <= 0 && layer.box.height <= 0) continue;
      var alpha = d.alpha === undefined ? 1 : d.alpha;
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * alpha;
      var cx = layer.box.x + layer.box.width / 2, cy = layer.box.y + layer.box.height / 2;
      ctx.translate((d.dx || 0), (d.dy || 0));
      /* The scale and the angle are both about the layer's own centre (milestone 29), so they
         compose in either order; the offset above has already moved that centre. */
      if (d.scale !== undefined && d.scale !== 1) { ctx.translate(cx, cy); ctx.scale(d.scale, d.scale); ctx.translate(-cx, -cy); }
      if (d.rotate) {
        /* About what the layer draws, not the slot it sits in: a line aligned in a wide block
           turns where it is rather than swinging about the middle of the block (milestone 29). */
        var ink = inkBox(layer);
        var ix = ink.x + ink.width / 2, iy = ink.y + ink.height / 2;
        ctx.translate(ix, iy); ctx.rotate(d.rotate * Math.PI / 180); ctx.translate(-ix, -iy);
      }
      if (layer.type === 'text') drawTextLayer(ctx, layer);
      else if (layer.picture) {
        var at = fitBox(layer.box, layer.picture.width, layer.picture.height, 'contain', 'center', 0);
        var effect = layer.image ? layer.image.effect : 'none';
        if (effect === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = Math.max(2, at.height * 0.12); ctx.shadowOffsetY = Math.max(1, at.height * 0.04); }
        else if (effect === 'glow') { ctx.shadowColor = layer.image && layer.image.treatment === 'tinted' ? layer.image.tint : 'rgba(255,255,255,0.85)'; ctx.shadowBlur = Math.max(4, at.height * 0.25); }
        ctx.drawImage(layer.picture, at.x, at.y, at.width, at.height);
      }
      ctx.restore();
    }
    return true;
  }
  function drawTextLayer(ctx, layer) {
    var spacingEm = layer.draw && layer.draw.letterSpacing !== undefined ? layer.draw.letterSpacing : layer.letterSpacing;
    var spacing = spacingEm * layer.size;
    ctx.font = layerFont(layer, layer.size);
    ctx.fillStyle = layer.color;
    ctx.textBaseline = 'alphabetic';
    for (var i = 0; i < layer.lines.length; i++) {
      var line = layer.lines[i];
      if (spacing === 0 && layer.kerning) {
        ctx.textAlign = 'left';
        ctx.fillText(line.text, line.x, line.baseline);
        continue;
      }
      /* Manual letter spacing, so it behaves the same in every Chromium version. */
      ctx.textAlign = 'left';
      var x = line.x;
      for (var c = 0; c < line.text.length; c++) {
        ctx.fillText(line.text[c], x, line.baseline);
        x += ctx.measureText(line.text[c]).width + spacing;
      }
    }
  }
  /* A slot the person hid: nothing is drawn there, not even the fallback, and a design that
     keeps room for it should close the space up (docs/template-format.md, "Image slots"). */
  function slotHidden(state, slotId) {
    var slot = state && state.images ? state.images[slotId] : null;
    return !!(slot && slot.hidden);
  }
  /* The words to put where a slot's image would go: its fallback, or the text passed in; nothing when hidden. */
  function slotText(state, slotId, instead) {
    if (slotHidden(state, slotId)) return '';
    var slot = state && state.images ? state.images[slotId] : null;
    return (slot && slot.fallback) || instead || '';
  }
  function drawImage(ctx, state, slotId, box) {
    var slot = state && state.images ? state.images[slotId] : null;
    if (!slot || slot.hidden || !slot.bitmap) return false;
    var target = box || slot.box;
    var at = fitBox(target, slot.bitmap.width, slot.bitmap.height, slot.fit, slot.align, slot.margin);
    ctx.save();
    if (slot.effect === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = Math.max(2, at.height * 0.12); ctx.shadowOffsetY = Math.max(1, at.height * 0.04); }
    else if (slot.effect === 'glow') { ctx.shadowColor = slot.treatment === 'tinted' ? slot.tint : 'rgba(255,255,255,0.85)'; ctx.shadowBlur = Math.max(4, at.height * 0.25); }
    ctx.drawImage(slot.bitmap, at.x, at.y, at.width, at.height);
    ctx.restore();
    return true;
  }
  /* Canvas text never triggers a font load, so every face a layer is set in is loaded before the
     frame; a face that is not declared or installed resolves at once and falls back as it would anyway.
     The wait is bounded: a face that never settles must not stop the frame being drawn, or one font
     that cannot be fetched would stop the template drawing at all (docs/platform-notes.md). */
  var FONT_WAIT_MS = 3000;
  var loadedFaces = {};
  function loadLayerFonts(state) {
    var blocks = state && state.blocks ? state.blocks : {};
    var pending = [];
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    Object.keys(blocks).forEach(function (id) {
      (blocks[id].layers || []).forEach(function (layer) {
        if (layer.type !== 'text') return;
        var face = (layer.italic ? 'italic ' : '') + layer.weight + ' 16px ' + cssFamily(layer.family);
        if (loadedFaces[face]) return;
        loadedFaces[face] = true;
        pending.push(document.fonts.load(face).then(null, function () { return null; }));
      });
    });
    if (pending.length === 0) return Promise.resolve();
    return Promise.race([
      Promise.all(pending),
      new Promise(function (resolve) { setTimeout(resolve, FONT_WAIT_MS); }),
    ]);
  }
  function render(state) {
    return ready.then(function () {
      if (typeof window.pulpRender !== 'function') {
        throw new Error('Template does not define window.pulpRender(state)');
      }
      window.__pulp.laid = { frame: state && state.frame, blocks: {} };
      return Promise.all([attachPictures(state), loadLayerFonts(state)]).then(function () { return window.pulpRender(state); });
    }).then(function () {
      /* Two animation frames: the first callback runs before the frame holding the draw is
         committed to the compositor, so resolving there can let a capture see the previous frame
         (observed on Windows CI as a blank or one-frame-stale first capture). The second callback
         runs after that commit. The wait is bounded: a throttled renderer — an occluded window, an
         offscreen frame — may never run an animation frame at all, and the draw itself has already
         happened, so after a moment the frame is declared drawn rather than held forever
         (docs/platform-notes.md, "Windows CI"). */
      return new Promise(function (resolve) {
        var settled = false;
        function done(by) {
          if (settled) return;
          settled = true;
          /* What is on the canvas now, for anyone asking whether a change has been drawn yet: a test
             reads the canvas after the frame it changed has landed, not after a guess at how long
             that takes (docs/platform-notes.md, "Windows CI"). */
          /* "by" says how the wait ended: 'raf' means the frame holding the draw has been
             committed, 'timeout' that the renderer never ran an animation frame and the
             ordering the capture relies on was not established (docs/platform-notes.md). */
          window.__pulp.drawn = { frame: state && state.frame, at: Date.now(), by: by, layers: countLayers(state), pictures: picturesIn(state) };
          resolve(by);
        }
        requestAnimationFrame(function () { requestAnimationFrame(function () { done('raf'); }); });
        setTimeout(function () { done('timeout'); }, 250);
      });
    });
  }
  /* Which image layers had a picture to draw, by id, and which did not: what a failing test needs to know. */
  function picturesIn(state) {
    var out = {}, blocks = state && state.blocks ? state.blocks : {};
    Object.keys(blocks).forEach(function (id) {
      (blocks[id].layers || []).forEach(function (layer) {
        if (layer.type === 'image') out[id + '.' + layer.id] = layer.image ? (pictureFor(layer) ? 'drawn' : 'no picture for ' + requestKey(layer.image)) : 'none chosen';
        if (layer.type === 'video') out[id + '.' + layer.id] = !layer.clip ? 'none chosen' : layer.frame === null ? 'not playing now' : (pictureFor(layer) ? 'drawn' : 'no frames for ' + layer.clip.id);
      });
    });
    out.cached = Object.keys(pictures).join(',');
    return out;
  }
  function countLayers(state) {
    var n = 0, blocks = state && state.blocks ? state.blocks : {};
    Object.keys(blocks).forEach(function (id) { n += (blocks[id].layers || []).length; });
    return n;
  }
  window.__pulp = { ready: ready, render: render, prepare: prepare, drawImage: drawImage, fitBox: fitBox, layoutBlock: layoutBlock, drawBlock: drawBlock, slotHidden: slotHidden, slotText: slotText, drawn: null, laid: { frame: null, blocks: {} } };
  window.pulpDrawImage = drawImage;
  window.pulpSlotHidden = slotHidden;
  window.pulpSlotText = slotText;
  window.pulpFitBox = fitBox;
  window.pulpLayoutBlock = layoutBlock;
  window.pulpDrawBlock = drawBlock;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || !event.source) return;
    var reply = event.source;
    if (data.type === 'pulp:prepare') {
      prepare(data.requests).then(function () {
        reply.postMessage({ type: 'pulp:prepared', id: data.id }, '*');
      }, function (err) {
        reply.postMessage({ type: 'pulp:prepared', id: data.id, message: String(err && err.message || err) }, '*');
      });
      return;
    }
    if (data.type !== 'pulp:render') return;
    render(data.state).then(function () {
      reply.postMessage({ type: 'pulp:rendered', id: data.id, laid: window.__pulp.laid }, '*');
    }, function (err) {
      reply.postMessage({ type: 'pulp:error', id: data.id, message: String(err && err.message || err) }, '*');
    });
  });
  ready.then(function () {
    if (window.parent !== window) window.parent.postMessage({ type: 'pulp:ready' }, '*');
  });
})();`;

/** The bridge on one line, so injecting it does not shift line numbers in template error locations. */
export const BRIDGE_SCRIPT_INLINE = BRIDGE_SCRIPT.replace(/\s*\n\s*/g, ' ');

/** The bundled fonts, declared for a template page under its own origin (ADR 0014); one line, like the bridge. */
export const TEMPLATE_FONT_CSS_INLINE = fontFaceCss(`/${TEMPLATE_FONTS_PATH}/`).replace(/\n/g, '');

/**
 * Insert the bridge as the first script of the document so it runs before template code, with the
 * bundled fonts' `@font-face` rules beside it, so a layer set in Oswald finds Oswald in every template.
 */
export function injectBridge(html: string, importedFontCss = ''): string {
  const imported = importedFontCss ? `<style data-pulp-imported-fonts>${importedFontCss.replace(/\n/g, '')}</style>` : '';
  const tag = `<script data-pulp-bridge>${BRIDGE_SCRIPT_INLINE}</script><style data-pulp-fonts>${TEMPLATE_FONT_CSS_INLINE}</style>${imported}`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const htmlTag = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + `<head>${tag}</head>` + html.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype[0].length) + tag + html.slice(doctype[0].length);
  return tag + html;
}
