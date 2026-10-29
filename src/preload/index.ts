import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { LibraryIndex, PulpApi, RenderQueueSnapshot } from '../shared/api';

const api: PulpApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescanLibrary: () => ipcRenderer.invoke('library:rescan'),
  setItemTags: (id, tags) => ipcRenderer.invoke('library:set-tags', id, tags),
  setItemThemes: (id, themes) => ipcRenderer.invoke('library:set-themes', id, themes),
  setItemFavorite: (id, favorite) => ipcRenderer.invoke('library:set-favorite', id, favorite),
  setItemSequenceFps: (id, fps) => ipcRenderer.invoke('library:set-sequence-fps', id, fps),
  markItemUsed: (id) => ipcRenderer.invoke('library:mark-used', id),
  onLibraryChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, index: LibraryIndex) => listener(index);
    ipcRenderer.on('library:changed', handler);
    return () => ipcRenderer.removeListener('library:changed', handler);
  },
  addLibraryFolder: () => ipcRenderer.invoke('library:add-folder'),
  addSampleMedia: () => ipcRenderer.invoke('library:add-sample-media'),
  loadSlotImages: (ids) => ipcRenderer.invoke('images:load', ids),
  loadLayerClips: (requests) => ipcRenderer.invoke('clips:load', requests),
  // The path never crosses from the page: the preload reads it off the File the picker handed over.
  importImage: (file) => ipcRenderer.invoke('images:import', webUtils.getPathForFile(file)),
  listFonts: () => ipcRenderer.invoke('fonts:list'),
  chooseFont: () => ipcRenderer.invoke('fonts:choose'),
  importFont: (path, note) => ipcRenderer.invoke('fonts:import', path, note),
  onFontsChanged: (listener) => {
    const handler = (_event: unknown, fonts: Parameters<typeof listener>[0]) => listener(fonts);
    ipcRenderer.on('fonts:changed', handler);
    return () => ipcRenderer.removeListener('fonts:changed', handler);
  },
  libraryDiagnostics: () => ipcRenderer.invoke('library:diagnostics'),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  render: (request) => ipcRenderer.invoke('queue:add', request),
  renderBatch: (request) => ipcRenderer.invoke('queue:add-batch', request),
  prepareDrag: (request) => ipcRenderer.invoke('drag:prepare', request),
  startDrag: (path, templateId) => ipcRenderer.invoke('drag:start', path, templateId),
  renderCacheStats: () => ipcRenderer.invoke('cache:stats'),
  clearRenderCache: () => ipcRenderer.invoke('cache:clear'),
  chooseRenderCacheDir: () => ipcRenderer.invoke('cache:choose-dir'),
  setRenderCacheLimit: (maxMB) => ipcRenderer.invoke('cache:set-limit', maxMB),
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
  removeRender: (id) => ipcRenderer.invoke('queue:remove', id),
  saveCollection: (collection, suggestedName) => ipcRenderer.invoke('collection:save', collection, suggestedName),
  openCollection: () => ipcRenderer.invoke('collection:open'),
  renderCollection: (items, name) => ipcRenderer.invoke('collection:render', items, name),
  revealFile: (path) => ipcRenderer.invoke('file:reveal', path),
  revealItem: (id) => ipcRenderer.invoke('item:reveal', id),
  copyItemPath: (id) => ipcRenderer.invoke('item:copy-path', id),
  copyFilePath: (path) => ipcRenderer.invoke('file:copy-path', path),
  platform: process.platform,
  getRenderQueue: () => ipcRenderer.invoke('queue:get'),
  getRecentColors: () => ipcRenderer.invoke('colors:recent-get'),
  addRecentColor: (hex) => ipcRenderer.invoke('colors:recent-add', hex),
  getRecentSearches: () => ipcRenderer.invoke('searches:recent-get'),
  addRecentSearch: (query) => ipcRenderer.invoke('searches:recent-add', query),
  getLayout: () => ipcRenderer.invoke('layout:get'),
  saveLayout: (layout) => ipcRenderer.invoke('layout:save', layout),
  hoverStrip: (id) => ipcRenderer.invoke('library:hover-strip', id),
  waveform: (id) => ipcRenderer.invoke('library:waveform', id),
  getDragNoticeSeen: () => ipcRenderer.invoke('drag-notice:get'),
  setDragNoticeSeen: () => ipcRenderer.invoke('drag-notice:seen'),
  getInfoSections: () => ipcRenderer.invoke('info-sections:get'),
  saveInfoSections: (sections) => ipcRenderer.invoke('info-sections:save', sections),
  getPlayer: () => ipcRenderer.invoke('player:get'),
  savePlayer: (player) => ipcRenderer.invoke('player:save', player),
  getBrowseAccordion: () => ipcRenderer.invoke('browse-accordion:get'),
  getResultsView: () => ipcRenderer.invoke('results-view:get'),
  saveResultsView: (view) => ipcRenderer.invoke('results-view:save', view),
  onRenderQueue: (listener) => {
    const handler = (_event: IpcRendererEvent, snapshot: RenderQueueSnapshot) => listener(snapshot);
    ipcRenderer.on('queue:changed', handler);
    return () => ipcRenderer.removeListener('queue:changed', handler);
  },
};

contextBridge.exposeInMainWorld('pulp', api);
