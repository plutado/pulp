/**
 * Pulp's own application menu (milestone 27): the macOS menu bar, and a menu
 * bar in the window on Windows and Linux. Pure — this says what the menu *is*,
 * so the main process can build it, the window can answer it, and the
 * keyboard-shortcut list can be read off the same description rather than
 * written out a second time and drifting.
 *
 * Every item that does something names a **command**, which the window runs by
 * doing exactly what the button for the same thing does; items that belong to
 * the platform rather than to Pulp carry an Electron **role** instead. An item
 * is enabled only when it can act, which is decided by one flag of `MenuState`
 * — the window pushes that whenever it changes, so nothing in the menu is ever
 * offered when pressing it would do nothing.
 *
 * **Accelerators are registered by the menu, so they shadow the window.** That
 * rules out the bare transport keys a video tool would like (Space, I, O): a
 * registered accelerator fires inside a text field too, and Space would stop
 * anyone typing a space. The transport therefore takes modified keys, which no
 * text field uses. Undo and Redo are the exception the other way: the window
 * already owns Ctrl/Cmd+Z, because inside a text field the field's own undo
 * must win, so those are shown without being registered (`displayOnly`).
 */

export type MenuCommand =
  | 'app.home'
  | 'project.new'
  | 'project.open'
  | 'project.openRecent'
  | 'project.save'
  | 'project.saveAs'
  | 'library.addFolder'
  | 'library.addSampleMedia'
  | 'pack.import'
  | 'pack.export'
  | 'render.one'
  | 'render.all'
  | 'edit.undo'
  | 'edit.redo'
  // What can be done to a layer (milestone 39). The stage's right-click menu names exactly these,
  // so the two surfaces offer one list of things, enabled by one set of flags; the test in
  // tests/stage-menu.test.ts holds them to it.
  | 'layer.addText'
  | 'layer.addImage'
  | 'layer.addVideo'
  | 'layer.cut'
  | 'layer.copy'
  | 'layer.paste'
  | 'layer.duplicate'
  | 'layer.delete'
  | 'layer.forward'
  | 'layer.backward'
  | 'layer.front'
  | 'layer.back'
  | 'layer.copyLook'
  | 'layer.pasteLook'
  | 'layer.startHere'
  | 'layer.endHere'
  | 'layer.reset'
  | 'browse.find'
  | 'view.browse'
  | 'view.stage'
  | 'view.results'
  | 'view.tray'
  | 'view.parameters'
  | 'view.output'
  | 'view.info'
  | 'view.grid'
  | 'view.list'
  | 'view.bigger'
  | 'view.smaller'
  | 'play.toggle'
  | 'play.previous'
  | 'play.next'
  | 'play.setIn'
  | 'play.setOut'
  | 'play.loop'
  | 'help.tour'
  | 'help.whatsNew'
  | 'help.shortcuts'
  | 'help.diagnostics';

/**
 * What the window can do right now. Every flag is something a menu item asks
 * about; the window works them out from the same state its buttons do, so a
 * menu item and its button are never enabled differently.
 */
export interface MenuState {
  /** A render can be queued: a template is shown, ffmpeg is there, the options are usable. */
  canRender: boolean;
  /** The collection holds something renderable. */
  canRenderAll: boolean;
  /** The listed templates can be exported as a pack. */
  canExportPack: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Something on the stage has a timeline: a template, or a frame sequence. */
  canPlay: boolean;
  playing: boolean;
  /** A frame is marked in or out, so there is a trim to clear. */
  loop: boolean;
  browseVisible: boolean;
  stageVisible: boolean;
  resultsVisible: boolean;
  trayVisible: boolean;
  /** The inspector drawer (milestone 38): open on this tab. At most one is true; all false is closed. */
  parametersOpen: boolean;
  outputOpen: boolean;
  infoOpen: boolean;
  /** The results are a grid of cards rather than a list of rows. */
  grid: boolean;
  /**
   * What can be done to a layer right now (milestone 39). Every one is a
   * question about the stack on the stage, worked out in one place
   * (`layerMenuFacts` in src/core/stage-menu.ts) and read by the application
   * menu and by the stage's right-click menu alike, so an item cannot be
   * offered on one and refused on the other.
   */
  /** A template with a block that takes added layers is on the stage. */
  canAddLayer: boolean;
  /** A layer is selected: there is something to copy, duplicate, time or reset. */
  canEditLayer: boolean;
  /** The selected layer is not one the template marks required, so it can go. */
  canDeleteLayer: boolean;
  /** It is not already at the front of its stack. */
  canLayerForward: boolean;
  /** It is not already at the back. */
  canLayerBackward: boolean;
  /** A layer has been cut or copied, and a block will take it. */
  canPasteLayer: boolean;
  /** A look has been copied, and a layer is selected to put it on. */
  canPasteLook: boolean;
  /** The selected layer has been placed, timed, given a look or an entrance of its own: something to undo. */
  canResetLayer: boolean;
  /** Recently opened projects, newest first; the Open Recent submenu. */
  recent: string[];
}

export const EMPTY_MENU_STATE: MenuState = {
  canRender: false,
  canRenderAll: false,
  canExportPack: false,
  canUndo: false,
  canRedo: false,
  canPlay: false,
  playing: false,
  loop: true,
  browseVisible: true,
  stageVisible: true,
  resultsVisible: true,
  trayVisible: false,
  parametersOpen: false,
  outputOpen: false,
  infoOpen: false,
  grid: true,
  canAddLayer: false,
  canEditLayer: false,
  canDeleteLayer: false,
  canLayerForward: false,
  canLayerBackward: false,
  canPasteLayer: false,
  canPasteLook: false,
  canResetLayer: false,
  recent: [],
};

/** The flags an item may be enabled by; `recent` is a list, not a condition. */
type Flag = Exclude<{ [K in keyof MenuState]: MenuState[K] extends boolean ? K : never }[keyof MenuState], undefined>;

export interface MenuItemSpec {
  /** What the window runs; absent for a separator, a submenu or a platform role. */
  command?: MenuCommand;
  /** An Electron role: the platform's own behaviour, which Pulp has no business reimplementing. */
  role?: string;
  label?: string;
  accelerator?: string;
  /** Shown but not registered, so the window keeps the key (Undo inside a text field). */
  displayOnly?: boolean;
  type?: 'separator' | 'checkbox' | 'radio';
  submenu?: MenuItemSpec[];
  /** The flag that decides whether it can act; absent means always. */
  enabledBy?: Flag;
  /** Never actable: a line that is there to say why the menu is empty. */
  disabled?: true;
  /** What the command is about, when one command serves many items (a recent project's path). */
  arg?: string;
  /** The flag a checkbox reflects. */
  checkedBy?: Flag;
  /** True when the item is the opposite of its flag — Play shows Pause while playing. */
  altLabel?: { whenFlag: Flag; label: string };
  /** Built only in a development build. */
  devOnly?: true;
  /** What the shortcut list calls this, when the label alone is not enough out of context. */
  listAs?: string;
  /** Filled in by `resolveMenu`: what the item is now, rather than what decides it. */
  enabled?: boolean;
  checked?: boolean;
}

export interface MenuSection {
  label: string;
  items: MenuItemSpec[];
}

export interface MenuOptions {
  mac: boolean;
  /** A development build gets Reload and Developer Tools; a packaged one does not. */
  development: boolean;
  appName: string;
  state: MenuState;
}

const sep: MenuItemSpec = { type: 'separator' };

/** The recently-opened projects as a submenu, or one disabled line saying there are none. */
function recentSubmenu(recent: readonly string[]): MenuItemSpec[] {
  if (recent.length === 0) return [{ label: 'Nothing opened yet', disabled: true }];
  return recent.map((path) => ({ command: 'project.openRecent' as const, label: recentLabel(path), arg: path }));
}

/**
 * How a recent project reads in the menu: its own name, and the folder it is
 * in after it. The whole path would make the menu as wide as the deepest
 * folder anyone has; the name alone would not tell two projects called "Show"
 * apart, which is exactly when a person reaches for this list.
 */
export function recentLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== '');
  const file = (parts.pop() ?? path).replace(/\.(pulp|pulpcollection)$/i, '');
  const folder = parts.pop();
  return folder ? `${file} — ${folder}` : file;
}

/**
 * What can be done to a layer, as the Edit menu offers it (milestone 39). The
 * stage's right-click menu names the same commands with the same flags, in the
 * order a pointer menu wants them; this is the keyboard-reachable, discoverable
 * copy, and `LAYER_COMMAND_FLAGS` below is what holds the two in step.
 */
export function layerSubmenu(): MenuItemSpec[] {
  return [
    { command: 'layer.addText', label: 'Add Text Layer', enabledBy: 'canAddLayer' },
    // Both take a library item as their argument, as Open Recent takes a path: with one they add
    // a layer showing it (the stage's Add Asset Here), with none a blank layer to be filled in.
    { command: 'layer.addImage', label: 'Add Image Layer', enabledBy: 'canAddLayer' },
    { command: 'layer.addVideo', label: 'Add Video Layer', enabledBy: 'canAddLayer' },
    sep,
    { command: 'layer.cut', label: 'Cut', enabledBy: 'canDeleteLayer' },
    { command: 'layer.copy', label: 'Copy', enabledBy: 'canEditLayer' },
    { command: 'layer.paste', label: 'Paste', enabledBy: 'canPasteLayer' },
    { command: 'layer.duplicate', label: 'Duplicate', enabledBy: 'canEditLayer' },
    { command: 'layer.delete', label: 'Delete', enabledBy: 'canDeleteLayer' },
    sep,
    { command: 'layer.forward', label: 'Bring Forward', enabledBy: 'canLayerForward' },
    { command: 'layer.backward', label: 'Send Backward', enabledBy: 'canLayerBackward' },
    { command: 'layer.front', label: 'Bring to Front', enabledBy: 'canLayerForward' },
    { command: 'layer.back', label: 'Send to Back', enabledBy: 'canLayerBackward' },
    sep,
    { command: 'layer.copyLook', label: 'Copy Look', enabledBy: 'canEditLayer' },
    { command: 'layer.pasteLook', label: 'Paste Look', enabledBy: 'canPasteLook' },
    sep,
    { command: 'layer.startHere', label: 'Start at Playhead', enabledBy: 'canEditLayer' },
    { command: 'layer.endHere', label: 'End at Playhead', enabledBy: 'canEditLayer' },
    sep,
    { command: 'layer.reset', label: 'Reset Layer', enabledBy: 'canResetLayer' },
  ];
}

/**
 * Which flag decides each layer command. One table, read by the Edit menu
 * above and by the stage's right-click menu (src/core/stage-menu.ts), so the
 * same command is never offered on one surface and refused on the other.
 */
export const LAYER_COMMAND_FLAGS: Readonly<Record<string, Flag>> = {
  'layer.addText': 'canAddLayer',
  'layer.addImage': 'canAddLayer',
  'layer.addVideo': 'canAddLayer',
  'layer.cut': 'canDeleteLayer',
  'layer.copy': 'canEditLayer',
  'layer.paste': 'canPasteLayer',
  'layer.duplicate': 'canEditLayer',
  'layer.delete': 'canDeleteLayer',
  'layer.forward': 'canLayerForward',
  'layer.backward': 'canLayerBackward',
  'layer.front': 'canLayerForward',
  'layer.back': 'canLayerBackward',
  'layer.copyLook': 'canEditLayer',
  'layer.pasteLook': 'canPasteLook',
  'layer.startHere': 'canEditLayer',
  'layer.endHere': 'canEditLayer',
  'layer.reset': 'canResetLayer',
};

/**
 * The whole menu for this platform and this state. The order is the one people
 * expect from the platform: the app's own menu first on macOS, File, Edit,
 * View, then what this app adds, then Window and Help.
 */
export function buildMenu(options: MenuOptions): MenuSection[] {
  const { mac, development, appName, state } = options;
  const sections: MenuSection[] = [];

  if (mac) {
    sections.push({
      label: appName,
      items: [
        { role: 'about', label: `About ${appName}` },
        sep,
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { role: 'quit', label: `Quit ${appName}` },
      ],
    });
  }

  sections.push({
    label: 'File',
    items: [
      // The start screen (milestone 31): also shown at launch, so this is the way back to it.
      { command: 'app.home', label: 'Home' },
      sep,
      { command: 'project.new', label: 'New Project', accelerator: 'CmdOrCtrl+N' },
      { command: 'project.open', label: 'Open…', accelerator: 'CmdOrCtrl+O' },
      { label: 'Open Recent', submenu: recentSubmenu(state.recent) },
      sep,
      { command: 'project.save', label: 'Save', accelerator: 'CmdOrCtrl+S' },
      { command: 'project.saveAs', label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S' },
      sep,
      { command: 'library.addFolder', label: 'Add Library Folder…' },
      { command: 'library.addSampleMedia', label: 'Add Sample Media' },
      sep,
      { command: 'pack.import', label: 'Import Pack…' },
      { command: 'pack.export', label: 'Export Pack…', enabledBy: 'canExportPack' },
      sep,
      { command: 'render.one', label: 'Render…', accelerator: 'CmdOrCtrl+R', enabledBy: 'canRender' },
      { command: 'render.all', label: 'Render All', accelerator: 'CmdOrCtrl+Shift+R', enabledBy: 'canRenderAll' },
      sep,
      { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+W' },
      ...(mac ? [] : [{ role: 'quit', label: 'Quit', accelerator: 'CmdOrCtrl+Q' }]),
    ],
  });

  sections.push({
    label: 'Edit',
    items: [
      // The window owns these keys: inside a text field the field's own undo must win, so the
      // accelerator is shown and not registered.
      { command: 'edit.undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', displayOnly: true, enabledBy: 'canUndo' },
      { command: 'edit.redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', displayOnly: true, enabledBy: 'canRedo' },
      sep,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      sep,
      // The layer edits (milestone 39), in a submenu of their own so the four roles above keep
      // Cut, Copy and Paste for whatever text field has the caret. None takes a key: an
      // accelerator is registered and would fire inside a text field (see the note at the top).
      { label: 'Layer', submenu: layerSubmenu() },
      sep,
      { command: 'browse.find', label: 'Find Category', accelerator: 'CmdOrCtrl+F' },
    ],
  });

  sections.push({
    label: 'View',
    items: [
      // The drawer's tabs first, on the plain digits (milestone 38): they are the keys reached for
      // while editing, so the panels move to the shifted ones.
      { command: 'view.parameters', label: 'Parameters', accelerator: 'CmdOrCtrl+1', type: 'checkbox', checkedBy: 'parametersOpen' },
      { command: 'view.output', label: 'Output', accelerator: 'CmdOrCtrl+2', type: 'checkbox', checkedBy: 'outputOpen' },
      { command: 'view.info', label: 'Info', accelerator: 'CmdOrCtrl+3', type: 'checkbox', checkedBy: 'infoOpen' },
      sep,
      { command: 'view.browse', label: 'Browse Panel', accelerator: 'CmdOrCtrl+Shift+1', type: 'checkbox', checkedBy: 'browseVisible' },
      { command: 'view.stage', label: 'Preview', accelerator: 'CmdOrCtrl+Shift+2', type: 'checkbox', checkedBy: 'stageVisible' },
      { command: 'view.results', label: 'Results', accelerator: 'CmdOrCtrl+Shift+3', type: 'checkbox', checkedBy: 'resultsVisible' },
      { command: 'view.tray', label: 'Collection Tray', accelerator: 'CmdOrCtrl+Shift+4', type: 'checkbox', checkedBy: 'trayVisible' },
      sep,
      // Two sides of one setting, so they are a pair of radios rather than two ticks.
      { command: 'view.grid', label: 'Grid of Cards', type: 'radio', checkedBy: 'grid' },
      { command: 'view.list', label: 'List of Rows', type: 'radio' },
      sep,
      { command: 'view.bigger', label: 'Bigger Cards', accelerator: 'CmdOrCtrl+]' },
      { command: 'view.smaller', label: 'Smaller Cards', accelerator: 'CmdOrCtrl+[' },
      sep,
      ...(development
        ? [
            // Both are given their own key. Electron would otherwise reload on CmdOrCtrl+R, which
            // is Render, and open the tools on Ctrl+Shift+I, which is Set In.
            { role: 'reload', accelerator: 'F5', devOnly: true as const },
            { role: 'toggleDevTools', label: 'Developer Tools', accelerator: 'F12', devOnly: true as const },
            sep,
          ]
        : []),
      { role: 'togglefullscreen' },
    ],
  });

  sections.push({
    label: 'Playback',
    items: [
      {
        command: 'play.toggle', label: 'Play', accelerator: 'CmdOrCtrl+Return', enabledBy: 'canPlay',
        altLabel: { whenFlag: 'playing', label: 'Pause' }, listAs: 'Play or pause',
      },
      { command: 'play.previous', label: 'Previous Frame', accelerator: 'CmdOrCtrl+Shift+,', enabledBy: 'canPlay' },
      { command: 'play.next', label: 'Next Frame', accelerator: 'CmdOrCtrl+Shift+.', enabledBy: 'canPlay' },
      sep,
      { command: 'play.setIn', label: 'Set In', accelerator: 'CmdOrCtrl+Shift+I', enabledBy: 'canPlay' },
      { command: 'play.setOut', label: 'Set Out', accelerator: 'CmdOrCtrl+Shift+O', enabledBy: 'canPlay' },
      sep,
      { command: 'play.loop', label: 'Loop', accelerator: 'CmdOrCtrl+Shift+L', type: 'checkbox', checkedBy: 'loop' },
    ],
  });

  sections.push({
    label: 'Window',
    items: [
      { role: 'minimize' },
      // Closing the window lives in File everywhere; macOS alone adds the two it expects here.
      ...(mac ? [{ role: 'zoom' }, sep, { role: 'front', label: 'Bring All to Front' }] : []),
    ],
  });

  sections.push({
    label: 'Help',
    items: [
      { command: 'help.tour', label: 'Take the Tour' },
      { command: 'help.whatsNew', label: "What's New" },
      sep,
      { command: 'help.shortcuts', label: 'Keyboard Shortcuts' },
      { command: 'help.diagnostics', label: 'Copy Diagnostics' },
    ],
  });

  return sections;
}

/** Whether an item can act, given the state; an item with no condition always can. */
export function itemEnabled(item: MenuItemSpec, state: MenuState): boolean {
  if (item.disabled) return false;
  return item.enabledBy === undefined ? true : state[item.enabledBy];
}

/** What a checkbox shows, given the state. */
export function itemChecked(item: MenuItemSpec, state: MenuState): boolean {
  if (item.checkedBy !== undefined) return state[item.checkedBy];
  // "List of Rows" is the other side of "Grid of Cards" rather than a flag of its own.
  return item.command === 'view.list' ? !state.grid : false;
}

/** The label to show now: an item that toggles says what pressing it does next. */
export function itemLabel(item: MenuItemSpec, state: MenuState): string {
  if (item.altLabel && state[item.altLabel.whenFlag]) return item.altLabel.label;
  return item.label ?? '';
}

/**
 * The menu as it stands: every item's label, enabled and checked worked out
 * from the state, so a reader — the shortcut list, a test, anything — sees
 * what the menu is rather than what decides it.
 */
export function resolveMenu(sections: readonly MenuSection[], state: MenuState): MenuSection[] {
  const item = (i: MenuItemSpec): MenuItemSpec => ({
    ...i,
    ...(i.label !== undefined ? { label: itemLabel(i, state) } : {}),
    ...(i.type === 'separator' ? {} : { enabled: itemEnabled(i, state) }),
    ...(i.type === 'checkbox' || i.type === 'radio' ? { checked: itemChecked(i, state) } : {}),
    ...(i.submenu ? { submenu: i.submenu.map(item) } : {}),
  });
  return sections.map((s) => ({ label: s.label, items: s.items.map(item) }));
}

/**
 * The keyboard shortcuts, read off the menu itself so the list cannot drift
 * from what the keys actually do. Grouped by menu, and only the items that
 * have a shortcut at all.
 */
export function shortcutList(sections: readonly MenuSection[]): { section: string; shortcuts: { label: string; accelerator: string }[] }[] {
  return sections
    .map((section) => ({
      section: section.label,
      shortcuts: section.items
        .filter((i) => i.accelerator !== undefined && (i.label !== undefined || i.listAs !== undefined))
        .map((i) => ({ label: i.listAs ?? i.label ?? '', accelerator: i.accelerator! })),
    }))
    .filter((s) => s.shortcuts.length > 0);
}

/**
 * The keys Electron gives a role when it is not told otherwise. Pulp's own
 * items must not take any of these, and a role Pulp gives a key of its own
 * overrides them — which is why Reload and Developer Tools carry one, since
 * Electron's would be Render's key and Set In's.
 */
export const ROLE_ACCELERATORS: Record<string, string> = {
  about: '',
  hide: 'CmdOrCtrl+H',
  hideOthers: 'CmdOrCtrl+Alt+H',
  unhide: '',
  quit: 'CmdOrCtrl+Q',
  close: 'CmdOrCtrl+W',
  cut: 'CmdOrCtrl+X',
  copy: 'CmdOrCtrl+C',
  paste: 'CmdOrCtrl+V',
  selectAll: 'CmdOrCtrl+A',
  minimize: 'CmdOrCtrl+M',
  zoom: '',
  front: '',
  reload: 'CmdOrCtrl+R',
  toggleDevTools: 'CmdOrCtrl+Alt+I',
  togglefullscreen: '',
};

/** The key an item really takes: its own, or the one its role comes with. */
export function effectiveAccelerator(item: MenuItemSpec): string {
  if (item.displayOnly) return '';
  if (item.accelerator) return item.accelerator;
  return item.role ? (ROLE_ACCELERATORS[item.role] ?? '') : '';
}

/**
 * An accelerator as this platform writes it: the symbols on a Mac, the words
 * everywhere else. Only for showing — Electron reads the `CmdOrCtrl+` form.
 */
export function acceleratorLabel(accelerator: string, mac: boolean): string {
  const parts = accelerator.split('+');
  const named: Record<string, string> = mac
    ? { CmdOrCtrl: '⌘', Cmd: '⌘', Ctrl: '⌃', Shift: '⇧', Alt: '⌥', Return: '↩', Space: 'Space' }
    : { CmdOrCtrl: 'Ctrl', Cmd: 'Ctrl', Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Return: 'Enter' };
  const shown = parts.map((p) => named[p] ?? p);
  return mac ? shown.join('') : shown.join('+');
}
