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

import { cutSourceTime, cutWindows, transitionAt, trackSourceAt, type CutTrack } from '../core/cut-track';
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
    cuts = [];
    wipes = {};
    return;
  }
  canvas.hidden = false;
  const height = clipProxySize(Math.max(90, displayedHeight));
  // The wipes ride in the same ask, after the cuts: a wipe template is a drawn clip to the frames
  // service, and asking for the whole of it (a wipe is short) lets the draw spread its timeline
  // over the transition's own duration, which is what a wipe's scale structure means.
  const wipeIds = [...new Set(track.cuts.flatMap((cut) => (cut.transition?.type === 'wipe' && cut.transition.template ? [cut.transition.template] : [])))];
  const wanted = JSON.stringify({ cuts: track.cuts, wipes: wipeIds, height });
  if (wanted === key) return;
  key = wanted;
  const asked = ++generation;
  const request = [
    // A freeze frame needs one frame; a sliver of the file at its moment is enough to hold.
    ...track.cuts.map((c) => ({ id: c.id, from: c.from, to: c.hold !== undefined ? c.from + 0.2 : c.to })),
    ...wipeIds.map((id) => ({ id, from: 0, to: 120 })),
  ];
  void window.pulp.trackFrames({ cuts: request, height }).then(async (answer) => {
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
    cuts = landed.slice(0, track.cuts.length);
    wipes = {};
    wipeIds.forEach((id, k) => {
      wipes[id] = landed[track.cuts.length + k] ?? null;
    });
    onReady();
  });
}

/** For the UI test: what the picture holds — the ask, and how many frames landed per cut. */
export function trackPictureDebug(): { key: string; cuts: (number | null)[] } {
  return { key, cuts: cuts.map((c) => (c ? c.imgs.length : null)) };
}

/** One cut's picture at a moment of the timeline, letterboxed, at an opacity; held at its edges. */
function drawCut(index: number, seconds: number, alpha: number): void {
  if (!ctx || !canvas || !shown) return;
  const cut = shown.cuts[index];
  const frames = cuts[index];
  if (!cut || !frames || frames.imgs.length === 0) return;
  const windows = cutWindows(shown);
  // The moment mapped into the cut's own file through its speed (milestone 56), clamped to its
  // window: past either edge the edge frame holds — which is exactly what the render's
  // clone-padding holds through a dissolve — and a freeze frame is always its one frame. Slow
  // motion shows the nearest frame here; the render makes the frames in between where asked.
  const source = cutSourceTime(cut, seconds - windows[index]!.start);
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
  const at = trackSourceAt(shown, seconds);
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
