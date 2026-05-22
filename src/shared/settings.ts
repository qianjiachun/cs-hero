export interface AppSettings {
  recordingFps: 30 | 60 | 90 | 120 | 144
  recordingQuality: '720p' | '1080p' | '1440p'
  captureMethod: 'auto' | 'wgc' | 'dxgi'
  /** GSI HTTP 监听端口 */
  gsiPort: number
  /** 击杀片段：锚点前秒数 */
  clipSecondsBefore: number
  /** 击杀片段：锚点后秒数 */
  clipSecondsAfter: number
  /**
   * 对局录制采集策略（写入 dev/settings.json 可改）：
   * - reliable：显示器采集（独占全屏最稳，推荐）
   * - auto：先试游戏采集，仅在 hook 确认有效时使用，否则回退显示器
   * - game：仅游戏/窗口采集（可能黑屏，仅调试用）
   */
  matchCaptureStrategy: 'reliable' | 'auto' | 'game'
}

export const DEFAULT_SETTINGS: AppSettings = {
  recordingFps: 60,
  recordingQuality: '1080p',
  captureMethod: 'auto',
  gsiPort: 1340,
  clipSecondsBefore: 5,
  clipSecondsAfter: 5,
  matchCaptureStrategy: 'auto'
}
