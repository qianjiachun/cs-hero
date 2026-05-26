/** 主进程 ↔ OBS Utility 子进程 IPC 协议 */

import type { AppSettings } from '../../shared/settings'

export interface ObsDisplayConfig {
  logicalWidth: number
  logicalHeight: number
  physicalWidth: number
  physicalHeight: number
  scaleFactor: number
  /** OBS base 画布（标准 16:9 画质分辨率，采集源 letterbox 入内） */
  baseWidth: number
  baseHeight: number
  /** 录制输出分辨率（与 base 一致） */
  outputWidth: number
  outputHeight: number
  /** OBS monitor_capture 使用的显示器索引 */
  monitorIndex: number
  displayLabel: string
}

export interface ObsPathsConfig {
  tempDir: string
  obsConfigPath: string
  recordingTmpMkv: string
}

export interface ObsRecordingConfig {
  recordingFps: AppSettings['recordingFps']
  recordingQuality: AppSettings['recordingQuality']
}

export interface ObsInitPayload {
  osnModuleDir: string
  osnVersion: string
  paths: ObsPathsConfig
  display: ObsDisplayConfig
  recording: ObsRecordingConfig
}

export interface ObsRuntimeInfoPayload {
  selectedEncoder: string
  encoderDisplayName: string
  availableEncoders: string[]
  baseWidth: number
  baseHeight: number
  outputWidth: number
  outputHeight: number
  recordingFps: number
  recordingQuality: AppSettings['recordingQuality']
  videoBitrateKbps: number
  encoderWarning?: string
  captureModeLabel: string
  recordingDisplayLabel: string
}

export type ObsWorkerRequestType =
  | 'init'
  | 'get-runtime-info'
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
