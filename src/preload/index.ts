import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PulpApi, RenderProgress } from '../shared/api';

const api: PulpApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  addLibraryFolder: () => ipcRenderer.invoke('library:add-folder'),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  render: (request) => ipcRenderer.invoke('render:start', request),
  cancelRender: () => ipcRenderer.invoke('render:cancel'),
  onRenderProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: RenderProgress) => listener(progress);
    ipcRenderer.on('render:progress', handler);
    return () => ipcRenderer.removeListener('render:progress', handler);
  },
};

contextBridge.exposeInMainWorld('pulp', api);
