import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { SAMPLE_MEDIA_FOLDER_NAME } from '../core/sample-media';
import { generateSampleMedia } from './sample-media-service';
import { readSlotImages, resolveRowImages } from './image-grant';
import { join, resolve } from 'node:path';
import { detectFfmpeg } from '../core/ffmpeg';
import { FRAME_FORMATS, OUTPUT_PRESETS, type FrameFormat, type PresetId, type RenderOptions } from '../core/render-plan';
import { parseTimecode, TimecodeError } from '../core/timecode';
import type { BatchRequest, FfmpegInfo, RenderRequest } from '../shared/api';
import { addLibraryFolder, closeLibrary, findTemplate, getLibrary, hoverStrip, importImageFile, itemPath, libraryDiagnostics, markItemUsed, rescan, rescanIfStale, setItemFavorite, setItemTags, setItemThemes, startLibraryMonitor, useInMemoryLibrary, waveform } from './library-service';
import { handleFontProtocol, handleMediaProtocol, handleTemplateProtocol, handleThumbProtocol, registerTemplateScheme } from './protocol';
import { renderTemplate } from './render';
import { allowedDragFiles, cancelRender, clearFinishedRenders, enqueueBatch, enqueueRender, getRenderQueue, prepareDrag, removeRender } from './render-queue-service';
import { cacheStats, chooseRenderCacheDir, clearRenderCache, setRenderCacheLimit, startDragOut } from './render-cache-service';
import { sanitizeCacheMaxMB } from '../core/render-cache';
import { deletePreset, listPresets, savePreset } from './preset-service';
import { openCollectionFile, readCollectionFile, renderCollection, saveCollectionTo } from './collection-service';
import type { Collection, CollectionItem } from '../core/collection';
import { chooseExportFile, choosePackFile, exportPackTo, installPack, listInstalledPacks, previewPack } from './pack-service';
import type { CollisionChoice } from '../core/pack';
import { planBatch } from '../core/batch-csv';
import { windowTitle } from '../core/display';
import { familiesUsedBy, importedFamilies } from '../core/fonts';
import { chooseFontFile, importFontFile, listImportedFonts } from './font-service';
import { parseLayersArgument } from '../core/layers';
import { LAYERS_KEY } from '../core/params';
import { slug } from '../core/pack';
import { readFile } from 'node:fs/promises';
import { addRecentColor } from '../core/recent-colors';
import { addRecentSearch } from '../core/recent-searches';
import { sanitizeLayout } from '../core/layout';
import { sanitizeResultsView } from '../core/results-view';
import { sanitizePlayer } from '../core/player';
import { loadSettings, updateSettings } from './settings';

registerTemplateScheme();

// Tests point this at a scratch folder so they never touch the user's settings.json.
if (process.env.PULP_USER_DATA) app.setPath('userData', resolve(process.env.PULP_USER_DATA));

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

  // The page's own <title> would replace it the moment the document loads.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle(title);
  });

  // Never navigate the app window away or open new windows inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle('library:get', () => getLibrary());
  ipcMain.handle('library:rescan', () => rescan());
  ipcMain.handle('library:set-tags', (_event, id: string, tags: string[]) => setItemTags(id, Array.isArray(tags) ? tags.map(String) : []));
  ipcMain.handle('library:set-themes', (_event, id: string, themes: string[]) => setItemThemes(id, Array.isArray(themes) ? themes.map(String) : []));
  ipcMain.handle('library:set-favorite', (_event, id: string, favorite: boolean) => setItemFavorite(id, favorite === true));
  ipcMain.handle('library:mark-used', (_event, id: string) => markItemUsed(id));
  ipcMain.handle('images:load', (_event, ids: unknown) => readSlotImages(Array.isArray(ids) ? ids.map(String) : []));
  ipcMain.handle('library:diagnostics', () => libraryDiagnostics());
  ipcMain.handle('images:import', (_event, path: unknown) => (typeof path === 'string' && path ? importImageFile(path) : { error: 'No file was chosen.' }));
  ipcMain.handle('fonts:list', () => listImportedFonts());
  ipcMain.handle('fonts:choose', () => chooseFontFile());
  ipcMain.handle('fonts:import', (_event, path: unknown, note: unknown) =>
    typeof path === 'string' && path ? importFontFile(path, typeof note === 'string' ? note : '') : { error: 'No file was chosen.' });
  ipcMain.handle('library:add-sample-media', async () => {
    const result = await dialog.showOpenDialog({
      title: `Choose where to make the "${SAMPLE_MEDIA_FOLDER_NAME}" folder`,
      buttonLabel: 'Make sample media here',
      properties: ['openDirectory', 'createDirectory'],
    });
    const parent = result.filePaths[0];
    if (result.canceled || !parent) return null;
    const folder = join(parent, SAMPLE_MEDIA_FOLDER_NAME);
    const report = await generateSampleMedia(folder);
    for (const f of report.failed) console.warn(`sample media: ${f.file || folder}: ${f.reason}`);
    const index = await addLibraryFolder(folder);
    return { index, written: report.written.length, skipped: report.skipped.length, failed: report.failed.map((f) => f.reason) };
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
  ipcMain.handle('collection:save', (_event, collection: Collection, name: unknown) => saveCollectionTo(collection, String(name ?? '')));
  ipcMain.handle('collection:open', () => openCollectionFile());
  ipcMain.handle('collection:render', (_event, items: CollectionItem[], name: unknown) => renderCollection(items, String(name ?? '')));
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
    const templates = index.templates.filter((t) => ids.has(t.manifest.id) && !t.offline);
    if (templates.length === 0) return { ok: false, message: 'No templates to export.' };
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
      return { ok: true, path: destination, bytes: out.bytes, warnings };
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
 *     [--fps <rate>] [--background #RRGGBB] [--in-point <tc|frame>] [--out-point <tc|frame>]
 *     [--aspect 16:9|9:16|1:1|4:5] [--size <width>x<height>]
 *     [--library <folder> ...] [--frame-timeout <seconds>] [--frame-format raw|png] [--batch <file.csv>]
 *   electron . --collection <file.pulpcollection> --out <folder> [--library <folder> ...]
 *   electron . --sample-media <folder>
 * `--sample-media` writes the sample-media catalogue (src/core/sample-media.ts) into the folder:
 * original CC0 sounds, music, stills and clips, three to five per media type, skipping files
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
  options: RenderOptions;
  /** In and out points as typed; parsed once the frame rate is known. */
  inPoint?: string;
  outPoint?: string;
  /** Flags whose value was not a number, reported before anything runs. */
  badNumbers: string[];
}

function parseCliRender(argv: string[]): CliRender | null {
  const i = argv.indexOf('--render');
  // --collection renders a saved file and --sample-media makes files; neither names a template of its own.
  if (i === -1 && argv.indexOf('--collection') === -1 && argv.indexOf('--sample-media') === -1) return null;
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
  const fpsRaw = get('--fps');
  if (fpsRaw !== undefined) {
    const value = Number(fpsRaw);
    if (fpsRaw.trim() === '' || !Number.isFinite(value)) badNumbers.push(`--fps ${fpsRaw}`);
    else options.fps = value;
  }
  const background = get('--background');
  if (background !== undefined) options.background = background;
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
  const batch = get('--batch');
  const collection = get('--collection');
  const sampleMedia = get('--sample-media');
  return {
    templateId: argv[i + 1] ?? '',
    presetId: get('--preset') ?? 'prores-4444',
    out: get('--out') ?? '',
    params,
    libraries,
    options,
    badNumbers,
    ...(inPoint !== undefined ? { inPoint } : {}),
    ...(batch !== undefined ? { batch: resolve(batch) } : {}),
    ...(collection !== undefined ? { collection: resolve(collection) } : {}),
    ...(sampleMedia !== undefined ? { sampleMedia: resolve(sampleMedia) } : {}),
    ...(outPoint !== undefined ? { outPoint } : {}),
    ...(frameTimeout > 0 ? { frameTimeoutMs: frameTimeout * 1000 } : {}),
    ...(frameFormat !== undefined ? { frameFormat } : {}),
  };
}

async function runCliRender(cli: CliRender): Promise<number> {
  if (cli.libraries.length > 0) await rescan(cli.libraries);
  if (cli.sampleMedia !== undefined) return runCliSampleMedia(cli.sampleMedia);
  if (cli.collection !== undefined) return runCliCollection(cli);
  const template = await findTemplate(cli.templateId);
  if (!template) {
    console.error(`Template "${cli.templateId}" not found.`);
    return 2;
  }
  if (!cli.out) {
    console.error('Missing --out <path>.');
    return 2;
  }
  if (cli.badNumbers.length > 0) {
    console.error(`Expected a number: ${cli.badNumbers.join(', ')}.`);
    return 2;
  }
  if (cli.frameFormat !== undefined && !(FRAME_FORMATS as readonly string[]).includes(cli.frameFormat)) {
    console.error(`Unknown frame format "${cli.frameFormat}" (expected one of: ${FRAME_FORMATS.join(', ')}).`);
    return 2;
  }
  // In and out points are frames at the output rate, so they are parsed once the template is known.
  const fps = cli.options.fps ?? template.manifest.fps;
  try {
    if (cli.inPoint !== undefined) cli.options.inFrame = parseTimecode(cli.inPoint, fps);
    if (cli.outPoint !== undefined) cli.options.outFrame = parseTimecode(cli.outPoint, fps);
  } catch (err) {
    if (!(err instanceof TimecodeError)) throw err;
    console.error(`${cli.inPoint !== undefined && err.message.startsWith(`"${cli.inPoint}"`) ? '--in-point' : '--out-point'}: ${err.message}`);
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
  if (cli.batch !== undefined) return runCliBatch(cli, template);
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

/** --sample-media: fill a folder with the sample-media catalogue and say what happened to each file. */
async function runCliSampleMedia(folder: string): Promise<number> {
  if (!folder) {
    console.error('Missing --sample-media <folder>.');
    return 2;
  }
  const started = Date.now();
  const report = await generateSampleMedia(folder, ({ done, total, file, outcome }) => console.log(`${done}/${total} ${outcome} ${file}`));
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
    if (item.kind !== 'template' || !item.templateId) {
      console.warn(`skipped ${item.name}: only templates render today (converting media is milestone 15)`);
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
    app.exit(code);
    return;
  }
  registerIpc();
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
