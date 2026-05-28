import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import type {
  AppSettings
} from '../../shared/settings'
import type {
  ContentListMatchesOptions,
  ContentListMatchesResult,
  Cs2IntegrationStatus,
  EditorExportTrimRequest,
  EditorOpenRequest,
  FfmpegJobStatus,
  MergeCreateRequest,
  MockMatchStatus,
  ObsRuntimeInfo,
  RecordingPocStatus
} from '../../shared/recording-types'
import { IPC } from './channels'
import { RecordingPocService } from '../services/recording_poc_service'
import { MockMatchService } from '../services/mock_match_service'
import { ContentService } from '../services/content_service'
import {
  primeMatchesCache,
  setOnMatchesChanged,
  startMatchesFileWatcher,
  stopMatchesFileWatcher
} from '../services/content_watch_service'
import {
  applySettings,
  loadSettings,
  setOnDiskSettingsChanged,
  startSettingsFileWatcher,
  stopSettingsFileWatcher
} from '../services/settings_service'
import { ensureRuntimeDirs } from '../shared/paths'
import { listDisplays } from '../shared/displays'
import { log, logError } from '../shared/logger'
import {
  getFfmpegService,
  getGameIntegrationService,
  getObsService,
  getRecorderService,
  startAppServices,
  shutdownAppServices
} from '../services/app_services'
import { EditorService } from '../services/editor_service'
import { ClipMergeService } from '../services/clip_merge_service'
import { paths } from '../shared/paths'
import { openEditorWindow } from '../windows/editor_window'
import { getStorageInfo } from '../services/storage_service'
import { ensureOsnRuntime } from '../services/osn_runtime_service'
import { ensureFfmpegRuntime } from '../services/ffmpeg_runtime_service'
import type { RuntimeDownloadStatus } from '../../shared/runtime-download-types'

let pocService: RecordingPocService | null = null
let mockMatchService: MockMatchService | null = null
let contentService: ContentService | null = null
let editorService: EditorService | null = null
let clipMergeService: ClipMergeService | null = null
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

function getContentService(): ContentService {
  if (!contentService) {
    contentService = new ContentService()
  }
  return contentService
}

function getEditorService(): EditorService {
  if (!editorService) {
    editorService = new EditorService()
  }
  return editorService
}

function getClipMergeService(): ClipMergeService {
  if (!clipMergeService) {
    clipMergeService = new ClipMergeService()
  }
  return clipMergeService
}

function broadcastFfmpegJob(status: FfmpegJobStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.FFMPEG_JOB_STATUS_EVENT, status)
  }
}

function refreshMatchesBroadcast(): void {
  notifyMatchesChanged()
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

function broadcastSettings(settings: AppSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.SETTINGS_CHANGED_EVENT, settings)
  }
}

function broadcastObsRuntime(info: ObsRuntimeInfo | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.OBS_RUNTIME_EVENT, info)
  }
}

function notifyMatchesChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.CONTENT_MATCHES_CHANGED_EVENT)
  }
}

function assertNotBusy(): void {
  if (getPocService().isRunning()) {
    throw new Error('PoC 录制进行中，请稍后再试')
  }
  if (getMockMatchService().isRunning()) {
    throw new Error('Mock 对局进行中，请稍后再试')
  }
  if (getRecorderService().isBusy()) {
    throw new Error('对局录制进行中，请稍后再试')
  }
}

const OBS_SETTING_KEYS = ['recordingFps', 'recordingQuality', 'recordingDisplayId'] as const

function needsObsReinit(prev: AppSettings, partial: Partial<AppSettings>): boolean {
  return OBS_SETTING_KEYS.some(
    (k) => partial[k] !== undefined && partial[k] !== prev[k]
  )
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
  setOnDiskSettingsChanged((settings) => {
    broadcastSettings(settings)
  })
  startSettingsFileWatcher()
  setOnMatchesChanged(() => notifyMatchesChanged())
  primeMatchesCache(() => getContentService())
  startMatchesFileWatcher(() => getContentService())
  log('App data root', getPocService().getStatus().appDataRoot)

  getFfmpegService().setOnJobStatusChanged(broadcastFfmpegJob)

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

  ipcMain.handle(IPC.CS2_REFRESH_LAUNCH_OPTION, async () => {
    await ensureAppServices()
    getGameIntegrationService().refreshLaunchOptions()
    const status = getGameIntegrationService().getStatus()
    broadcastCs2IntegrationStatus(status)
    return status
  })

  ipcMain.handle(IPC.CS2_OPEN_STEAM_GAME, async () => {
    await shell.openExternal('steam://open/gamedetails/730')
    return true
  })

  ipcMain.handle(IPC.MANUAL_RECORDING_START, async () => {
    assertNotBusy()
    await ensureAppServices()
    await getRecorderService().startManualRecording()
    const status = getGameIntegrationService().getStatus()
    broadcastCs2IntegrationStatus(status)
    return status
  })

  ipcMain.handle(IPC.MANUAL_RECORDING_STOP, async () => {
    await ensureAppServices()
    await getRecorderService().stopManualRecording()
    const status = getGameIntegrationService().getStatus()
    broadcastCs2IntegrationStatus(status)
    return status
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => loadSettings())

  ipcMain.handle(IPC.SETTINGS_UPDATE, async (_evt, partial: Partial<AppSettings>) => {
    if (partial.recordingMode !== undefined && getRecorderService().isBusy()) {
      throw new Error('录制进行中，无法切换自动/手动模式')
    }
    const prev = loadSettings()
    const next = applySettings(partial)

    const reinitObs =
      needsObsReinit(prev, partial) && getRecorderService().getState() === 'idle'

    if (reinitObs) {
      void getObsService()
        .reinitializeFromSettings()
        .then(async () => {
          const info = await getObsService().getRuntimeInfo()
          broadcastObsRuntime(info)
          getPocService().warmUpObs(broadcastRecordingStatus)
          getMockMatchService().warmUpObs(broadcastMockMatchStatus)
        })
        .catch((err) => log('OBS reinit after settings failed', err))
    }

    return next
  })

  ipcMain.handle(IPC.OBS_GET_RUNTIME_INFO, async () => {
    try {
      return await getObsService().getRuntimeInfo()
    } catch {
      return getObsService().getCachedRuntimeInfo()
    }
  })

  ipcMain.handle(
    IPC.CONTENT_LIST_MATCHES,
    (_evt, options?: ContentListMatchesOptions): ContentListMatchesResult => {
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 20
      return getContentService().listMatches(offset, limit)
    }
  )

  ipcMain.handle(IPC.CONTENT_GET_MATCH, (_evt, matchId: string) => {
    return getContentService().getMatch(matchId)
  })

  ipcMain.handle(IPC.CONTENT_OPEN_PATH, async (_evt, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('无效路径')
    }
    const err = await shell.openPath(targetPath)
    if (err) throw new Error(err)
    return true
  })

  ipcMain.handle(IPC.DISPLAYS_LIST, () => listDisplays())

  ipcMain.handle(IPC.EDITOR_OPEN, async (_evt, req: EditorOpenRequest) => {
    if (!req?.matchId || !req?.source) {
      throw new Error('无效的剪辑请求')
    }
    await openEditorWindow(req)
    return true
  })

  ipcMain.handle(IPC.EDITOR_GET_SESSION, async (_evt, req: EditorOpenRequest) => {
    if (!req?.matchId || !req?.source) {
      throw new Error('无效的剪辑请求')
    }
    const session = await getEditorService().getSessionAsync(req)
    return JSON.parse(JSON.stringify(session)) as typeof session
  })

  ipcMain.handle(IPC.EDITOR_EXPORT_TRIM, async (_evt, request: EditorExportTrimRequest) => {
    return getEditorService().exportTrim(request)
  })

  ipcMain.handle(IPC.EDITOR_DELETE_CLIP, (_evt, matchId: string, clipFile: string) => {
    getEditorService().deleteClip(matchId, clipFile)
    refreshMatchesBroadcast()
    return true
  })

  ipcMain.handle(IPC.EDITOR_OPEN_EXPORTS, async () => {
    fs.mkdirSync(paths.exportsDir, { recursive: true })
    const err = await shell.openPath(paths.exportsDir)
    if (err) throw new Error(err)
    return true
  })

  ipcMain.handle(IPC.FFMPEG_GET_JOB_STATUS, (_evt, jobId: string) => {
    if (!jobId) return null
    return getFfmpegService().getJobStatus(jobId)
  })

  ipcMain.handle(IPC.FFMPEG_CANCEL_JOB, (_evt, jobId: string) => {
    if (!jobId) throw new Error('无效任务')
    const ok = getFfmpegService().cancelJob(jobId)
    if (!ok) throw new Error('任务不存在或已结束')
    return true
  })

  ipcMain.handle(IPC.MERGE_GET_CANDIDATES, async (_evt, matchId: string) => {
    if (!matchId) throw new Error('无效对局')
    return getClipMergeService().getMergeCandidates(matchId)
  })

  ipcMain.handle(IPC.MERGE_CREATE, async (_evt, request: MergeCreateRequest) => {
    const result = await getClipMergeService().createMergedVideo({
      ...request,
      exportOnly: false
    })
    refreshMatchesBroadcast()
    return result
  })

  ipcMain.handle(IPC.MERGE_EXPORT, async (_evt, request: MergeCreateRequest) => {
    const result = await getClipMergeService().createMergedVideo({
      ...request,
      exportOnly: true
    })
    return result
  })

  ipcMain.on(IPC.WINDOW_MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.on(IPC.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on(IPC.WINDOW_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.handle(IPC.STORAGE_GET_INFO, async () => getStorageInfo())
}

function broadcastRuntimeDownloadStatus(status: RuntimeDownloadStatus): void {
  getPocService().setRuntimeDownloadStatus(status)
  broadcastRecordingStatus(getPocService().getStatus())
  getMockMatchService().setRuntimeDownloadStatus(status)
  broadcastMockMatchStatus(getMockMatchService().getStatus())
}

/** 窗口已显示后再预热 OBS，避免与首屏渲染争抢主线程 */
export function scheduleObsWarmUp(): void {
  setImmediate(() => {
    void (async () => {
      log('Scheduling OBS warm-up')
      try {
        if (app.isPackaged) {
          await ensureFfmpegRuntime(broadcastRuntimeDownloadStatus)
          await ensureOsnRuntime(broadcastRuntimeDownloadStatus)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logError('Recording runtime install failed', err)
        broadcastRuntimeDownloadStatus({
          component: message.includes('FFmpeg') ? 'ffmpeg' : 'osn',
          label: message.includes('FFmpeg') ? '视频处理组件' : '录制组件',
          phase: 'failed',
          message,
          error: message
        })
        return
      }

      getPocService().warmUpObs(broadcastRecordingStatus)
      getMockMatchService().warmUpObs(broadcastMockMatchStatus)
      await getObsService()
        .ensureReady()
        .then(() => {
          if (appServicesStarted) {
            broadcastCs2IntegrationStatus(getGameIntegrationService().getStatus())
          }
          return getObsService().getRuntimeInfo()
        })
        .catch((err) => logError('OBS warm-up failed', err))
    })()
  })
}

export async function shutdownServices(): Promise<void> {
  stopMatchesFileWatcher()
  stopSettingsFileWatcher()
  await pocService?.shutdown()
  await mockMatchService?.shutdown()
  await shutdownAppServices()
  pocService = null
  mockMatchService = null
  contentService = null
  editorService = null
  clipMergeService = null
  appServicesStarted = false
}
