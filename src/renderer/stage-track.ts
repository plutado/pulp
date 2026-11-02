/**
 * The cut track's picture in the preview (milestone 49): a canvas under the
 * template's iframe — over the stage's background, beneath the transparent
 * graphic — drawn to the frame on screen, so what sits under the layers is
 * what the render composites under them.
 *
 * The frames come the way a video layer's do: each cut's window decoded once
 * in the main process at a proxy height (src/main/clip-grant.ts, the same
 * cache and the same steps), held here as decoded images and picked per
 * displayed frame by the track's own arithmetic (`trackSourceAt`) — so a cut
 * boundary lands on exactly the frame it lands on in the file. The canvas is
 * the pad too: black behind a letterboxed clip and past the track's end,
 * which is what the render pads with. Frames arrive in the background; until
 * they do, or where a cut cannot be read, the pad shows and the render is
 * still exact.
  *
 * The frames are decoded in **tiles** (milestone 58, src/core/track-window.ts):
 * ten seconds of a cut's file at a time, around the moment being shown, with
 * the tile ahead fetched before the playhead reaches it. Only the tiles being
 * drawn from are held — the cut under the playhead, its neighbour across a
 * transition, and the one coming next — so a 30-minute track costs what a
 * 30-second one did, and a ten-minute shot previews at all, where a whole
 * window of it was more than a window may hold.
 */
import { cutSourceTime, cutWindows, transitionAt, trackSourceAt, type CutTrack } from '../core/cut-track';
import { tileHolds, tileKey, tilesWanted, TRACK_HELD_FRAMES_BUDGET, type Tile } from '../core/track-window';
import { clipProxySize } from '../core/video-layer';

interface CutFrames {
  imgs: HTMLImageElement[];
  fps: number;
  first: number;
}

/** One tile of a cut, decoded: which stretch of the file, and its frames. */
interface CutTile extends CutFrames {
  tile: Tile;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
/** Redraw the frame on screen, once frames land after it was drawn without them. */
let onReady: () => void = () => undefined;

let key = '';
let generation = 0;
let shown: CutTrack | null = null;
/** The proxy height the tiles were asked at; a change throws every tile away. */
let height = 0;
/** The tiles held, by cut index and tile: what the draw picks frames from. */
const tiles = new Map<string, CutTile>();
/** A cut that cannot be read at all (offline, no ffmpeg): asked once, then the pad. */
const unreadable = new Set<string>();
/** Tiles asked for and not yet landed, so a moment is asked for once. */
const inFlight = new Set<string>();
/** A wipe template's frames, by its id: the whole template, spread over the transition when drawn. */
let wipes: Record<string, CutFrames | null> = {};

export function mountTrackPicture(el: HTMLCanvasElement, redraw: () => void): void {
  canvas = el;
  ctx = el.getContext('2d');
  onReady = redraw;
}

/**
 * Bring the frames in line with the track: nothing when the project has none,
 * and one ask per change — the proxy height is quantized to the steps a video
 * layer uses, so a resized window does not decode the track again for a few
 * pixels. Cheap when nothing changed; called as often as the stage likes.
 */
export function trackPictureSync(track: CutTrack | null, displayedHeight: number): void {
  shown = track;
  if (!canvas) return;
  if (!track) {
    canvas.hidden = true;
    key = '';
    tiles.clear();
    unreadable.clear();
    inFlight.clear();
    wipes = {};
    return;
  }
  canvas.hidden = false;
  const wantedHeight = clipProxySize(Math.max(90, displayedHeight));
  // The wipes ride in one ask: a wipe template is a drawn clip to the frames service, and asking
  // for the whole of it (a wipe is short) lets the draw spread its timeline over the transition's
  // own duration, which is what a wipe's scale structure means.
  const wipeIds = [...new Set(track.cuts.flatMap((cut) => (cut.transition?.type === 'wipe' && cut.transition.template ? [cut.transition.template] : [])))];
  const wanted = JSON.stringify({ cuts: track.cuts.map((c) => [c.id, c.from, c.to, c.hold ?? null, c.speed ?? null]), wipes: wipeIds, height: wantedHeight });
  if (wanted === key) return;
  key = wanted;
  height = wantedHeight;
  // The cuts changed or the size did: every tile is of another track now. The draw asks again
  // for the moment it is on, which is one tile rather than the whole track.
  tiles.clear();
  unreadable.clear();
  inFlight.clear();
  const asked = ++generation;
  if (wipeIds.length === 0) {
    wipes = {};
    onReady();
    return;
  }
  void window.pulp.trackFrames({ cuts: wipeIds.map((id) => ({ id, from: 0, to: 120 })), height }).then(async (answer) => {
    if (asked !== generation) return;
    const landed = await decoded(answer.cuts);
    if (asked !== generation) return;
    wipes = {};
    wipeIds.forEach((id, k) => {
      wipes[id] = landed[k] ?? null;
    });
    onReady();
  });
}

/** Frames as images, decoded before they are offered, so the first draw never paints a half-arrived one. */
async function decoded(answer: ({ srcs: string[]; fps: number; first: number } | null)[]): Promise<(CutFrames | null)[]> {
  const landed: (CutFrames | null)[] = answer.map((cut) => cut && {
    imgs: cut.srcs.map((src) => {
      const img = new Image();
      img.src = src;
      return img;
    }),
    fps: cut.fps,
    first: cut.first,
  });
  await Promise.all(landed.flatMap((cut) => cut?.imgs.map((img) => img.decode().catch(() => undefined)) ?? []));
  return landed;
}

/**
 * Make sure the tiles a moment of this cut wants are held or on their way:
 * the one the moment is in, and the next when the moment is near its seam. A
 * tile asked for lands in the background and the picture redraws; a cut that
 * cannot be read is asked once and shows the pad.
 */
function wantTiles(index: number, source: number): void {
  if (!shown) return;
  const cut = shown.cuts[index];
  if (!cut || unreadable.has(String(index))) return;
  // A freeze frame is one frame: a sliver of the file at its moment is the whole of its tile.
  const window = cut.hold !== undefined ? { from: cut.from, to: cut.from + 0.2 } : { from: cut.from, to: cut.to };
  for (const tile of tilesWanted(window, source)) {
    const k = tileKey(index, tile);
    if (tiles.has(k) || inFlight.has(k)) continue;
    inFlight.add(k);
    const asked = generation;
    void window_trackFrames(cut.id, tile).then(async (answer) => {
      if (asked !== generation) return;
      inFlight.delete(k);
      const [landed] = await decoded([answer]);
      if (asked !== generation) return;
      if (!landed) {
        unreadable.add(String(index));
        return;
      }
      tiles.set(k, { ...landed, tile });
      onReady();
    });
  }
}

function window_trackFrames(id: string, tile: Tile): Promise<{ srcs: string[]; fps: number; first: number } | null> {
  return window.pulp.trackFrames({ cuts: [{ id, from: tile.from, to: tile.to }], height }).then((answer) => answer.cuts[0] ?? null);
}

/**
 * Let go of every tile the moment is not drawing from and will not within a
 * tile's reach: the budget is the tiles of the cut under the playhead, its
 * neighbour across a transition and the one ahead (TRACK_HELD_FRAMES_BUDGET).
 */
function dropFarTiles(keep: Set<string>): void {
  for (const k of [...tiles.keys()]) if (!keep.has(k)) tiles.delete(k);
}

/** The held tile of this cut holding this second of its file, if it has landed. */
function tileAt(index: number, source: number): CutTile | undefined {
  const cut = shown?.cuts[index];
  if (!cut) return undefined;
  const end = cut.hold !== undefined ? cut.from + 0.2 : cut.to;
  for (const held of tiles.values()) {
    if (held.tile && tileKeyIndex(held, index) && tileHolds(held.tile, source, end)) return held;
  }
  return undefined;
}

function tileKeyIndex(held: CutTile, index: number): boolean {
  for (const [k, v] of tiles) if (v === held) return k.startsWith(`${index}:`);
  return false;
}

/**
 * For the UI test: what the picture holds — the ask, how many frames each cut has landed across
 * its held tiles (null for a cut found unreadable), and the frames held in all, which the
 * long-track test holds to the budget.
 */
export function trackPictureDebug(): { key: string; cuts: (number | null)[]; held: number; budget: number } {
  const counts: (number | null)[] = (shown?.cuts ?? []).map((_, index) => (unreadable.has(String(index)) ? null : 0));
  let held = 0;
  for (const [k, tile] of tiles) {
    const index = Number(k.slice(0, k.indexOf(':')));
    if (counts[index] !== null && counts[index] !== undefined) counts[index] = (counts[index] ?? 0) + tile.imgs.length;
    held += tile.imgs.length;
  }
  return { key, cuts: counts, held, budget: TRACK_HELD_FRAMES_BUDGET };
}

/** One cut's picture at a moment of the timeline, letterboxed, at an opacity; held at its edges. */
function drawCut(index: number, seconds: number, alpha: number): void {
  if (!ctx || !canvas || !shown) return;
  const cut = shown.cuts[index];
  if (!cut) return;
  const windows = cutWindows(shown);
  // The moment mapped into the cut's own file through its speed (milestone 56), clamped to its
  // window: past either edge the edge frame holds — which is exactly what the render's
  // clone-padding holds through a dissolve — and a freeze frame is always its one frame. Slow
  // motion shows the nearest frame here; the render makes the frames in between where asked.
  const source = cutSourceTime(cut, seconds - windows[index]!.start);
  wantTiles(index, source);
  const frames = tileAt(index, source);
  if (!frames || frames.imgs.length === 0) return;
  const frameIndex = Math.min(frames.imgs.length - 1, Math.max(0, Math.floor(source * frames.fps) - frames.first));
  const img = frames.imgs[frameIndex]!;
  if (!img.complete || img.naturalWidth === 0) return;
  const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

/**
 * Draw what the track shows at a moment, letterboxed into the frame over the
 * pad — and the transition where the moment is inside one (milestone 49): a
 * dissolve blends the two shots exactly as the render's cross-fade does, a
 * dip lays its colour over at the fade's own ramp, and a wipe draws its
 * template's frame over the join, its timeline spread across the duration.
 */
export function trackPictureDraw(seconds: number, frame: { width: number; height: number }): void {
  if (!canvas || !ctx || canvas.hidden || !shown) return;
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // What this moment and the moments just ahead draw from: the tiles of the cut under the
  // playhead and, across a transition, its neighbour. Everything else is let go.
  const keep = new Set<string>();
  const wantedBy = (index: number, source: number) => {
    const cut = shown!.cuts[index];
    if (!cut) return;
    const window = cut.hold !== undefined ? { from: cut.from, to: cut.from + 0.2 } : { from: cut.from, to: cut.to };
    for (const tile of tilesWanted(window, source)) keep.add(tileKey(index, tile));
  };
  const at = trackSourceAt(shown, seconds);
  if (at) wantedBy(at.index, at.seconds);
  for (let index = 0; index < shown.cuts.length - 1; index++) {
    const transition = transitionAt(shown, index);
    if (!transition) continue;
    const progress = (seconds - (transition.at - transition.seconds / 2)) / transition.seconds;
    if (progress <= 0 || progress >= 1) continue;
    const windows = cutWindows(shown);
    wantedBy(index, cutSourceTime(shown.cuts[index]!, seconds - windows[index]!.start));
    wantedBy(index + 1, cutSourceTime(shown.cuts[index + 1]!, seconds - windows[index + 1]!.start));
  }
  dropFarTiles(keep);
  if (at) drawCut(at.index, seconds, 1);
  // The transition the moment is inside, if any: at most one, since a transition can never be
  // longer than either of its sides.
  for (let index = 0; index < shown.cuts.length - 1; index++) {
    const transition = transitionAt(shown, index);
    if (!transition) continue;
    const progress = (seconds - (transition.at - transition.seconds / 2)) / transition.seconds;
    if (progress <= 0 || progress >= 1) continue;
    if (transition.type === 'dissolve') {
      // The earlier shot whole, the later over it at the fade's progress: A·(1−p) + B·p, which is
      // the render's cross-fade — on both sides of the boundary, each shot held at its edge frame.
      drawCut(index, seconds, 1);
      drawCut(index + 1, seconds, progress);
    } else if (transition.type === 'dip') {
      ctx.fillStyle = transition.color;
      ctx.globalAlpha = 1 - Math.abs(progress - 0.5) * 2;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    } else if (transition.type === 'wipe' && transition.template) {
      const wipe = wipes[transition.template];
      if (wipe && wipe.imgs.length > 0) {
        const img = wipe.imgs[Math.min(wipe.imgs.length - 1, Math.round(progress * (wipe.imgs.length - 1)))]!;
        if (img.complete && img.naturalWidth > 0) {
          const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
          ctx.drawImage(img, (canvas.width - img.naturalWidth * scale) / 2, (canvas.height - img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
        }
      }
    }
    break;
  }
}
