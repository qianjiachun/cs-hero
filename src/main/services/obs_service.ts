import { getObsWorkerHost } from '../obs/obs_worker_host'

/**
 * 主进程 OBS 门面：实际 libobs 运行在子进程，避免阻塞 UI。
 */
export class ObsService {
  private readonly host = getObsWorkerHost()

  isInitialized(): boolean {
    return this.host.isReady()
  }

  async ensureReady(): Promise<void> {
    await this.host.ensureReady()
  }

  async initialize(): Promise<void> {
    await this.host.ensureReady()
  }

  async startTestRecording(): Promise<void> {
    await this.host.startRecording()
  }

  /** 对局录制：优先 Game Capture(cs2.exe)，失败回退显示器采集 */
  async startMatchRecording(): Promise<string> {
    return this.host.startMatchRecording()
  }

  async stopRecording(): Promise<string> {
    return this.host.stopRecording()
  }

  async shutdown(): Promise<void> {
    await this.host.shutdown()
  }
}
