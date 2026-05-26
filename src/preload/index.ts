import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { DisplayInfo } from '../shared/display-types'
import type { AppSettings } from '../shared/settings'
import type {
  ContentMatchDetail,
  ContentMatchSummary,
  Cs2IntegrationStatus,
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
  listMatches: (): Promise<ContentMatchSummary[]> =>
    ipcRenderer.invoke(IPC.CONTENT_LIST_MATCHES),
  onMatchesChanged: (callback: (matches: ContentMatchSummary[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, matches: ContentMatchSummary[]): void => {
      callback(matches)
    }
    ipcRenderer.on(IPC.CONTENT_MATCHES_CHANGED_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.CONTENT_MATCHES_CHANGED_EVENT, handler)
  },
  getMatch: (matchId: string): Promise<ContentMatchDetail | null> =>
    ipcRenderer.invoke(IPC.CONTENT_GET_MATCH, matchId),
  openPath: (targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.CONTENT_OPEN_PATH, targetPath),
  listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.DISPLAYS_LIST)
}

try {
  contextBridge.exposeInMainWorld('csHero', api)
  console.log('[cs-hero preload] csHero bridge exposed')
} catch (err) {
  console.error('[cs-hero preload] exposeInMainWorld failed:', err)
}
