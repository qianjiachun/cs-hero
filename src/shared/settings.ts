export type RecordingMode = 'auto' | 'manual'

export interface AppSettings {
  /** auto：GSI 自动开停；manual：用户手动开始/暂停/结束（与 auto 互斥） */
  recordingMode: RecordingMode
  recordingFps: 30 | 60 | 90 | 120
  recordingQuality: '720p' | '1080p' | '1440p'
  /** 录制使用的显示器（Electron display.id）；采集源/编码器由程序自动选择 */
  recordingDisplayId: number
  /** GSI HTTP 监听端口 */
  gsiPort: number
  /** 击杀片段：锚点前秒数 */
  clipSecondsBefore: number
  /** 击杀片段：锚点后秒数 */
  clipSecondsAfter: number
  /** 对局结束后是否保留 full_match.mp4（false 时 clips 成功后删除整局） */
  keepFullMatch: boolean
  /**
   * @deprecated 仅兼容旧 settings.json；始终按自动采集处理，不在 UI 暴露
   */
  captureMethod?: 'auto' | 'wgc' | 'dxgi'
  matchCaptureStrategy?: 'reliable' | 'auto' | 'game'
}

export const DEFAULT_SETTINGS: AppSettings = {
  recordingMode: 'auto',
  recordingFps: 60,
  recordingQuality: '1080p',
  recordingDisplayId: 0,
  gsiPort: 1340,
  clipSecondsBefore: 5,
  clipSecondsAfter: 5,
  keepFullMatch: true
}

/** 内部固定：采集与编码器全自动（不对用户暴露） */
export const AUTO_CAPTURE_METHOD = 'auto' as const
export const AUTO_MATCH_CAPTURE_STRATEGY = 'auto' as const
