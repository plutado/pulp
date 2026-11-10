/**
 * Clip clean-up (milestone 52): the ffmpeg argument lists a key, a grade and
 * a split would run, read here rather than hoped for. A wrong escape in a LUT
 * path or a cut parsed off by a second is footage quietly ruined, the kind of
 * thing only this test or a re-watch catches.
 */

import { describe, expect, it } from 'vitest';
import { featureStatus } from '../src/core/ffmpeg-needs';
import {
  chromaKeyArgs, chromaKeyFilter, chromaKeyStillArgs, despillType, filterQuoted, isCubeFile, KEY_DEFAULTS,
  keyedClipPath, lutFilter, MIN_SCENE_SECONDS, parseSceneCuts, sanitizeChromaKey, sceneDetectArgs, sceneFolder,
  scenePattern, sceneSplitArgs,
  passSeconds, sanitizeStabilize, STABILIZE_DEFAULTS, stabilizeDetectArgs, stabilizedClipPath, stabilizeTransformArgs,
} from '../src/core/clip-clean';

describe('the LUT filter', () => {
  it('quotes a path for a filtergraph, a Windows one included', () => {
    expect(lutFilter('/luts/warm look.cube')).toBe("lut3d=file='/luts/warm look.cube'");
    // Backslashes become the forward slashes ffmpeg takes on Windows too, and the drive's colon is
    // escaped: the graph strips the quotes before the filter splits its options at colons.
    expect(lutFilter('C:\\LUTs\\teal.cube')).toBe("lut3d=file='C\\:/LUTs/teal.cube'");
    expect(filterQuoted("o'brien.cube")).toBe("'o'\\''brien.cube'");
  });

  it('knows a .cube when it sees one', () => {
    expect(isCubeFile('/a/b.cube')).toBe(true);
    expect(isCubeFile('/a/B.CUBE')).toBe(true);
    expect(isCubeFile('/a/b.cube.txt')).toBe(false);
    expect(isCubeFile('/a/b.look')).toBe(false);
  });
});

describe('the chroma key', () => {
  it('keeps every setting in range and starts from studio green', () => {
    expect(sanitizeChromaKey(undefined)).toEqual(KEY_DEFAULTS);
    expect(sanitizeChromaKey({ color: '#0000FF', tolerance: 5, spill: -1 })).toEqual({ color: '#0000ff', tolerance: 0.9, spill: 0 });
    expect(sanitizeChromaKey({ color: 'green' }).color).toBe(KEY_DEFAULTS.color);
  });

  it('washes the spill the way of the key color, and not at all for one that is neither green nor blue', () => {
    expect(despillType('#00ff00')).toBe('green');
    expect(despillType('#1133aa')).toBe('blue');
    expect(despillType('#ff2200')).toBeNull();
    expect(chromaKeyFilter({ color: '#00ff00', tolerance: 0.18, spill: 0.5 })).toBe('chromakey=color=0x00ff00:similarity=0.18:blend=0.09,despill=type=green:mix=0.5');
    expect(chromaKeyFilter({ color: '#ff2200', tolerance: 0.2, spill: 0.5 })).not.toContain('despill');
    expect(chromaKeyFilter({ color: '#00ff00', tolerance: 0.2, spill: 0 })).not.toContain('despill');
  });

  it('renders the whole clip to ProRes 4444 with its sound kept, beside the original', () => {
    const args = chromaKeyArgs('/lib/take.mp4', KEY_DEFAULTS, '/lib/take alpha.mov');
    expect(args).toContain('prores_ks');
    expect(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2)).toEqual(['-c:a', 'copy']);
    expect(args[args.length - 1]).toBe('/lib/take alpha.mov');
    expect(args[args.indexOf('-vf') + 1]).toContain('format=yuva444p10le');
    expect(keyedClipPath('/lib/take.mp4')).toBe('/lib/take alpha.mov');
    expect(keyedClipPath('C:\\clips\\take.mov')).toBe('C:\\clips\\take alpha.mov');
  });

  it('draws one frame for the dialog, plain or keyed, small and with alpha', () => {
    const plain = chromaKeyStillArgs('/lib/take.mp4', null, 2);
    expect(plain.join(' ')).toContain('-ss 2 -i /lib/take.mp4');
    expect(plain[plain.indexOf('-vf') + 1]).not.toContain('chromakey');
    const keyed = chromaKeyStillArgs('/lib/take.mp4', KEY_DEFAULTS, 2);
    expect(keyed[keyed.indexOf('-vf') + 1]).toContain('chromakey');
    expect(keyed[keyed.indexOf('-vf') + 1]).toContain('format=rgba');
  });
});

describe('scene detection', () => {
  it('asks for every frame scored and reads the cuts showinfo printed, sorted and thinned', () => {
    const detect = sceneDetectArgs('/lib/long.mp4');
    expect(detect[detect.indexOf('-vf') + 1]).toBe("select='gt(scene,0.4)',showinfo");
    const stderr = [
      '[Parsed_showinfo_1 @ 0x1] n: 0 pts: 1024 pts_time:8.2 duration...',
      '[Parsed_showinfo_1 @ 0x1] n: 1 pts: 2048 pts_time:3.5 foo',
      // A flash scores like a cut; within a second of the one before it is not a scene.
      '[Parsed_showinfo_1 @ 0x1] n: 2 pts: 2049 pts_time:3.9 bar',
      `[Parsed_showinfo_1 @ 0x1] n: 3 pts: 2050 pts_time:0.4 too-early`,
    ].join('\n');
    expect(parseSceneCuts(stderr)).toEqual([3.5, 8.2]);
    expect(MIN_SCENE_SECONDS).toBeGreaterThan(0);
    expect(parseSceneCuts('no cuts here')).toEqual([]);
  });

  it('splits by stream copy into a folder beside the original, timestamps starting over', () => {
    const args = sceneSplitArgs('/lib/long.mp4', [3.5, 8.2], '/lib/long scenes/long_%03d.mp4');
    expect(args.slice(args.indexOf('-c'), args.indexOf('-c') + 2)).toEqual(['-c', 'copy']);
    expect(args[args.indexOf('-segment_times') + 1]).toBe('3.5,8.2');
    expect(args).toContain('-reset_timestamps');
    expect(sceneFolder('/lib/long.mp4')).toBe('/lib/long scenes');
    expect(scenePattern('/lib/long.mp4')).toBe('long_%03d.mp4');
    expect(scenePattern('C:\\clips\\b-roll.mov')).toBe('b-roll_%03d.mov');
  });
});

describe('stabilization (milestone 78)', () => {
  it('keeps every setting in range and starts from a gentle smoothing with the edges zoomed away', () => {
    expect(sanitizeStabilize(undefined)).toEqual(STABILIZE_DEFAULTS);
    expect(sanitizeStabilize({ smoothing: 200, edges: 'keep' })).toEqual({ smoothing: 60, edges: 'keep' });
    expect(sanitizeStabilize({ smoothing: -3, edges: 'sideways' })).toEqual({ smoothing: 1, edges: 'zoom' });
    expect(sanitizeStabilize({ smoothing: 14.6 })).toEqual({ smoothing: 15, edges: 'zoom' });
  });

  it('reads the motion in pass one and renders the steadier clip in pass two, its sound kept', () => {
    const detect = stabilizeDetectArgs('/clips/take 1.mp4', '/tmp/t.trf');
    expect(detect).toEqual(expect.arrayContaining(['-i', '/clips/take 1.mp4', '-f', 'null', '-']));
    expect(detect.join(' ')).toContain("vidstabdetect=result='/tmp/t.trf':shakiness=8");
    const zoomed = stabilizeTransformArgs('/clips/take 1.mp4', '/tmp/t.trf', { smoothing: 20, edges: 'zoom' }, '/clips/take 1 steady.mov');
    expect(zoomed.join(' ')).toContain("vidstabtransform=input='/tmp/t.trf':smoothing=20:optzoom=1:crop=black,unsharp");
    expect(zoomed).toEqual(expect.arrayContaining(['-c:v', 'prores_ks', '-c:a', 'copy', '/clips/take 1 steady.mov']));
    const kept = stabilizeTransformArgs('/clips/a.mp4', 'C\\x\\t.trf', { smoothing: 5, edges: 'keep' }, '/clips/a steady.mov');
    expect(kept.join(' ')).toContain('optzoom=0:crop=keep');
    // A Windows transforms path is quoted for the filtergraph like a LUT's.
    expect(kept.join(' ')).toContain("input='C/x/t.trf'");
  });

  it('names the steadied clip beside the original, whatever the original is called', () => {
    expect(stabilizedClipPath('/media/B-roll/take 1.mp4')).toBe('/media/B-roll/take 1 steady.mov');
    expect(stabilizedClipPath('C\\media\\clip.mov')).toBe('C\\media\\clip steady.mov');
    expect(stabilizedClipPath('/media/no-extension')).toBe('/media/no-extension steady.mov');
  });

  it('knows an ffmpeg with vid.stab from one without, through the feature table (milestone 88)', () => {
    const caps = (filters: string[]) => ({ filters, encoders: null, decoders: null });
    expect(featureStatus(caps(['vidstabdetect', 'vidstabtransform']), 'stabilize').ok).toBe(true);
    expect(featureStatus(caps(['vidstabdetect']), 'stabilize')).toMatchObject({ ok: false, missing: ['vidstabtransform'], library: 'libvidstab' });
    expect(featureStatus(caps(['deshake']), 'stabilize').missing).toEqual(['vidstabdetect', 'vidstabtransform']);
  });

  it('reads how far a pass has reached off ffmpeg\'s own progress line, the newest mention winning', () => {
    expect(passSeconds('frame=  120 fps= 30 time=00:00:04.00 bitrate=...')).toBe(4);
    expect(passSeconds('time=00:01:02.50 ...\ntime=01:00:00.25 ...')).toBe(3600.25);
    expect(passSeconds('frame=  120 fps= 30 bitrate=...')).toBeNull();
    expect(passSeconds('')).toBeNull();
  });
});
