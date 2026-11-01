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
