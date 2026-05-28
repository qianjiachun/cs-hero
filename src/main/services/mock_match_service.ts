import http from 'http'
import type { MockMatchStatus } from '../../shared/recording-types'
import type { RuntimeDownloadStatus } from '../../shared/runtime-download-types'
import { MOCK_STEAM_ID } from '../../shared/gsi-types'
import type { GsiPayload } from '../../shared/gsi-types'
import { getAppDataRoot } from '../shared/paths'
import { log, logError } from '../shared/logger'
import { getObsService, getRecorderService, getGameIntegrationService } from './app_services'

const MOCK_MAP = 'de_mirage'
const MOCK_DURATION_MS = 15_000
const FIRST_KILL_MS = 6_000
const SECOND_KILL_MS = 10_000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function buildPayload(
  phase: 'live' | 'gameover',
  kills: number,
  deaths: number
): GsiPayload {
  return {
    provider: { steamid: MOCK_STEAM_ID },
    map: { phase, name: MOCK_MAP },
    player: {
      steamid: MOCK_STEAM_ID,
      match_stats: { kills, deaths }
    }
  }
}

function postGsi(port: number, payload: GsiPayload): Promise<void> {
  const body = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        res.resume()
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve()
          } else {
            reject(new Error(`GSI POST 状态码 ${res.statusCode}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

export class MockMatchService {
  private status: MockMatchStatus = {
    phase: 'idle',
    message: '就绪',
    appDataRoot: '',
    obsReady: false
  }

  private running = false
  private warmUpPromise: Promise<void> | null = null

  private readonly obs = getObsService()
  private readonly recorder = getRecorderService()

  getStatus(): MockMatchStatus {
    return { ...this.status, appDataRoot: getAppDataRoot() }
  }

  isRunning(): boolean {
    return this.running
  }

  private mergeFromRecorder(): void {
    const r = this.recorder.getStatus()
    this.status = {
      ...this.status,
      phase: r.phase,
      message: r.message,
      obsReady: r.obsReady,
      matchId: r.matchId,
      outputDir: r.outputDir,
      outputVideo: r.outputVideo,
      matchJson: r.matchJson,
      bookmarkCount: r.bookmarkCount,
      clipCount: r.clipCount,
      error: r.error,
      runtimeDownload: r.runtimeDownload,
      appDataRoot: getAppDataRoot()
    }
  }

  private setStatus(partial: Partial<MockMatchStatus>): void {
    this.status = { ...this.status, ...partial, appDataRoot: getAppDataRoot() }
  }

  setRuntimeDownloadStatus(status: RuntimeDownloadStatus): void {
    this.setStatus({
      message: status.message,
      obsReady: false,
      runtimeDownload: status,
      error: status.error
    })
  }

  warmUpObs(onUpdate?: (s: MockMatchStatus) => void): void {
    if (this.obs.isInitialized()) {
      this.setStatus({ obsReady: true })
      onUpdate?.(this.getStatus())
      return
    }
    if (this.warmUpPromise) return

    const notify = (): void => onUpdate?.(this.getStatus())
    this.setStatus({ message: '正在初始化 OBS…', obsReady: false })
    notify()

    this.warmUpPromise = (async () => {
      try {
        await this.obs.ensureReady()
        if (!this.running) {
          this.setStatus({ obsReady: true, message: '就绪', runtimeDownload: undefined })
          notify()
        }
        log('OBS warm-up complete (mock match)')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!this.running) {
          this.setStatus({
            obsReady: false,
            message: 'OBS 初始化失败',
            error: message
          })
          notify()
        }
        logError('OBS warm-up failed (mock)', err)
        throw err
      } finally {
        this.warmUpPromise = null
      }
    })()
  }

  async runMockMatch(onUpdate?: (s: MockMatchStatus) => void): Promise<MockMatchStatus> {
    if (this.running) {
      throw new Error('已有 Mock 对局任务在进行中')
    }
    if (this.recorder.isBusy()) {
      throw new Error('Recorder 忙碌中')
    }

    const integration = getGameIntegrationService()
    if (!integration.isGsiListening()) {
      throw new Error('GSI 服务未就绪，请重启 CS Hero')
    }

    this.running = true
    this.recorder.resetCompleted()

    const notify = (): void => {
      this.mergeFromRecorder()
      onUpdate?.(this.getStatus())
    }

    try {
      this.setStatus({
        phase: 'recording',
        message: '准备 Mock 对局…',
        obsReady: false,
        error: undefined,
        bookmarkCount: 0,
        clipCount: 0,
        matchId: undefined,
        outputDir: undefined,
        outputVideo: undefined,
        matchJson: undefined
      })
      notify()

      if (!this.obs.isInitialized()) {
        await this.obs.ensureReady()
      }
      this.setStatus({ obsReady: true })
      notify()

      const port = integration.getGsiPort()
      log('Mock match script start', `port=${port}`)

      await postGsi(port, buildPayload('live', 0, 0))
      notify()

      await sleep(FIRST_KILL_MS)
      await postGsi(port, buildPayload('live', 1, 0))
      notify()

      await sleep(SECOND_KILL_MS - FIRST_KILL_MS)
      await postGsi(port, buildPayload('live', 2, 0))
      notify()

      await sleep(MOCK_DURATION_MS - SECOND_KILL_MS)
      await postGsi(port, buildPayload('gameover', 2, 0))
      notify()

      this.mergeFromRecorder()
      this.setStatus({
        phase: 'completed',
        message: 'Mock 对局完成',
        obsReady: true
      })
      notify()
      log('Mock match script complete')
      return this.getStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus({ phase: 'failed', message: 'Mock 对局失败', error: message })
      notify()
      logError('Mock match failed', err)
      return this.getStatus()
    } finally {
      this.running = false
      if (this.obs.isInitialized() && this.status.phase !== 'failed') {
        this.setStatus({ obsReady: true })
        notify()
      }
    }
  }

  async shutdown(): Promise<void> {
    // 共享 OBS / GSI 由 app_services 统一关闭
  }
}
