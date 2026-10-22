import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join, resolve } from 'node:path';
import { detectFfmpeg } from '../core/ffmpeg';
import { FRAME_FORMATS, type FrameFormat } from '../core/render-plan';
import type { FfmpegInfo, RenderRequest } from '../shared/api';
import { addLibraryFolder, findTemplate, getLibrary, rescan } from './library-service';
import { handleTemplateProtocol, registerTemplateScheme } from './protocol';
import { renderTemplate } from './render';
import { cancelRender, clearFinishedRenders, enqueueRender, getRenderQueue } from './render-queue-service';

registerTemplateScheme();

let mainWindow: BrowserWindow | null = null;

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

  ipcMain.handle('queue:add', (_event, request: RenderRequest) => enqueueRender(request));
  ipcMain.handle('queue:cancel', (_event, jobId: number) => cancelRender(jobId));
  ipcMain.handle('queue:clear-finished', () => clearFinishedRenders());
  ipcMain.handle('queue:get', () => getRenderQueue());
}

/**
 * Headless mode for scripting and smoke tests:
 *   electron . --render <template-id> --preset <preset-id> --out <path> [--param key=value ...]
 *     [--library <folder> ...] [--frame-timeout <seconds>] [--frame-format raw|png]
 * `--library` adds template folders for this run only; they are not saved to settings.
 * `--frame-format png` uses the slower PNG pipe to ffmpeg, for comparison with the raw default.
 * The final line reports the elapsed time and frames per second.
 */
interface CliRender {
  templateId: string;
  presetId: string;
  out: string;
  params: Record<string, string>;
  libraries: string[];
  frameTimeoutMs?: number;
  frameFormat?: string;
}

function parseCliRender(argv: string[]): CliRender | null {
  const i = argv.indexOf('--render');
  if (i === -1) return null;
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
  return {
    templateId: argv[i + 1] ?? '',
    presetId: get('--preset') ?? 'prores-4444',
    out: get('--out') ?? '',
    params,
    libraries,
    ...(frameTimeout > 0 ? { frameTimeoutMs: frameTimeout * 1000 } : {}),
    ...(frameFormat !== undefined ? { frameFormat } : {}),
  };
}

async function runCliRender(cli: CliRender): Promise<number> {
  if (cli.libraries.length > 0) await rescan(cli.libraries);
  const template = await findTemplate(cli.templateId);
  if (!template) {
    console.error(`Template "${cli.templateId}" not found.`);
    return 2;
  }
  if (!cli.out) {
    console.error('Missing --out <path>.');
    return 2;
  }
  if (cli.frameFormat !== undefined && !(FRAME_FORMATS as readonly string[]).includes(cli.frameFormat)) {
    console.error(`Unknown frame format "${cli.frameFormat}" (expected one of: ${FRAME_FORMATS.join(', ')}).`);
    return 2;
  }
  const started = Date.now();
  const result = await renderTemplate({
    template,
    params: cli.params,
    presetId: cli.presetId,
    outputPath: resolve(cli.out),
    overwrite: true,
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
