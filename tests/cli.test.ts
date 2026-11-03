/**
 * The `pulp` command's grammar (src/core/cli.ts): subcommands, flags, the
 * older flag spelling read as the command it meant, the help text drawn from
 * the same table the parser reads, and what counts as a usage error.
 */

import { describe, expect, it } from 'vitest';
import { CLI_COMMANDS, CLI_SPECS, cliSpec, EXIT_CODES, helpText, isRuntimeSwitch, parseCommandLine, usageErrorText, usageLine } from '../src/core/cli';

const command = (argv: string[]) => {
  const parsed = parseCommandLine(argv);
  if (parsed.kind !== 'command') throw new Error(`expected a command, got ${JSON.stringify(parsed)}`);
  return parsed;
};

describe('parseCommandLine', () => {
  it('opens the window when nothing is asked, whatever Chromium put on the line', () => {
    expect(parseCommandLine([])).toEqual({ kind: 'none' });
    expect(parseCommandLine(['--remote-debugging-port=9341'])).toEqual({ kind: 'none' });
    // A project file double-clicked is not a command; the window opens it.
    expect(parseCommandLine(['/Users/me/show.pulp'])).toEqual({ kind: 'none' });
  });

  it('reads pulp render with its target, its flags in both spellings, and the repeatable ones in order', () => {
    const parsed = command(['render', 'pulp.samples.lower-third-bar', '--out', 'renders/strap.mov', '--preset=h264-mp4',
      '--param', 'name=Sam Okafor', '--param', 'side=right', '--library', '/a', '--library', '/b', '--fps', '30']);
    expect(parsed.command).toBe('render');
    expect(parsed.target).toBe('pulp.samples.lower-third-bar');
    expect(parsed.values).toEqual({ '--out': 'renders/strap.mov', '--preset': 'h264-mp4', '--fps': '30' });
    expect(parsed.params).toEqual({ name: 'Sam Okafor', side: 'right' });
    expect(parsed.libraries).toEqual(['/a', '/b']);
  });

  it('keeps the value of a parameter whole, equals signs and JSON included', () => {
    const parsed = command(['render', 't', '--out', 'o', '--param', '@layers={"strap":[{"id":"name","text":"a=b"}]}']);
    expect(parsed.params['@layers']).toBe('{"strap":[{"id":"name","text":"a=b"}]}');
  });

  it('reads the older flag spelling as the command it always meant', () => {
    const render = command(['--render', 'pulp.samples.title-card', '--preset', 'png-sequence', '--out', 'renders/title']);
    expect(render.command).toBe('render');
    expect(render.target).toBe('pulp.samples.title-card');
    const collection = command(['--collection', 'show.pulpcollection', '--out', 'renders']);
    expect(collection.command).toBe('collection');
    expect(collection.target).toBe('show.pulpcollection');
    const samples = command(['--sample-media', '/tmp/samples', '--types', 'shapes,arrows']);
    expect(samples).toMatchObject({ command: 'sample-media', target: '/tmp/samples', values: { '--types': 'shapes,arrows' } });
    const hashes = command(['--visual-hashes', 'refs.json', '--check']);
    expect(hashes.command).toBe('visual-hashes');
    expect(hashes.switches.has('--check')).toBe(true);
  });

  it('answers help and the version from any spelling', () => {
    expect(parseCommandLine(['help'])).toEqual({ kind: 'help' });
    expect(parseCommandLine(['--help'])).toEqual({ kind: 'help' });
    expect(parseCommandLine(['help', 'render'])).toEqual({ kind: 'help', command: 'render' });
    expect(parseCommandLine(['render', '--help'])).toEqual({ kind: 'help', command: 'render' });
    expect(parseCommandLine(['version'])).toEqual({ kind: 'version' });
    expect(parseCommandLine(['--version'])).toEqual({ kind: 'version' });
  });

  it('names what is wrong with the command line, and which command it was about', () => {
    expect(parseCommandLine(['render', 't', '--out', 'o', '--bogus', '1'])).toEqual({ kind: 'usage-error', message: 'unknown option "--bogus"', command: 'render' });
    expect(parseCommandLine(['render', '--out', 'o'])).toEqual({ kind: 'usage-error', message: 'missing <template-id>', command: 'render' });
    expect(parseCommandLine(['render', 't', '--out'])).toEqual({ kind: 'usage-error', message: '--out needs a value (<path>)', command: 'render' });
    expect(parseCommandLine(['render', 't', '--out', 'o', '--param', 'novalue'])).toMatchObject({ kind: 'usage-error', command: 'render' });
    expect(parseCommandLine(['render', 't', 'extra', '--out', 'o'])).toEqual({ kind: 'usage-error', message: 'unexpected argument "extra"', command: 'render' });
    expect(parseCommandLine(['visual-hashes', 'refs.json', '--check=yes'])).toEqual({ kind: 'usage-error', message: '--check takes no value', command: 'visual-hashes' });
    expect(parseCommandLine(['help', 'frobnicate'])).toEqual({ kind: 'usage-error', message: 'unknown command "frobnicate"', command: 'help' });
    // A bare word that is not a command is a typo at a prompt, said rather than opening the app headless;
    // only a project file is for the window.
    expect(parseCommandLine(['frobnicate'])).toEqual({ kind: 'usage-error', message: 'unknown command "frobnicate"' });
    expect(parseCommandLine(['--render', 'x', 'again'])).toEqual({ kind: 'usage-error', message: 'unexpected argument "again"', command: 'render' });
  });

  it('lets Chromium\'s own switches ride beside a command, by name or family, and still names a misspelled option', () => {
    const parsed = command(['render', 't', '--out', 'o', '--force-device-scale-factor=1.5', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9222', '-psn_0_123']);
    expect(parsed.values).toEqual({ '--out': 'o' });
    expect(isRuntimeSwitch('--enable-features')).toBe(true);
    expect(parseCommandLine(['render', 't', '--out', 'o', '--presett', 'h264-mp4'])).toEqual({ kind: 'usage-error', message: 'unknown option "--presett"', command: 'render' });
  });

  it('refuses a flag belonging to another command', () => {
    expect(parseCommandLine(['collection', 'show.pulpcollection', '--out', 'o', '--preset', 'h264-mp4'])).toEqual({ kind: 'usage-error', message: 'unknown option "--preset"', command: 'collection' });
  });
});

describe('the help text', () => {
  it('lists every command once, with its summary, and the exit codes', () => {
    const text = helpText();
    for (const name of CLI_COMMANDS) expect(text).toContain(`  ${name}`);
    expect(text).toContain('Exit codes: 0 the work was done · 1 the work failed · 2 the command line was wrong.');
    expect(EXIT_CODES).toEqual({ ok: 0, failed: 1, usage: 2 });
  });

  it('draws a command\'s options from the table the parser reads, so neither can drift', () => {
    for (const spec of CLI_SPECS) {
      const text = helpText(spec.name);
      expect(text.startsWith(`Usage: ${usageLine(spec.name)}`)).toBe(true);
      for (const flag of spec.flags) expect(text, `${spec.name} ${flag.name}`).toContain(flag.name);
    }
    expect(usageLine('render')).toBe('pulp render <template-id> --out <path> [options]');
    expect(usageLine('collection')).toBe('pulp collection <file.pulpcollection> --out <folder> [options]');
    expect(cliSpec('render').flags.map((f) => f.name)).toContain('--stems');
  });

  it('says where the mistake was and where to read more', () => {
    expect(usageErrorText({ kind: 'usage-error', message: 'unknown option "--bogus"', command: 'render' }))
      .toBe('pulp render: unknown option "--bogus"\nRun "pulp help render" for its options.\n');
    expect(usageErrorText({ kind: 'usage-error', message: 'unknown command "x"' })).toContain('Run "pulp help" for the commands.');
  });
});
