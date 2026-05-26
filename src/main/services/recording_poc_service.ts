import fs from 'fs'
import path from 'path'
import type { RecordingPocStatus } from '../../shared/recording-types'
import { getAppDataRoot, paths } from '../shared/paths'
import { log, logError } from '../shared/logger'
import { ObsService } from './obs_service'
import { FfmpegService } from './ffmpeg_service'

const POC_DURATION_MS = 10_000

function formatMatchId(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `poc_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

export class RecordingPocService {
  private status: RecordingPocStatus = {
    phase: 'idle',
    message: '就绪',
    appDataRoot: '',
    obsReady: false
  }

  private running = false
  private warmUpPromise: Promise<void> | null = null

  constructor(
    private readonly obs = new ObsService(),
    private readonly ffmpeg = new FfmpegService()
  ) {}

  isRunning(): boolean {
    return this.running
  }

  getStatus(): RecordingPocStatus {
    return { ...this.status, appDataRoot: getAppDataRoot() }
  }

  private setStatus(partial: Partial<RecordingPocStatus>): void {
    this.status = { ...this.status, ...partial, appDataRoot: getAppDataRoot() }
  }

  /** 应用启动后后台预热 OBS，录制时直接 start/stop，无需每次冷启动 */
  warmUpObs(onUpdate?: (s: RecordingPocStatus) => void): void {
    if (this.obs.isInitialized()) {
      this.setStatus({ obsReady: true })
      onUpdate?.(this.getStatus())
      return
    }
    if (this.warmUpPromise) return

    const notify = (): void => onUpdate?.(this.getStatus())

    this.setStatus({
      phase: 'idle',
      message: '正在初始化 OBS…',
      obsReady: false,
      error: undefined
    })
    notify()

    this.warmUpPromise = (async () => {
      try {
        await this.obs.ensureReady()
        if (!this.running) {
          this.setStatus({ obsReady: true, message: '就绪' })
          notify()
        }
        log('OBS warm-up complete')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!this.running) {
          this.setStatus({
            obsReady: false,
            message: 'OBS 初始化失败，点击录制将重试',
            error: message
          })
          notify()
        }
        logError('OBS warm-up failed', err)
        throw err
      } finally {
        this.warmUpPromise = null
      }
    })()
  }

  async runPoc(onUpdate?: (s: RecordingPocStatus) => void): Promise<RecordingPocStatus> {
    if (this.running) {
      throw new Error('已有录制任务在进行中')
    }
    this.running = true
    const startedAt = new Date()

    const notify = (): void => {
      onUpdate?.(this.getStatus())
    }

    try {
      if (!this.obs.isInitialized()) {
        this.setStatus({
          phase: 'initializing',
          message: '正在等待 OBS 就绪…',
          obsReady: false,
          error: undefined
        })
        notify()
        await this.obs.ensureReady()
      }
      this.setStatus({ obsReady: true })

      this.setStatus({ phase: 'recording', message: '录制中（10 秒）…' })
      notify()
      await this.obs.startTestRecording()
      await sleep(POC_DURATION_MS)

      this.setStatus({ phase: 'stopping', message: '正在停止录制…' })
      notify()
      const mkvPath = await this.obs.stopRecording()

      this.setStatus({ phase: 'remuxing', message: '正在生成 MP4…' })
      notify()

      const matchId = formatMatchId(startedAt)
      const matchDir = path.join(paths.matchesDir, matchId)
      const outputMp4 = path.join(matchDir, 'full_match.mp4')
      const matchJsonPath = path.join(matchDir, 'match.json')

      fs.mkdirSync(matchDir, { recursive: true })

      let remuxOk = true
      try {
        await this.ffmpeg.remuxMkvToMp4(mkvPath, outputMp4)
      } catch (err) {
        remuxOk = false
        logError('Remux failed', err)
      }

      const endedAt = new Date()
      const runtime = await this.obs.getRuntimeInfo()
      const matchJson = {
        id: matchId,
        map: 'poc',
        start_time: startedAt.toISOString(),
        end_time: endedAt.toISOString(),
        duration: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
        capture_method: 'monitor_capture',
        encoder: runtime?.selectedEncoder ?? 'unknown',
        status: remuxOk ? 'complete' : 'incomplete',
        source_mkv: mkvPath,
        bookmarks: [],
        clips: []
      }

      fs.writeFileSync(matchJsonPath, JSON.stringify(matchJson, null, 2), 'utf-8')

      if (!remuxOk) {
        throw new Error('MKV 已生成，但 remux 为 MP4 失败，详见 match.json')
      }

      this.setStatus({
        phase: 'completed',
        message: '录制完成',
        obsReady: true,
        outputDir: matchDir,
        outputVideo: outputMp4,
        matchJson: matchJsonPath
      })
      notify()
      log('PoC complete', matchDir)
      return this.getStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus({ phase: 'failed', message: '录制失败', error: message })
      notify()
      logError('PoC failed', err)
      return this.getStatus()
    } finally {
      this.running = false
      if (this.obs.isInitialized() && this.status.phase !== 'failed') {
        this.setStatus({ obsReady: true, message: '就绪' })
        notify()
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.obs.shutdown()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
