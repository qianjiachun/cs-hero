import fs from 'fs'
import path from 'path'
import type { Cs2IntegrationStatus, GsiServerState } from '../../shared/recording-types'
import type { GsiPayload } from '../../shared/gsi-types'
import { log, logError } from '../shared/logger'
import { loadSettings, saveSettings } from './settings_service'
import type { RecorderService } from './recorder_service'
import { GsiHttpServer } from './gsi/gsi_http_server'
import { buildGsiCfgContent, getCs2GsiCfgPath } from './gsi/cs2_gsi_config'

export class GameIntegrationService {
  private readonly gsiServer: GsiHttpServer
  private gsiPort = 0
  private gsiServerState: GsiServerState = 'idle'
  private gsiListenError: string | undefined
  private gsiPortAdjusted = false
  private cfgPath: string | undefined
  private cfgWritten = false
  private cfgNeedsCs2Restart = false
  private lastPayloadAt: string | undefined
  private lastMapPhase: string | undefined
  private lastMapName: string | undefined
  private lastKills: number | undefined
  private lastDeaths: number | undefined
  private statusListener: ((status: Cs2IntegrationStatus) => void) | undefined
  private started = false

  constructor(private readonly recorder: RecorderService) {
    this.gsiServer = new GsiHttpServer(
      async (payload) => {
        await this.recorder.handleGsiPayload(payload)
        this.notifyStatus()
      },
      {
        logLabel: 'GSI',
        onPayload: (payload) => this.trackPayload(payload)
      }
    )
  }

  setStatusListener(listener: (status: Cs2IntegrationStatus) => void): void {
    this.statusListener = listener
  }

  getGsiPort(): number {
    return this.gsiServer.isListening() ? this.gsiServer.getPort() : this.gsiPort
  }

  isGsiListening(): boolean {
    return this.gsiServer.isListening()
  }

  getStatus(): Cs2IntegrationStatus {
    const recorderStatus = this.recorder.getStatus()
    return {
      gsiServerState: this.gsiServerState,
      gsiPort: this.getGsiPort(),
      gsiListenError: this.gsiListenError,
      gsiPortAdjusted: this.gsiPortAdjusted,
      cfgPath: this.cfgPath,
      cfgWritten: this.cfgWritten,
      cfgNeedsCs2Restart: this.cfgNeedsCs2Restart,
      lastPayloadAt: this.lastPayloadAt,
      lastMapPhase: this.lastMapPhase,
      lastMapName: this.lastMapName,
      lastKills: this.lastKills,
      lastDeaths: this.lastDeaths,
      recordingPhase: recorderStatus.phase,
      recordingMessage: recorderStatus.message,
      matchId: recorderStatus.matchId,
      outputDir: recorderStatus.outputDir,
      bookmarkCount: recorderStatus.bookmarkCount,
      clipCount: recorderStatus.clipCount,
      recordingError: recorderStatus.error,
      obsReady: recorderStatus.obsReady
    }
  }

  private notifyStatus(): void {
    this.statusListener?.(this.getStatus())
  }

  private trackPayload(payload: GsiPayload): void {
    this.lastPayloadAt = new Date().toISOString()
    this.lastMapPhase = payload.map?.phase
    this.lastMapName = payload.map?.name
    this.lastKills = payload.player?.match_stats?.kills
    this.lastDeaths = payload.player?.match_stats?.deaths
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    const settings = loadSettings()
    const result = await this.gsiServer.startWithPortRange(settings.gsiPort)

    this.gsiServerState = result.state
    this.gsiListenError = result.listenError
    this.gsiPortAdjusted = result.portAdjusted ?? false

    if (result.state === 'listening') {
      this.gsiPort = result.port
      if (result.portAdjusted && result.port !== settings.gsiPort) {
        saveSettings({ ...settings, gsiPort: result.port })
        this.gsiPortAdjusted = true
        log('GSI port saved to settings', result.port)
      }
      await this.ensureCs2GsiConfig(result.port)
    } else {
      this.gsiPort = settings.gsiPort
      logError('GSI server failed to start', result.listenError ?? result.state)
      await this.ensureCs2GsiConfig(settings.gsiPort)
    }

    this.notifyStatus()
  }

  async ensureCs2GsiConfig(port: number): Promise<void> {
    const cfgPath = getCs2GsiCfgPath()
    this.cfgPath = cfgPath ?? undefined

    if (!cfgPath) {
      this.cfgWritten = false
      log('CS2 GSI cfg path not found (Steam/CS2 install)')
      return
    }

    const content = buildGsiCfgContent(port)
    let needsWrite = true

    if (fs.existsSync(cfgPath)) {
      const existing = fs.readFileSync(cfgPath, 'utf-8')
      needsWrite = existing !== content
    }

    if (!needsWrite) {
      this.cfgWritten = true
      this.cfgNeedsCs2Restart = false
      log('CS2 GSI cfg up to date', cfgPath)
      return
    }

    fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
    fs.writeFileSync(cfgPath, content, 'utf-8')
    this.cfgWritten = true
    this.cfgNeedsCs2Restart = true
    log('CS2 GSI cfg written', cfgPath)
  }

  async stop(): Promise<void> {
    await this.gsiServer.stop()
    this.gsiServerState = 'idle'
    this.started = false
    this.notifyStatus()
  }
}
