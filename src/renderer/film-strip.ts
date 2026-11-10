/**
 * The timeline's film strips in the window (milestone 87): the choice of what
 * the lanes draw, each clip's strip asked for once and kept, and the painting
 * of a strip's tiles along a shot. Where each picture goes is the core's
 * arithmetic (src/core/film-strip.ts); this only draws.
 *
 * A strip arrives as PNG bytes and is decoded straight to an `ImageBitmap`,
 * so nothing loads by URL and nothing waits: until a clip's strip lands its
 * shots are drawn plain, and `filmStrips` ticks when it does, which the lanes
 * repaint on.
 */

import { signal } from '@preact/signals';
import { DEFAULT_FILM_STRIP, filmFrameAt, filmTileRect, type FilmSlot, type FilmStripInfo, type FilmStripMode } from '../core/film-strip';
import { stripFrameIndices } from '../core/hover-scrub';

/** What the lanes draw of each clip, as the player's settings hold it (stage.ts keeps it in settings.json). */
export const filmStripMode = signal<FilmStripMode>(DEFAULT_FILM_STRIP);

let chooser: (mode: FilmStripMode) => void = (mode) => {
  filmStripMode.value = mode;
};

/** The stage stores the choice with the player's other settings; it lends the way to here. */
export function setFilmStripChooser(fn: (mode: FilmStripMode) => void): void {
  chooser = fn;
}

/** Choose what the lanes draw — from Settings, or a shot's right-click menu. */
export function chooseFilmStrip(mode: FilmStripMode): void {
  chooser(mode);
}

interface LoadedStrip {
  info: FilmStripInfo;
  image: ImageBitmap;
}

/** Strips by clip id: loaded, null for a clip that has none, absent while not yet asked. */
const strips = new Map<string, LoadedStrip | null>();
const asking = new Set<string>();
/** Ticks when a strip lands, so the lanes paint it. */
export const filmStrips = signal(0);

/** A clip's strip when it is here; asked for the first time it is wanted, and `filmStrips` ticks when it lands. */
export function filmStripFor(id: string): LoadedStrip | null | undefined {
  if (strips.has(id)) return strips.get(id);
  if (!asking.has(id)) {
    asking.add(id);
    void window.pulp.filmStrip(id).then(async (answer) => {
      if (!answer.ok) {
        asking.delete(id);
        // Worth asking again later — no ffmpeg yet, a folder offline — so it is not remembered.
        if (!answer.transient) strips.set(id, null);
        return;
      }
      const image = await createImageBitmap(new Blob([answer.png as BlobPart], { type: 'image/png' }));
      const { rate, count, tileWidth, tileHeight, columns } = answer;
      strips.set(id, { info: { rate, count, tileWidth, tileHeight, columns }, image });
      asking.delete(id);
      filmStrips.value++;
    }).catch(() => asking.delete(id));
  }
  return undefined;
}

/** What a painter draws from: an image of tiles, their size, and which tile shows a given second. */
interface Tiles {
  image: CanvasImageSource;
  tileWidth: number;
  tileHeight: number;
  tileAt: (seconds: number) => { x: number; y: number; width: number; height: number };
}

/**
 * Paint a clip's strip along a canvas that covers a shot or a clip block: the
 * slots the caller works out for a span this wide with tiles this wide, each
 * tile drawn at the canvas's height in the clip's own shape. Hidden when the
 * lanes draw nothing or the strip is not here yet. True when drawn.
 */
export function paintFilm(canvas: HTMLCanvasElement, mode: FilmStripMode, id: string | null, slots: (width: number, slot: number) => FilmSlot[]): boolean {
  const strip = mode === 'off' || !id ? undefined : filmStripFor(id);
  if (!strip) {
    canvas.hidden = true;
    return false;
  }
  const { info, image } = strip;
  return paintTiles(canvas, { image, tileWidth: info.tileWidth, tileHeight: info.tileHeight, tileAt: (seconds) => filmTileRect(info, filmFrameAt(info, seconds)) }, slots);
}

function paintTiles(canvas: HTMLCanvasElement, tiles: Tiles, slots: (width: number, slot: number) => FilmSlot[]): boolean {
  // Shown before it is measured: a hidden canvas has no size to measure.
  canvas.hidden = false;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return false;
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.clearRect(0, 0, w, h);
  // A tile at the canvas's height, in the clip's shape; the slots are that wide.
  const slot = (height * tiles.tileWidth) / tiles.tileHeight;
  const list = slots(width, slot);
  for (const { x, seconds } of list) {
    const tile = tiles.tileAt(seconds);
    ctx.drawImage(tiles.image, tile.x, tile.y, tile.width, tile.height, Math.round(x * ratio), 0, Math.round(slot * ratio), h);
  }
  // How many pictures went along it, and how wide each is, for the end-to-end test to read them back.
  canvas.dataset.slots = String(list.length);
  canvas.dataset.slotWidth = String(Math.round(slot * 100) / 100);
  return true;
}

// ---------------------------------------------------------------- a template's own frames

interface TemplateTiles {
  image: HTMLImageElement;
  /** The template frame each tile shows, in order: the hover scrub's eight, evenly over its timeline. */
  frames: number[];
  fps: number;
}
const templateStrips = new Map<string, TemplateTiles | null>();
const askingTemplates = new Set<string>();

/**
 * A template's own frames along its layer bars (milestone 87): the hover
 * scrub's strip of the template (milestone 12), already made for its card and
 * cached, read for the frame each moment of the graphic shows. A bar's slots
 * give template seconds — the graphic's moment through the template's own
 * timing, a stretched hold included — and the nearest of the eight is drawn.
 */
export function paintTemplateFilm(canvas: HTMLCanvasElement, mode: FilmStripMode, template: { id: string; fps: number; duration: number } | null, slots: (width: number, slot: number) => FilmSlot[]): boolean {
  if (mode === 'off' || !template) {
    canvas.hidden = true;
    return false;
  }
  const known = templateStrips.get(template.id);
  if (known === undefined && !askingTemplates.has(template.id)) {
    askingTemplates.add(template.id);
    void window.pulp.hoverStrip(template.id).then((answer) => {
      if (!answer.url) {
        askingTemplates.delete(template.id);
        if (!answer.transient) templateStrips.set(template.id, null);
        return;
      }
      const image = new Image();
      image.onload = () => {
        const total = Math.max(1, Math.round(template.duration * template.fps));
        templateStrips.set(template.id, { image, frames: stripFrameIndices(total), fps: template.fps });
        askingTemplates.delete(template.id);
        filmStrips.value++;
      };
      image.onerror = () => askingTemplates.delete(template.id);
      image.src = answer.url;
    }).catch(() => askingTemplates.delete(template.id));
  }
  if (!known) {
    canvas.hidden = true;
    return false;
  }
  const count = known.frames.length;
  const tileWidth = known.image.naturalWidth / count;
  const tileHeight = known.image.naturalHeight;
  return paintTiles(canvas, {
    image: known.image, tileWidth, tileHeight,
    tileAt: (seconds) => {
      const frame = seconds * known.fps;
      let best = 0;
      known.frames.forEach((f, i) => {
        if (Math.abs(f - frame) < Math.abs(known.frames[best]! - frame)) best = i;
      });
      return { x: best * tileWidth, y: 0, width: tileWidth, height: tileHeight };
    },
  }, slots);
}
