/**
 * The edit exported for an editing app (milestone 49): the FCPXML and the EDL
 * the cut track writes, pinned line for line where a format is a contract —
 * a drifted rational or a transition without its handles is a file an editor
 * refuses, the kind of thing only a test catches.
 */

import { describe, expect, it } from 'vitest';
import { withCutTransition, type CutTrack } from '../src/core/cut-track';
import { dissolveHandles, edlEdit, fcpxmlEdit, fileUrl, timecode, type EditClip } from '../src/core/edit-export';
import { parseXml, findElement } from '../src/core/xml';

const clips: Record<string, EditClip> = {
  aa: { path: '/shots/day one/red & blue.mp4', name: 'red & blue', duration: 10, audio: true },
  bb: { path: 'C:\\shots\\tall.mov', name: 'tall', duration: 5, audio: false },
};
const track = (): CutTrack => ({ cuts: [{ id: 'aa', from: 1, to: 3 }, { id: 'bb', from: 0.5, to: 2 }] });
const input = (t: CutTrack = track()) => ({ name: 'My Short', fps: 30, width: 1920, height: 1080, track: t, clips, graphics: { path: '/out/My Short-graphics.mov', seconds: 4 } });

describe('times and paths', () => {
  it('writes non-drop timecode at the sequence rate, and file URLs both separators survive', () => {
    expect(timecode(0, 30)).toBe('00:00:00:00');
    expect(timecode(3661.5, 30)).toBe('01:01:01:15');
    expect(fileUrl('/shots/day one/red & blue.mp4')).toBe('file:///shots/day%20one/red%20&%20blue.mp4');
    expect(fileUrl('C:\\shots\\tall.mov')).toBe('file:///C:/shots/tall.mov');
  });
});

describe('FCPXML', () => {
  it('writes the spine of cuts with the clips referenced in place and the graphics connected above', () => {
    const xml = fcpxmlEdit(input());
    const root = parseXml(xml);
    expect(root.name).toBe('fcpxml');
    const spine = findElement(root, 'spine')!;
    expect(spine).not.toBeNull();
    // Two cuts: the first carries the graphics on a lane above it.
    const text = xml;
    expect(text).toContain('<asset-clip ref="r2" name="red &amp; blue" offset="0/30s" start="30/30s" duration="60/30s" format="r1">');
    expect(text).toContain('<asset-clip lane="1" ref="r4" name="My Short graphics" offset="30/30s" start="0s" duration="120/30s" format="r1"/>');
    expect(text).toContain('<asset-clip ref="r3" name="tall" offset="60/30s" start="15/30s" duration="45/30s" format="r1"/>');
    // The clips are referenced where they lie, and only the sounded one says it has audio.
    expect(text).toContain('src="file:///shots/day%20one/red%20&amp;%20blue.mp4"');
    expect(text).toContain('src="file:///C:/shots/tall.mov"');
    expect(text).toContain('hasVideo="1" hasAudio="1" format="r1"');
    expect(text).toContain(`frameDuration="1/30s" width="1920" height="1080"`);
    // The sequence runs to the longer of the track and the graphics.
    expect(text).toContain('<sequence format="r1" duration="120/30s">');
  });

  it('writes a cross dissolve only where both sides hold its handles', () => {
    // Both cuts have material past their windows, so a half-second dissolve fits.
    const roomy = withCutTransition(track(), 0, { type: 'dissolve', seconds: 0.5 });
    expect(dissolveHandles(roomy, 0, clips)).toBe(true);
    expect(fcpxmlEdit(input(roomy))).toContain('<transition name="Cross Dissolve" offset="53/30s" duration="15/30s"/>');
    // The second cut starts at the top of its file: nothing before it to overlap, so the
    // boundary travels as the cut it lands on rather than a transition an editor refuses.
    const tight: CutTrack = { cuts: [{ id: 'aa', from: 1, to: 3, transition: { type: 'dissolve', seconds: 0.5 } }, { id: 'bb', from: 0, to: 2 }] };
    expect(dissolveHandles(tight, 0, clips)).toBe(false);
    expect(fcpxmlEdit(input(tight))).not.toContain('<transition');
    // A dip or a wipe never writes one.
    const dipped = withCutTransition(track(), 0, { type: 'dip', seconds: 0.5, color: '#000000' });
    expect(fcpxmlEdit(input(dipped))).not.toContain('<transition');
  });
});

describe('the EDL', () => {
  it('writes one event per cut with the source files named, and the transitions the format has words for', () => {
    const dipped = withCutTransition(track(), 0, { type: 'dip', seconds: 0.5, color: '#00ff00' });
    const edl = edlEdit(input(dipped));
    expect(edl).toContain('TITLE: My Short');
    expect(edl).toContain('FCM: NON-DROP FRAME');
    expect(edl).toContain('* GRAPHICS WITH ALPHA: /out/My Short-graphics.mov');
    expect(edl).toContain('001  AX       V     C        00:00:01:00 00:00:03:00 00:00:00:00 00:00:02:00');
    expect(edl).toContain('002  AX       V     D    015 00:00:00:15 00:00:02:00 00:00:02:00 00:00:03:15');
    expect(edl).toContain('* DIP TO COLOR: #00ff00');
    expect(edl).toContain('* SOURCE FILE: /shots/day one/red & blue.mp4');
    const wiped = withCutTransition(track(), 0, { type: 'wipe', seconds: 1, template: 'pulp.samples.circle-wipe' });
    const wedl = edlEdit(input(wiped));
    expect(wedl).toContain('002  AX       V     W001 030 ');
    expect(wedl).toContain('* WIPE: pulp.samples.circle-wipe');
  });
});

describe('speed changes in the exported edit (milestone 56)', () => {
  it('writes a time map on a retimed clip, and none on an ordinary one', () => {
    const plain = fcpxmlEdit(input());
    expect(plain).not.toContain('<timeMap>');
    // 2 s of file at 2× is 1 s of timeline: the clip runs 30 frames and its map reaches 2 s in.
    const fast: CutTrack = { cuts: [{ id: 'aa', from: 1, to: 3, speed: { rate: 2 } }, { id: 'bb', from: 0.5, to: 2 }] };
    const xml = fcpxmlEdit(input(fast));
    expect(xml).toContain('<asset-clip ref="r2" name="red &amp; blue" offset="0/30s" start="30/30s" duration="30/30s" format="r1">');
    expect(xml).toContain('<timept time="0/30s" value="30/30s" interp="linear"/>');
    expect(xml).toContain('<timept time="30/30s" value="90/30s" interp="linear"/>');
    // The next cut starts where the fast one ends on the timeline.
    expect(xml).toContain('<asset-clip ref="r3" name="tall" offset="30/30s"');
    // A ramp is sampled along its curve; a freeze frame maps its whole length to one frame.
    const ramp: CutTrack = { cuts: [{ id: 'aa', from: 0, to: 4, speed: { rate: 1, to: 3 } }] };
    const curve = fcpxmlEdit(input(ramp));
    expect(curve.match(/<timept /g)).toHaveLength(6);
    expect(curve).toContain('<timept time="60/30s" value="120/30s" interp="linear"/>');
    const hold: CutTrack = { cuts: [{ id: 'aa', from: 2, to: 2.05, hold: 1.5 }] };
    const held = fcpxmlEdit(input(hold));
    expect(held).toContain('duration="45/30s"');
    expect(held).toContain('<timept time="0/30s" value="60/30s" interp="linear"/>');
    expect(held).toContain('<timept time="45/30s" value="60/30s" interp="linear"/>');
    expect(parseXml(held).name).toBe('fcpxml');
  });

  it('writes an M2 motion line per retimed event in the EDL', () => {
    const fast: CutTrack = { cuts: [{ id: 'aa', from: 1, to: 3, speed: { rate: 2 } }, { id: 'bb', from: 0.5, to: 2, speed: { rate: 0.5, to: 2 } }] };
    const edl = edlEdit(input(fast));
    expect(edl).toContain('001  AX       V     C        00:00:01:00 00:00:03:00 00:00:00:00 00:00:01:00\nM2   AX       060.0                00:00:01:00');
    expect(edl).toContain('M2   AX       037.5                00:00:00:15\n* SPEED RAMP: 50% TO 200%');
    const hold = edlEdit(input({ cuts: [{ id: 'aa', from: 2, to: 2.05, hold: 1.5 }] }));
    expect(hold).toContain('M2   AX       000.0                00:00:02:00\n* FREEZE FRAME: 1.5 s');
    expect(edlEdit(input())).not.toContain('M2');
  });
});

describe('the second picture track in the exported edit (milestone 57)', () => {
  const pip = { id: 'bb', name: 'Reaction', from: 0.5, to: 2.5, at: 1, speed: 1, dx: 0.3, dy: -0.25, height: 0.35, crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 } };

  it('writes each clip as a connected clip on a lane of its own, the graphics above them, with its transform and crop', () => {
    const xml = fcpxmlEdit({ ...input(), overlays: [pip] });
    expect(parseXml(xml).name).toBe('fcpxml');
    // Inside the first spine clip, at its own moment in the parent's time (the cut starts at 1 s of its file).
    expect(xml).toContain('<asset-clip lane="1" ref="r3" name="Reaction" offset="60/30s" start="15/30s" duration="60/30s" format="r1">');
    // The frame is 1920 × 1080: 30% across is 576 px right, a quarter up is 270 px up; the scale is the height.
    expect(xml).toContain('<adjust-transform position="576 270" scale="0.35 0.35"/>');
    expect(xml).toContain('<trim-rect left="192" right="192" top="0" bottom="0"/>');
    // The graphics move up a lane to stay on top.
    expect(xml).toContain('<asset-clip lane="2" ref="r4" name="My Short graphics"');
    // The sequence reaches the overlay's end where that is the furthest thing.
    const late = fcpxmlEdit({ ...input(), graphics: undefined, overlays: [{ ...pip, at: 3 }] });
    expect(late).toContain('<sequence format="r1" duration="150/30s">');
    // An overlay at a speed carries a time map like a retimed cut.
    expect(fcpxmlEdit({ ...input(), overlays: [{ ...pip, speed: 2 }] })).toContain('<timept time="30/30s" value="75/30s" interp="linear"/>');
    // Without any, nothing changes: the graphics stay on lane 1.
    expect(fcpxmlEdit(input())).toContain('<asset-clip lane="1" ref="r4"');
  });

  it('writes V2 events in the EDL, with the framing in comments', () => {
    const edl = edlEdit({ ...input(), overlays: [{ ...pip, speed: 2 }] });
    expect(edl).toContain('003  AX       V2    C        00:00:00:15 00:00:02:15 00:00:01:00 00:00:02:00\nM2   AX       060.0                00:00:00:15');
    expect(edl).toContain("* PICTURE IN PICTURE: Reaction, 35% of the frame's height, centre 30% across and -25% down from the frame's centre");
    expect(edl).toContain('* CROP: left 10%, top 0%, right 10%, bottom 0%');
    expect(edl).toContain('* SOURCE FILE: C:\\shots\\tall.mov');
  });
});
