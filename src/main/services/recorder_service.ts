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
import { loadSettings } from './settings_service'
import { sanitizeMapNameForMatchId } from './gsi/cs2_gsi_config'

function formatMatchId(prefix: string, date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${prefix}_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

export type RecorderState = 'idle' | 'recording' | 'finalizing' | 'clipping'
export type MatchSource = 'mock' | 'cs2_gsi'

export class RecorderService {
  private state: RecorderState = 'idle'
  private matchId = ''
  private matchDir = ''
  private mapName = 'unknown'
  private matchSource: MatchSource = 'cs2_gsi'
  private captureMethod = 'monitor_capture'
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
    return this.state
  }

  private setMessage(msg: string): void {
    this.message = msg
  }

  /** 处理 GSI POST payload（Mock 与真实共用逻辑） */
  async handleGsiPayload(payload: GsiPayload): Promise<void> {
    const phase = payload.map?.phase
    if (phase !== 'live' && phase !== 'gameover') {
      log('GSI ignored: invalid phase', phase)
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

    if (phase === 'live') {
      if (this.state === 'idle') {
        await this.startMatch(source)
      }
      if (this.state === 'recording' && stats) {
        this.applyStatsIncrement(stats.kills ?? 0, stats.deaths ?? 0)
      }
      return
    }

    if (phase === 'gameover' && this.state === 'recording') {
      if (stats) {
        this.applyStatsIncrement(stats.kills ?? 0, stats.deaths ?? 0)
      }
      await this.finishMatch('gameover')
    }
  }

  private async startMatch(source: MatchSource): Promise<void> {
    if (this.state !== 'idle') {
      log('GSI ignored: recorder busy', this.state)
      return
    }

    await this.obs.ensureReady()
    this.startedAt = new Date()
    this.matchSource = source

    if (source === 'mock') {
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

    this.state = 'recording'
    this.setMessage('对局录制中…')
    log('Match start', this.matchId, `source=${source}`)

    if (source === 'cs2_gsi') {
      this.captureMethod = await this.obs.startMatchRecording()
    } else {
      await this.obs.startTestRecording()
      this.captureMethod = 'monitor_capture'
    }
    this.recordingStartMs = Date.now()
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

  private addBookmark(type: BookmarkType): void {
    const now = Date.now()
    const time = (now - this.recordingStartMs) / 1000
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

    this.state = 'finalizing'
    this.setMessage('正在停止录制…')

    const endedAt = new Date()
    let mkvPath = ''
    let remuxOk = true
    const clipErrors: string[] = []

    try {
      mkvPath = await this.obs.stopRecording()
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
      await this.ffmpeg.remuxMkvToMp4(mkvPath, outputMp4)
      this.outputVideo = outputMp4
    } catch (err) {
      remuxOk = false
      const msg = err instanceof Error ? err.message : String(err)
      clipErrors.push(`remux: ${msg}`)
      logError('Remux failed', err)
    }

    let clips: MatchJson['clips'] = []

    if (remuxOk && fs.existsSync(outputMp4)) {
      this.state = 'clipping'
      this.setMessage('正在生成片段…')

      const settings = loadSettings()
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
    }

    const startTime = this.startedAt ?? endedAt
    const matchJson: MatchJson = {
      id: this.matchId,
      map: this.mapName,
      start_time: startTime.toISOString(),
      end_time: endedAt.toISOString(),
      duration: Math.round((endedAt.getTime() - startTime.getTime()) / 1000),
      capture_method: this.captureMethod,
      encoder: 'auto',
      status: remuxOk ? 'complete' : 'incomplete',
      source: this.matchSource,
      source_mkv: mkvPath,
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
    this.matchId = ''
    this.matchDir = ''
    this.outputVideo = ''
    this.matchJsonPath = ''
    this.bookmarkCount = 0
    this.clipCount = 0
    this.error = undefined
    this.finishing = false
    this.setMessage('就绪')
  }
}
