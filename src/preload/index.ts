import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PulpApi, RenderQueueSnapshot } from '../shared/api';

const api: PulpApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  addLibraryFolder: () => ipcRenderer.invoke('library:add-folder'),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  render: (request) => ipcRenderer.invoke('queue:add', request),
  cancelRender: (jobId) => ipcRenderer.invoke('queue:cancel', jobId),
  clearFinishedRenders: () => ipcRenderer.invoke('queue:clear-finished'),
  getRenderQueue: () => ipcRenderer.invoke('queue:get'),
  onRenderQueue: (listener) => {
    const handler = (_event: IpcRendererEvent, snapshot: RenderQueueSnapshot) => listener(snapshot);
    ipcRenderer.on('queue:changed', handler);
    return () => ipcRenderer.removeListener('queue:changed', handler);
  },
};

contextBridge.exposeInMainWorld('pulp', api);
