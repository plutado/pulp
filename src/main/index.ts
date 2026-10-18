import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { detectFfmpeg } from '../core/ffmpeg';
import { OUTPUT_PRESETS, type PresetId } from '../core/render-plan';
import type { FfmpegInfo, RenderRequest, RenderResult } from '../shared/api';
import { addLibraryFolder, findTemplate, getLibrary, rescan } from './library-service';
import { handleTemplateProtocol, registerTemplateScheme } from './protocol';
import { renderTemplate } from './render';

registerTemplateScheme();

let mainWindow: BrowserWindow | null = null;
let activeRender: AbortController | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Pulp',
    backgroundColor: '#16181d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
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
    return status.ok ? { ok: true, path: status.path, version: status.version } : { ok: false, message: status.message };
  });

  ipcMain.handle('render:start', async (event, request: RenderRequest): Promise<RenderResult> => {
    if (activeRender) return { ok: false, message: 'A render is already running.' };
    const template = await findTemplate(request.templateId);
    if (!template) return { ok: false, message: `Template "${request.templateId}" not found.` };
    const preset = OUTPUT_PRESETS[request.presetId as PresetId];
    if (!preset) return { ok: false, message: `Unknown preset "${request.presetId}".` };

    const defaultName = `${template.manifest.id.split('.').pop() ?? 'render'}${preset.extension}`;
    const save = await dialog.showSaveDialog({
      title: `Render ${template.manifest.name}`,
      defaultPath: join(app.getPath('videos') || homedir(), defaultName),
      filters: [{ name: preset.label, extensions: [preset.extension.slice(1)] }],
    });
    if (save.canceled || !save.filePath) return { ok: false, cancelled: true, message: 'Render cancelled.' };

    activeRender = new AbortController();
    try {
      return await renderTemplate({
        template,
        params: request.params,
        presetId: request.presetId,
        outputPath: save.filePath,
        // The save dialog already asked about replacing an existing file.
        overwrite: true,
        signal: activeRender.signal,
        ...(request.background ? { background: request.background } : {}),
        onProgress: (progress) => event.sender.send('render:progress', progress),
      });
    } finally {
      activeRender = null;
    }
  });

  ipcMain.handle('render:cancel', () => {
    activeRender?.abort();
  });
}

/**
 * Headless mode for scripting and smoke tests:
 *   electron . --render <template-id> --preset <preset-id> --out <path> [--param key=value ...]
 */
function parseCliRender(argv: string[]): { templateId: string; presetId: string; out: string; params: Record<string, string> } | null {
  const i = argv.indexOf('--render');
  if (i === -1) return null;
  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const params: Record<string, string> = {};
  argv.forEach((arg, idx) => {
    if (arg === '--param') {
      const pair = argv[idx + 1] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) params[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  });
  return {
    templateId: argv[i + 1] ?? '',
    presetId: get('--preset') ?? 'prores-4444',
    out: get('--out') ?? '',
    params,
  };
}

async function runCliRender(cli: NonNullable<ReturnType<typeof parseCliRender>>): Promise<number> {
  const template = await findTemplate(cli.templateId);
  if (!template) {
    console.error(`Template "${cli.templateId}" not found.`);
    return 2;
  }
  if (!cli.out) {
    console.error('Missing --out <path>.');
    return 2;
  }
  const result = await renderTemplate({
    template,
    params: cli.params,
    presetId: cli.presetId,
    outputPath: resolve(cli.out),
    overwrite: true,
    onProgress: ({ frame, totalFrames }) => {
      if (frame === totalFrames || frame % 30 === 0) console.log(`frame ${frame}/${totalFrames}`);
    },
  });
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  console.log(`wrote ${result.output} (${result.frames} frames)`);
  return 0;
}

const cli = parseCliRender(process.argv);

app.whenReady().then(async () => {
  handleTemplateProtocol();
  if (cli) {
    app.dock?.hide();
    const code = await runCliRender(cli);
    app.exit(code);
    return;
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (cli) return;
  if (process.platform !== 'darwin') app.quit();
});
