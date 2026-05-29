import { isGsiGameConnected } from '../../shared/gsi-connection'
import { log } from '../shared/logger'
import { isCs2ProcessRunning } from '../obs/cs2_window'
import type { GameIntegrationService } from './game_integration_service'
import type { RecorderService } from './recorder_service'

const POLL_INTERVAL_MS = 2000

export class GameDetectionService {
  private timer: ReturnType<typeof setInterval> | null = null
  private cs2WasRunning = false
  private lastGsiConnected: boolean | undefined
  private onCs2Started: (() => void) | undefined

  constructor(
    private readonly recorder: RecorderService,
    private readonly integration: GameIntegrationService
  ) {}

  setOnCs2Started(handler: () => void): void {
    this.onCs2Started = handler
  }

  start(): void {
    if (this.timer) return
    this.cs2WasRunning = isCs2ProcessRunning()
    log('GameDetection started', `cs2=${this.cs2WasRunning}`)

    this.timer = setInterval(() => {
      void this.poll()
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async poll(): Promise<void> {
    const running = isCs2ProcessRunning()
    if (this.cs2WasRunning && !running) {
      log('GameDetection: cs2.exe exited')
      this.integration.onCs2ProcessExit()
      if (
        this.recorder.getState() === 'recording' &&
        this.recorder.getRecordingMode() === 'auto'
      ) {
        await this.recorder.finishMatch('process_exit')
        this.integration.broadcastStatus()
      }
    } else if (!this.cs2WasRunning && running) {
      log('GameDetection: cs2.exe started')
      this.onCs2Started?.()
    }

    const connected = isGsiGameConnected(this.integration.getStatus())
    if (connected !== this.lastGsiConnected || running !== this.cs2WasRunning) {
      this.integration.broadcastStatus()
      this.lastGsiConnected = connected
    }

    this.cs2WasRunning = running
  }

}
