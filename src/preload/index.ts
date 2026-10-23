import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { LibraryIndex, PulpApi, RenderQueueSnapshot } from '../shared/api';

const api: PulpApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  setItemTags: (id, tags) => ipcRenderer.invoke('library:set-tags', id, tags),
  setItemFavorite: (id, favorite) => ipcRenderer.invoke('library:set-favorite', id, favorite),
  markItemUsed: (id) => ipcRenderer.invoke('library:mark-used', id),
  onLibraryChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, index: LibraryIndex) => listener(index);
    ipcRenderer.on('library:changed', handler);
    return () => ipcRenderer.removeListener('library:changed', handler);
  },
  addLibraryFolder: () => ipcRenderer.invoke('library:add-folder'),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  render: (request) => ipcRenderer.invoke('queue:add', request),
  renderBatch: (request) => ipcRenderer.invoke('queue:add-batch', request),
  choosePackFile: () => ipcRenderer.invoke('packs:choose'),
  previewPack: (path) => ipcRenderer.invoke('packs:preview', path),
  installPack: (path, choices) => ipcRenderer.invoke('packs:install', path, choices),
  listInstalledPacks: () => ipcRenderer.invoke('packs:list'),
  exportPack: (templateIds, meta) => ipcRenderer.invoke('packs:export', templateIds, meta),
  cancelRender: (jobId) => ipcRenderer.invoke('queue:cancel', jobId),
  listPresets: (templateId) => ipcRenderer.invoke('presets:list', templateId),
  savePreset: (templateId, name, values) => ipcRenderer.invoke('presets:save', templateId, name, values),
  deletePreset: (templateId, name) => ipcRenderer.invoke('presets:delete', templateId, name),
  clearFinishedRenders: () => ipcRenderer.invoke('queue:clear-finished'),
  getRenderQueue: () => ipcRenderer.invoke('queue:get'),
  getRecentColors: () => ipcRenderer.invoke('colors:recent-get'),
  addRecentColor: (hex) => ipcRenderer.invoke('colors:recent-add', hex),
  onRenderQueue: (listener) => {
    const handler = (_event: IpcRendererEvent, snapshot: RenderQueueSnapshot) => listener(snapshot);
    ipcRenderer.on('queue:changed', handler);
    return () => ipcRenderer.removeListener('queue:changed', handler);
  },
};

contextBridge.exposeInMainWorld('pulp', api);
