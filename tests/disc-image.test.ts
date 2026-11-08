/**
 * A stock library from a disc image (milestone 32): mounted read-only with the platform's own
 * tool, read as a library, and said plainly when it cannot be. The commands and the parsing are
 * pure and checked here exactly; the service is checked with a runner that mounts nothing.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBrowseTree } from '../src/core/browse-tree';
import { ANY_DISC_IMAGE_EXTENSIONS, discImageName, isDiscImagePath, mountCommand, mountLinuxCommand, parseLoopDevice, parseMountOutput, platformMounts, toolDetail, unmountCommands } from '../src/core/disc-image';
import { libraryAddItems } from '../src/core/menu';
import { sanitizeStockLibraries } from '../src/core/stock-library';
import { forgetMounts, mountDiscImage, mountedAt, mountProblemMessage, unmountAllDiscImages, unmountDiscImage, type MountResult } from '../src/main/disc-image-service';

/** The problem a failed mount carries; a passing one has none, which a test would not ask for. */
const problemOf = (r: MountResult) => (r.ok ? (() => { throw new Error('mounted'); })() : r.problem);

const HDIUTIL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>system-entities</key><array>
<dict><key>content-hint</key><string>GUID_partition_scheme</string><key>dev-entry</key><string>/dev/disk10</string></dict>
<dict><key>content-hint</key><string>Apple_APFS</string><key>dev-entry</key><string>/dev/disk11s1</string><key>mount-point</key><string>/Volumes/Stock &amp; Co 2019</string><key>volume-kind</key><string>apfs</string></dict>
</array></dict></plist>`;

describe('what a disc image is, and how it is mounted', () => {
  it('knows the kinds each platform mounts, and names a library after the image', () => {
    expect(isDiscImagePath('/Volumes/Backup/Stock 2019.iso')).toBe(true);
    expect(isDiscImagePath('C:\\Stock\\Motion.DMG')).toBe(true);
    expect(isDiscImagePath('/Users/a/Stock')).toBe(false);
    expect(platformMounts('a.dmg', 'darwin')).toBe(true);
    expect(platformMounts('a.dmg', 'win32')).toBe(false);
    expect(platformMounts('a.vhdx', 'win32')).toBe(true);
    expect(platformMounts('a.iso', 'linux')).toBe(true);
    expect(ANY_DISC_IMAGE_EXTENSIONS).toEqual(expect.arrayContaining(['.iso', '.dmg', '.toast', '.vhdx']));
    expect(discImageName('/Volumes/Backup/Stock 2019.iso')).toBe('Stock 2019');
  });

  it('asks each platform\'s tool for a read-only mount, as arguments and never a shell line', () => {
    expect(mountCommand('/x/Stock.dmg', 'darwin')).toEqual({ program: 'hdiutil', args: ['attach', '-readonly', '-nobrowse', '-noverify', '-plist', '/x/Stock.dmg'] });
    const win = mountCommand("C:\\Stock\\O'Neil.iso", 'win32');
    expect(win.program).toBe('powershell');
    expect(win.args.at(-1)).toBe("Mount-DiskImage -ImagePath 'C:\\Stock\\O''Neil.iso' -Access ReadOnly -PassThru | Get-Volume | Select-Object -ExpandProperty DriveLetter");
    expect(mountCommand('/x/Stock.iso', 'linux')).toEqual({ program: 'udisksctl', args: ['loop-setup', '-r', '-f', '/x/Stock.iso'] });
    expect(mountLinuxCommand('/dev/loop3')).toEqual({ program: 'udisksctl', args: ['mount', '-b', '/dev/loop3'] });
  });

  it('reads where the mount landed from each tool\'s output, and nothing from output that says nothing', () => {
    expect(parseMountOutput(HDIUTIL_PLIST, 'darwin')).toBe('/Volumes/Stock & Co 2019');
    expect(parseMountOutput('<plist><dict></dict></plist>', 'darwin')).toBeNull();
    expect(parseMountOutput('\r\nE\r\n\r\n', 'win32')).toBe('E:\\');
    expect(parseMountOutput('', 'win32')).toBeNull();
    expect(parseMountOutput('Mounted /dev/loop3 at /media/alex/STOCK 2019.\n', 'linux')).toBe('/media/alex/STOCK 2019');
    expect(parseMountOutput('Mounted /dev/loop3 at /media/alex/STOCK\n', 'linux')).toBe('/media/alex/STOCK');
    expect(parseLoopDevice('Mapped file /x/Stock.iso as /dev/loop3.\n')).toBe('/dev/loop3');
    expect(parseLoopDevice('nothing')).toBeNull();
    expect(toolDetail('hdiutil: attach failed - image not recognized\n')).toBe('hdiutil: attach failed - image not recognized');
  });

  it('undoes a mount with the tool that made it: detach, dismount, or unmount and delete the loop device', () => {
    expect(unmountCommands('/x/a.dmg', '/Volumes/A', 'darwin')).toEqual([{ program: 'hdiutil', args: ['detach', '/Volumes/A'] }]);
    expect(unmountCommands('C:\\a.iso', 'E:\\', 'win32')[0]!.args.at(-1)).toBe("Dismount-DiskImage -ImagePath 'C:\\a.iso'");
    expect(unmountCommands('/x/a.iso', '/media/a/A', 'linux', '/dev/loop3').map((c) => c.args.join(' '))).toEqual(['unmount -b /dev/loop3', 'loop-delete -b /dev/loop3']);
    expect(unmountCommands('/x/a.iso', '/media/a/A', 'linux')).toEqual([]);
  });

  it('is offered under Add beside the folder, in the application menu and the panel alike', () => {
    const items = libraryAddItems({ canAddSampleMedia: false });
    expect(items.map((i) => i.command)).toEqual(['library.addFolder', 'library.addStock', 'library.addStockImage', 'pack.import']);
    expect(items[2]!.label).toBe('Stock Library from Disc Image…');
    expect(items[2]!.detail).toContain('read-only');
  });

  it('keeps the image a library was read from in settings, and says on the tree where it is mounted or why it is not', () => {
    const [lib] = sanitizeStockLibraries([{ path: '/Volumes/Stock 2019', name: 'Stock 2019', addedAt: '', image: ' /x/Stock 2019.dmg ' }, { path: '/a', image: 7 }]);
    expect(lib).toEqual({ path: '/Volumes/Stock 2019', name: 'Stock 2019', addedAt: '', image: '/x/Stock 2019.dmg' });
    const online = buildBrowseTree([], ['/Volumes/Stock 2019'], undefined, [{ ...lib!, online: true, items: 3 }]).find((n) => n.id === 'stock')!.children[0]!;
    expect(online.description).toBe('A disc image, /x/Stock 2019.dmg, mounted read-only at /Volumes/Stock 2019. Pulp never copies or changes it.');
    const offline = buildBrowseTree([], [], undefined, [{ ...lib!, online: false, items: 3, mountProblem: 'Pulp could not mount Stock 2019.dmg: hdiutil: attach failed - image not recognized' }]).find((n) => n.id === 'stock')!.children[0]!;
    expect(offline.offline).toBe(true);
    expect(offline.description).toBe('Its disc image is not mounted: /x/Stock 2019.dmg. Pulp could not mount Stock 2019.dmg: hdiutil: attach failed - image not recognized Its 3 items stay listed meanwhile.');
  });
});

describe('mounting through the service, with a runner that mounts nothing', () => {
  let dir = '';
  afterEach(async () => {
    forgetMounts();
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });
  const image = async (name: string) => {
    dir ||= await mkdtemp(join(tmpdir(), 'pulp-disc-'));
    const file = join(dir, name);
    await writeFile(file, 'not really an image');
    return file;
  };
  type Run = (program: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

  it('mounts read-only and answers the mount point, remembers it, and unmounts it on the way out', async () => {
    const calls: string[] = [];
    const run: Run = async (program, args) => {
      calls.push(`${program} ${args.join(' ')}`);
      return { code: 0, stdout: program === 'hdiutil' && args[0] === 'attach' ? HDIUTIL_PLIST : '', stderr: '' };
    };
    const dmg = await image('Stock.dmg');
    const made = await mountDiscImage(dmg, run, 'darwin');
    expect(made).toEqual({ ok: true, path: '/Volumes/Stock & Co 2019' });
    expect(calls).toEqual([`hdiutil attach -readonly -nobrowse -noverify -plist ${dmg}`]);
    expect(mountedAt(dmg)).toBe('/Volumes/Stock & Co 2019');
    expect(await unmountDiscImage(dmg, run, 'darwin')).toBe(true);
    expect(calls.at(-1)).toBe('hdiutil detach /Volumes/Stock & Co 2019');
    expect(mountedAt(dmg)).toBeUndefined();
    // One Pulp did not mount is left alone.
    expect(await unmountDiscImage(dmg, run, 'darwin')).toBe(false);
  });

  it('says plainly what went wrong: a kind this system does not mount, a tool that is not there, an image that is not there, a tool that refused', async () => {
    const dmg = await image('Stock.dmg');
    const onWindows = await mountDiscImage(dmg, async () => ({ code: 0, stdout: 'E', stderr: '' }), 'win32');
    expect(onWindows).toEqual({ ok: false, problem: { kind: 'format', ext: '.dmg' } });
    expect(mountProblemMessage(problemOf(onWindows), dmg)).toBe('Pulp cannot mount Stock.dmg here: a .dmg is not a kind this system opens. Mount it with another tool and add the drive it opens as.');
    const iso = await image('Stock.iso');
    const noTool = await mountDiscImage(iso, async () => { throw Object.assign(new Error('spawn udisksctl ENOENT'), { code: 'ENOENT' }); }, 'linux');
    expect(noTool).toEqual({ ok: false, problem: { kind: 'no-tool', program: 'udisksctl' } });
    expect(mountProblemMessage(problemOf(noTool), iso)).toContain('udisksctl is not installed');
    const gone = await mountDiscImage(join(dir, 'Nowhere.iso'), async () => ({ code: 0, stdout: '', stderr: '' }), 'darwin');
    expect(gone).toEqual({ ok: false, problem: { kind: 'missing' } });
    const refused = await mountDiscImage(iso, async () => ({ code: 1, stdout: '', stderr: 'hdiutil: attach failed - image not recognized\n' }), 'darwin');
    expect(refused).toEqual({ ok: false, problem: { kind: 'refused', detail: 'hdiutil: attach failed - image not recognized' } });
    expect(mountProblemMessage(problemOf(refused), iso)).toBe('Pulp could not mount Stock.iso: hdiutil: attach failed - image not recognized');
    expect(mountedAt(iso)).toBeUndefined();
  });

  it('on Linux sets up a read-only loop device, mounts it, and deletes it again when the mount fails or ends', async () => {
    const iso = await image('Stock.iso');
    const calls: string[] = [];
    const run: Run = async (program, args) => {
      calls.push(args.join(' '));
      if (args[0] === 'loop-setup') return { code: 0, stdout: `Mapped file ${iso} as /dev/loop3.\n`, stderr: '' };
      if (args[0] === 'mount') return { code: 0, stdout: 'Mounted /dev/loop3 at /media/alex/Stock.\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    expect(await mountDiscImage(iso, run, 'linux')).toEqual({ ok: true, path: '/media/alex/Stock' });
    expect(calls).toEqual([`loop-setup -r -f ${iso}`, 'mount -b /dev/loop3']);
    await unmountAllDiscImages(run, 'linux');
    expect(calls.slice(2)).toEqual(['unmount -b /dev/loop3', 'loop-delete -b /dev/loop3']);
    // The second step failing undoes the first.
    const calls2: string[] = [];
    const failing: Run = async (_p, args) => {
      calls2.push(args.join(' '));
      if (args[0] === 'loop-setup') return { code: 0, stdout: `Mapped file ${iso} as /dev/loop4.\n`, stderr: '' };
      if (args[0] === 'mount') return { code: 1, stdout: '', stderr: 'Error mounting /dev/loop4: unknown filesystem type\n' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const made = await mountDiscImage(iso, failing, 'linux');
    expect(made).toEqual({ ok: false, problem: { kind: 'refused', detail: 'Error mounting /dev/loop4: unknown filesystem type' } });
    expect(calls2.at(-1)).toBe('loop-delete -b /dev/loop4');
  });
});
