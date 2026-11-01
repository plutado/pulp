import { app, BrowserWindow, clipboard, dialog, ipcMain, ShareMenu, shell } from 'electron';
import { SAMPLE_MEDIA_FOLDER_NAME } from '../core/sample-media';
import { generateSampleMedia, samplesToMake, unmadeSamplesByType } from './sample-media-service';
import { readSlotImages, resolveRowImages } from './image-grant';
import { layeredOutlineFor } from './layered-service';
import { renderMedia } from './media-render';
import { AUDIO_PRESETS, isAudioPresetId } from '../core/media-render';
import { sanitizePsdChoice, type ImageGrantRequest } from '../core/image-slot';
import { loadLayerClips, loadTrackFrames } from './clip-grant';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { detectFfmpeg } from '../core/ffmpeg';
import { FRAME_FORMATS, OUTPUT_PRESETS, type FrameFormat, type PresetId, type RenderOptions } from '../core/render-plan';
import { PLATFORM_IDS, platformPreset } from '../core/platform-presets';
import { parseLengthSeconds, parseTimecode, timecodePattern, TimecodeError } from '../core/timecode';
import type { BatchRequest, FfmpegInfo, RenderRequest, SampleMediaOutcome } from '../shared/api';
import { addLibraryFolder, closeLibrary, findTemplate, getLibrary, hoverStrip, importImageFile, itemPath, libraryDiagnostics, lookupMedia, markItemUsed, rescan, rescanIfStale, setItemFavorite, setItemSequenceFps, setItemTags, setItemThemes, startLibraryMonitor, useInMemoryLibrary, waveform } from './library-service';
import { handleFontProtocol, handleMediaProtocol, handleTemplateProtocol, handleThumbProtocol, registerTemplateScheme } from './protocol';
import { renderTemplate } from './render';
import { mixLoudness } from './mix-loudness';
import { exportEdit } from './edit-export-service';
import { trackSilences } from './track-silence';
import { voicePreview } from './voice-service';
import { chromaKeyClip, chromaKeyPreview, splitScenes } from './cleanup-service';
import { allowedDragFiles, cancelRender, clearFinishedRenders, enqueueBatch, enqueueRender, getRenderQueue, prepareDrag, removeRender } from './render-queue-service';
import { cacheStats, chooseRenderCacheDir, clearRenderCache, setRenderCacheLimit, startDragOut } from './render-cache-service';
import { sanitizeCacheMaxMB } from '../core/render-cache';
import { deletePreset, listPresets, savePreset } from './preset-service';
import { openCollectionFile, readCollectionFile, renderCollection, saveCollectionTo } from './collection-service';
import {
  clearRecovery, forgetProject, missingLibraryFolders, openProjectDialog, readProjectFile, readRecovery,
  recentProjects, recentProjectsDetailed, relinkProjectItem, relinkRecentProject, saveProjectTo, setProjectPinned, writeRecovery,
} from './project-service';
import { listExamples, readExample } from './examples-service';
import type { Project } from '../core/project';
import { initMenu, menuSections, setMenuState } from './menu-service';
import type { MenuState } from '../core/menu';
import type { Collection, CollectionItem } from '../core/collection';
import { chooseExportFile, choosePackFile, exportPackTo, installPack, listInstalledPacks, previewPack } from './pack-service';
import type { CollisionChoice } from '../core/pack';
import { planBatch } from '../core/batch-csv';
import { windowTitle } from '../core/display';
import { familiesUsedBy, importedFamilies } from '../core/fonts';
import { chooseFontFile, importFontFile, listImportedFonts } from './font-service';
import { parseLayersArgument } from '../core/layers';
import { sanitizeCutTrack } from '../core/cut-track';
import { LAYERS_KEY, TRACK_KEY } from '../core/params';
import { slug } from '../core/pack';
import { readFile, writeFile } from 'node:fs/promises';
import { addRecentColor } from '../core/recent-colors';
import { addRecentSearch } from '../core/recent-searches';
import { sanitizeLayout } from '../core/layout';
import { sanitizeResultsView } from '../core/results-view';
import { sanitizePlayer } from '../core/player';
import { loadSettings, updateSettings } from './settings';
import { adoptStageWindow, destroyStageWindow, loadStageWindowSetting, registerStageWindowIpc, stageWindowOptions } from './stage-window-service';
import { initCrashLog, registerLogIpc } from './log-service';
import { DIAGNOSTICS_MAX_CHARS } from '../core/log';
import { STAGE_WINDOW_NAME } from '../core/stage-window';

registerTemplateScheme();

/** The window's image grant requests, read from untrusted input: ids, each with an optional layered choice (milestone 33). */
function grantRequestsFrom(raw: unknown): ImageGrantRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageGrantRequest[] = [];
  for (const r of raw) {
    if (typeof r === 'string') out.push({ id: r });
    else if (r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string') {
      const psd = sanitizePsdChoice((r as { psd?: unknown }).psd);
      out.push({ id: (r as { id: string }).id, ...(psd ? { psd } : {}) });
    }
  }
  return out;
}

// Tests point this at a scratch folder so they never touch the user's settings.json.
if (process.env.PULP_USER_DATA) app.setPath('userData', resolve(process.env.PULP_USER_DATA));

// Before anything else runs (milestone 8): a failure while the app is still coming up is written
// to the log like any other, rather than disappearing with the process.
initCrashLog();

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Run from source, the window names the checkout it came from, so two copies side by side are
  // told apart in the Dock and the task bar; a packaged build is just "Pulp" (src/core/display.ts).
  const title = windowTitle(app.getAppPath(), app.isPackaged);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title,
    backgroundColor: '#16181d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // An occluded or backgrounded window must keep drawing: the preview answers frame requests
      // through requestAnimationFrame, which throttling stops entirely — seen on the Windows CI
      // runner, whose desktop occludes the window, as a preview that never draws the frame asked for.
      backgroundThrottling: false,
    },
  });

  // The page's own <title> would replace it the moment the document loads. The window names the
  // project instead (milestone 27), with a mark while it has unsaved changes.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle(windowTitleNow());
  });

  /**
   * A window with unsaved changes is not closed under the person's feet: the close is held and
   * the window asked, and it closes when the window says so (`project:allow-close`). Cancelling
   * re-arms the question, so the next close asks again; a close while the question is already up
   * does nothing rather than stacking a second one.
   */
  mainWindow.on('close', (event) => {
    if (!projectDirty || closeAllowed) return;
    event.preventDefault();
    if (closeAsked) return;
    closeAsked = true;
    mainWindow?.webContents.send('project:close-requested');
  });

  // Never navigate the app window away or open new windows inside the app — but for the one the
  // stage pops out into (milestone 43), which the renderer opens under a known name and the stage
  // window service places and watches.
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    const stage = stageWindowOptions(frameName);
    if (stage) return { action: 'allow', overrideBrowserWindowOptions: stage };
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', (win, details) => {
    if (details.frameName === STAGE_WINDOW_NAME && mainWindow) adoptStageWindow(win, mainWindow);
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  // Pulp's own menu goes up before the page loads, so there is never a moment of Electron's.
  initMenu(mainWindow);

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    // The stage's window has no life of its own; it is remembered as it was for the next launch.
    destroyStageWindow();
  });
}

/** Everything written to stdout and stderr handed to the pipe, so an exit straight after loses none of it. */
function flushStdio(): Promise<void> {
  return Promise.all([process.stdout, process.stderr].map((stream) => new Promise<void>((resolve) => stream.write('', () => resolve())))).then(() => undefined);
}

/** What the title bar says: the app (and, run from source, the checkout), then the project. */
function windowTitleNow(): string {
  const base = windowTitle(app.getAppPath(), app.isPackaged);
  if (!projectTitle) return base;
  return `${projectDirty ? '• ' : ''}${projectTitle} — ${base}`;
}

/** The project's name and whether it has unsaved changes; the window tells us as they change. */
let projectTitle = '';
let projectDirty = false;
/** Set when the window has said the close may go ahead, so the second close is not held too. */
let closeAllowed = false;
/** Set while the window is asking about unsaved changes, so one close makes one question. */
let closeAsked = false;

function registerIpc(): void {
  ipcMain.handle('library:get', () => getLibrary());
  ipcMain.handle('library:rescan', () => rescan());
  ipcMain.handle('library:set-tags', (_event, id: string, tags: string[]) => setItemTags(id, Array.isArray(tags) ? tags.map(String) : []));
  ipcMain.handle('library:set-themes', (_event, id: string, themes: string[]) => setItemThemes(id, Array.isArray(themes) ? themes.map(String) : []));
  ipcMain.handle('library:set-favorite', (_event, id: string, favorite: boolean) => setItemFavorite(id, favorite === true));
  ipcMain.handle('library:set-sequence-fps', (_event, id: string, fps: unknown) => setItemSequenceFps(id, typeof fps === 'number' ? fps : undefined));
  ipcMain.handle('library:mark-used', (_event, id: string) => markItemUsed(id));
  ipcMain.handle('images:load', (_event, requests: unknown) => readSlotImages(grantRequestsFrom(requests)));
  ipcMain.handle('psd:outline', (_event, id: unknown) => layeredOutlineFor(String(id ?? '')));
  // The clips a video layer chose, read the same way and by the same rule (milestone 26).
  ipcMain.handle('clips:load', (_event, requests: unknown) => loadLayerClips(Array.isArray(requests) ? requests : []));
  ipcMain.handle('library:diagnostics', () => libraryDiagnostics());
  ipcMain.handle('images:import', (_event, path: unknown) => (typeof path === 'string' && path ? importImageFile(path) : { error: 'No file was chosen.' }));
  ipcMain.handle('fonts:list', () => listImportedFonts());
  ipcMain.handle('fonts:choose', () => chooseFontFile());
  ipcMain.handle('fonts:import', (_event, path: unknown, note: unknown) =>
    typeof path === 'string' && path ? importFontFile(path, typeof note === 'string' ? note : '') : { error: 'No file was chosen.' });
  /**
   * Where the sample media lives: the folder a run was made in, or — for a folder made before that
   * was recorded — a library folder named like the one the generator makes. Null when there is none
   * yet, which the hint reads as "nothing made" and a run turns into a question of where to put it.
   */
  const sampleMediaRoot = async (): Promise<string | null> => {
    const settings = await loadSettings();
    if (settings.sampleMediaRoot && existsSync(settings.sampleMediaRoot)) return settings.sampleMediaRoot;
    const named = settings.libraryFolders.find((f) => basename(f) === SAMPLE_MEDIA_FOLDER_NAME && existsSync(f));
    return named ?? null;
  };

  /** Make the catalogue, or the part of it `types` names, into `folder`, and put it in the library. */
  const makeSampleMedia = async (folder: string, types?: readonly string[]): Promise<SampleMediaOutcome> => {
    const items = types ? samplesToMake(types) : undefined;
    const report = await generateSampleMedia(folder, undefined, items);
    for (const f of report.failed) console.warn(`sample media: ${f.file || folder}: ${f.reason}`);
    await updateSettings((s) => ({ ...s, sampleMediaRoot: folder }));
    const index = await addLibraryFolder(folder);
    return { index, written: report.written.length, skipped: report.skipped.length, failed: report.failed.map((f) => f.reason) };
  };

  /** Ask where the folder should go; null when the question is dismissed. */
  const askForSampleFolder = async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: `Choose where to make the "${SAMPLE_MEDIA_FOLDER_NAME}" folder`,
      buttonLabel: 'Make sample media here',
      properties: ['openDirectory', 'createDirectory'],
    });
    const parent = result.filePaths[0];
    return result.canceled || !parent ? null : join(parent, SAMPLE_MEDIA_FOLDER_NAME);
  };

  ipcMain.handle('library:add-sample-media', async () => {
    const folder = await askForSampleFolder();
    return folder === null ? null : makeSampleMedia(folder);
  });
  // What the results' hint counts from (milestone 34): how many catalogue files each type still lacks.
  ipcMain.handle('library:sample-media-status', async () => ({ unmade: unmadeSamplesByType(await sampleMediaRoot()) }));
  // And the button beside it: just these types, into the folder the rest is in — or a new one, asked for once.
  ipcMain.handle('library:make-sample-media', async (_event, types: unknown) => {
    const wanted = Array.isArray(types) ? types.filter((t): t is string => typeof t === 'string') : [];
    if (wanted.length === 0) return null;
    const folder = (await sampleMediaRoot()) ?? (await askForSampleFolder());
    return folder === null ? null : makeSampleMedia(folder, wanted);
  });
  ipcMain.handle('library:add-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add library folder',
      properties: ['openDirectory'],
    });
    const folder = result.filePaths[0];
    if (result.canceled || !folder) return null;
    return addLibraryFolder(folder);
  });

  ipcMain.handle('ffmpeg:status', async (): Promise<FfmpegInfo> => {
    const status = await detectFfmpeg();
    return status.ok
      ? { ok: true, path: status.path, version: status.version, encoders: status.encoders }
      : { ok: false, message: status.message };
  });

  ipcMain.handle('queue:add', (_event, request: RenderRequest) => enqueueRender(request));
  ipcMain.handle('queue:add-batch', (_event, request: BatchRequest) => enqueueBatch(request));
  ipcMain.handle('drag:prepare', (_event, request: RenderRequest) => prepareDrag(request));
  ipcMain.handle('drag:start', (event, path: string, templateId?: string) =>
    startDragOut(event.sender, String(path), allowedDragFiles(), typeof templateId === 'string' ? templateId : undefined),
  );
  // Reveal and Copy path take the same allow-list as the drag: a render this app
  // made, never an arbitrary path the window asks for.
  ipcMain.handle('file:reveal', (_event, path: unknown) => {
    const file = String(path);
    if (!allowedDragFiles().has(file)) return false;
    shell.showItemInFolder(file);
    return true;
  });
  ipcMain.handle('file:copy-path', (_event, path: unknown) => {
    const file = String(path);
    if (!allowedDragFiles().has(file)) return false;
    clipboard.writeText(file);
    return true;
  });
  // The hand-off (milestone 20, ADR 0020): the file, not the account. Share… is the system's own
  // sheet — macOS's, the one place Electron has one; the card offers it only there.
  ipcMain.handle('file:share', (event, path: unknown) => {
    const file = String(path);
    if (process.platform !== 'darwin' || !allowedDragFiles().has(file)) return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    new ShareMenu({ filePaths: [file] }).popup({ window: win });
    return true;
  });
  // Open upload page: the platform's page in the browser and the file shown in the file manager,
  // ready to drop. The page comes off the built-in preset by its id — never a URL from the window —
  // and the file is held to the same allow-list as the drag.
  ipcMain.handle('file:open-upload', (_event, path: unknown, platform: unknown) => {
    const file = String(path);
    const preset = platformPreset(typeof platform === 'string' ? platform : undefined);
    if (!preset || !allowedDragFiles().has(file)) return false;
    shell.showItemInFolder(file);
    void shell.openExternal(preset.uploadUrl);
    return true;
  });
  ipcMain.handle('collection:save', (_event, collection: Collection, name: unknown) => saveCollectionTo(collection, String(name ?? '')));
  ipcMain.handle('collection:open', () => openCollectionFile());
  ipcMain.handle('collection:render', (_event, items: CollectionItem[], name: unknown) => renderCollection(items, String(name ?? '')));
  // Projects (milestone 27).
  ipcMain.handle('project:save', (_event, project: Project, path: unknown, name: unknown) =>
    saveProjectTo(project, typeof path === 'string' && path ? path : null, String(name ?? '')));
  ipcMain.handle('project:open', () => openProjectDialog());
  ipcMain.handle('project:open-path', (_event, path: unknown) =>
    typeof path === 'string' && path ? readProjectFile(path) : { ok: false as const, message: 'No project was chosen.' });
  ipcMain.handle('project:recent', () => recentProjects());
  ipcMain.handle('project:forget', (_event, path: unknown) => forgetProject(String(path ?? '')));
  // The start screen (milestone 31): the recent list with pins and times, the examples, and its switches.
  ipcMain.handle('project:recent-detailed', () => recentProjectsDetailed());
  ipcMain.handle('project:set-pinned', (_event, path: unknown, pinned: unknown) => setProjectPinned(String(path ?? ''), pinned === true));
  ipcMain.handle('project:relink-recent', (_event, path: unknown, answer: unknown) =>
    relinkRecentProject(String(path ?? ''), typeof answer === 'string' && answer ? answer : undefined));
  ipcMain.handle('examples:list', () => listExamples());
  ipcMain.handle('examples:read', (_event, path: unknown) => readExample(String(path ?? '')));
  ipcMain.handle('start-screen:get', async () => {
    const s = await loadSettings();
    return { showAtStartup: s.showStartScreen, tourSeen: s.tourSeen };
  });
  ipcMain.handle('start-screen:show-at-startup', async (_event, on: unknown) => {
    await updateSettings((s) => ({ ...s, showStartScreen: on === true }));
  });
  ipcMain.handle('start-screen:tour-seen', async () => {
    await updateSettings((s) => ({ ...s, tourSeen: true }));
  });
  ipcMain.handle('project:autosave', (_event, project: Project, path: unknown) =>
    writeRecovery(project, typeof path === 'string' && path ? path : null));
  ipcMain.handle('project:clear-recovery', () => clearRecovery());
  ipcMain.handle('project:recovery', () => readRecovery());
  ipcMain.handle('project:relink', (_event, target: { uid: string; path: string; kind: 'template' | 'media'; name: string }, others: { uid: string; path: string }[], answer: unknown) =>
    relinkProjectItem(target, Array.isArray(others) ? others : [], typeof answer === 'string' && answer ? answer : undefined));
  ipcMain.handle('project:missing-folders', (_event, folders: unknown) =>
    missingLibraryFolders(Array.isArray(folders) ? folders.map(String) : []));
  ipcMain.handle('project:title', (_event, name: unknown, dirty: unknown) => {
    projectTitle = String(name ?? '');
    projectDirty = dirty === true;
    // A window with nothing unsaved may close freely again.
    if (!projectDirty) closeAllowed = false;
    mainWindow?.setTitle(windowTitleNow());
  });
  ipcMain.handle('project:allow-close', async () => {
    closeAllowed = true;
    projectDirty = false;
    await clearRecovery();
    mainWindow?.close();
  });
  // Cancelled: the window stays, and the next close asks again rather than going straight through.
  ipcMain.handle('project:cancel-close', () => {
    closeAsked = false;
  });
  // The application menu (milestone 27): the window says what it can do, and reads back the
  // shortcuts to list them, so the list cannot drift from the keys.
  ipcMain.handle('menu:state', (_event, state: MenuState) => setMenuState(state));
  ipcMain.handle('menu:sections', () => menuSections());
  // Help -> Copy Diagnostics. Named for its one purpose and bounded, rather than a way for the
  // window to put anything at all on the clipboard.
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('diagnostics:copy', (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length > DIAGNOSTICS_MAX_CHARS) return false;
    clipboard.writeText(text);
    return true;
  });
  // The window sends an item id, never a path: the main process looks the path up,
  // so there is nothing to allow-list and nothing for the window to get wrong.
  ipcMain.handle('item:reveal', (_event, id: unknown) => {
    const path = itemPath(String(id));
    if (!path) return false;
    shell.showItemInFolder(path);
    return true;
  });
  ipcMain.handle('item:copy-path', (_event, id: unknown) => {
    const path = itemPath(String(id));
    if (!path) return false;
    clipboard.writeText(path);
    return true;
  });
  ipcMain.handle('queue:remove', (_event, id: unknown) => removeRender(Number(id)));
  ipcMain.handle('cache:stats', () => cacheStats());
  ipcMain.handle('cache:clear', () => clearRenderCache());
  ipcMain.handle('cache:choose-dir', () => chooseRenderCacheDir());
  ipcMain.handle('cache:set-limit', (_event, maxMB: unknown) => setRenderCacheLimit(sanitizeCacheMaxMB(maxMB)));
  ipcMain.handle('packs:choose', () => choosePackFile());
  ipcMain.handle('packs:preview', (_event, path: string) => previewPack(String(path)));
  ipcMain.handle('packs:install', (_event, path: string, choices: Record<string, CollisionChoice>) =>
    installPack(String(path), choices && typeof choices === 'object' ? choices : {}),
  );
  ipcMain.handle('packs:list', () => listInstalledPacks());
  ipcMain.handle('packs:export', async (_event, templateIds: string[], meta: { name: string; author?: string; license: string; description?: string }) => {
    const index = await getLibrary();
    const ids = new Set(Array.isArray(templateIds) ? templateIds.map(String) : []);
    // A Lottie animation is one file in a folder of other things, not a template folder (milestone 35):
    // a pack cannot carry it, and zipping its folder would carry everything beside it.
    const chosen = index.templates.filter((t) => ids.has(t.manifest.id) && !t.offline);
    const templates = chosen.filter((t) => !t.lottie);
    const lottieSkipped = chosen.filter((t) => t.lottie).map((t) => `${t.manifest.name} is a Lottie animation, which a pack cannot carry; share the .json or .lottie file itself.`);
    if (templates.length === 0) return { ok: false, message: lottieSkipped[0] ?? 'No templates to export.' };
    const destination = await chooseExportFile(meta?.name || templates[0]!.manifest.name);
    if (!destination) return { ok: false, cancelled: true, message: 'Export cancelled.' };
    try {
      const out = await exportPackTo(destination, templates, { name: String(meta?.name || 'Pack'), license: String(meta?.license || ''), ...(meta?.author ? { author: String(meta.author) } : {}), ...(meta?.description ? { description: String(meta.description) } : {}) });
      // A pack never carries a person's imported fonts: a template whose type is set in one is named here,
      // so whoever installs the pack knows what to supply (ADR 0014).
      const imported = new Set(importedFamilies(await listImportedFonts()));
      const warnings = templates
        .map((t) => ({ name: t.manifest.name, fonts: familiesUsedBy(t.manifest.blocks).filter((f) => imported.has(f)) }))
        .filter((t) => t.fonts.length > 0)
        .map((t) => `${t.name} is set in ${t.fonts.join(' and ')}, an imported font that is not in the pack; whoever installs it needs that font.`);
      return { ok: true, path: destination, bytes: out.bytes, warnings: [...lottieSkipped, ...warnings] };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });
  ipcMain.handle('presets:list', (_event, templateId: string) => listPresets(String(templateId)));
  ipcMain.handle('presets:save', (_event, templateId: string, name: string, values: Record<string, unknown>) =>
    savePreset(String(templateId), String(name), values && typeof values === 'object' ? values : {}),
  );
  ipcMain.handle('presets:delete', (_event, templateId: string, name: string) => deletePreset(String(templateId), String(name)));
  ipcMain.handle('queue:cancel', (_event, jobId: number) => cancelRender(jobId));
  ipcMain.handle('queue:clear-finished', () => clearFinishedRenders());
  ipcMain.handle('queue:get', () => getRenderQueue());

  ipcMain.handle('colors:recent-get', async () => (await loadSettings()).recentColors);
  ipcMain.handle('colors:recent-add', async (_event, hex: string) => {
    const saved = await updateSettings((s) => ({ ...s, recentColors: addRecentColor(s.recentColors, hex) }));
    return saved.recentColors;
  });

  ipcMain.handle('searches:recent-get', async () => (await loadSettings()).recentSearches);
  ipcMain.handle('searches:recent-add', async (_event, query: string) => {
    const saved = await updateSettings((s) => ({ ...s, recentSearches: addRecentSearch(s.recentSearches, String(query)) }));
    return saved.recentSearches;
  });

  ipcMain.handle('layout:get', async () => (await loadSettings()).layout);
  ipcMain.handle('layout:save', async (_event, layout: unknown) => {
    await updateSettings((s) => ({ ...s, layout: sanitizeLayout(layout) }));
  });

  ipcMain.handle('library:hover-strip', (_event, id: string) => hoverStrip(String(id)));
  ipcMain.handle('library:waveform', (_event, id: string) => waveform(String(id)));
  // Clip clean-up (milestone 52): keys, splits and the LUT chooser, each by library id, never a path.
  ipcMain.handle('cleanup:key-preview', (_event, id: unknown, settings: unknown, at: unknown) => chromaKeyPreview(String(id), settings, at));
  ipcMain.handle('cleanup:key', (_event, id: unknown, settings: unknown) => chromaKeyClip(String(id), settings));
  ipcMain.handle('cleanup:split-scenes', (_event, id: unknown) => splitScenes(String(id)));
  ipcMain.handle('cleanup:choose-lut', async () => {
    const pick = await dialog.showOpenDialog({ title: 'Choose a LUT', filters: [{ name: 'Cube LUT', extensions: ['cube'] }], properties: ['openFile'] });
    return pick.canceled || !pick.filePaths[0] ? null : pick.filePaths[0];
  });
  // The mix's loudness for the transport row's meter (milestone 52): ids and settings in, LUFS out.
  ipcMain.handle('audio:mix-loudness', (_event, request: unknown) => mixLoudness(request));
  // A treated voice preview (milestone 53): an id and a treatment in, a cache URL out.
  ipcMain.handle('audio:voice-preview', (_event, request: unknown) => voicePreview(request));
  // The cut track's frames for the preview (milestone 49): proxy windows per cut.
  ipcMain.handle('track:frames', (_event, request: unknown) => loadTrackFrames(request));
  // The track's quiet stretches (milestone 49), shown before anything is cut.
  ipcMain.handle('track:silences', (_event, request: unknown) => trackSilences(request));
  // The edit exported for an editing app (milestone 49): FCPXML, an EDL and the graphics with alpha.
  ipcMain.handle('track:export-edit', (_event, request: unknown) => exportEdit(request));

  ipcMain.handle('drag-notice:get', async () => (await loadSettings()).dragNoticeSeen);
  ipcMain.handle('drag-notice:seen', async () => {
    await updateSettings((s) => ({ ...s, dragNoticeSeen: true }));
  });

  ipcMain.handle('info-sections:get', async () => (await loadSettings()).infoSections);
  ipcMain.handle('info-sections:save', async (_event, sections: unknown) => {
    await updateSettings((s) => ({ ...s, infoSections: { ...s.infoSections, ...(sections && typeof sections === 'object' ? (sections as Record<string, boolean>) : {}) } }));
  });

  ipcMain.handle('player:get', async () => (await loadSettings()).player);
  ipcMain.handle('player:save', async (_event, player: unknown) => {
    await updateSettings((s) => ({ ...s, player: sanitizePlayer(player) }));
  });

  ipcMain.handle('browse-accordion:get', async () => (await loadSettings()).browseAccordion);
  ipcMain.handle('results-view:get', async () => (await loadSettings()).resultsView);
  ipcMain.handle('results-view:save', async (_event, view: unknown) => {
    await updateSettings((s) => ({ ...s, resultsView: sanitizeResultsView(view) }));
  });
}

/**
 * Headless mode for scripting and smoke tests:
 *   electron . --render <template-id> --preset <preset-id> --out <path> [--param key=value ...]
 *
 * A parameter may be a layer stack: `--param '@layers={"strap":[{"id":"name","text":"Ada Lovelace"}]}'`.
 *     [--fps <rate>] [--length <seconds|tc>] [--background #RRGGBB] [--in-point <tc|frame>] [--out-point <tc|frame>]
 *     [--cover-at <tc|frame>] [--platform <platform-id>] [--lut <file.cube>]
 *     [--aspect 16:9|9:16|1:1|4:5] [--size <width>x<height>]
 *     [--library <folder> ...] [--frame-timeout <seconds>] [--frame-format raw|png] [--batch <file.csv>]
 *   electron . --collection <file.pulpcollection> --out <folder> [--library <folder> ...]
 *   electron . --sample-media <folder> [--types <type,type>]
 *   electron . --visual-hashes <file> [--check]
 * `--sample-media` writes the sample-media catalogue (src/core/sample-media.ts) into the folder:
 * original CC0 sounds, music, stills and clips, at least six per media type, skipping files
 * that exist. Add the folder to a library afterwards.
 * `--collection` renders every template in a saved collection into the --out folder with the settings
 * each item carries; items the library cannot answer for are named and skipped.
 * `--batch` renders one output per CSV row into the folder given by --out, parameters from the row's
 * columns (headers match a parameter id or label, ignoring case) and the file name from its name column.
 * `--fps` samples the template at another standard frame rate; `--background` is the color alpha
 * templates are flattened over in non-alpha presets; `--in-point`/`--out-point` are the first and
 * last frame to render (inclusive), as timecode HH:MM:SS:FF, a frame number, or seconds like "2.5s".
 * `--aspect` picks one of the shapes the template draws for and `--size` the output size in pixels
 * (ADR 0012); without them a template renders at the size it declared, else its first aspect at 1080p.
 * `--platform <id>` (milestone 20) sets the aspect, size, frame rate and preset a platform asks for
 * in one go, and measures the finished file against that platform's length and file-size limits,
 * warning rather than refusing; `--preset`, `--aspect`, `--size` and `--fps` beside it win.
 * `--lut <file.cube>` (milestone 52) grades the whole render through the LUT, after any flattening
 * and before the preset's colour conversion.
 * `--library` adds template folders for this run only; they are not saved to settings.
 * `--frame-format png` uses the slower PNG pipe to ffmpeg, for comparison with the raw default.
 * The final line reports the elapsed time and frames per second.
 */
interface CliRender {
  templateId: string;
  presetId: string;
  out: string;
  /** As typed; `@layers` becomes the parsed stacks once the template is known. */
  params: Record<string, unknown>;
  libraries: string[];
  frameTimeoutMs?: number;
  frameFormat?: string;
  batch?: string;
  collection?: string;
  sampleMedia?: string;
  /** --types: fill only these taxonomy types, as the results' own hint does (milestone 34). */
  sampleTypes?: string[];
  /** --cover-at: the frame a cover image is taken at, beside the render (milestone 20). */
  coverAt?: string;
  /** --platform: named but not in the built-in list, reported with the list before anything runs. */
  unknownPlatform?: string;
  /** `--visual-hashes <file>`: write or check the visual references. */
  visualHashes?: { file: string; check: boolean };
  options: RenderOptions;
  /** The length as typed; read as seconds once the frame rate is known (milestone 30). */
  length?: string;
  /** In and out points as typed; parsed once the frame rate is known. */
  inPoint?: string;
  outPoint?: string;
  /** Flags whose value was not a number, reported before anything runs. */
  badNumbers: string[];
  /** `--export-edit <base>`: write the cut track as FCPXML and an EDL with the graphics rendered beside, instead of a render (milestone 49). */
  exportEdit?: string;
}

/**
 * `--visual-hashes <file>`: hash every bundled template at every aspect it
 * declares, at a few fixed frames, and either write the references or compare
 * with them (`--check`). The visual regression safety net; see
 * src/main/visual-service.ts.
 */
async function runVisualHashes(file: string, check: boolean): Promise<number> {
  const { hashLibrary, toReferences, compare } = await import('./visual-service');
  const templates = join(app.getAppPath(), 'templates');
  const { results, failed } = await hashLibrary(templates, (done, total, what) => {
    if (done % 25 === 0 || done === total) process.stdout.write(`${done}/${total} ${what}\n`);
  });
  for (const f of failed) process.stderr.write(`could not render ${f.what}: ${f.error}\n`);
  if (!check) {
    await writeFile(file, JSON.stringify(toReferences(results), null, 2) + '\n');
    process.stdout.write(`wrote ${results.length} hashes for ${Object.keys(toReferences(results)).length} templates to ${file}\n`);
    return failed.length > 0 ? 1 : 0;
  }
  let references;
  try {
    references = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    process.stderr.write(`no references at ${file}: ${(err as Error).message}\n`);
    return 1;
  }
  const { changed, missing } = compare(results, references);
  for (const c of changed) process.stdout.write(`CHANGED ${c.template} ${c.aspect} frame ${c.frame}: ${c.apart} bits from its reference\n`);
  for (const m of missing) process.stdout.write(`NEW ${m.template} ${m.aspect} frame ${m.frame}: ${m.hash}\n`);
  process.stdout.write(`${results.length} frames checked, ${changed.length} changed, ${missing.length} without a reference\n`);
  return changed.length + missing.length + failed.length > 0 ? 1 : 0;
}

function parseCliRender(argv: string[]): CliRender | null {
  const i = argv.indexOf('--render');
  // --collection renders a saved file and --sample-media makes files; neither names a template of its own.
  if (i === -1 && argv.indexOf('--collection') === -1 && argv.indexOf('--sample-media') === -1 && argv.indexOf('--visual-hashes') === -1) return null;
  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const params: Record<string, string> = {};
  const libraries: string[] = [];
  argv.forEach((arg, idx) => {
    if (arg === '--param') {
      const pair = argv[idx + 1] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) params[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    if (arg === '--library' && argv[idx + 1]) libraries.push(resolve(argv[idx + 1]!));
  });
  const frameTimeout = Number(get('--frame-timeout'));
  const frameFormat = get('--frame-format');
  const options: RenderOptions = {};
  const badNumbers: string[] = [];
  // --platform seeds the aspect, size, rate and preset (milestone 20); the flags read below
  // overwrite whichever of them were also given by hand, so either can be used with the other.
  const platformRaw = get('--platform');
  const platform = platformPreset(platformRaw);
  let platformPresetId: string | undefined;
  if (platform) {
    options.platform = platform.id;
    options.aspect = platform.aspect;
    options.width = platform.width;
    options.height = platform.height;
    options.fps = platform.fps;
    platformPresetId = platform.presetId;
  }
  const fpsRaw = get('--fps');
  if (fpsRaw !== undefined) {
    const value = Number(fpsRaw);
    if (fpsRaw.trim() === '' || !Number.isFinite(value)) badNumbers.push(`--fps ${fpsRaw}`);
    else options.fps = value;
  }
  const background = get('--background');
  if (background !== undefined) options.background = background;
  // A .cube graded over the whole render (milestone 52); the planner refuses anything else by name.
  const lutPath = get('--lut');
  if (lutPath !== undefined) options.lut = resolve(lutPath);
  const aspect = get('--aspect');
  if (aspect !== undefined) options.aspect = aspect;
  const sizeRaw = get('--size');
  if (sizeRaw !== undefined) {
    const m = /^(\d+)x(\d+)$/i.exec(sizeRaw.trim());
    if (!m) badNumbers.push(`--size ${sizeRaw} (expected <width>x<height>)`);
    else {
      options.width = Number(m[1]);
      options.height = Number(m[2]);
    }
  }
  const inPoint = get('--in-point');
  const outPoint = get('--out-point');
  const coverAt = get('--cover-at');
  const length = get('--length');
  const batch = get('--batch');
  const collection = get('--collection');
  const sampleMedia = get('--sample-media');
  const sampleTypes = get('--types');
  const visualHashes = get('--visual-hashes');
  const exportEditPath = get('--export-edit');
  return {
    templateId: argv[i + 1] ?? '',
    presetId: get('--preset') ?? platformPresetId ?? 'prores-4444',
    out: get('--out') ?? '',
    ...(platformRaw !== undefined && !platform ? { unknownPlatform: platformRaw } : {}),
    params,
    libraries,
    options,
    badNumbers,
    ...(length !== undefined ? { length } : {}),
    ...(inPoint !== undefined ? { inPoint } : {}),
    ...(batch !== undefined ? { batch: resolve(batch) } : {}),
    ...(collection !== undefined ? { collection: resolve(collection) } : {}),
    ...(sampleMedia !== undefined ? { sampleMedia: resolve(sampleMedia) } : {}),
    ...(sampleTypes !== undefined ? { sampleTypes: sampleTypes.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
    ...(coverAt !== undefined ? { coverAt } : {}),
    ...(visualHashes !== undefined ? { visualHashes: { file: resolve(visualHashes), check: argv.includes('--check') } } : {}),
    ...(exportEditPath !== undefined ? { exportEdit: resolve(exportEditPath) } : {}),
    ...(outPoint !== undefined ? { outPoint } : {}),
    ...(frameTimeout > 0 ? { frameTimeoutMs: frameTimeout * 1000 } : {}),
    ...(frameFormat !== undefined ? { frameFormat } : {}),
  };
}

async function runCliRender(cli: CliRender): Promise<number> {
  if (cli.libraries.length > 0) await rescan(cli.libraries);
  if (cli.sampleMedia !== undefined) return runCliSampleMedia(cli.sampleMedia, cli.sampleTypes);
  if (cli.visualHashes !== undefined) return runVisualHashes(cli.visualHashes.file, cli.visualHashes.check);
  if (cli.collection !== undefined) return runCliCollection(cli);
  const template = await findTemplate(cli.templateId);
  if (!template) {
    console.error(`Template "${cli.templateId}" not found.`);
    return 2;
  }
  if (!cli.out && cli.exportEdit === undefined) {
    // --export-edit names its own destination; everything else renders to --out.
    console.error('Missing --out <path>.');
    return 2;
  }
  if (cli.badNumbers.length > 0) {
    console.error(`Expected a number: ${cli.badNumbers.join(', ')}.`);
    return 2;
  }
  if (cli.unknownPlatform !== undefined) {
    console.error(`Unknown platform "${cli.unknownPlatform}" (expected one of: ${PLATFORM_IDS.join(', ')}).`);
    return 2;
  }
  if (cli.frameFormat !== undefined && !(FRAME_FORMATS as readonly string[]).includes(cli.frameFormat)) {
    console.error(`Unknown frame format "${cli.frameFormat}" (expected one of: ${FRAME_FORMATS.join(', ')}).`);
    return 2;
  }
  // In and out points are frames at the output rate, so they are parsed once the template is known.
  const fps = cli.options.fps ?? template.manifest.fps;
  try {
    // The length is settled before the points, which are frames of the length it chooses.
    if (cli.length !== undefined) {
      const seconds = parseLengthSeconds(cli.length, fps);
      if (seconds === null) {
        console.error(`--length: "${cli.length}" is not a number of seconds ("20", "20s") or a timecode (${timecodePattern(fps)})`);
        return 2;
      }
      cli.options.length = seconds;
    }
    if (cli.inPoint !== undefined) cli.options.inFrame = parseTimecode(cli.inPoint, fps);
    if (cli.outPoint !== undefined) cli.options.outFrame = parseTimecode(cli.outPoint, fps);
    if (cli.coverAt !== undefined) cli.options.coverFrame = parseTimecode(cli.coverAt, fps);
  } catch (err) {
    if (!(err instanceof TimecodeError)) throw err;
    const named = [
      ['--in-point', cli.inPoint],
      ['--out-point', cli.outPoint],
      ['--cover-at', cli.coverAt],
    ].find(([, value]) => value !== undefined && err.message.startsWith(`"${value}"`))?.[0];
    console.error(`${named ?? '--out-point'}: ${err.message}`);
    return 2;
  }
  // Layers given as JSON (milestone 23): parsed against this template, so a typo is named rather than ignored.
  const layersArg = cli.params[LAYERS_KEY];
  if (typeof layersArg === 'string') {
    const parsed = parseLayersArgument(layersArg, template.manifest);
    if (!parsed.ok) {
      console.error(parsed.message);
      return 2;
    }
    cli.params[LAYERS_KEY] = parsed.layers;
  }
  // The cut track given as JSON (milestone 49): read strictly, so a typo is named rather than ignored.
  const trackArg = cli.params[TRACK_KEY];
  if (typeof trackArg === 'string') {
    let parsedTrack: unknown;
    try {
      parsedTrack = JSON.parse(trackArg);
    } catch {
      console.error(`${TRACK_KEY}: must be JSON, such as {"cuts":[{"id":"<clip-id>","from":0,"to":2.5}]}`);
      return 2;
    }
    const sane = sanitizeCutTrack(parsedTrack);
    if (!sane) {
      console.error(`${TRACK_KEY}: holds no cuts; each needs a clip id and a window at least 0.05 s long`);
      return 2;
    }
    cli.params[TRACK_KEY] = sane;
  }
  if (cli.batch !== undefined) return runCliBatch(cli, template);
  // --export-edit (milestone 49): the edit for an editing app, in place of a render.
  if (cli.exportEdit !== undefined) {
    const exported = await exportEdit({ templateId: template.id, name: template.manifest.name, params: cli.params }, cli.exportEdit, template);
    if (!exported.ok) {
      console.error(exported.message);
      return 1;
    }
    console.log(`wrote ${exported.fcpxml}`);
    console.log(`wrote ${exported.edl}`);
    console.log(`wrote ${exported.graphics}`);
    return 0;
  }
  const started = Date.now();
  const result = await renderTemplate({
    template,
    params: cli.params,
    presetId: cli.presetId,
    outputPath: resolve(cli.out),
    overwrite: true,
    options: cli.options,
    ...(cli.frameTimeoutMs ? { frameTimeoutMs: cli.frameTimeoutMs } : {}),
    ...(cli.frameFormat !== undefined ? { frameFormat: cli.frameFormat as FrameFormat } : {}),
    onProgress: ({ frame, totalFrames }) => {
      if (frame === totalFrames || frame % 30 === 0) console.log(`frame ${frame}/${totalFrames}`);
    },
  });
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  console.log(`frames: ${result.transport}`);
  const seconds = (Date.now() - started) / 1000;
  console.log(`wrote ${result.output} (${result.frames} frames in ${seconds.toFixed(1)} s, ${(result.frames / seconds).toFixed(1)} frames/s)`);
  return 0;
}

/**
 * --sample-media: fill a folder with the sample-media catalogue and say what happened to each file.
 * With --types, only those taxonomy types are made — the command-line form of the results' own
 * "N more with sample media" button (milestone 34), and quicker than the whole catalogue.
 */
async function runCliSampleMedia(folder: string, types?: readonly string[]): Promise<number> {
  if (!folder) {
    console.error('Missing --sample-media <folder>.');
    return 2;
  }
  let items;
  if (types !== undefined) {
    items = samplesToMake(types);
    if (items.length === 0) {
      console.error(`No sample media for --types ${types.join(',')}.`);
      return 2;
    }
  }
  const started = Date.now();
  const report = await generateSampleMedia(folder, ({ done, total, file, outcome }) => console.log(`${done}/${total} ${outcome} ${file}`), items);
  for (const f of report.failed) console.error(`failed: ${f.file || folder}: ${f.reason}`);
  const seconds = (Date.now() - started) / 1000;
  console.log(`sample media in ${folder}: ${report.written.length} written, ${report.skipped.length} already there, ${report.failed.length} failed (${seconds.toFixed(1)} s)`);
  return report.failed.length > 0 ? 1 : 0;
}

/**
 * --collection: render a saved collection into the --out folder, each item with
 * the settings it carries. Items the library cannot answer for are named and
 * skipped rather than failing the run, so a collection that has outlived part of
 * a library still renders the rest.
 */
async function runCliCollection(cli: CliRender): Promise<number> {
  if (!cli.out) {
    console.error('Missing --out <folder>.');
    return 2;
  }
  const file = await readCollectionFile(cli.collection!);
  if (!file.ok) {
    console.error(file.message);
    return 2;
  }
  const items = file.collection?.items ?? [];
  const folder = resolve(cli.out);
  console.log(`collection: ${items.length} ${items.length === 1 ? 'item' : 'items'} from ${file.name} into ${folder}`);
  let rendered = 0;
  let failed = 0;
  for (const item of items) {
    if (item.kind === 'media') {
      // A media item renders itself (milestone 15), with the settings its card carries.
      const found = lookupMedia(item.id);
      const facts = isAudioPresetId(item.presetId) ? AUDIO_PRESETS[item.presetId] : OUTPUT_PRESETS[item.presetId as PresetId];
      if (!found || !found.online || !facts) {
        console.warn(`skipped ${item.name}: ${facts ? 'it is not in the library, or its folder is offline' : `unknown preset "${item.presetId}"`}`);
        continue;
      }
      const result = await renderMedia({ entry: found.entry, params: item.params, presetId: item.presetId, outputPath: join(folder, `${slug(item.name, 'render')}${facts.extension}`), overwrite: true, options: item.options });
      if (result.ok) {
        rendered += 1;
        console.log(`wrote ${result.output} (${item.name})`);
      } else {
        failed += 1;
        console.error(`${item.name}: ${result.message}`);
      }
      continue;
    }
    if (!item.templateId) {
      console.warn(`skipped ${item.name}: it names no template`);
      continue;
    }
    const template = await findTemplate(item.templateId);
    const preset = OUTPUT_PRESETS[item.presetId as PresetId];
    if (!template || !preset) {
      console.warn(`skipped ${item.name}: ${template ? `unknown preset "${item.presetId}"` : 'its template is not in the library'}`);
      continue;
    }
    const result = await renderTemplate({
      template,
      params: item.params,
      presetId: item.presetId,
      outputPath: join(folder, `${slug(item.name, 'render')}${preset.extension}`),
      overwrite: true,
      options: item.options,
      ...(cli.frameTimeoutMs ? { frameTimeoutMs: cli.frameTimeoutMs } : {}),
      ...(cli.frameFormat !== undefined ? { frameFormat: cli.frameFormat as FrameFormat } : {}),
    });
    if (result.ok) {
      rendered += 1;
      console.log(`wrote ${result.output} (${item.name})`);
    } else {
      failed += 1;
      console.error(`${item.name}: ${result.message}`);
    }
  }
  console.log(`collection: ${rendered} rendered, ${failed} failed`);
  return failed === 0 && rendered > 0 ? 0 : 1;
}

/** --batch: one render per CSV row into the --out folder. Warnings are printed before anything renders. */
async function runCliBatch(cli: CliRender, template: NonNullable<Awaited<ReturnType<typeof findTemplate>>>): Promise<number> {
  let csv: string;
  try {
    csv = await readFile(cli.batch!, 'utf8');
  } catch (err) {
    console.error(`Could not read ${cli.batch}: ${(err as Error).message}`);
    return 2;
  }
  const plan = planBatch(template.manifest, csv);
  for (const w of plan.warnings) console.warn(`warning: ${w}`);
  if (plan.rows.length === 0) {
    console.error('Nothing to render.');
    return 2;
  }
  const preset = OUTPUT_PRESETS[cli.presetId as PresetId];
  if (!preset) {
    console.error(`Unknown preset "${cli.presetId}".`);
    return 2;
  }
  const folder = resolve(cli.out);
  console.log(`batch: ${plan.rows.length} renders of ${template.manifest.name} into ${folder}`);
  let failed = 0;
  for (const row of plan.rows) {
    // A logo column may name a file in the Imported folder (milestone 22); a row whose logo is not found is named and skipped.
    const images = resolveRowImages(template.manifest, row.params);
    if (images.problems.length > 0) {
      failed += 1;
      console.error(`${row.label}: skipped: ${images.problems.join('; ')}`);
      continue;
    }
    const result = await renderTemplate({
      template,
      params: images.params,
      presetId: cli.presetId,
      outputPath: join(folder, `${row.fileName}${preset.extension}`),
      overwrite: true,
      options: cli.options,
      ...(cli.frameTimeoutMs ? { frameTimeoutMs: cli.frameTimeoutMs } : {}),
      ...(cli.frameFormat !== undefined ? { frameFormat: cli.frameFormat as FrameFormat } : {}),
    });
    if (result.ok) console.log(`wrote ${result.output} (${row.label})`);
    else {
      failed += 1;
      console.error(`${row.label}: ${result.message}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

const cli = parseCliRender(process.argv);

app.whenReady().then(async () => {
  handleTemplateProtocol();
  handleMediaProtocol();
  handleThumbProtocol();
  handleFontProtocol();
  if (cli) {
    app.dock?.hide();
    useInMemoryLibrary();
    const code = await runCliRender(cli);
    // What was printed reaches the pipe first: a run that prints hundreds of lines in a burst — the
    // sample-media generator skipping a folder that is already made — leaves them queued, and
    // app.exit drops the queue, so the run's own summary line never arrived on the Linux runner.
    await flushStdio();
    // A run that ends within a moment of ready could crash on Windows (0xC0000005): app.exit tore
    // the process down while Chromium's own start-up — its GPU process handshake — was still under
    // way (docs/ideas.md, 2026-11-01). The GPU process answering is the sign that start-up has
    // settled, so a quick run now ends the way a long one does: after it. A graceful app.quit was
    // tried and drops the exit code, so the exit stays app.exit, only no longer mid-handshake.
    await Promise.race([
      app.getGPUInfo('basic').catch(() => undefined),
      // No answer is not a reason to hang a finished run; five seconds is far past a handshake.
      new Promise((settle) => setTimeout(settle, 5_000)),
    ]);
    app.exit(code);
    return;
  }
  registerIpc();
  registerLogIpc();
  registerStageWindowIpc();
  await loadStageWindowSetting();
  createWindow();
  startLibraryMonitor();
  // Coming back to the app after working in a file manager: pick up what changed.
  app.on('browser-window-focus', () => void rescanIfStale());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => closeLibrary());

app.on('window-all-closed', () => {
  if (cli) return;
  if (process.platform !== 'darwin') app.quit();
});
