/**
 * The `pulp` command (milestone 8's command line, made proper): subcommands,
 * flags, help text and exit codes, parsed here and run by the main process.
 *
 *   pulp render <template-id> --out <path> [options]
 *   pulp collection <file.pulpcollection> --out <folder> [options]
 *   pulp sample-media <folder> [--types <type,type>]
 *   pulp visual-hashes <file> [--check]
 *   pulp help [command]   ·   pulp version
 *
 * The older spelling — `--render <id>`, `--collection <file>`, `--sample-media
 * <folder>`, `--visual-hashes <file>` as flags on the app itself — is still
 * read, translated to the subcommand it always meant, so scripts written
 * against it keep working.
 *
 * Pure: it reads an argument list and answers with what was asked, a usage
 * error, or help to print. It knows nothing of Electron, files or the
 * library; the main process validates values that need the template (a
 * timecode at its frame rate, a layer stack against its blocks) and runs the
 * work. One flag table per command is the parser's rule book **and** the
 * help text, so the two cannot drift.
 *
 * Exit codes, as the shell reads them:
 *   0  the work was done (a render written, a collection rendered in full)
 *   1  the work failed — ffmpeg refused, a template threw, an item in a
 *      collection or a row in a batch did not render
 *   2  the command line was wrong — an unknown command or flag, a missing
 *      value, a template, preset or platform that is not known
 */

import { isProjectFile } from './open-file';

export const EXIT_CODES = { ok: 0, failed: 1, usage: 2 } as const;

export const CLI_COMMANDS = ['render', 'collection', 'sample-media', 'visual-hashes', 'safe-box', 'help', 'version'] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

/** One flag a command takes: its spelling, whether it takes a value (and what to call it), and the help line. */
export interface CliFlag {
  name: string;
  /** The placeholder shown in help; absent for a switch that takes no value. */
  value?: string;
  /** May be given more than once; every value is kept, in order. */
  repeat?: boolean;
  help: string;
}

interface CliCommandSpec {
  name: CliCommand;
  /** The positional argument the command takes, if one. */
  positional?: { name: string; required: boolean };
  summary: string;
  flags: readonly CliFlag[];
  /** Lines under the flags: what the exit codes mean here, examples. */
  notes?: readonly string[];
}

const LIBRARY_FLAG: CliFlag = { name: '--library', value: '<folder>', repeat: true, help: 'Add a template folder for this run only; repeatable, never saved to settings.' };
const FRAME_TIMEOUT_FLAG: CliFlag = { name: '--frame-timeout', value: '<seconds>', help: 'How long one frame may take before the template is treated as hung (default 10).' };
const FRAME_FORMAT_FLAG: CliFlag = { name: '--frame-format', value: 'raw|png', help: 'How frames travel to ffmpeg; raw is the default, png the slower reference path.' };

export const CLI_SPECS: readonly CliCommandSpec[] = [
  {
    name: 'render',
    positional: { name: '<template-id>', required: true },
    summary: 'Render a template to a file, an image sequence, a CSV batch, or export its edit.',
    flags: [
      { name: '--out', value: '<path>', help: 'Where to write: a file for a video or a still, a folder for a sequence or a batch. Required, except with --export-edit.' },
      { name: '--preset', value: '<preset-id>', help: 'Output preset: prores-4444 (default), prores-422hq, dnxhr-hq, dnxhr-hqx, qt-animation, webm-vp9-alpha, h264-mp4, hevc-alpha (macOS), png-sequence, png-still, gif, webp-animated, apng.' },
      { name: '--param', value: 'key=value', repeat: true, help: 'A parameter, by id; repeatable. @layers, @track, @captions and @sound take their JSON or value; @length a number of seconds.' },
      { name: '--length', value: '<seconds|tc>', help: 'Run the graphic for another length, for a template that declares what may stretch.' },
      { name: '--fps', value: '<rate>', help: 'Sample the template at another standard frame rate (23.976 … 120).' },
      { name: '--aspect', value: '16:9|9:16|1:1|4:5', help: 'One of the shapes the template draws for.' },
      { name: '--size', value: '<width>x<height>', help: 'An exact output size, of the chosen aspect.' },
      { name: '--platform', value: '<platform-id>', help: 'Set the aspect, size, rate and preset a platform asks for (tiktok, instagram-reels, youtube-shorts, youtube, x, linkedin, facebook-feed, instagram-feed) and warn past its limits.' },
      { name: '--image-fps', value: '<rate>', help: 'GIF, animated WebP and APNG: their own frame rate (10, 12, 15, 20, 24, 25 or 30), only ever fewer frames than the render, or full for the render\'s own; a GIF\'s is 15 unless set.' },
      { name: '--image-width', value: '<pixels>', help: 'GIF, animated WebP and APNG: scale down to this width, the height following, or full for the render\'s own; a GIF\'s is 480 unless set.' },
      { name: '--background', value: '#RRGGBB', help: 'The color an alpha template is flattened over in a preset without alpha (default black).' },
      { name: '--in-point', value: '<tc|frame|Ns>', help: 'First frame to render, at the output rate: timecode, a frame number, or seconds such as 2.5s.' },
      { name: '--out-point', value: '<tc|frame|Ns>', help: 'Last frame to render, inclusive.' },
      { name: '--cover-at', value: '<tc|frame|Ns>', help: 'Write a still of this frame beside the render as <name>-cover.png.' },
      { name: '--lut', value: '<file.cube>', help: 'Grade the whole render through a .cube LUT.' },
      { name: '--captions', value: 'burn|track|none', help: 'How the project\'s captions reach the render; SRT and WebVTT are written beside it either way.' },
      { name: '--stems', value: 'mix|files', help: 'Music that came in as stems: folded into the mix (default), or one WAV per stem beside the render.' },
      { name: '--batch', value: '<file.csv>', help: 'One render per CSV row into the --out folder; headers match parameter ids or labels, a name column names the files.' },
      { name: '--export-edit', value: '<base>', help: 'Instead of a render: write the cut track as FCPXML and an EDL at <base>, with the graphics rendered with alpha beside them.' },
      LIBRARY_FLAG,
      FRAME_TIMEOUT_FLAG,
      FRAME_FORMAT_FLAG,
    ],
    notes: [
      'Examples:',
      '  pulp render pulp.samples.lower-third-bar --out renders/strap.mov --param "name=Sam Okafor"',
      '  pulp render pulp.samples.diagonal-wipe --preset png-sequence --out renders/wipe --param @sound=sharp',
      '  pulp render pulp.samples.title-card --platform youtube-shorts --out renders/title.mp4',
    ],
  },
  {
    name: 'collection',
    positional: { name: '<file.pulpcollection>', required: true },
    summary: 'Render every item of a saved collection into a folder, each with the settings it carries.',
    flags: [
      { name: '--out', value: '<folder>', help: 'The folder the renders go into, named after their items. Required.' },
      LIBRARY_FLAG,
      FRAME_TIMEOUT_FLAG,
      FRAME_FORMAT_FLAG,
    ],
    notes: [
      'Items the library cannot answer for are named and skipped; the exit code is 1 when any item failed or none rendered.',
      'Example:',
      '  pulp collection show.pulpcollection --out renders/',
    ],
  },
  {
    name: 'sample-media',
    positional: { name: '<folder>', required: true },
    summary: 'Write the CC0 sample-media catalog (sounds, music, stills, clips, assets) into a folder, skipping what is there.',
    flags: [
      { name: '--types', value: '<type,type>', help: 'Only these taxonomy types, such as shapes,arrows.' },
      LIBRARY_FLAG,
    ],
  },
  {
    name: 'visual-hashes',
    positional: { name: '<file>', required: true },
    summary: 'Hash every bundled template\'s frames and write the references, or compare against them.',
    flags: [
      { name: '--check', help: 'Compare with the references in <file> instead of writing them; exit 1 on any change.' },
      LIBRARY_FLAG,
    ],
  },
  {
    name: 'safe-box',
    summary: 'Check that every template made for vertical keeps its words inside the safe box and clear of the vertical zones at 9:16.',
    flags: [],
    notes: ['Prints a line per moment whose words are out of place and exits 1 if there is any (docs/vertical-layouts.md).'],
  },
  {
    name: 'help',
    positional: { name: '[command]', required: false },
    summary: 'Show this help, or one command\'s.',
    flags: [],
  },
  {
    name: 'version',
    summary: 'Print the version.',
    flags: [],
  },
];

export function cliSpec(name: CliCommand): CliCommandSpec {
  return CLI_SPECS.find((s) => s.name === name)!;
}

/** What the command line asked for. */
export type ParsedCli =
  /** No command: the window opens as ever. */
  | { kind: 'none' }
  | { kind: 'help'; command?: CliCommand }
  | { kind: 'version' }
  /** The command line was wrong; `command` is set when the command itself was understood. */
  | { kind: 'usage-error'; message: string; command?: CliCommand }
  | {
      kind: 'command';
      command: Exclude<CliCommand, 'help' | 'version'>;
      /** The positional argument: the template id, the collection file, the folder, the references file. */
      target: string;
      /** Single-valued flags, by name, as typed; `--flag=value` and `--flag value` alike. */
      values: Record<string, string>;
      /** Switches that take no value, present or not. */
      switches: Set<string>;
      /** Every `--param key=value`, in order. */
      params: Record<string, string>;
      /** Every `--library <folder>`, in order. */
      libraries: string[];
    };

/** The older flag spelling, read as the subcommand it always meant. */
const LEGACY: Record<string, CliCommand> = {
  '--render': 'render',
  '--collection': 'collection',
  '--sample-media': 'sample-media',
  '--visual-hashes': 'visual-hashes',
};

/**
 * Chromium's and Electron's own switches, which ride on the same command line
 * as the command and belong to the runtime, not to Pulp: `--no-sandbox`,
 * `--disable-gpu`, `--force-device-scale-factor=1.5`, a debugging port. Known
 * by name or by family, so a misspelled Pulp option (`--presett`) is still an
 * error while the runtime's are left alone. Chromium writes a value with `=`,
 * so a bare word after one is never taken as its value.
 */
const RUNTIME_SWITCHES = new Set([
  '--no-sandbox', '--headless', '--lang', '--v', '--vmodule', '--js-flags', '--inspect', '--inspect-brk', '--trace-warnings',
  '--remote-debugging-port', '--remote-debugging-pipe', '--user-data-dir', '--in-process-gpu', '--ignore-gpu-blocklist',
]);
const RUNTIME_SWITCH_FAMILIES = ['--enable-', '--disable-', '--force-', '--use-', '--ozone-', '--gpu-', '--log-', '--enable_', '--disable_'];

export function isRuntimeSwitch(name: string): boolean {
  if (name.startsWith('-psn_')) return true;
  return RUNTIME_SWITCHES.has(name) || RUNTIME_SWITCH_FAMILIES.some((family) => name.startsWith(family));
}

/**
 * Parse the arguments after the program (and, in development, after the app
 * path). Anything Electron or Chromium put there (`--remote-debugging-port=…`)
 * is ignored when no command is named, since the window is what then opens.
 */
export function parseCommandLine(argv: readonly string[]): ParsedCli {
  const args = [...argv];
  // The older spelling: the flag becomes the command, in place, so what follows is read the same.
  const legacyAt = args.findIndex((a) => LEGACY[a] !== undefined);
  if (legacyAt >= 0) args[legacyAt] = LEGACY[args[legacyAt]!]!;
  if (args.includes('--version') || args.includes('-V')) return { kind: 'version' };
  // The command is the first argument that is not a flag.
  let at = -1;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a.startsWith('-')) continue;
    at = i;
    break;
  }
  const wantsHelp = args.includes('--help') || args.includes('-h');
  if (at < 0) return wantsHelp ? { kind: 'help' } : { kind: 'none' };
  const word = args[at]!;
  if (!(CLI_COMMANDS as readonly string[]).includes(word)) {
    // Not a command: a project file double-clicked opens the window; any other word is a typo at
    // a prompt, and is said rather than opening the whole app headless.
    if (wantsHelp) return { kind: 'help' };
    if (legacyAt < 0 && isProjectFile(word)) return { kind: 'none' };
    return { kind: 'usage-error', message: `unknown command "${word}"` };
  }
  const command = word as CliCommand;
  const rest = args.slice(at + 1);
  if (command === 'version') return { kind: 'version' };
  if (command === 'help') {
    const topic = rest.find((a) => !a.startsWith('-'));
    if (topic === undefined) return { kind: 'help' };
    if (!(CLI_COMMANDS as readonly string[]).includes(topic)) return { kind: 'usage-error', message: `unknown command "${topic}"`, command: 'help' };
    return { kind: 'help', command: topic as CliCommand };
  }
  if (wantsHelp) return { kind: 'help', command };

  const spec = cliSpec(command);
  const known = new Map(spec.flags.map((f) => [f.name, f]));
  const values: Record<string, string> = {};
  const switches = new Set<string>();
  const params: Record<string, string> = {};
  const libraries: string[] = [];
  let target: string | undefined;
  const usage = (message: string): ParsedCli => ({ kind: 'usage-error', message, command });
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (!a.startsWith('-')) {
      if (target === undefined) {
        target = a;
        continue;
      }
      return usage(`unexpected argument "${a}"`);
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(0, eq) : a;
    const flag = known.get(name);
    if (!flag) {
      if (isRuntimeSwitch(name)) continue;
      return usage(`unknown option "${name}"`);
    }
    if (flag.value === undefined) {
      if (eq > 0) return usage(`${name} takes no value`);
      switches.add(name);
      continue;
    }
    const value = eq > 0 ? a.slice(eq + 1) : rest[++i];
    if (value === undefined || (eq < 0 && value.startsWith('--') && !value.includes('='))) return usage(`${name} needs a value (${flag.value})`);
    if (name === '--param') {
      const sep = value.indexOf('=');
      if (sep <= 0) return usage(`--param needs key=value, got "${value}"`);
      params[value.slice(0, sep)] = value.slice(sep + 1);
    } else if (name === '--library') {
      libraries.push(value);
    } else if (flag.repeat) {
      values[name] = values[name] === undefined ? value : `${values[name]},${value}`;
    } else {
      values[name] = value;
    }
  }
  if (spec.positional?.required && (target === undefined || target === '')) return usage(`missing ${spec.positional.name}`);
  return { kind: 'command', command, target: target ?? '', values, switches, params, libraries };
}

/** One line: how a command is spelled. */
export function usageLine(command: CliCommand): string {
  const spec = cliSpec(command);
  const positional = spec.positional ? ` ${spec.positional.name}` : '';
  const required = command === 'render' ? ' --out <path>' : command === 'collection' ? ' --out <folder>' : '';
  const more = spec.flags.length > 0 ? ' [options]' : '';
  return `pulp ${command}${positional}${required}${more}`;
}

/** The help text for the whole command, or for one subcommand. */
export function helpText(command?: CliCommand): string {
  if (command === undefined) {
    const width = Math.max(...CLI_SPECS.map((s) => s.name.length));
    const lines = [
      'pulp — render motion-graphics templates without opening the window.',
      '',
      'Usage: pulp <command> [arguments]',
      '',
      'Commands:',
      ...CLI_SPECS.map((s) => `  ${s.name.padEnd(width)}  ${s.summary}`),
      '',
      'Run "pulp help <command>" for its options. "pulp --version" prints the version.',
      'Chromium\'s own switches (--no-sandbox, --disable-gpu, --force-device-scale-factor=1.5) pass through to the runtime.',
      '',
      'Exit codes: 0 the work was done · 1 the work failed · 2 the command line was wrong.',
    ];
    return `${lines.join('\n')}\n`;
  }
  const spec = cliSpec(command);
  const lines = [`Usage: ${usageLine(command)}`, '', spec.summary];
  if (spec.flags.length > 0) {
    const heads = spec.flags.map((f) => `${f.name}${f.value ? ` ${f.value}` : ''}`);
    const width = Math.min(34, Math.max(...heads.map((h) => h.length)));
    lines.push('', 'Options:');
    spec.flags.forEach((f, i) => {
      const head = heads[i]!;
      lines.push(head.length > width ? `  ${head}\n  ${''.padEnd(width)}  ${f.help}` : `  ${head.padEnd(width)}  ${f.help}`);
    });
  }
  if (spec.notes) lines.push('', ...spec.notes);
  lines.push('', 'Exit codes: 0 the work was done · 1 the work failed · 2 the command line was wrong.');
  return `${lines.join('\n')}\n`;
}

/** The line printed for a usage error, before the exit with code 2. */
export function usageErrorText(parsed: Extract<ParsedCli, { kind: 'usage-error' }>): string {
  const where = parsed.command ? `pulp ${parsed.command}` : 'pulp';
  const hint = parsed.command && parsed.command !== 'help' ? `Run "pulp help ${parsed.command}" for its options.` : 'Run "pulp help" for the commands.';
  return `${where}: ${parsed.message}\n${hint}\n`;
}
