/**
 * OBS 子进程入口（child_process.fork + ELECTRON_RUN_AS_NODE）
 */
import { ObsEngine } from './obs_engine'
import { createWorkerMessenger } from './obs_worker_ipc'
import type { ObsInitPayload, ObsWorkerRequest, ObsWorkerResponse } from './obs_ipc'

const ipc = createWorkerMessenger()
let engine: ObsEngine | null = null

function reply(res: ObsWorkerResponse): void {
  ipc.post(res)
}

function workerLog(level: 'info' | 'error', message: string, detail?: string): void {
  ipc.post({ type: 'log', level, message, detail })
}

process.on('uncaughtException', (err) => {
  workerLog('error', 'uncaughtException', err instanceof Error ? err.stack ?? err.message : String(err))
})

process.on('unhandledRejection', (reason) => {
  workerLog('error', 'unhandledRejection', String(reason))
})

ipc.onMessage(async (raw) => {
  const msg = raw as ObsWorkerRequest
  if (!msg?.id || !msg?.type) return

  const { id, type, payload } = msg

  try {
    switch (type) {
      case 'init': {
        if (!payload) throw new Error('init 缺少 payload')
        engine = new ObsEngine(workerLog)
        engine.initialize(payload as ObsInitPayload)
        reply({ id, ok: true })
        break
      }
      case 'start-recording': {
        if (!engine?.isInitialized()) throw new Error('OBS 未初始化')
        engine.startRecording()
        await engine.waitRecordingStarted()
        reply({ id, ok: true })
        break
      }
      case 'start-match-recording': {
        if (!engine?.isInitialized()) throw new Error('OBS 未初始化')
        const captureMethod = await engine.prepareMatchCapture()
        engine.startRecording()
        await engine.waitRecordingStarted()
        reply({ id, ok: true, result: captureMethod })
        break
      }
      case 'stop-recording': {
        if (!engine?.isInitialized()) throw new Error('OBS 未初始化')
        const mkvPath = await engine.stopRecording()
        reply({ id, ok: true, result: mkvPath })
        break
      }
      case 'get-runtime-info': {
        if (!engine?.isInitialized()) throw new Error('OBS 未初始化')
        reply({ id, ok: true, result: engine.getRuntimeInfo() })
        break
      }
      case 'shutdown': {
        engine?.shutdown()
        engine = null
        reply({ id, ok: true })
        break
      }
      default:
        reply({ id, ok: false, error: `未知请求: ${type}` })
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    workerLog('error', `OBS worker ${type} failed`, error)
    reply({ id, ok: false, error })
  }
})

ipc.post({ type: 'booted' })
