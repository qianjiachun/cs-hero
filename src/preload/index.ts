import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { Cs2IntegrationStatus, MockMatchStatus, RecordingPocStatus } from '../shared/recording-types'

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
  onCs2IntegrationStatusChanged: (callback: (status: Cs2IntegrationStatus) => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: Cs2IntegrationStatus): void => {
      callback(status)
    }
    ipcRenderer.on(IPC.CS2_INTEGRATION_STATUS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.CS2_INTEGRATION_STATUS_EVENT, handler)
  }
}

try {
  contextBridge.exposeInMainWorld('csHero', api)
  console.log('[cs-hero preload] csHero bridge exposed')
} catch (err) {
  console.error('[cs-hero preload] exposeInMainWorld failed:', err)
}
