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
 */

import { trackSourceAt, type CutTrack } from '../core/cut-track';
import { clipProxySize } from '../core/video-layer';

interface CutFrames {
  imgs: HTMLImageElement[];
  fps: number;
  first: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
/** Redraw the frame on screen, once frames land after it was drawn without them. */
let onReady: () => void = () => undefined;

let key = '';
let generation = 0;
let shown: CutTrack | null = null;
let cuts: (CutFrames | null)[] = [];

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
    cuts = [];
    return;
  }
  canvas.hidden = false;
  const height = clipProxySize(Math.max(90, displayedHeight));
  const wanted = JSON.stringify({ cuts: track.cuts, height });
  if (wanted === key) return;
  key = wanted;
  const asked = ++generation;
  void window.pulp.trackFrames({ cuts: track.cuts.map((c) => ({ id: c.id, from: c.from, to: c.to })), height }).then(async (answer) => {
    if (asked !== generation) return;
    const landed: (CutFrames | null)[] = answer.cuts.map((cut) => cut && {
      imgs: cut.srcs.map((src) => {
        const img = new Image();
        img.src = src;
        return img;
      }),
      fps: cut.fps,
      first: cut.first,
    });
    // Decoded before they are offered, so the first draw never paints a half-arrived image.
    await Promise.all(landed.flatMap((cut) => cut?.imgs.map((img) => img.decode().catch(() => undefined)) ?? []));
    if (asked !== generation) return;
    cuts = landed;
    onReady();
  });
}

/** For the UI test: what the picture holds — the ask, and how many frames landed per cut. */
export function trackPictureDebug(): { key: string; cuts: (number | null)[] } {
  return { key, cuts: cuts.map((c) => (c ? c.imgs.length : null)) };
}

/** Draw what the track shows at a moment, letterboxed into the frame over the pad. */
export function trackPictureDraw(seconds: number, frame: { width: number; height: number }): void {
  if (!canvas || !ctx || canvas.hidden || !shown) return;
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const at = trackSourceAt(shown, seconds);
  const cut = at ? cuts[at.index] : null;
  if (!at || !cut || cut.imgs.length === 0) return;
  const index = Math.min(cut.imgs.length - 1, Math.max(0, Math.floor(at.seconds * cut.fps) - cut.first));
  const img = cut.imgs[index]!;
  if (!img.complete || img.naturalWidth === 0) return;
  const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}
