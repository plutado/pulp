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

import { DEFAULT_PLAYER, STAGE_BACKGROUNDS, type StageBackground } from './player';
import { MOTION_PRESETS } from './motion-presets';
import { APPEARANCES, DEFAULT_APPEARANCE, type Appearance } from './appearance';
import type { MenuDisplay } from './stage-window';
import { SOURCE_TRANSLATOR, type Translator } from './i18n';

export type MenuCommand =
  | 'app.home'
  | 'project.new'
  | 'canvas.new'
  | 'canvas.saveTemplate'
  | 'help.setup'
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
  | 'layer.editText'
  | 'layer.replaceImage'
  | 'layer.replaceClip'
  | 'layer.addText'
  | 'layer.addImage'
  | 'layer.addVideo'
  | 'layer.addShape'
  | 'layer.exposeText'
  | 'layer.exposeColor'
  | 'layer.exposeImage'
  | 'layer.motion'
  | 'layer.keyframing'
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
  // A keyframe's mark on a layer's bar (milestone 51). Named here so the bar's right-click menu
  // speaks the one command type, but run by the bars themselves rather than the dispatcher: the
  // application menu has no "the mark under the pointer" to act on.
  | 'key.copy'
  | 'key.paste'
  | 'key.delete'
  // A cut on the track (milestone 49), run by the lane's own menu for the same reason.
  | 'cut.transition'
  | 'cut.transitionSeconds'
  | 'cut.sound'
  | 'cut.speed'
  | 'cut.ramp'
  | 'cut.smooth'
  | 'cut.freeze'
  | 'cut.hold'
  | 'cut.silences'
  | 'cut.export'
  | 'cut.delete'
  | 'search.focus'
  | 'browse.filter'
  | 'view.browse'
  | 'view.stage'
  | 'view.results'
  | 'view.tray'
  | 'view.parameters'
  | 'view.output'
  | 'view.info'
  | 'view.theater'
  | 'view.popOut'
  | 'view.stageOnDisplay'
  | 'view.background'
  | 'view.appearance'
  | 'record.audio'
  | 'record.input'
  | 'record.video'
  | 'collection.add'
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
  | 'help.userGuide'
  | 'help.acknowledgements'
  | 'help.diagnostics'
  | 'app.settings';

/**
 * What the window can do right now. Every flag is something a menu item asks
 * about; the window works them out from the same state its buttons do, so a
 * menu item and its button are never enabled differently.
 */
/** The bundled template "New Blank Canvas" opens (milestone 55): nothing of its own, one open block to compose on. */
export const BLANK_CANVAS_ID = 'pulp.samples.blank-canvas';

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
  /** The stage is in a window of its own (milestone 43). */
  stageOut: boolean;
  /** Some of the sample-media catalog is still unmade, so Add has something to offer (milestone 47). */
  canAddSampleMedia: boolean;
  /** The connected displays, for View → Stage on Display; filled by the main process, which is where the screen is. */
  displays: MenuDisplay[];
  /**
   * What can be done to a layer right now (milestone 39). Every one is a
   * question about the stack on the stage, worked out in one place
   * (`layerMenuFacts` in src/core/stage-menu.ts) and read by the application
   * menu and by the stage's right-click menu alike, so an item cannot be
   * offered on one and refused on the other.
   */
  /** A template with a block that takes added layers is on the stage. */
  canAddLayer: boolean;
  /** The selected layer is a line of type, so there are words to edit. */
  canEditText: boolean;
  /** The selected layer shows a picture, so another can be chosen for it. */
  canReplaceImage: boolean;
  /** The selected layer has one color of its own — a line of type or a shape — so it can be picked as a parameter. */
  canExposeColor: boolean;
  /** Keyframe recording is on for the selected layer (milestone 51): moving it writes a key at the playhead. */
  keyframing: boolean;
  /** The blank canvas is on the stage, so what is composed on it can be saved as a template (milestone 55). */
  canSaveCanvas: boolean;
  /** The selected layer plays a clip, so another can be chosen for it. */
  canReplaceClip: boolean;
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
  /** The stage has taken the window (milestone 38). */
  theater: boolean;
  /** What is drawn behind a transparent graphic, so the background choices show which is on. */
  background: StageBackground;
  /** Light, dark or the system's (milestone 62), so View → Appearance shows which is chosen. */
  appearance: Appearance;
  /** A voice is being recorded (milestone 63), so File → Record Audio reads Stop Recording. */
  recordingAudio: boolean;
  /** A camera's take is being recorded (milestone 64), so File → Record Video reads Stop Recording. */
  recordingVideo: boolean;
  /** There is an item on the stage that the collection tray will take. */
  canAddToCollection: boolean;
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
  stageOut: false,
  canAddSampleMedia: true,
  displays: [],
  canAddLayer: false,
  canEditText: false,
  canReplaceImage: false,
  canExposeColor: false,
  keyframing: false,
  canSaveCanvas: false,
  canReplaceClip: false,
  canEditLayer: false,
  canDeleteLayer: false,
  canLayerForward: false,
  canLayerBackward: false,
  canPasteLayer: false,
  canPasteLook: false,
  canResetLayer: false,
  theater: false,
  background: DEFAULT_PLAYER.background,
  appearance: DEFAULT_APPEARANCE,
  recordingAudio: false,
  recordingVideo: false,
  canAddToCollection: false,
  recent: [],
};

/** The flags an item may be enabled by; `recent` is a list, not a condition. */
type Flag = Exclude<{ [K in keyof MenuState]: MenuState[K] extends boolean ? K : never }[keyof MenuState], undefined>;

export interface MenuItemSpec {
  /** What the window runs; absent for a separator, a submenu or a platform role. */
  command?: MenuCommand;
  /** An Electron role: the platform's own behavior, which Pulp has no business reimplementing. */
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
  /** A radio that is on when the state's background is this one; the only value-valued choice there is. */
  checkedWhenBackground?: StageBackground;
  /** A radio that is on when this appearance is the one chosen (milestone 62). */
  checkedWhenAppearance?: Appearance;
  /** True when the item is the opposite of its flag — Play shows Pause while playing. */
  altLabel?: { whenFlag: Flag; label: string };
  /** Built only in a development build. */
  devOnly?: true;
  /** What the shortcut list calls this, when the label alone is not enough out of context. */
  listAs?: string;
  /**
   * A line under the label saying what the choice brings or does (milestone 47).
   * Drawn by the in-window menus; the platform's own menu has no room for it,
   * so there it is simply not shown and the label carries the meaning alone.
   */
  detail?: string;
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
  /** The words, in the interface's language (milestone 59); US English when not given. */
  t?: Translator;
}

const sep: MenuItemSpec = { type: 'separator' };

/**
 * What Add brings into the library (milestone 47), named by **what arrives**
 * rather than by the act of adding: four buttons in the browse panel's header
 * said "Add folder", "Add sample media…", "Import pack…" and "Export…", which
 * between them said "add" three times and never said that the first takes a
 * folder of your own media, the second makes files Pulp draws itself, and the
 * third installs templates somebody else made.
 *
 * One list, read by the panel's Add menu and by File → Add alike, so the two
 * cannot drift apart in their words or in what they do (ADR 0017's rule for
 * the stage's menu, which this follows).
 */
export function libraryAddItems(state: Pick<MenuState, 'canAddSampleMedia'> = EMPTY_MENU_STATE, t: Translator = SOURCE_TRANSLATOR): MenuItemSpec[] {
  return [
    { command: 'library.addFolder', label: t('menu.library.addFolder'), detail: t('menu.library.addFolder.detail') },
    { command: 'pack.import', label: t('menu.pack.import'), detail: t('menu.pack.import.detail') },
    // Offered only while some of the catalog is unmade: once it is all there, there is nothing
    // to bring in (milestone 34 counts what is left).
    ...(state.canAddSampleMedia ? [{ command: 'library.addSampleMedia' as const, label: t('menu.library.addSampleMedia'), detail: t('menu.library.addSampleMedia.detail') }] : []),
  ];
}

/** The connected displays as a submenu (milestone 43), or one disabled line while none is known. */
function displaysSubmenu(displays: readonly MenuDisplay[], t: Translator): MenuItemSpec[] {
  if (displays.length === 0) return [{ label: t('menu.displays.none'), disabled: true }];
  return displays.map((d) => ({ command: 'view.stageOnDisplay' as const, label: d.label, arg: String(d.id) }));
}

/** The recently-opened projects as a submenu, or one disabled line saying there are none. */
function recentSubmenu(recent: readonly string[], t: Translator): MenuItemSpec[] {
  if (recent.length === 0) return [{ label: t('menu.recent.none'), disabled: true }];
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
/**
 * The motion presets as menu items (milestone 55): one command, the preset's id
 * as its argument, the way a recent project's path or an asset's id rides.
 * Shared by the Edit menu and the stage's right-click menu.
 */
export function motionSubmenu(): MenuItemSpec[] {
  return MOTION_PRESETS.map((p) => ({ command: 'layer.motion' as const, label: p.label, arg: p.id, enabledBy: 'canEditLayer' as const }));
}

export function layerSubmenu(t: Translator = SOURCE_TRANSLATOR): MenuItemSpec[] {
  return [
    // What the selected layer itself holds, before what can be added beside it.
    { command: 'layer.editText', label: t('menu.layer.editText'), enabledBy: 'canEditText' },
    { command: 'layer.replaceImage', label: t('menu.layer.replaceImage'), enabledBy: 'canReplaceImage' },
    { command: 'layer.replaceClip', label: t('menu.layer.replaceClip'), enabledBy: 'canReplaceClip' },
    sep,
    // Parameters by picking (milestone 55): the property becomes a named parameter in the Parameters tab.
    { command: 'layer.exposeText', label: t('menu.layer.exposeText'), enabledBy: 'canEditText' },
    { command: 'layer.exposeColor', label: t('menu.layer.exposeColor'), enabledBy: 'canExposeColor' },
    { command: 'layer.exposeImage', label: t('menu.layer.exposeImage'), enabledBy: 'canReplaceImage' },
    sep,
    // Motion (milestone 55): a ready-made motion from the presets, and keyframe recording on the selected layer.
    { label: t('menu.animate'), submenu: motionSubmenu() },
    { command: 'layer.keyframing', label: t('menu.layer.keyframing'), type: 'checkbox', checkedBy: 'keyframing', enabledBy: 'canEditLayer' },
    sep,
    { command: 'layer.addText', label: t('menu.layer.addText'), enabledBy: 'canAddLayer' },
    // Both take a library item as their argument, as Open Recent takes a path: with one they add
    // a layer showing it (the stage's Add Asset Here), with none a blank layer to be filled in.
    { command: 'layer.addImage', label: t('menu.layer.addImage'), enabledBy: 'canAddLayer' },
    { command: 'layer.addVideo', label: t('menu.layer.addVideo'), enabledBy: 'canAddLayer' },
    { command: 'layer.addShape', label: t('menu.layer.addShape'), enabledBy: 'canAddLayer' },
    sep,
    { command: 'layer.cut', label: t('menu.layer.cut'), enabledBy: 'canDeleteLayer' },
    { command: 'layer.copy', label: t('menu.layer.copy'), enabledBy: 'canEditLayer' },
    { command: 'layer.paste', label: t('menu.layer.paste'), enabledBy: 'canPasteLayer' },
    { command: 'layer.duplicate', label: t('menu.layer.duplicate'), enabledBy: 'canEditLayer' },
    { command: 'layer.delete', label: t('menu.layer.delete'), enabledBy: 'canDeleteLayer' },
    sep,
    { command: 'layer.forward', label: t('menu.layer.forward'), enabledBy: 'canLayerForward' },
    { command: 'layer.backward', label: t('menu.layer.backward'), enabledBy: 'canLayerBackward' },
    { command: 'layer.front', label: t('menu.layer.front'), enabledBy: 'canLayerForward' },
    { command: 'layer.back', label: t('menu.layer.back'), enabledBy: 'canLayerBackward' },
    sep,
    { command: 'layer.copyLook', label: t('menu.layer.copyLook'), enabledBy: 'canEditLayer' },
    { command: 'layer.pasteLook', label: t('menu.layer.pasteLook'), enabledBy: 'canPasteLook' },
    sep,
    { command: 'layer.startHere', label: t('menu.layer.startHere'), enabledBy: 'canEditLayer' },
    { command: 'layer.endHere', label: t('menu.layer.endHere'), enabledBy: 'canEditLayer' },
    sep,
    { command: 'layer.reset', label: t('menu.layer.reset'), enabledBy: 'canResetLayer' },
  ];
}

/**
 * Which flag decides each command the application menu and the stage's
 * right-click menu both offer. One table, read by the Edit and View menus here
 * and by src/core/stage-menu.ts, so the same command is never offered on one
 * surface and refused on the other. A command with no entry is always offered.
 */
export const SHARED_COMMAND_FLAGS: Readonly<Partial<Record<MenuCommand, Flag>>> = {
  'layer.editText': 'canEditText',
  'layer.replaceImage': 'canReplaceImage',
  'layer.replaceClip': 'canReplaceClip',
  'collection.add': 'canAddToCollection',
  'layer.addText': 'canAddLayer',
  'layer.addImage': 'canAddLayer',
  'layer.addVideo': 'canAddLayer',
  'layer.addShape': 'canAddLayer',
  'layer.exposeText': 'canEditText',
  'layer.exposeColor': 'canExposeColor',
  'layer.exposeImage': 'canReplaceImage',
  'layer.motion': 'canEditLayer',
  'layer.keyframing': 'canEditLayer',
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

/** What is drawn behind a transparent graphic: one radio per choice, ticked for the one that is on. */
export function backgroundSubmenu(): MenuItemSpec[] {
  return STAGE_BACKGROUNDS.map((b) => ({
    command: 'view.background' as const,
    label: b.label,
    // One command for all four, with the choice as its argument, as Open Recent carries a path.
    arg: b.id,
    type: 'radio' as const,
    checkedWhenBackground: b.id,
  }));
}

/** Light, dark or the system's (milestone 62): one radio per choice, the same three Settings offers. */
export function appearanceSubmenu(): MenuItemSpec[] {
  return APPEARANCES.map((a) => ({
    command: 'view.appearance' as const,
    label: a.label,
    arg: a.id,
    type: 'radio' as const,
    checkedWhenAppearance: a.id,
  }));
}

/**
 * The whole menu for this platform and this state. The order is the one people
 * expect from the platform: the app's own menu first on macOS, File, Edit,
 * View, then what this app adds, then Window and Help.
 */
export function buildMenu(options: MenuOptions): MenuSection[] {
  const { mac, development, appName, state } = options;
  const t = options.t ?? SOURCE_TRANSLATOR;
  const sections: MenuSection[] = [];

  if (mac) {
    sections.push({
      label: appName,
      items: [
        { role: 'about', label: t('menu.role.about-app', { app: appName }) },
        sep,
        // The Settings window (milestone 8): where the platform puts it, under the app's own menu.
        { command: 'app.settings', label: t('menu.app.settings'), accelerator: 'CmdOrCtrl+,' },
        sep,
        { role: 'hide', label: t('menu.role.hide-app', { app: appName }) },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { role: 'quit', label: t('menu.role.quit-app', { app: appName }) },
      ],
    });
  }

  sections.push({
    label: t('menu.file'),
    items: [
      // The start screen (milestone 31): also shown at launch, so this is the way back to it.
      { command: 'app.home', label: t('menu.app.home') },
      sep,
      { command: 'project.new', label: t('menu.project.new'), accelerator: 'CmdOrCtrl+N' },
      // The visual template editor's first piece (milestone 55): the bundled blank canvas, opened to compose on.
      { command: 'canvas.new', label: t('menu.canvas.new'), accelerator: 'CmdOrCtrl+Shift+N' },
      // And its other end (milestone 55): what was composed on the canvas, saved in the open format.
      { command: 'canvas.saveTemplate', label: t('menu.canvas.saveTemplate'), enabledBy: 'canSaveCanvas' },
      { command: 'project.open', label: t('menu.project.open'), accelerator: 'CmdOrCtrl+O' },
      { label: t('menu.open-recent'), submenu: recentSubmenu(state.recent, t) },
      sep,
      { command: 'project.save', label: t('menu.project.save'), accelerator: 'CmdOrCtrl+S' },
      { command: 'project.saveAs', label: t('menu.project.saveAs'), accelerator: 'CmdOrCtrl+Shift+S' },
      sep,
      // The same list the browse panel's Add button offers, in the same words (milestone 47).
      { label: t('menu.add'), submenu: libraryAddItems(state, t) },
      // A voice from the microphone, into the library (milestone 63): the menu is the window's own
      // button, so it says what pressing it does next, as Play says Pause.
      { command: 'record.audio', label: t('menu.record.audio'), accelerator: 'CmdOrCtrl+Shift+A', altLabel: { whenFlag: 'recordingAudio', label: t('menu.record.audio.alt') } },
      // The camera button (milestone 64): opens the preview; with the preview up, records; recording, stops.
      { command: 'record.video', label: t('menu.record.video'), altLabel: { whenFlag: 'recordingVideo', label: t('menu.record.video.alt') } },
      { command: 'pack.export', label: t('menu.pack.export'), enabledBy: 'canExportPack' },
      sep,
      { command: 'collection.add', label: t('menu.collection.add'), enabledBy: 'canAddToCollection' },
      sep,
      { command: 'render.one', label: t('menu.render.one'), accelerator: 'CmdOrCtrl+R', enabledBy: 'canRender' },
      { command: 'render.all', label: t('menu.render.all'), accelerator: 'CmdOrCtrl+Shift+R', enabledBy: 'canRenderAll' },
      sep,
      { role: 'close', label: t('menu.role.close'), accelerator: 'CmdOrCtrl+W' },
      ...(mac ? [] : [{ role: 'quit', label: t('menu.role.quit'), accelerator: 'CmdOrCtrl+Q' }]),
    ],
  });

  sections.push({
    label: t('menu.edit'),
    items: [
      // The window owns these keys: inside a text field the field's own undo must win, so the
      // accelerator is shown and not registered.
      { command: 'edit.undo', label: t('menu.edit.undo'), accelerator: 'CmdOrCtrl+Z', displayOnly: true, enabledBy: 'canUndo' },
      { command: 'edit.redo', label: t('menu.edit.redo'), accelerator: 'CmdOrCtrl+Shift+Z', displayOnly: true, enabledBy: 'canRedo' },
      sep,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      sep,
      // The layer edits (milestone 39), in a submenu of their own so the four roles above keep
      // Cut, Copy and Paste for whatever text field has the caret. None takes a key: an
      // accelerator is registered and would fire inside a text field (see the note at the top).
      { label: t('menu.layer'), submenu: layerSubmenu(t) },
      sep,
      // Cmd/Ctrl+F is the Search field (milestone 41), wherever the panel is; the category filter
      // is reached from the funnel in the Browse heading, and has no key of its own.
      { command: 'search.focus', label: t('menu.search.focus'), accelerator: 'CmdOrCtrl+F' },
      { command: 'browse.filter', label: t('menu.browse.filter') },
      // Settings lives in Edit everywhere but macOS, which keeps it in the app's own menu.
      ...(mac ? [] : [sep, { command: 'app.settings' as const, label: t('menu.app.settings'), accelerator: 'CmdOrCtrl+,' }]),
    ],
  });

  sections.push({
    label: t('menu.view'),
    items: [
      // The drawer's tabs first, on the plain digits (milestone 38): they are the keys reached for
      // while editing, so the panels move to the shifted ones.
      { command: 'view.parameters', label: t('menu.view.parameters'), accelerator: 'CmdOrCtrl+1', type: 'checkbox', checkedBy: 'parametersOpen' },
      { command: 'view.output', label: t('menu.view.output'), accelerator: 'CmdOrCtrl+2', type: 'checkbox', checkedBy: 'outputOpen' },
      { command: 'view.info', label: t('menu.view.info'), accelerator: 'CmdOrCtrl+3', type: 'checkbox', checkedBy: 'infoOpen' },
      sep,
      { command: 'view.browse', label: t('menu.view.browse'), accelerator: 'CmdOrCtrl+Shift+1', type: 'checkbox', checkedBy: 'browseVisible' },
      { command: 'view.stage', label: t('menu.view.stage'), accelerator: 'CmdOrCtrl+Shift+2', type: 'checkbox', checkedBy: 'stageVisible' },
      { command: 'view.results', label: t('menu.view.results'), accelerator: 'CmdOrCtrl+Shift+3', type: 'checkbox', checkedBy: 'resultsVisible' },
      { command: 'view.tray', label: t('menu.view.tray'), accelerator: 'CmdOrCtrl+Shift+4', type: 'checkbox', checkedBy: 'trayVisible' },
      sep,
      // Two sides of one setting, so they are a pair of radios rather than two ticks.
      { command: 'view.grid', label: t('menu.view.grid'), type: 'radio', checkedBy: 'grid' },
      { command: 'view.list', label: t('menu.view.list'), type: 'radio' },
      sep,
      { command: 'view.bigger', label: t('menu.view.bigger'), accelerator: 'CmdOrCtrl+]' },
      { command: 'view.smaller', label: t('menu.view.smaller'), accelerator: 'CmdOrCtrl+[' },
      sep,
      // The stage's own two (milestone 39), offered here as well as on the picture itself.
      { label: t('menu.stage-background'), submenu: backgroundSubmenu() },
      // `T` is the window's, not the menu's: a bare key registered here would fire inside a text
      // field (see the note at the top), so it is shown and left to src/renderer/theater.ts.
      { command: 'view.theater', label: t('menu.view.theater'), accelerator: 'T', displayOnly: true, type: 'checkbox', checkedBy: 'theater' },
      // The stage in a window of its own, on any display (milestone 43); again to bring it back.
      { command: 'view.popOut', label: t('menu.view.popOut'), accelerator: 'CmdOrCtrl+Shift+P', type: 'checkbox', checkedBy: 'stageOut' },
      // One item per connected display: the stage fills that one with the picture alone.
      { label: t('menu.stage-on-display'), submenu: displaysSubmenu(state.displays, t) },
      sep,
      // The window's own look (milestone 62), the same setting as Settings → Appearance.
      { label: t('menu.appearance'), submenu: appearanceSubmenu() },
      sep,
      ...(development
        ? [
            // Both are given their own key. Electron would otherwise reload on CmdOrCtrl+R, which
            // is Render, and open the tools on Ctrl+Shift+I, which is Set In.
            { role: 'reload', accelerator: 'F5', devOnly: true as const },
            { role: 'toggleDevTools', label: t('menu.role.toggleDevTools'), accelerator: 'F12', devOnly: true as const },
            sep,
          ]
        : []),
      { role: 'togglefullscreen' },
    ],
  });

  sections.push({
    label: t('menu.playback'),
    items: [
      {
        command: 'play.toggle', label: t('menu.play.toggle'), accelerator: 'CmdOrCtrl+Return', enabledBy: 'canPlay',
        altLabel: { whenFlag: 'playing', label: t('menu.play.toggle.alt') }, listAs: t('menu.play.toggle.list'),
      },
      { command: 'play.previous', label: t('menu.play.previous'), accelerator: 'CmdOrCtrl+Shift+,', enabledBy: 'canPlay' },
      { command: 'play.next', label: t('menu.play.next'), accelerator: 'CmdOrCtrl+Shift+.', enabledBy: 'canPlay' },
      sep,
      { command: 'play.setIn', label: t('menu.play.setIn'), accelerator: 'CmdOrCtrl+Shift+I', enabledBy: 'canPlay' },
      { command: 'play.setOut', label: t('menu.play.setOut'), accelerator: 'CmdOrCtrl+Shift+O', enabledBy: 'canPlay' },
      sep,
      { command: 'play.loop', label: t('menu.play.loop'), accelerator: 'CmdOrCtrl+Shift+L', type: 'checkbox', checkedBy: 'loop' },
    ],
  });

  sections.push({
    label: t('menu.window'),
    items: [
      { role: 'minimize' },
      // Closing the window lives in File everywhere; macOS alone adds the two it expects here.
      ...(mac ? [{ role: 'zoom' }, sep, { role: 'front', label: t('menu.bring-all-to-front') }] : []),
    ],
  });

  sections.push({
    label: t('menu.help'),
    items: [
      { command: 'help.userGuide', label: t('menu.help.userGuide') },
      { command: 'help.tour', label: t('menu.help.tour') },
      // The set-up checklist leaves the start screen once it is done (milestone 60); this is its home after.
      { command: 'help.setup', label: t('menu.help.setup') },
      { command: 'help.whatsNew', label: t('menu.help.whatsNew') },
      sep,
      { command: 'help.shortcuts', label: t('menu.help.shortcuts') },
      // The third-party notices (milestone 8): what Pulp is built on, each under its own license.
      { command: 'help.acknowledgements', label: t('menu.help.acknowledgements') },
      { command: 'help.diagnostics', label: t('menu.help.diagnostics') },
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
  if (item.checkedWhenBackground !== undefined) return state.background === item.checkedWhenBackground;
  if (item.checkedWhenAppearance !== undefined) return state.appearance === item.checkedWhenAppearance;
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
