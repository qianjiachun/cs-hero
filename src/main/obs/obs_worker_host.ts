import { fork, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import { paths, checkResources, getProjectRoot } from '../shared/paths'
import { loadSettings } from '../services/settings_service'
import { resolveRecordingDisplay } from '../shared/displays'
import { planRecordingCanvas } from '../shared/recording_size_planner'
import type { AppSettings } from '../../shared/settings'
import { OSN_VERSION } from '../shared/osn_constants'
import { fixPackagedPath, getOsnConfigDataPath, getOsnModuleDir } from '../shared/osn_paths'
import { ensureOsnRuntime } from '../services/osn_runtime_service'
import { ensureFfmpegRuntime } from '../services/ffmpeg_runtime_service'
import { log, logError } from '../shared/logger'
import type {
  ObsDisplayConfig,
  ObsInitPayload,
  ObsWorkerEvent,
  ObsWorkerRequest,
  ObsWorkerResponse
} from './obs_ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function unwrapMessage(raw: unknown): ObsWorkerResponse | ObsWorkerEvent | null {
  if (!raw || typeof raw !== 'object') return null
  if ('data' in raw && raw.data && typeof raw.data === 'object') {
    return raw.data as ObsWorkerResponse | ObsWorkerEvent
  }
  return raw as ObsWorkerResponse | ObsWorkerEvent
}

let sharedHost: ObsWorkerHost | null = null

/** 全局唯一 OBS 子进程宿主（避免多处 new ObsService 重复 fork） */
export function getObsWorkerHost(): ObsWorkerHost {
  if (!sharedHost) {
    sharedHost = new ObsWorkerHost()
  }
  return sharedHost
}

/** 主进程侧：fork OBS 子进程（比 utilityProcess 更稳定地加载 obs-studio-node） */
export class ObsWorkerHost {
  private child: ChildProcess | null = null
  private ready = false
  private booted = false
  private initPromise: Promise<void> | null = null
  private spawnPromise: Promise<void> | null = null
  private readonly pending = new Map<string, Pending>()

  isReady(): boolean {
    return this.ready
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return
    if (!this.initPromise) {
      this.initPromise = this.runInit().catch((err) => {
        this.initPromise = null
        throw err
      })
    }
    await this.initPromise
  }

  async startRecording(): Promise<void> {
    await this.ensureReady()
    await this.request('start-recording', undefined, 30_000)
  }

  async startMatchRecording(): Promise<string> {
    await this.ensureReady()
    return (await this.request('start-match-recording', undefined, 30_000)) as string
  }

  async stopRecording(): Promise<string> {
    await this.ensureReady()
    return (await this.request('stop-recording', undefined, 120_000)) as string
  }

  async shutdown(): Promise<void> {
    if (!this.child) return
    try {
      if (this.ready) {
        await this.request('shutdown', undefined, 10_000)
      }
    } catch (err) {
      logError('OBS worker shutdown RPC failed', err)
    }
    try {
      this.child.kill()
    } catch {
      // ignore
    }
    this.reset()
    if (sharedHost === this) {
      sharedHost = null
    }
    log('OBS worker process stopped')
  }

  private reset(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('OBS worker 已退出'))
    }
    this.pending.clear()
    this.child = null
    this.ready = false
    this.booted = false
    this.initPromise = null
    this.spawnPromise = null
  }

  private getWorkerPath(): string {
    // fork 无法执行 asar 内脚本，须走 asarUnpack + unpacked 路径
    return fixPackagedPath(path.join(__dirname, 'obs_worker.js'))
  }

  private buildInitPayload(): ObsInitPayload {
    const settings = loadSettings()
    const resolved = resolveRecordingDisplay(settings.recordingDisplayId)
    const canvas = planRecordingCanvas(settings.recordingQuality)

    const display: ObsDisplayConfig = {
      logicalWidth: resolved.logicalWidth,
      logicalHeight: resolved.logicalHeight,
      physicalWidth: resolved.physicalWidth,
      physicalHeight: resolved.physicalHeight,
      scaleFactor: resolved.scaleFactor,
      baseWidth: canvas.baseWidth,
      baseHeight: canvas.baseHeight,
      outputWidth: canvas.outputWidth,
      outputHeight: canvas.outputHeight,
      monitorIndex: resolved.monitorIndex,
      displayLabel: resolved.display.label
    }

    return {
      osnModuleDir: getOsnModuleDir(),
      osnVersion: OSN_VERSION,
      paths: {
        tempDir: paths.tempDir,
        obsConfigPath: getOsnConfigDataPath(),
        recordingTmpMkv: paths.recordingTmpMkv
      },
      display,
      recording: {
        recordingFps: settings.recordingFps,
        recordingQuality: settings.recordingQuality
      }
    }
  }

  async getRuntimeInfo(): Promise<import('./obs_ipc').ObsRuntimeInfoPayload> {
    await this.ensureReady()
    return (await this.request('get-runtime-info', undefined, 10_000)) as import('./obs_ipc').ObsRuntimeInfoPayload
  }

  /** 设置变更后重新初始化 OBS（录制空闲时调用） */
  async reinitialize(): Promise<void> {
    if (this.child?.connected && this.ready) {
      try {
        await this.request('shutdown', undefined, 10_000)
      } catch {
        // ignore
      }
    }
    this.reset()
    this.initPromise = null
    await this.ensureReady()
  }

  private attachChildIo(child: ChildProcess): void {
    child.stdout?.on('data', (buf) => {
      const text = buf.toString().trim()
      if (text) log('[obs-worker stdout]', text)
    })
    child.stderr?.on('data', (buf) => {
      const text = buf.toString().trim()
      if (text) logError('[obs-worker stderr]', text)
    })
  }

  private onChildMessage(raw: unknown): void {
    const message = unwrapMessage(raw)
    if (!message) return

    if ('type' in message && message.type === 'booted') {
      if (!this.booted) {
        this.booted = true
        log('OBS worker booted')
      }
      return
    }

    this.handleMessage(message)
  }

  private async ensureSpawned(): Promise<void> {
    if (this.child && this.booted) return
    if (this.spawnPromise) {
      await this.spawnPromise
      return
    }

    this.spawnPromise = new Promise<void>((resolve, reject) => {
      const workerPath = this.getWorkerPath()
      log('OBS worker fork', workerPath)

      const child = fork(workerPath, [], {
        execPath: process.execPath,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          // Optimus 笔记本：子进程与 CS2 同走 NVIDIA，避免 game_capture 黑屏
          SHIM_MCCOMPAT: '0x800000001',
          __NV_PRIME_RENDER_OFFLOAD: '1',
          __NV_PRIME_RENDER_OFFLOAD_PROVIDER: 'NVIDIA-GPU',
          __GLX_VENDOR_LIBRARY_NAME: 'nvidia'
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        cwd: getProjectRoot()
      })
      this.child = child
      this.attachChildIo(child)

      const bootTimeout = setTimeout(() => {
        reject(new Error('OBS worker 启动超时（未收到 booted）'))
      }, 45_000)

      child.on('message', (raw) => {
        const wasBooted = this.booted
        this.onChildMessage(raw)
        if (!wasBooted && this.booted) {
          clearTimeout(bootTimeout)
          resolve()
        }
      })

      child.on('spawn', () => {
        log('OBS worker spawned', String(child.pid))
      })

      child.on('error', (err) => {
        clearTimeout(bootTimeout)
        logError('OBS worker error', err)
        reject(err)
      })

      child.on('exit', (code, signal) => {
        log('OBS worker exited', `code=${code} signal=${signal ?? ''}`)
        if (!this.booted) {
          clearTimeout(bootTimeout)
          reject(new Error(`OBS worker 异常退出 code=${code}`))
        }
        this.reset()
      })
    })

    try {
      await this.spawnPromise
    } catch (err) {
      this.spawnPromise = null
      try {
        this.child?.kill()
      } catch {
        // ignore
      }
      this.reset()
      throw err
    }
  }

  private async runInit(): Promise<void> {
    await ensureFfmpegRuntime()
    await ensureOsnRuntime()

    const check = checkResources()
    if (!check.ok) {
      throw new Error(`录制依赖不完整，缺少：\n${check.missing.join('\n')}`)
    }

    await this.ensureSpawned()
    const payload = this.buildInitPayload()
    await this.request('init', payload, 120_000)
    this.ready = true
    log('OBS worker ready')
  }

  private handleMessage(message: ObsWorkerResponse | ObsWorkerEvent): void {
    if ('type' in message && message.type === 'log') {
      const evt = message as ObsWorkerEvent & { type: 'log' }
      if (evt.level === 'error') {
        logError(`[obs-worker] ${evt.message}`, evt.detail ?? '')
      } else {
        log(`[obs-worker] ${evt.message}`, evt.detail ?? '')
      }
      return
    }

    if (!('id' in message)) return

    const res = message as ObsWorkerResponse
    const pending = this.pending.get(res.id)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pending.delete(res.id)

    if (res.ok) {
      pending.resolve(res.result)
    } else {
      pending.reject(new Error(res.error ?? 'OBS worker 请求失败'))
    }
  }

  private request(
    type: ObsWorkerRequest['type'],
    payload?: ObsInitPayload,
    timeoutMs = 30_000
  ): Promise<unknown> {
    if (!this.child?.connected) {
      return Promise.reject(new Error('OBS worker 未连接'))
    }

    const id = randomUUID()
    const msg: ObsWorkerRequest = { id, type, payload }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`OBS worker 请求超时: ${type}`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      this.child!.send(msg)
    })
  }
}
