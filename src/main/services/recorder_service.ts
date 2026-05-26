import fs from 'fs'
import path from 'path'
import type {
  Bookmark,
  BookmarkType,
  MatchJson,
  MockMatchPhase,
  MockMatchStatus
} from '../../shared/recording-types'
import type { GsiPayload } from '../../shared/gsi-types'
import { MOCK_STEAM_ID } from '../../shared/gsi-types'
import { getAppDataRoot, paths } from '../shared/paths'
import { log, logError } from '../shared/logger'
import { ObsService } from './obs_service'
import { FfmpegService } from './ffmpeg_service'
import { ClipService } from './clip_service'
import { loadSettings, type RecordingMode } from './settings_service'
import { sanitizeMapNameForMatchId } from './gsi/cs2_gsi_config'
import {
  isRecordingActivePhase,
  isRecordingEndPhase,
  normalizeMapPhase
} from './gsi/cs2_gsi_phases'
import { isCs2CaptureReady } from '../obs/cs2_window'
import { MANUAL_MATCH_MAP_LABEL } from '../../shared/match-display'
import { encoderDisplayName } from './encoder_service'

function formatMatchId(prefix: string, date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${prefix}_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

export type RecorderState =
  | 'idle'
  | 'waiting_cs2'
  | 'recording'
  | 'finalizing'
  | 'clipping'
export type MatchSource = 'mock' | 'cs2_gsi' | 'manual'

export class RecorderService {
  private state: RecorderState = 'idle'
  private matchId = ''
  private matchDir = ''
  private mapName = 'unknown'
  private matchSource: MatchSource = 'cs2_gsi'
  private captureMethod = 'monitor_capture'
  private encoderLabel = 'unknown'
  private startedAt: Date | null = null
  private recordingStartMs = 0
  private bookmarks: Bookmark[] = []
  private lastKills = 0
  private lastDeaths = 0
  private endedReason = ''
  private message = '就绪'
  private error: string | undefined
  private outputVideo = ''
  private matchJsonPath = ''
  private clipCount = 0
  private bookmarkCount = 0
  private finishing = false
  /** 首包 match_stats 仅作基线，避免开局瞬间产生虚假 Bookmark */
  private statsBaselinePending = true
  private waitCs2PollTimer: ReturnType<typeof setInterval> | null = null
  private manualActivateInFlight = false
  private onStatusChanged: (() => void) | undefined

  constructor(
    private readonly obs = new ObsService(),
    private readonly ffmpeg = new FfmpegService(),
    private readonly clipService = new ClipService()
  ) {}

  getState(): RecorderState {
    return this.state
  }

  isBusy(): boolean {
    return this.state !== 'idle'
  }

  setStatusListener(listener: () => void): void {
    this.onStatusChanged = listener
  }

  private emitStatus(): void {
    this.onStatusChanged?.()
  }

  getRecordingMode(): RecordingMode {
    return loadSettings().recordingMode
  }

  isManualMode(): boolean {
    return this.getRecordingMode() === 'manual'
  }

  private assertManualMode(): void {
    if (!this.isManualMode()) {
      throw new Error('当前为自动录制模式，请先在设置中切换到手动录制')
    }
  }

  getStatus(): MockMatchStatus {
    const phase = this.toUiPhase()
    return {
      phase,
      message: this.message,
      appDataRoot: getAppDataRoot(),
      obsReady: this.obs.isInitialized(),
      matchId: this.matchId || undefined,
      outputDir: this.matchDir || undefined,
      outputVideo: this.outputVideo || undefined,
      matchJson: this.matchJsonPath || undefined,
      bookmarkCount: this.bookmarkCount,
      clipCount: this.clipCount,
      error: this.error
    }
  }

  private toUiPhase(): MockMatchPhase {
    if (this.error && this.state === 'idle') return 'failed'
    if (this.state === 'idle' && this.outputVideo) return 'completed'
    if (this.state === 'idle') return 'idle'
    if (this.state === 'waiting_cs2') return 'waiting_cs2'
    return this.state
  }

  private setMessage(msg: string): void {
    this.message = msg
  }

  /** 处理 GSI POST payload（自动模式；手动模式仅 Mock 开发用） */
  async handleGsiPayload(payload: GsiPayload): Promise<void> {
    if (this.isManualMode()) {
      if (payload.player?.steamid === MOCK_STEAM_ID) {
        // 开发区 Mock 仍可走 GSI 流程
      } else {
        return
      }
    }

    const phase = normalizeMapPhase(payload.map?.phase)
    if (!isRecordingActivePhase(phase) && !isRecordingEndPhase(phase)) {
      log('GSI ignored: phase not in match', payload.map?.phase)
      return
    }

    const providerId = payload.provider?.steamid
    const playerId = payload.player?.steamid
    if (providerId && playerId && providerId !== playerId) {
      log('GSI ignored: steamid mismatch (spectating?)')
      return
    }

    if (payload.map?.name) {
      this.mapName = payload.map.name
    }

    const stats = payload.player?.match_stats
    const source: MatchSource = playerId === MOCK_STEAM_ID ? 'mock' : 'cs2_gsi'

    if (isRecordingActivePhase(phase)) {
      if (this.state === 'idle') {
        await this.startMatch(source)
        log('Match start from GSI phase', phase)
      }
      if (this.state === 'recording' && stats) {
        this.applyStatsIncrement(stats.kills ?? 0, stats.deaths ?? 0)
      }
      return
    }

    if (isRecordingEndPhase(phase) && this.state === 'recording') {
      if (stats) {
        this.applyStatsIncrement(stats.kills ?? 0, stats.deaths ?? 0)
      }
      await this.finishMatch('gameover')
    }
  }

  private async beginSession(source: MatchSource): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('录制器忙碌')
    }

    await this.obs.ensureReady()
    this.startedAt = new Date()
    this.matchSource = source

    if (source === 'manual') {
      this.matchId = formatMatchId('manual', this.startedAt)
      this.mapName = MANUAL_MATCH_MAP_LABEL
    } else if (source === 'mock') {
      this.matchId = formatMatchId('mock', this.startedAt)
    } else {
      const mapPart = sanitizeMapNameForMatchId(this.mapName)
      this.matchId = formatMatchId(mapPart, this.startedAt)
    }

    this.matchDir = path.join(paths.matchesDir, this.matchId)
    fs.mkdirSync(this.matchDir, { recursive: true })

    this.bookmarks = []
    this.lastKills = 0
    this.lastDeaths = 0
    this.endedReason = ''
    this.error = undefined
    this.outputVideo = ''
    this.matchJsonPath = ''
    this.clipCount = 0
    this.bookmarkCount = 0
    this.finishing = false
    this.statsBaselinePending = true
  }

  private async startObsCapture(source: MatchSource): Promise<void> {
    if (source === 'cs2_gsi' || source === 'manual') {
      this.captureMethod = await this.obs.startMatchRecording()
    } else {
      await this.obs.startTestRecording()
      this.captureMethod = 'monitor_capture'
    }
    const runtime = await this.obs.getRuntimeInfo()
    this.encoderLabel =
      runtime?.selectedEncoder ?? encoderDisplayName(this.encoderLabel)
    this.recordingStartMs = Date.now()
  }

  private async startMatch(source: MatchSource): Promise<void> {
    if (this.state !== 'idle') {
      log('GSI ignored: recorder busy', this.state)
      return
    }
    await this.beginSession(source)
    this.state = 'recording'
    this.setMessage('对局录制中…')
    log('Match start', this.matchId, `source=${source}`)
    await this.startObsCapture(source)
  }

  private stopWaitingForCs2Poll(): void {
    if (this.waitCs2PollTimer) {
      clearInterval(this.waitCs2PollTimer)
      this.waitCs2PollTimer = null
    }
  }

  private startWaitingForCs2Poll(): void {
    this.stopWaitingForCs2Poll()
    this.waitCs2PollTimer = setInterval(() => {
      void this.tryActivateManualRecordingIfWaiting()
    }, 2000)
  }

  /** CS2 窗口就绪后真正启动 OBS 采集（手动模式） */
  async tryActivateManualRecordingIfWaiting(): Promise<void> {
    if (this.state !== 'waiting_cs2' || this.manualActivateInFlight) return
    if (!isCs2CaptureReady()) {
      this.setMessage('等待 CS2 启动…')
      this.emitStatus()
      return
    }

    this.manualActivateInFlight = true
    try {
      this.setMessage('正在连接 CS2 画面…')
      this.emitStatus()
      await this.startObsCapture('manual')
      this.state = 'recording'
      this.stopWaitingForCs2Poll()
      this.setMessage('手动录制中…')
      log('Manual recording active', this.matchId)
    } catch (err) {
      logError('Manual OBS start deferred', err)
      this.setMessage('等待 CS2 窗口就绪…')
    } finally {
      this.manualActivateInFlight = false
      this.emitStatus()
    }
  }

  /** 手动模式：随时可点；未开游戏则待命，CS2 就绪后自动开录 */
  async startManualRecording(): Promise<void> {
    this.assertManualMode()
    if (this.state !== 'idle') {
      throw new Error('已有进行中的手动录制，请先结束')
    }

    await this.beginSession('manual')
    this.state = 'waiting_cs2'
    log('Manual recording armed', this.matchId)

    if (isCs2CaptureReady()) {
      this.setMessage('正在启动录制…')
      await this.tryActivateManualRecordingIfWaiting()
    } else {
      this.setMessage('等待 CS2 启动…')
      this.startWaitingForCs2Poll()
    }
    this.emitStatus()
  }

  /** 取消待命（未真正开录） */
  cancelManualSession(): void {
    this.stopWaitingForCs2Poll()
    if (this.matchDir && fs.existsSync(this.matchDir)) {
      try {
        fs.rmSync(this.matchDir, { recursive: true, force: true })
        log('Manual session cancelled, dir removed', this.matchDir)
      } catch (err) {
        logError('Failed to remove manual session dir', err)
      }
    }
    this.resetSessionFields()
    this.state = 'idle'
    this.setMessage('就绪')
    this.emitStatus()
  }

  private resetSessionFields(): void {
    this.matchId = ''
    this.matchDir = ''
    this.mapName = 'unknown'
    this.matchSource = 'cs2_gsi'
    this.finishing = false
    this.error = undefined
    this.bookmarkCount = 0
    this.clipCount = 0
  }

  /** 手动模式：结束并生成对局文件 */
  async stopManualRecording(): Promise<MatchJson | null> {
    this.assertManualMode()
    if (this.state === 'idle') {
      throw new Error('当前没有进行中的手动录制')
    }
    if (this.state === 'waiting_cs2') {
      this.cancelManualSession()
      return null
    }
    return this.finishMatch('manual_stop')
  }

  private applyStatsIncrement(kills: number, deaths: number): void {
    if (this.state !== 'recording') return

    if (deaths < this.lastDeaths) {
      log('GSI: deaths decreased, reset counters (new match in stats)')
      this.lastKills = kills
      this.lastDeaths = deaths
      this.statsBaselinePending = false
      return
    }

    if (this.statsBaselinePending) {
      this.lastKills = kills
      this.lastDeaths = deaths
      this.statsBaselinePending = false
      log('GSI stats baseline', `kills=${kills}`, `deaths=${deaths}`)
      return
    }

    const killDelta = kills - this.lastKills
    const deathDelta = deaths - this.lastDeaths

    if (killDelta > 0) {
      for (let i = 0; i < killDelta; i++) {
        this.addBookmark('kill')
      }
    }
    if (deathDelta > 0) {
      for (let i = 0; i < deathDelta; i++) {
        this.addBookmark('death')
      }
    }

    this.lastKills = kills
    this.lastDeaths = deaths
  }

  private currentTimelineMs(): number {
    return Date.now() - this.recordingStartMs
  }

  private addBookmark(type: BookmarkType): void {
    const now = Date.now()
    const time = this.currentTimelineMs() / 1000
    const bookmark: Bookmark = {
      type,
      time,
      occurredAt: new Date(now).toISOString()
    }
    this.bookmarks.push(bookmark)
    this.bookmarkCount = this.bookmarks.length
    log('Bookmark added', type, time.toFixed(2))
  }

  async finishMatch(endedReason?: string): Promise<MatchJson | null> {
    if (this.state !== 'recording') {
      return null
    }
    if (this.finishing) {
      log('finishMatch skipped: already finalizing')
      return null
    }

    this.finishing = true
    if (endedReason) {
      this.endedReason = endedReason
    }

    this.stopWaitingForCs2Poll()
    this.state = 'finalizing'
    this.setMessage('正在停止录制…')
    this.emitStatus()

    const endedAt = new Date()
    let remuxOk = true
    const clipErrors: string[] = []
    let sourceMkv = ''

    try {
      const mkvPath = await this.obs.stopRecording()
      if (!mkvPath || !fs.existsSync(mkvPath)) {
        throw new Error('没有录制到视频文件')
      }
      sourceMkv = mkvPath
    } catch (err) {
      this.state = 'idle'
      this.finishing = false
      this.error = err instanceof Error ? err.message : String(err)
      this.setMessage('停止录制失败')
      logError('Stop recording failed', err)
      throw err
    }

    const outputMp4 = path.join(this.matchDir, 'full_match.mp4')
    this.matchJsonPath = path.join(this.matchDir, 'match.json')

    try {
      this.setMessage('正在生成 MP4…')
      await this.ffmpeg.remuxMkvToMp4(sourceMkv, outputMp4)
      this.outputVideo = outputMp4
    } catch (err) {
      remuxOk = false
      const msg = err instanceof Error ? err.message : String(err)
      clipErrors.push(`remux: ${msg}`)
      logError('Remux failed', err)
    }

    let clips: MatchJson['clips'] = []
    const settings = loadSettings()
    const shouldGenerateClips = this.matchSource !== 'manual'

    if (shouldGenerateClips && remuxOk && fs.existsSync(outputMp4)) {
      this.state = 'clipping'
      this.setMessage('正在生成片段…')
      const killBookmarks = this.bookmarks.filter((b) => b.type === 'kill')
      const clipsDir = path.join(this.matchDir, 'clips')

      try {
        const result = await this.clipService.generateKillClips(
          outputMp4,
          clipsDir,
          killBookmarks,
          settings
        )
        clips = result.clips
        clipErrors.push(...result.errors)
        this.clipCount = clips.length
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        clipErrors.push(`clips: ${msg}`)
        logError('Clip generation failed', err)
      }
    } else if (!shouldGenerateClips && remuxOk) {
      this.setMessage('正在保存录像…')
      log('Manual match: skip clip generation', this.matchId)
    }

    let fullMatchRetained = true
    if (
      shouldGenerateClips &&
      remuxOk &&
      fs.existsSync(outputMp4) &&
      !settings.keepFullMatch &&
      clips.length > 0 &&
      clipErrors.length === 0
    ) {
      try {
        fs.unlinkSync(outputMp4)
        fullMatchRetained = false
        this.outputVideo = ''
        log('full_match removed per keepFullMatch=false', this.matchId)
      } catch (err) {
        logError('Failed to remove full_match.mp4', err)
        fullMatchRetained = true
      }
    }

    const startTime = this.startedAt ?? endedAt
    const matchJson: MatchJson = {
      id: this.matchId,
      map: this.mapName,
      start_time: startTime.toISOString(),
      end_time: endedAt.toISOString(),
      duration: Math.round((endedAt.getTime() - startTime.getTime()) / 1000),
      capture_method: this.captureMethod,
      encoder: this.encoderLabel,
      status: remuxOk ? 'complete' : 'incomplete',
      source: this.matchSource,
      source_mkv: sourceMkv,
      full_match_retained: fullMatchRetained,
      bookmarks: this.bookmarks.map(({ type, time }) => ({ type, time })),
      clips,
      ...(clipErrors.length > 0 ? { clip_errors: clipErrors } : {}),
      ...(this.endedReason ? { ended_reason: this.endedReason } : {})
    }

    fs.writeFileSync(this.matchJsonPath, JSON.stringify(matchJson, null, 2), 'utf-8')

    this.state = 'idle'
    this.finishing = false
    this.bookmarkCount = this.bookmarks.length
    this.clipCount = clips.length

    if (!remuxOk) {
      this.error = 'MKV 已生成，但 remux 为 MP4 失败'
      this.setMessage('对局结束（remux 失败）')
      throw new Error(this.error)
    }

    this.setMessage('对局完成')
    log('Match complete', this.matchDir, `clips=${clips.length}`, `reason=${this.endedReason}`)
    return matchJson
  }

  resetCompleted(): void {
    if (this.state !== 'idle') return
    this.resetSessionFields()
    this.outputVideo = ''
    this.matchJsonPath = ''
    this.setMessage('就绪')
  }
}
