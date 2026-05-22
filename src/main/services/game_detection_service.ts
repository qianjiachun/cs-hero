import { execSync } from 'child_process'
import { log } from '../shared/logger'
import type { RecorderService } from './recorder_service'

const POLL_INTERVAL_MS = 2000

export class GameDetectionService {
  private timer: ReturnType<typeof setInterval> | null = null
  private cs2WasRunning = false

  constructor(private readonly recorder: RecorderService) {}

  start(): void {
    if (this.timer) return
    this.cs2WasRunning = this.isCs2Running()
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
    const running = this.isCs2Running()

    if (this.cs2WasRunning && !running) {
      log('GameDetection: cs2.exe exited')
      if (this.recorder.getState() === 'recording') {
        await this.recorder.finishMatch('process_exit')
      }
    } else if (!this.cs2WasRunning && running) {
      log('GameDetection: cs2.exe started')
    }

    this.cs2WasRunning = running
  }

  private isCs2Running(): boolean {
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq cs2.exe" /NH', {
        encoding: 'utf-8',
        windowsHide: true
      })
      return out.toLowerCase().includes('cs2.exe')
    } catch {
      return false
    }
  }
}
