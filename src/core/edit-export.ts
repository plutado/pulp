/**
 * The edit exported for an editing app (milestone 49): the cut track written
 * as FCPXML and as a CMX3600-style EDL, with the clips referenced **in
 * place** — paths to the files as they lie, nothing copied — and the graphics
 * above them as one clip rendered with alpha, so an assembly started in Pulp
 * is finished where finishing belongs.
 *
 * FCPXML carries the spine of cuts with the graphics connected above the
 * first, and a dissolve travels as a cross dissolve **only where both sides
 * have the handle material it needs** — half the duration past each cut's
 * window — since an editor would otherwise refuse the file; without handles,
 * and for a dip or a wipe, the boundary travels as the cut it lands on. The
 * EDL carries every transition the format has words for: `D` for a dissolve
 * or a dip, `W001` for a wipe, each named in a comment.
 *
 * The second picture track (milestone 57) — the project's video layers, a
 * clip anywhere over the shots — travels as connected clips on a lane of its
 * own between the spine and the graphics, with the transform and the crop the
 * format has words for, and as V2 events in the EDL.
 *
 * Pure text over plain values; times are whole frames at the sequence's rate,
 * which is what both formats are made of.
 */

import { cutRates, cutSeconds, cutSourceTime, cutWindows, transitionAt, type Cut, type CutTrack } from './cut-track';

/** What a cut's clip resolves to: the file as it lies, and what was measured about it. */
export interface EditClip {
  path: string;
  name: string;
  /** Seconds the whole file runs for. */
  duration: number;
  /** Whether the file carries an audio stream, which FCPXML wants said. */
  audio: boolean;
}

export interface EditExportInput {
  /** The project's name, which the event, the sequence and the EDL title carry. */
  name: string;
  fps: number;
  width: number;
  height: number;
  track: CutTrack;
  /** Each cut's clip by id; every cut's id must answer. */
  clips: Record<string, EditClip>;
  /** The graphics rendered with alpha, connected above the cuts for the piece's whole length. */
  graphics?: { path: string; seconds: number };
  /**
   * The second picture track (milestone 57): the project's video layers, each
   * a clip placed anywhere on the timeline over the shots, written as a lane
   * of connected clips between the spine and the graphics, with its framing —
   * where it sits, how large, what is cropped — as near as the format says it.
   */
  overlays?: EditOverlay[];
}

/** One clip of the second picture track, as the exported edit places it. */
export interface EditOverlay {
  /** The clip's library id, which must answer in `clips`. */
  id: string;
  /** The layer's own name, which the editor shows on the clip. */
  name: string;
  /** Seconds into the file it plays from and to. */
  from: number;
  to: number;
  /** Seconds into the piece it starts. */
  at: number;
  /** The rate it plays at; 1 is real time. */
  speed: number;
  /** Its centre's offset from the frame's centre, as fractions of the frame's width and height; down is positive. */
  dx: number;
  dy: number;
  /** Its height as a fraction of the frame's height. */
  height: number;
  /** Fractions of each edge cut away, if any. */
  crop?: { left: number; top: number; right: number; bottom: number };
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** A path as a file URL, Windows drives and spaces included. */
export function fileUrl(path: string): string {
  const slashed = path.split('\\').join('/');
  return encodeURI(`file://${slashed.startsWith('/') ? '' : '/'}${slashed}`).replace(/#/g, '%23');
}

/** Seconds as a whole-frame rational, the only time FCPXML trusts. */
const rational = (seconds: number, fps: number): string => `${Math.round(seconds * fps)}/${fps}s`;

/**
 * A dissolve may only travel to FCPXML where both sides hold the handle
 * material it overlaps — half its duration past each cut's window; an editor
 * refuses a transition over material that is not there.
 */
export function dissolveHandles(track: CutTrack, index: number, clips: Record<string, EditClip>): boolean {
  const transition = transitionAt(track, index);
  if (transition?.type !== 'dissolve') return false;
  const a = track.cuts[index]!;
  const b = track.cuts[index + 1]!;
  const half = transition.seconds / 2;
  const aFile = clips[a.id]?.duration ?? a.to;
  return a.to + half <= aFile + 1e-9 && b.from - half >= -1e-9 && b.from - half >= 0;
}

/** The cut track as FCPXML 1.10: resources, one event, one project, the spine of cuts. */
export function fcpxmlEdit(input: EditExportInput): string {
  const { track, fps, clips } = input;
  const windows = cutWindows(track);
  const overlays = input.overlays ?? [];
  const ids = [...new Set([...track.cuts.map((c) => c.id), ...overlays.map((o) => o.id)])];
  const assetId = new Map(ids.map((id, i) => [id, `r${i + 2}`]));
  const graphicsId = `r${ids.length + 2}`;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.10">',
    '  <resources>',
    `    <format id="r1" frameDuration="1/${fps}s" width="${input.width}" height="${input.height}"/>`,
  ];
  for (const id of ids) {
    const clip = clips[id]!;
    lines.push(
      `    <asset id="${assetId.get(id)}" name="${escapeXml(clip.name)}" start="0s" duration="${rational(clip.duration, fps)}" hasVideo="1"${clip.audio ? ' hasAudio="1"' : ''} format="r1">`,
      `      <media-rep kind="original-media" src="${escapeXml(fileUrl(clip.path))}"/>`,
      '    </asset>',
    );
  }
  if (input.graphics) {
    lines.push(
      `    <asset id="${graphicsId}" name="${escapeXml(input.name)} graphics" start="0s" duration="${rational(input.graphics.seconds, fps)}" hasVideo="1" format="r1">`,
      `      <media-rep kind="original-media" src="${escapeXml(fileUrl(input.graphics.path))}"/>`,
      '    </asset>',
    );
  }
  const overlayEnd = overlays.reduce((end, o) => Math.max(end, o.at + (o.to - o.from) / o.speed), 0);
  const total = Math.max(input.graphics?.seconds ?? 0, windows[windows.length - 1]?.end ?? 0, overlayEnd);
  lines.push(
    '  </resources>',
    '  <library>',
    `    <event name="${escapeXml(input.name)}">`,
    `      <project name="${escapeXml(input.name)}">`,
    `        <sequence format="r1" duration="${rational(total, fps)}">`,
    '          <spine>',
  );
  track.cuts.forEach((cut, index) => {
    const clip = clips[cut.id]!;
    // A dissolve with the handles it needs sits between the clips it joins.
    if (index > 0 && dissolveHandles(track, index - 1, clips)) {
      const transition = transitionAt(track, index - 1)!;
      lines.push(`            <transition name="Cross Dissolve" offset="${rational(transition.at - transition.seconds / 2, fps)}" duration="${rational(transition.seconds, fps)}"/>`);
    }
    const open = `            <asset-clip ref="${assetId.get(cut.id)}" name="${escapeXml(clip.name)}" offset="${rational(windows[index]!.start, fps)}" start="${rational(cut.from, fps)}" duration="${rational(cutSeconds(cut), fps)}" format="r1"`;
    const inside: string[] = [];
    if (index === 0) {
      // The second picture track rides connected above the first cut on lane 1 (milestone 57),
      // each clip at its own moment, and the graphics above them all on lane 2, from the top of
      // the piece. A connected clip's offset is in the parent's own time, which starts at `start`.
      for (const overlay of overlays) {
        const clip = clips[overlay.id]!;
        const seconds = (overlay.to - overlay.from) / overlay.speed;
        inside.push(
          `              <asset-clip lane="1" ref="${assetId.get(overlay.id)}" name="${escapeXml(overlay.name)}" offset="${rational(cut.from + overlay.at, fps)}" start="${rational(overlay.from, fps)}" duration="${rational(seconds, fps)}" format="r1">`,
          ...overlayAdjustLines(overlay, input.width, input.height),
          ...timeMapLines({ id: overlay.id, from: overlay.from, to: overlay.to, ...(overlay.speed !== 1 ? { speed: { rate: overlay.speed } } : {}) }, fps),
          '              </asset-clip>',
        );
        void clip;
      }
      if (input.graphics) {
        inside.push(`              <asset-clip lane="${overlays.length > 0 ? 2 : 1}" ref="${graphicsId}" name="${escapeXml(input.name)} graphics" offset="${rational(cut.from, fps)}" start="0s" duration="${rational(input.graphics.seconds, fps)}" format="r1"/>`);
      }
    }
    inside.push(...timeMapLines(cut, fps));
    if (inside.length > 0) lines.push(`${open}>`, ...inside, '            </asset-clip>');
    else lines.push(`${open}/>`);
  });
  lines.push('          </spine>', '        </sequence>', '      </project>', '    </event>', '  </library>', '</fcpxml>', '');
  return lines.join('\n');
}

/**
 * Where a clip of the second picture track sits (milestone 57), as FCPXML
 * says it: the transform's position in pixels of the project's frame from its
 * centre, up positive, and its scale against a clip that fills the frame's
 * height; the crop as the fraction of each edge trimmed away. An editor's own
 * fit of a clip to the frame is the thing the scale is relative to, so a clip
 * of another shape lands near rather than exactly — the layout's anchor is the
 * frame's centre and nothing finer, which is said in the comment it carries.
 */
function overlayAdjustLines(overlay: EditOverlay, width: number, height: number): string[] {
  const num = (v: number) => String(Math.round(v * 1000) / 1000);
  const lines = [
    `                <adjust-transform position="${num(overlay.dx * width)} ${num(-overlay.dy * height)}" scale="${num(overlay.height)} ${num(overlay.height)}"/>`,
  ];
  if (overlay.crop) {
    lines.push(
      '                <adjust-crop mode="trim">',
      `                  <trim-rect left="${num(overlay.crop.left * width)}" right="${num(overlay.crop.right * width)}" top="${num(overlay.crop.top * height)}" bottom="${num(overlay.crop.bottom * height)}"/>`,
      '                </adjust-crop>',
    );
  }
  return lines;
}

/**
 * A retimed cut's time map (milestone 56), as FCPXML says it: points pairing
 * a moment of the clip on the timeline with the second of the file it shows.
 * Two points are a constant speed or a held frame; a ramp is the quadratic
 * `cutSourceTime` integrates, sampled at a handful of points joined
 * linearly, which an editor plays as a close stepped ramp. Nothing in real
 * time: an ordinary clip carries no map.
 */
function timeMapLines(cut: Pick<Cut, 'id' | 'from' | 'to' | 'speed' | 'hold'>, fps: number): string[] {
  const { start, end } = cutRates(cut);
  if (cut.hold === undefined && start === 1 && end === 1) return [];
  const seconds = cutSeconds(cut);
  const points = cut.hold !== undefined || start === end ? 2 : 6;
  const lines = ['              <timeMap>'];
  for (let k = 0; k < points; k++) {
    const t = (seconds * k) / (points - 1);
    lines.push(`                <timept time="${rational(t, fps)}" value="${rational(cutSourceTime(cut, t), fps)}" interp="linear"/>`);
  }
  lines.push('              </timeMap>');
  return lines;
}

/**
 * The speed a cut plays at, as an EDL's `M2` motion memory line says it: the
 * frames per second the source runs at, which is the sequence rate times the
 * rate, and the source timecode it starts from. A ramp has no words in the
 * format, so it is written at its mean with a comment saying the two ends; a
 * freeze frame is a speed of nothing.
 */
function motionLines(cut: Cut, fps: number): string[] {
  const { start, end } = cutRates(cut);
  if (cut.hold === undefined && start === 1 && end === 1) return [];
  const mean = cut.hold !== undefined ? 0 : (start + end) / 2;
  const lines = [`M2   AX       ${(fps * mean).toFixed(1).padStart(5, '0')}                ${timecode(cut.from, fps)}`];
  if (cut.hold !== undefined) lines.push(`* FREEZE FRAME: ${cut.hold} s`);
  else if (start !== end) lines.push(`* SPEED RAMP: ${Math.round(start * 100)}% TO ${Math.round(end * 100)}%`);
  return lines;
}

/** Frames as a non-drop timecode at the sequence's rate. */
export function timecode(seconds: number, fps: number): string {
  const frames = Math.round(seconds * fps);
  const f = frames % fps;
  const total = Math.floor(frames / fps);
  const two = (v: number) => String(v).padStart(2, '0');
  return `${two(Math.floor(total / 3600))}:${two(Math.floor(total / 60) % 60)}:${two(total % 60)}:${two(f)}`;
}

/**
 * The cut track as a CMX3600-style EDL: one video event per cut, reel AX with
 * the file named in comments, a dissolve or a dip as `D`, a wipe as `W001`.
 * The graphics have no track of their own in an EDL, so the file is named in
 * the header for the editor to place.
 */
export function edlEdit(input: EditExportInput): string {
  const { track, fps, clips } = input;
  const windows = cutWindows(track);
  const lines: string[] = [`TITLE: ${input.name}`, 'FCM: NON-DROP FRAME'];
  if (input.graphics) lines.push(`* GRAPHICS WITH ALPHA: ${input.graphics.path}`);
  lines.push('');
  const tc = (seconds: number) => timecode(seconds, fps);
  track.cuts.forEach((cut, index) => {
    const clip = clips[cut.id]!;
    const into = index > 0 ? transitionAt(track, index - 1) : null;
    const event = String(index + 1).padStart(3, '0');
    const kind = into ? (into.type === 'wipe' ? 'W001' : 'D   ') : 'C   ';
    const span = into ? ` ${String(Math.round(into.seconds * fps)).padStart(3, '0')}` : '    ';
    lines.push(`${event}  AX       V     ${kind}${span} ${tc(cut.from)} ${tc(cut.to)} ${tc(windows[index]!.start)} ${tc(windows[index]!.end)}`);
    lines.push(...motionLines(cut, fps));
    if (into?.type === 'dip') lines.push(`* DIP TO COLOR: ${into.color}`);
    if (into?.type === 'wipe' && into.template) lines.push(`* WIPE: ${into.template}`);
    lines.push(`* FROM CLIP NAME: ${clip.name}`, `* SOURCE FILE: ${clip.path}`, '');
  });
  // The second picture track as V2 events (milestone 57): where each clip sits over the shots, its
  // speed as a motion line, and its framing in comments, since an EDL has no words for a transform.
  (input.overlays ?? []).forEach((overlay, k) => {
    const clip = clips[overlay.id]!;
    const event = String(track.cuts.length + k + 1).padStart(3, '0');
    const seconds = (overlay.to - overlay.from) / overlay.speed;
    lines.push(`${event}  AX       V2    C        ${tc(overlay.from)} ${tc(overlay.to)} ${tc(overlay.at)} ${tc(overlay.at + seconds)}`);
    if (overlay.speed !== 1) lines.push(`M2   AX       ${(fps * overlay.speed).toFixed(1).padStart(5, '0')}                ${tc(overlay.from)}`);
    lines.push(`* PICTURE IN PICTURE: ${overlay.name}, ${Math.round(overlay.height * 100)}% of the frame's height, centre ${Math.round(overlay.dx * 100)}% across and ${Math.round(overlay.dy * 100)}% down from the frame's centre`);
    if (overlay.crop) lines.push(`* CROP: left ${Math.round(overlay.crop.left * 100)}%, top ${Math.round(overlay.crop.top * 100)}%, right ${Math.round(overlay.crop.right * 100)}%, bottom ${Math.round(overlay.crop.bottom * 100)}%`);
    lines.push(`* FROM CLIP NAME: ${clip.name}`, `* SOURCE FILE: ${clip.path}`, '');
  });
  return lines.join('\n');
}
