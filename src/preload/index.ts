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
  addStockLibrary: () => ipcRenderer.invoke('library:add-stock'),
  addStockLibraryImage: () => ipcRenderer.invoke('library:add-stock-image'),
  clipSetPreview: (id: string, length?: number) => ipcRenderer.invoke('clip-set:preview', id, length),
  stemsPreview: (id: string) => ipcRenderer.invoke('stems:preview', id),
  removeStockLibrary: (path: string) => ipcRenderer.invoke('library:remove-stock', path),
  addSampleMedia: () => ipcRenderer.invoke('library:add-sample-media'),
  stageWindowState: () => ipcRenderer.invoke('stage-window:state'),
  closeStageWindow: () => ipcRenderer.invoke('stage-window:close'),
  setStageWindowFullScreen: (on) => ipcRenderer.invoke('stage-window:full-screen', on),
  stageWindowOnDisplay: (id) => ipcRenderer.invoke('stage-window:on-display', id),
  onStageWindowCloseRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('stage-window:close-requested', handler);
    return () => ipcRenderer.removeListener('stage-window:close-requested', handler);
  },
  onStageWindowFullScreen: (listener) => {
    const handler = (_event: IpcRendererEvent, on: boolean) => listener(on);
    ipcRenderer.on('stage-window:full-screen-changed', handler);
    return () => ipcRenderer.removeListener('stage-window:full-screen-changed', handler);
  },
  sampleMediaStatus: () => ipcRenderer.invoke('library:sample-media-status'),
  makeSampleMedia: (types) => ipcRenderer.invoke('library:make-sample-media', types),
  loadSlotImages: (requests) => ipcRenderer.invoke('images:load', requests),
  psdOutline: (id) => ipcRenderer.invoke('psd:outline', id),
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
  ffmpegDownloadStatus: () => ipcRenderer.invoke('ffmpeg:download-status'),
  fetchFfmpeg: () => ipcRenderer.invoke('ffmpeg:fetch'),
  onFfmpegProgress: (listener) => {
    const handler = (_event: unknown, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('ffmpeg:progress', handler);
    return () => ipcRenderer.removeListener('ffmpeg:progress', handler);
  },
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
  saveProject: (project, path, suggestedName) => ipcRenderer.invoke('project:save', project, path, suggestedName),
  openProject: () => ipcRenderer.invoke('project:open'),
  takePendingOpen: () => ipcRenderer.invoke('project:take-pending-open'),
  onOpenFile: (listener) => {
    const handler = (_event: unknown, path: string) => listener(path);
    ipcRenderer.on('project:open-file', handler);
    return () => ipcRenderer.removeListener('project:open-file', handler);
  },
  openProjectPath: (path) => ipcRenderer.invoke('project:open-path', path),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  forgetProject: (path) => ipcRenderer.invoke('project:forget', path),
  recentProjectsDetailed: () => ipcRenderer.invoke('project:recent-detailed'),
  setProjectPinned: (path, pinned) => ipcRenderer.invoke('project:set-pinned', path, pinned),
  relinkRecentProject: (path, answer) => ipcRenderer.invoke('project:relink-recent', path, answer),
  listExamples: () => ipcRenderer.invoke('examples:list'),
  readExample: (path) => ipcRenderer.invoke('examples:read', path),
  getStartScreenPrefs: () => ipcRenderer.invoke('start-screen:get'),
  setShowStartScreen: (on) => ipcRenderer.invoke('start-screen:show-at-startup', on),
  setTourSeen: () => ipcRenderer.invoke('start-screen:tour-seen'),
  autosaveProject: (project, path) => ipcRenderer.invoke('project:autosave', project, path),
  clearRecovery: () => ipcRenderer.invoke('project:clear-recovery'),
  pendingRecovery: () => ipcRenderer.invoke('project:recovery'),
  interruptedRenders: () => ipcRenderer.invoke('render:interrupted'),
  renderAgain: () => ipcRenderer.invoke('render:again'),
  relinkItem: (target, others, answer) => ipcRenderer.invoke('project:relink', target, others, answer),
  missingLibraryFolders: (folders) => ipcRenderer.invoke('project:missing-folders', folders),
  onCloseRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('project:close-requested', handler);
    return () => ipcRenderer.removeListener('project:close-requested', handler);
  },
  allowClose: () => ipcRenderer.invoke('project:allow-close'),
  cancelClose: () => ipcRenderer.invoke('project:cancel-close'),
  setProjectTitle: (name, dirty) => ipcRenderer.invoke('project:title', name, dirty),
  setMenuState: (state) => ipcRenderer.invoke('menu:state', state),
  menuSections: () => ipcRenderer.invoke('menu:sections'),
  copyDiagnostics: (text) => ipcRenderer.invoke('diagnostics:copy', text),
  recordLog: (level, source, message, detail) => ipcRenderer.invoke('log:record', level, source, message, detail),
  logTail: (lines) => ipcRenderer.invoke('log:tail', lines),
  revealLog: () => ipcRenderer.invoke('log:reveal'),
  onMenuCommand: (listener) => {
    const handler = (_event: unknown, command: string, arg: string | null) => listener(command as never, arg);
    ipcRenderer.on('menu:command', handler);
    return () => ipcRenderer.removeListener('menu:command', handler);
  },
  renderCollection: (items, name) => ipcRenderer.invoke('collection:render', items, name),
  revealFile: (path) => ipcRenderer.invoke('file:reveal', path),
  revealItem: (id) => ipcRenderer.invoke('item:reveal', id),
  copyItemPath: (id) => ipcRenderer.invoke('item:copy-path', id),
  copyFilePath: (path) => ipcRenderer.invoke('file:copy-path', path),
  shareFile: (path) => ipcRenderer.invoke('file:share', path),
  openUploadPage: (path, platform) => ipcRenderer.invoke('file:open-upload', path, platform),
  platform: process.platform,
  appVersion: () => ipcRenderer.invoke('app:version'),
  appPerformance: () => ipcRenderer.invoke('app:performance'),
  getRenderQueue: () => ipcRenderer.invoke('queue:get'),
  getRecentColors: () => ipcRenderer.invoke('colors:recent-get'),
  addRecentColor: (hex) => ipcRenderer.invoke('colors:recent-add', hex),
  getRecentSearches: () => ipcRenderer.invoke('searches:recent-get'),
  addRecentSearch: (query) => ipcRenderer.invoke('searches:recent-add', query),
  getLayout: () => ipcRenderer.invoke('layout:get'),
  saveLayout: (layout) => ipcRenderer.invoke('layout:save', layout),
  hoverStrip: (id) => ipcRenderer.invoke('library:hover-strip', id),
  waveform: (id) => ipcRenderer.invoke('library:waveform', id),
  mixLoudness: (request) => ipcRenderer.invoke('audio:mix-loudness', request),
  voicePreview: (request) => ipcRenderer.invoke('audio:voice-preview', request),
  trackFrames: (request) => ipcRenderer.invoke('track:frames', request),
  trackSilences: (request) => ipcRenderer.invoke('track:silences', request),
  exportEdit: (request) => ipcRenderer.invoke('track:export-edit', request),
  semanticStatus: () => ipcRenderer.invoke('semantic:status'),
  setSemanticSearch: (enabled) => ipcRenderer.invoke('semantic:set', enabled),
  fetchSemanticModel: () => ipcRenderer.invoke('semantic:fetch-model'),
  semanticSearch: (text) => ipcRenderer.invoke('semantic:search', text),
  onSemanticProgress: (listener) => {
    const handler = (_event: unknown, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('semantic:progress', handler);
    return () => ipcRenderer.removeListener('semantic:progress', handler);
  },
  panelStatus: () => ipcRenderer.invoke('panel:status'),
  setEditorPanel: (enabled) => ipcRenderer.invoke('panel:set', enabled),
  getAppearance: () => ipcRenderer.invoke('appearance:get'),
  setAppearance: (choice) => ipcRenderer.invoke('appearance:set', choice),
  getLanguage: () => ipcRenderer.invoke('language:get'),
  setLanguage: (choice) => ipcRenderer.invoke('language:set', choice),
  onLanguageChanged: (listener) => {
    const handler = (_event: unknown, state: Parameters<typeof listener>[0]) => listener(state);
    ipcRenderer.on('language:changed', handler);
    return () => ipcRenderer.removeListener('language:changed', handler);
  },
  microphoneAccess: () => ipcRenderer.invoke('recording:access'),
  saveRecording: (wav) => ipcRenderer.invoke('recording:save', wav),
  openPrivacySettings: (device) => ipcRenderer.invoke('recording:open-settings', device),
  getRecordingInput: () => ipcRenderer.invoke('recording:input'),
  setRecordingInput: (input) => ipcRenderer.invoke('recording:set-input', input),
  cameraAccess: (sound) => ipcRenderer.invoke('video:access', sound),
  beginVideoTake: () => ipcRenderer.invoke('video:begin'),
  appendVideoTake: (id, piece) => ipcRenderer.invoke('video:append', id, piece),
  finishVideoTake: (id, facts) => ipcRenderer.invoke('video:finish', id, facts),
  abandonVideoTake: (id) => ipcRenderer.invoke('video:abandon', id),
  getVideoInputs: () => ipcRenderer.invoke('video:inputs'),
  setVideoInputs: (inputs) => ipcRenderer.invoke('video:set-inputs', inputs),
  panelCollectionChanged: (collection, name) => ipcRenderer.invoke('panel:collection', collection, name),
  saveCanvasTemplate: (request) => ipcRenderer.invoke('canvas:save-template', request),
  saveLottieTemplate: (request) => ipcRenderer.invoke('lottie:save-template', request),
  onPanelOpen: (listener) => {
    const handler = (_event: unknown, target: Parameters<typeof listener>[0]) => listener(target);
    ipcRenderer.on('panel:open', handler);
    return () => ipcRenderer.removeListener('panel:open', handler);
  },
  speechStatus: (request) => ipcRenderer.invoke('speech:status', request),
  fetchSpeechModel: (request) => ipcRenderer.invoke('speech:fetch-model', request),
  transcribe: (request) => ipcRenderer.invoke('speech:transcribe', request),
  trackMotion: (request) => ipcRenderer.invoke('track:motion', request),
  reframeCut: (request) => ipcRenderer.invoke('track:reframe', request),
  onSpeechProgress: (listener) => {
    const handler = (_event: unknown, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('speech:progress', handler);
    return () => ipcRenderer.removeListener('speech:progress', handler);
  },
  chromaKeyPreview: (id, settings, atSeconds) => ipcRenderer.invoke('cleanup:key-preview', id, settings, atSeconds),
  chromaKeyClip: (id, settings) => ipcRenderer.invoke('cleanup:key', id, settings),
  splitScenes: (id) => ipcRenderer.invoke('cleanup:split-scenes', id),
  stabilizeStatus: () => ipcRenderer.invoke('cleanup:stabilize-status'),
  stabilizeClip: (id, settings) => ipcRenderer.invoke('cleanup:stabilize', id, settings),
  cancelStabilize: () => ipcRenderer.invoke('cleanup:stabilize-cancel'),
  onStabilizeProgress: (listener) => {
    const handler = (_event: unknown, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on('cleanup:stabilize-progress', handler);
    return () => ipcRenderer.removeListener('cleanup:stabilize-progress', handler);
  },
  chooseLutFile: () => ipcRenderer.invoke('cleanup:choose-lut'),
  getDragNoticeSeen: () => ipcRenderer.invoke('drag-notice:get'),
  setDragNoticeSeen: () => ipcRenderer.invoke('drag-notice:seen'),
  getTypeOutputDefaults: () => ipcRenderer.invoke('type-defaults:get'),
  setTypeOutputDefault: (type, value) => ipcRenderer.invoke('type-defaults:save', type, value),
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
