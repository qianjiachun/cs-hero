import type { RecorderService } from '../recorder_service'
import { GsiHttpServer } from './gsi_http_server'

/** @deprecated Mock 对局改由 GameIntegrationService 常驻 GSI；保留薄包装供兼容 */
export class MockGsiServer {
  private readonly server: GsiHttpServer

  constructor(recorder: RecorderService) {
    this.server = new GsiHttpServer(
      (payload) => recorder.handleGsiPayload(payload),
      { logLabel: 'Mock GSI' }
    )
  }

  getPort(): number {
    return this.server.getPort()
  }

  isListening(): boolean {
    return this.server.isListening()
  }

  async start(port: number): Promise<void> {
    const result = await this.server.startWithPortRange(port)
    if (result.state !== 'listening') {
      throw new Error(result.listenError ?? `无法启动 Mock GSI（${result.state}）`)
    }
  }

  async stop(): Promise<void> {
    await this.server.stop()
  }
}
