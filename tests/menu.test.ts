import { describe, expect, it } from 'vitest';
import {
  acceleratorLabel, buildMenu, effectiveAccelerator, EMPTY_MENU_STATE, itemChecked, itemEnabled, itemLabel,
  recentLabel, shortcutList,
  type MenuItemSpec, type MenuSection, type MenuState,
} from '../src/core/menu';

const state = (over: Partial<MenuState> = {}): MenuState => ({ ...EMPTY_MENU_STATE, ...over });
const menu = (over: Partial<Parameters<typeof buildMenu>[0]> = {}) =>
  buildMenu({ mac: false, development: false, appName: 'Pulp', state: state(), ...over });

const section = (sections: MenuSection[], label: string): MenuItemSpec[] =>
  sections.find((s) => s.label === label)?.items ?? [];
const byLabel = (items: MenuItemSpec[], label: string): MenuItemSpec | undefined => items.find((i) => i.label === label);
const every = (sections: MenuSection[]): MenuItemSpec[] =>
  sections.flatMap((s) => s.items).flatMap((i) => [i, ...(i.submenu ?? [])]);

describe('the application menu (milestone 27)', () => {
  it('has the menus a person expects, in the order the platform puts them', () => {
    expect(menu().map((s) => s.label)).toEqual(['File', 'Edit', 'View', 'Playback', 'Window', 'Help']);
    // On macOS the app's own menu comes first and is named after the app.
    expect(menu({ mac: true, appName: 'Pulp' }).map((s) => s.label)).toEqual(['Pulp', 'File', 'Edit', 'View', 'Playback', 'Window', 'Help']);
    const pulp = section(menu({ mac: true }), 'Pulp');
    expect(pulp.map((i) => i.role).filter(Boolean)).toEqual(['about', 'hide', 'hideOthers', 'unhide', 'quit']);
    // Quit belongs to the app's menu on macOS and to File everywhere else; it is never in both.
    expect(byLabel(section(menu({ mac: true }), 'File'), 'Quit')).toBeUndefined();
    expect(byLabel(section(menu(), 'File'), 'Quit')?.role).toBe('quit');
  });

  it('offers an item only when it can act, and the window says when that is', () => {
    const off = state();
    const on = state({ canRender: true, canRenderAll: true, canExportPack: true, canUndo: true, canRedo: true, canPlay: true });
    const file = section(menu(), 'File');
    for (const label of ['Render…', 'Render All', 'Export Pack…']) {
      expect(itemEnabled(byLabel(file, label)!, off), `${label} off`).toBe(false);
      expect(itemEnabled(byLabel(file, label)!, on), `${label} on`).toBe(true);
    }
    // What has no condition is always there: nothing stops a person starting a project.
    expect(itemEnabled(byLabel(file, 'New Project')!, off)).toBe(true);
    const edit = section(menu(), 'Edit');
    expect([itemEnabled(byLabel(edit, 'Undo')!, off), itemEnabled(byLabel(edit, 'Undo')!, on)]).toEqual([false, true]);
    // Every item of the Playback menu waits for something with a timeline.
    for (const item of section(menu(), 'Playback').filter((i) => i.command)) {
      if (item.command === 'play.loop') continue; // loop is a preference, settable with nothing open
      expect(itemEnabled(item, off), item.label).toBe(false);
      expect(itemEnabled(item, on), item.label).toBe(true);
    }
  });

  it('shows the regions and the view as they are, and says what pressing will do next', () => {
    const view = section(menu(), 'View');
    const shown = state({ browseVisible: true, stageVisible: false, trayVisible: true, grid: false });
    expect(itemChecked(byLabel(view, 'Browse Panel')!, shown)).toBe(true);
    expect(itemChecked(byLabel(view, 'Preview')!, shown)).toBe(false);
    expect(itemChecked(byLabel(view, 'Collection Tray')!, shown)).toBe(true);
    // Grid and list are two sides of one setting, so exactly one is ever ticked.
    expect(itemChecked(byLabel(view, 'Grid of Cards')!, shown)).toBe(false);
    expect(itemChecked(byLabel(view, 'List of Rows')!, shown)).toBe(true);
    expect(itemChecked(byLabel(view, 'Grid of Cards')!, state({ grid: true }))).toBe(true);
    expect(itemChecked(byLabel(view, 'List of Rows')!, state({ grid: true }))).toBe(false);
    // Play says what it will do, not what it is doing.
    const play = section(menu(), 'Playback')[0]!;
    expect(itemLabel(play, state({ playing: false }))).toBe('Play');
    expect(itemLabel(play, state({ playing: true }))).toBe('Pause');
  });

  it('lists the recently opened projects, and says so plainly when there are none', () => {
    const none = byLabel(section(menu(), 'File'), 'Open Recent')!.submenu!;
    expect(none).toHaveLength(1);
    expect(itemEnabled(none[0]!, state())).toBe(false);
    const some = byLabel(section(menu({ state: state({ recent: ['/a/One.pulp', '/b/Two.pulp'] }) }), 'File'), 'Open Recent')!.submenu!;
    // The project's own name and the folder it is in: enough to tell two called "Show" apart
    // without making the menu as wide as the deepest folder anyone has.
    expect(some.map((i) => i.label)).toEqual(['One — a', 'Two — b']);
    expect(recentLabel('C:\\Work\\Shows\\Evening.pulp')).toBe('Evening — Shows');
    expect(recentLabel('/Old Set.pulpcollection')).toBe('Old Set');
    // Each carries the path it opens, so one command serves them all.
    expect(some.map((i) => [i.command, i.arg])).toEqual([['project.openRecent', '/a/One.pulp'], ['project.openRecent', '/b/Two.pulp']]);
  });

  it('keeps the developer items out of a packaged build', () => {
    const packaged = section(menu({ development: false }), 'View').map((i) => i.role);
    expect(packaged).not.toContain('toggleDevTools');
    expect(packaged).not.toContain('reload');
    const dev = section(menu({ development: true }), 'View');
    expect(dev.map((i) => i.role)).toContain('toggleDevTools');
    // Its own key, so it does not take the one Set Out uses on Windows and Linux.
    expect(dev.find((i) => i.role === 'toggleDevTools')!.accelerator).toBe('F12');
  });

  it('registers every accelerator but the two the window has to keep', () => {
    const items = every(menu({ development: true }));
    const shown = items.filter((i) => i.displayOnly);
    // Undo and Redo only: inside a text field the field's own undo must win, and a registered
    // accelerator would fire there too.
    expect(shown.map((i) => i.label)).toEqual(['Undo', 'Redo']);
    // Nothing else is a bare key, for the same reason: a registered accelerator shadows typing.
    for (const item of items) {
      if (!item.accelerator || item.displayOnly) continue;
      expect(item.accelerator, `${item.label ?? item.role} is modified or a function key`).toMatch(/^(CmdOrCtrl|Alt|Shift|F\d)/);
    }
  });

  it('gives no two items the same key, counting the keys a role comes with', () => {
    // A role Electron is not given a key for brings its own — Reload would take CmdOrCtrl+R,
    // which is Render, and the developer tools would take Set In's. That is how the two of them
    // came to be given keys of their own, and this is what would have caught it.
    for (const mac of [true, false]) {
      for (const development of [true, false]) {
        const used = new Map<string, string>();
        for (const item of every(buildMenu({ mac, development, appName: 'Pulp', state: state() }))) {
          const key = effectiveAccelerator(item);
          if (!key) continue;
          const who = item.label ?? item.role ?? '?';
          expect(used.get(key), `${key}: ${used.get(key)} and ${who} (mac=${mac}, dev=${development})`).toBeUndefined();
          used.set(key, who);
        }
      }
    }
  });

  it('reads the shortcut list off the menu, so the list cannot drift from the keys', () => {
    const list = shortcutList(menu());
    expect(list.map((s) => s.section)).toEqual(['File', 'Edit', 'View', 'Playback']);
    const file = list.find((s) => s.section === 'File')!.shortcuts;
    expect(file).toContainEqual({ label: 'New Project', accelerator: 'CmdOrCtrl+N' });
    // An item with no key is not in the list at all.
    expect(file.map((s) => s.label)).not.toContain('Add Sample Media');
    // Play is listed as what it does rather than as whichever label it is wearing.
    expect(list.find((s) => s.section === 'Playback')!.shortcuts[0]!.label).toBe('Play or pause');
  });

  it('writes a key the way the platform writes it', () => {
    expect(acceleratorLabel('CmdOrCtrl+Shift+S', true)).toBe('⌘⇧S');
    expect(acceleratorLabel('CmdOrCtrl+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(acceleratorLabel('CmdOrCtrl+Return', true)).toBe('⌘↩');
    expect(acceleratorLabel('CmdOrCtrl+Return', false)).toBe('Ctrl+Enter');
    expect(acceleratorLabel('F12', false)).toBe('F12');
  });
});
