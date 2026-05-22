/** 主进程 ↔ OBS Utility 子进程 IPC 协议 */

export interface ObsDisplayConfig {
  logicalWidth: number
  logicalHeight: number
  scaleFactor: number
  outputWidth: number
  outputHeight: number
}

export interface ObsPathsConfig {
  tempDir: string
  obsConfigPath: string
  recordingTmpMkv: string
}

export interface ObsInitPayload {
  osnModuleDir: string
  osnVersion: string
  paths: ObsPathsConfig
  display: ObsDisplayConfig
}

export type ObsWorkerRequestType =
  | 'init'
  | 'start-recording'
  | 'start-match-recording'
  | 'stop-recording'
  | 'shutdown'

export interface ObsWorkerRequest {
  id: string
  type: ObsWorkerRequestType
  payload?: ObsInitPayload
}

export interface ObsWorkerResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export type ObsWorkerEvent =
  | { type: 'booted' }
  | { type: 'log'; level: 'info' | 'error'; message: string; detail?: string }
