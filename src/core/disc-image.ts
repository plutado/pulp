/**
 * A stock library from a disc image (milestone 32): an `.iso` or a `.dmg` of
 * stock media that is not mounted yet. Pulp mounts it read-only with the
 * platform's own tool, lists what is on it as a stock library, and when it
 * cannot — a format the platform does not mount, a damaged image, no tool —
 * says so plainly. The image is never written to: every mount asks for
 * read-only, so even a writable image stays as it was.
 *
 * This is the pure part: which files are disc images here, the commands that
 * mount and unmount one, and how their output is read. The main process runs
 * them (src/main/disc-image-service.ts).
 */

export type MountPlatform = 'darwin' | 'win32' | 'linux';

/** The kinds a platform's own tool mounts: hdiutil, Mount-DiskImage, udisksctl. */
export const DISC_IMAGE_EXTENSIONS: Readonly<Record<MountPlatform, readonly string[]>> = {
  darwin: ['.dmg', '.iso', '.cdr', '.toast', '.img', '.sparseimage', '.sparsebundle'],
  win32: ['.iso', '.vhd', '.vhdx', '.img'],
  linux: ['.iso', '.img', '.dmg'],
};

/** Every kind any platform mounts, for the picker's filter and for telling a disc image apart from a folder. */
export const ANY_DISC_IMAGE_EXTENSIONS: readonly string[] = [...new Set(Object.values(DISC_IMAGE_EXTENSIONS).flat())];

function extensionOf(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

export function isDiscImagePath(file: string): boolean {
  return ANY_DISC_IMAGE_EXTENSIONS.includes(extensionOf(file));
}

/** The image's kind as said to a person: ".dmg". */
export function discImageKind(file: string): string {
  return extensionOf(file);
}

/** Whether this platform's tool mounts the image's kind. */
export function platformMounts(file: string, platform: MountPlatform): boolean {
  return DISC_IMAGE_EXTENSIONS[platform].includes(extensionOf(file));
}

/** The image's name as a library is called: the file's own name without its extension. */
export function discImageName(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? file;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** One command to run: the program and its arguments, never a shell line. */
export interface Command {
  program: string;
  args: string[];
}

/** PowerShell's single-quoted string: a quote inside is doubled. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The command that mounts an image read-only and tells where. macOS: hdiutil, as a plist, not
 * browsed by the Finder, without the long verification. Windows: PowerShell's Mount-DiskImage with
 * ReadOnly access, answering the drive letter. Linux: udisksctl sets up a read-only loop device
 * (`mountLinuxCommand` then mounts it).
 */
export function mountCommand(image: string, platform: MountPlatform): Command {
  switch (platform) {
    case 'darwin':
      return { program: 'hdiutil', args: ['attach', '-readonly', '-nobrowse', '-noverify', '-plist', image] };
    case 'win32':
      // i18n-exempt(technical): a PowerShell command
      return { program: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', `Mount-DiskImage -ImagePath ${psQuote(image)} -Access ReadOnly -PassThru | Get-Volume | Select-Object -ExpandProperty DriveLetter`] };
    case 'linux':
      return { program: 'udisksctl', args: ['loop-setup', '-r', '-f', image] };
  }
}

/** Linux's second step: mount the loop device udisksctl set up (read-only, as the device is). */
export function mountLinuxCommand(device: string): Command {
  return { program: 'udisksctl', args: ['mount', '-b', device] };
}

/**
 * Where the mount landed, from the tool's output; null when it said nothing usable. macOS answers
 * a plist whose one entity with a `mount-point` is the volume; Windows a drive letter; Linux the
 * loop-setup line ("Mapped file … as /dev/loop3.") on the first step and "Mounted /dev/loop3 at
 * /media/… ." on the second.
 */
export function parseMountOutput(output: string, platform: MountPlatform): string | null {
  switch (platform) {
    case 'darwin': {
      const m = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(output);
      return m ? decodePlist(m[1]!) : null;
    }
    case 'win32': {
      const letter = output.trim().split(/\r?\n/).map((l) => l.trim()).find((l) => /^[A-Za-z]$/.test(l));
      return letter ? `${letter.toUpperCase()}:\\` : null;
    }
    case 'linux': {
      const mounted = /Mounted \S+ at (.+?)\.?\s*$/m.exec(output);
      return mounted ? mounted[1]!.trim() : null;
    }
  }
}

/** The loop device Linux's first step made: "Mapped file x.iso as /dev/loop3." */
export function parseLoopDevice(output: string): string | null {
  const m = /Mapped file .* as (\/dev\/\S+?)\.?\s*$/m.exec(output);
  return m ? m[1]! : null;
}

/** The few entities a plist escapes in a string. */
function decodePlist(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** The commands that undo a mount, in order. Linux unmounts the loop device and then deletes it. */
export function unmountCommands(image: string, mountPoint: string, platform: MountPlatform, device?: string): Command[] {
  switch (platform) {
    case 'darwin':
      return [{ program: 'hdiutil', args: ['detach', mountPoint] }];
    case 'win32':
      // i18n-exempt(technical): a PowerShell command
      return [{ program: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', `Dismount-DiskImage -ImagePath ${psQuote(image)}`] }];
    case 'linux':
      return device
        ? [{ program: 'udisksctl', args: ['unmount', '-b', device] }, { program: 'udisksctl', args: ['loop-delete', '-b', device] }]
        : [];
  }
}

/** Why an image could not be mounted, for a message in the person's language. */
export type MountProblem =
  /** The platform's tool does not mount this kind: a .dmg on Windows. */
  | { kind: 'format'; ext: string }
  /** The tool is not installed: udisksctl on a Linux without udisks. */
  | { kind: 'no-tool'; program: string }
  /** The tool refused, in its own words: a damaged image, an unknown format, a password. */
  | { kind: 'refused'; detail: string }
  /** The image file is not there: on a drive that is not connected. */
  | { kind: 'missing' };

/** The tool's own last line, for a message: "hdiutil: attach failed - image not recognized". */
export function toolDetail(stderr: string, stdout = ''): string {
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.at(-1) ?? '';
}
