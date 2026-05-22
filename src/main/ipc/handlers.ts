import { BrowserWindow, ipcMain } from 'electron'
import type { Cs2IntegrationStatus, MockMatchStatus, RecordingPocStatus } from '../../shared/recording-types'
import { IPC } from './channels'
import { RecordingPocService } from '../services/recording_poc_service'
import { MockMatchService } from '../services/mock_match_service'
import { loadSettings } from '../services/settings_service'
import { ensureRuntimeDirs } from '../shared/paths'
import { log } from '../shared/logger'
import {
  getGameIntegrationService,
  startAppServices,
  shutdownAppServices
} from '../services/app_services'

let pocService: RecordingPocService | null = null
let mockMatchService: MockMatchService | null = null
let appServicesStarted = false

function getPocService(): RecordingPocService {
  if (!pocService) {
    pocService = new RecordingPocService()
  }
  return pocService
}

function getMockMatchService(): MockMatchService {
  if (!mockMatchService) {
    mockMatchService = new MockMatchService()
  }
  return mockMatchService
}

function broadcastRecordingStatus(status: RecordingPocStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.RECORDING_STATUS_EVENT, status)
  }
}

function broadcastMockMatchStatus(status: MockMatchStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.MOCK_MATCH_STATUS_EVENT, status)
  }
}

function broadcastCs2IntegrationStatus(status: Cs2IntegrationStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.CS2_INTEGRATION_STATUS_EVENT, status)
  }
}

function assertNotBusy(): void {
  if (getPocService().isRunning()) {
    throw new Error('PoC 录制进行中，请稍后再试')
  }
  if (getMockMatchService().isRunning()) {
    throw new Error('Mock 对局进行中，请稍后再试')
  }
}

async function ensureAppServices(): Promise<void> {
  if (appServicesStarted) return
  await startAppServices(broadcastCs2IntegrationStatus)
  appServicesStarted = true
  broadcastCs2IntegrationStatus(getGameIntegrationService().getStatus())
}

export function registerIpcHandlers(): void {
  ensureRuntimeDirs()
  loadSettings()
  log('App data root', getPocService().getStatus().appDataRoot)

  void ensureAppServices()

  ipcMain.handle(IPC.RECORDING_GET_STATUS, () => {
    return getPocService().getStatus()
  })

  ipcMain.handle(IPC.RECORDING_RUN_POC, async () => {
    assertNotBusy()
    if (getMockMatchService().isRunning()) {
      throw new Error('Mock 对局进行中')
    }
    const service = getPocService()
    const result = await service.runPoc(broadcastRecordingStatus)
    return result
  })

  ipcMain.handle(IPC.MOCK_MATCH_GET_STATUS, () => {
    return getMockMatchService().getStatus()
  })

  ipcMain.handle(IPC.MOCK_MATCH_RUN, async () => {
    assertNotBusy()
    const poc = getPocService()
    const pocPhase = poc.getStatus().phase
    if (pocPhase === 'recording' || pocPhase === 'stopping' || pocPhase === 'remuxing') {
      throw new Error('PoC 录制进行中')
    }
    await ensureAppServices()
    const service = getMockMatchService()
    const result = await service.runMockMatch((s) => {
      broadcastMockMatchStatus(s)
      broadcastCs2IntegrationStatus(getGameIntegrationService().getStatus())
    })
    return result
  })

  ipcMain.handle(IPC.CS2_INTEGRATION_GET_STATUS, async () => {
    await ensureAppServices()
    return getGameIntegrationService().getStatus()
  })
}

/** 窗口已显示后再预热 OBS，避免与首屏渲染争抢主线程 */
export function scheduleObsWarmUp(): void {
  setImmediate(() => {
    log('Scheduling OBS warm-up')
    getPocService().warmUpObs(broadcastRecordingStatus)
    getMockMatchService().warmUpObs(broadcastMockMatchStatus)
  })
}

export async function shutdownServices(): Promise<void> {
  await pocService?.shutdown()
  await mockMatchService?.shutdown()
  await shutdownAppServices()
  pocService = null
  mockMatchService = null
  appServicesStarted = false
}
