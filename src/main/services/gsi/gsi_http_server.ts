import http from 'http'
import type { GsiPayload } from '../../../shared/gsi-types'
import { log, logError } from '../../shared/logger'

export type GsiServerState = 'idle' | 'listening' | 'port_conflict' | 'failed'

export interface GsiHttpServerStartResult {
  port: number
  state: GsiServerState
  listenError?: string
  portAdjusted?: boolean
  requestedPort?: number
}

export type GsiPayloadHandler = (payload: GsiPayload) => Promise<void>

export interface GsiHttpServerOptions {
  onPayload?: (payload: GsiPayload) => void
  logLabel?: string
}

/** 共用 GSI HTTP 服务（真实 CS2 与 Mock 脚本 POST 共用） */
export class GsiHttpServer {
  private server: http.Server | null = null
  private port = 0
  private state: GsiServerState = 'idle'
  private listenError: string | undefined

  constructor(
    private readonly handlePayload: GsiPayloadHandler,
    private readonly options: GsiHttpServerOptions = {}
  ) {}

  getPort(): number {
    return this.port
  }

  getState(): GsiServerState {
    return this.state
  }

  getListenError(): string | undefined {
    return this.listenError
  }

  isListening(): boolean {
    return this.server !== null && this.state === 'listening'
  }

  /**
   * 从 preferredPort 起最多尝试 10 个端口（含 preferredPort）。
   */
  async startWithPortRange(preferredPort: number): Promise<GsiHttpServerStartResult> {
    if (this.server) {
      return {
        port: this.port,
        state: 'listening',
        requestedPort: preferredPort
      }
    }

    const label = this.options.logLabel ?? 'GSI'
    let lastError: string | undefined

    for (let offset = 0; offset < 10; offset++) {
      const tryPort = preferredPort + offset
      try {
        await this.listenOnce(tryPort)
        this.state = 'listening'
        this.listenError = undefined
        const portAdjusted = offset > 0
        if (portAdjusted) {
          log(`${label} port adjusted`, `${preferredPort} -> ${tryPort}`)
        }
        return {
          port: tryPort,
          state: 'listening',
          portAdjusted,
          requestedPort: preferredPort
        }
      } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : ''
        const msg = err instanceof Error ? err.message : String(err)
        lastError = msg
        if (code === 'EADDRINUSE') {
          log(`${label} port in use`, tryPort)
          continue
        }
        logError(`${label} listen failed`, err)
        this.state = 'failed'
        this.listenError = msg
        return {
          port: 0,
          state: 'failed',
          listenError: msg,
          requestedPort: preferredPort
        }
      }
    }

    this.state = 'port_conflict'
    this.listenError = lastError ?? 'GSI 端口被占用'
    logError(`${label} no available port in range`, `${preferredPort}-${preferredPort + 9}`)
    return {
      port: 0,
      state: 'port_conflict',
      listenError: this.listenError,
      requestedPort: preferredPort
    }
  }

  private listenOnce(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const label = this.options.logLabel ?? 'GSI'
      const server = http.createServer((req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }

        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
          void this.handlePost(Buffer.concat(chunks), res)
        })
      })

      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        this.server = server
        const addr = server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : port
        log(`${label} server listening`, `http://127.0.0.1:${this.port}/`)
        resolve()
      })
    })
  }

  private async handlePost(body: Buffer, res: http.ServerResponse): Promise<void> {
    const label = this.options.logLabel ?? 'GSI'
    try {
      const payload = JSON.parse(body.toString('utf-8')) as GsiPayload
      log(`${label} POST`, JSON.stringify(payload).slice(0, 240))
      this.options.onPayload?.(payload)
      await this.handlePayload(payload)
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    } catch (err) {
      logError(`${label} handler error`, err)
      res.writeHead(500)
      res.end('error')
    }
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.state = 'idle'
      this.port = 0
      return
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    this.server = null
    this.port = 0
    this.state = 'idle'
    this.listenError = undefined
    log(`${this.options.logLabel ?? 'GSI'} server stopped`)
  }
}
