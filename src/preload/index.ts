import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { DisplayInfo } from '../shared/display-types'
import type { AppSettings } from '../shared/settings'
import type {
  ContentListMatchesOptions,
  ContentListMatchesResult,
  ContentMatchDetail,
  ContentMatchSummary,
  Cs2IntegrationStatus,
  EditorExportTrimRequest,
  EditorExportTrimResult,
  EditorOpenRequest,
  EditorSession,
  FfmpegJobStatus,
  MergeCandidates,
  MergeCreateRequest,
  MergeResult,
  MockMatchStatus,
  ObsRuntimeInfo,
  RecordingPocStatus
} from '../shared/recording-types'

const api = {
  runRecordingPoc: (): Promise<RecordingPocStatus> =>
    ipcRenderer.invoke(IPC.RECORDING_RUN_POC),
  getRecordingStatus: (): Promise<RecordingPocStatus> =>
    ipcRenderer.invoke(IPC.RECORDING_GET_STATUS),
  onRecordingStatusChanged: (callback: (status: RecordingPocStatus) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: RecordingPocStatus): void => {
      callback(status)
    }
    ipcRenderer.on(IPC.RECORDING_STATUS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.RECORDING_STATUS_EVENT, handler)
  },
  runMockMatch: (): Promise<MockMatchStatus> => ipcRenderer.invoke(IPC.MOCK_MATCH_RUN),
  getMockMatchStatus: (): Promise<MockMatchStatus> =>
    ipcRenderer.invoke(IPC.MOCK_MATCH_GET_STATUS),
  onMockMatchStatusChanged: (callback: (status: MockMatchStatus) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: MockMatchStatus): void => {
      callback(status)
    }
    ipcRenderer.on(IPC.MOCK_MATCH_STATUS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.MOCK_MATCH_STATUS_EVENT, handler)
  },
  getCs2IntegrationStatus: (): Promise<Cs2IntegrationStatus> =>
    ipcRenderer.invoke(IPC.CS2_INTEGRATION_GET_STATUS),
  refreshCs2LaunchOption: (): Promise<Cs2IntegrationStatus> =>
    ipcRenderer.invoke(IPC.CS2_REFRESH_LAUNCH_OPTION),
  openCs2InSteam: (): Promise<boolean> => ipcRenderer.invoke(IPC.CS2_OPEN_STEAM_GAME),
  startManualRecording: (): Promise<Cs2IntegrationStatus> =>
    ipcRenderer.invoke(IPC.MANUAL_RECORDING_START),
  stopManualRecording: (): Promise<Cs2IntegrationStatus> =>
    ipcRenderer.invoke(IPC.MANUAL_RECORDING_STOP),
  onCs2IntegrationStatusChanged: (callback: (status: Cs2IntegrationStatus) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: Cs2IntegrationStatus): void => {
      callback(status)
    }
    ipcRenderer.on(IPC.CS2_INTEGRATION_STATUS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.CS2_INTEGRATION_STATUS_EVENT, handler)
  },
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  updateSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_UPDATE, partial),
  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const handler = (_: Electron.IpcRendererEvent, settings: AppSettings): void => {
      callback(settings)
    }
    ipcRenderer.on(IPC.SETTINGS_CHANGED_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.SETTINGS_CHANGED_EVENT, handler)
  },
  getObsRuntimeInfo: (): Promise<ObsRuntimeInfo | null> =>
    ipcRenderer.invoke(IPC.OBS_GET_RUNTIME_INFO),
  onObsRuntimeChanged: (callback: (info: ObsRuntimeInfo | null) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: ObsRuntimeInfo | null): void => {
      callback(info)
    }
    ipcRenderer.on(IPC.OBS_RUNTIME_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.OBS_RUNTIME_EVENT, handler)
  },
  listMatches: (options?: ContentListMatchesOptions): Promise<ContentListMatchesResult> =>
    ipcRenderer.invoke(IPC.CONTENT_LIST_MATCHES, options),
  onMatchesChanged: (callback: () => void) => {
    const handler = (): void => {
      callback()
    }
    ipcRenderer.on(IPC.CONTENT_MATCHES_CHANGED_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.CONTENT_MATCHES_CHANGED_EVENT, handler)
  },
  getMatch: (matchId: string): Promise<ContentMatchDetail | null> =>
    ipcRenderer.invoke(IPC.CONTENT_GET_MATCH, matchId),
  openPath: (targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CONTENT_OPEN_PATH, targetPath),
  listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.DISPLAYS_LIST),
  openEditor: (req: EditorOpenRequest): Promise<boolean> =>
    ipcRenderer.invoke(IPC.EDITOR_OPEN, req),
  getEditorSession: (req: EditorOpenRequest): Promise<EditorSession> =>
    ipcRenderer.invoke(IPC.EDITOR_GET_SESSION, req),
  exportTrim: (request: EditorExportTrimRequest): Promise<EditorExportTrimResult> =>
    ipcRenderer.invoke(IPC.EDITOR_EXPORT_TRIM, request),
  deleteClip: (matchId: string, clipFile: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.EDITOR_DELETE_CLIP, matchId, clipFile),
  openExportsDir: (): Promise<boolean> => ipcRenderer.invoke(IPC.EDITOR_OPEN_EXPORTS),
  getFfmpegJobStatus: (jobId: string): Promise<FfmpegJobStatus | null> =>
    ipcRenderer.invoke(IPC.FFMPEG_GET_JOB_STATUS, jobId),
  cancelFfmpegJob: (jobId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FFMPEG_CANCEL_JOB, jobId),
  onFfmpegJobStatusChanged: (callback: (status: FfmpegJobStatus) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: FfmpegJobStatus): void => {
      callback(status)
    }
    ipcRenderer.on(IPC.FFMPEG_JOB_STATUS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.FFMPEG_JOB_STATUS_EVENT, handler)
  },
  getMergeCandidates: (matchId: string): Promise<MergeCandidates> =>
    ipcRenderer.invoke(IPC.MERGE_GET_CANDIDATES, matchId),
  createMergedVideo: (request: MergeCreateRequest): Promise<MergeResult> =>
    ipcRenderer.invoke(IPC.MERGE_CREATE, request),
  exportMergedVideo: (request: MergeCreateRequest): Promise<MergeResult> =>
    ipcRenderer.invoke(IPC.MERGE_EXPORT, request)
}

try {
  contextBridge.exposeInMainWorld('csHero', api)
  console.log('[cs-hero preload] csHero bridge exposed')
} catch (err) {
  console.error('[cs-hero preload] exposeInMainWorld failed:', err)
}
