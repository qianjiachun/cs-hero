import { getObsWorkerHost } from '../obs/obs_worker_host'
import type { ObsRuntimeInfo } from '../../shared/recording-types'
import { encoderDisplayName } from './encoder_service'

/**
 * 主进程 OBS 门面：实际 libobs 运行在子进程，避免阻塞 UI。
 */
export class ObsService {
  private readonly host = getObsWorkerHost()
  private lastRuntimeInfo: ObsRuntimeInfo | null = null

  isInitialized(): boolean {
    return this.host.isReady()
  }

  async ensureReady(): Promise<void> {
    await this.host.ensureReady()
    await this.refreshRuntimeInfo()
  }

  async initialize(): Promise<void> {
    await this.ensureReady()
  }

  async getRuntimeInfo(): Promise<ObsRuntimeInfo | null> {
    if (!this.host.isReady()) return this.lastRuntimeInfo
    return this.refreshRuntimeInfo()
  }

  private async refreshRuntimeInfo(): Promise<ObsRuntimeInfo | null> {
    try {
      const raw = await this.host.getRuntimeInfo()
      this.lastRuntimeInfo = {
        selectedEncoder: raw.encoderDisplayName || encoderDisplayName(raw.selectedEncoder),
        availableEncoders: raw.availableEncoders,
        baseWidth: raw.baseWidth,
        baseHeight: raw.baseHeight,
        outputWidth: raw.outputWidth,
        outputHeight: raw.outputHeight,
        recordingFps: raw.recordingFps,
        recordingQuality: raw.recordingQuality,
        videoBitrateKbps: raw.videoBitrateKbps,
        qualityCq: raw.qualityCq,
        qualityModeLabel: raw.qualityModeLabel,
        encoderWarning: raw.encoderWarning,
        captureModeLabel: raw.captureModeLabel,
        recordingDisplayLabel: raw.recordingDisplayLabel
      }
      return this.lastRuntimeInfo
    } catch {
      return this.lastRuntimeInfo
    }
  }

  async reinitializeFromSettings(): Promise<void> {
    await this.host.reinitialize()
    await this.refreshRuntimeInfo()
  }

  getCachedRuntimeInfo(): ObsRuntimeInfo | null {
    return this.lastRuntimeInfo
  }

  async startTestRecording(): Promise<void> {
    await this.host.startRecording()
  }

  /** 对局录制：按设置采集策略；返回 capture_method */
  async startMatchRecording(): Promise<string> {
    return this.host.startMatchRecording()
  }

  async stopRecording(): Promise<string> {
    return this.host.stopRecording()
  }

  async shutdown(): Promise<void> {
    await this.host.shutdown()
    this.lastRuntimeInfo = null
  }
}
