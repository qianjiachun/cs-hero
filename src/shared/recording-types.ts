/** 第一条竖切：PoC 录制状态 */
export type RecordingPocPhase =
  | 'idle'
  | 'initializing'
  | 'recording'
  | 'stopping'
  | 'remuxing'
  | 'completed'
  | 'failed'

export interface RecordingPocStatus {
  phase: RecordingPocPhase
  message: string
  appDataRoot: string
  obsReady?: boolean
  obsWarming?: boolean
  outputDir?: string
  outputVideo?: string
  matchJson?: string
  error?: string
}

/** 第二条竖切：Mock 对局状态 */
export type MockMatchPhase =
  | 'idle'
  | 'waiting_cs2'
  | 'recording'
  | 'finalizing'
  | 'clipping'
  | 'completed'
  | 'failed'

export type RecordingMode = 'auto' | 'manual'

export type BookmarkType = 'kill' | 'death'

export interface Bookmark {
  type: BookmarkType
  /** 相对 full_match 起点的秒数 */
  time: number
  /** 事件发生时的绝对时间（用于 clip 文件名） */
  occurredAt: string
}

export interface ClipInfo {
  type: BookmarkType
  time: number
  file: string
}

export interface MatchJson {
  id: string
  map: string
  start_time: string
  end_time: string
  duration: number
  capture_method: string
  encoder: string
  status: 'complete' | 'incomplete'
  source?: 'mock' | 'cs2_gsi' | 'manual' | 'recovery'
  source_mkv?: string
  recovered_from?: string
  full_match_retained?: boolean
  bookmarks: Array<{ type: BookmarkType; time: number }>
  clips: ClipInfo[]
  clip_errors?: string[]
  ended_reason?: string
}

/** 第四条竖切：最近对局列表项 */
export interface ContentMatchSummary {
  id: string
  dir: string
  map: string
  start_time: string
  duration: number
  status: 'complete' | 'incomplete' | 'unknown'
  source?: string
  ended_reason?: string
  capture_method?: string
  encoder?: string
  bookmarkCount: number
  clipCount: number
  hasFullMatch: boolean
  parseError?: string
}

export interface ContentMatchDetail extends ContentMatchSummary {
  end_time?: string
  clips: ClipInfo[]
  bookmarks: Array<{ type: BookmarkType; time: number }>
  full_match_path?: string
  match_json_path: string
}

/** OBS 运行时信息（设置页展示） */
export interface ObsRuntimeInfo {
  selectedEncoder: string
  availableEncoders: string[]
  baseWidth: number
  baseHeight: number
  outputWidth: number
  outputHeight: number
  recordingFps: number
  recordingQuality: '720p' | '1080p' | '1440p'
  videoBitrateKbps: number
  encoderWarning?: string
  /** 用户可读的自动采集说明 */
  captureModeLabel: string
  recordingDisplayLabel: string
}

/** 第三条竖切：真实 CS2 GSI 集成状态 */
export type GsiServerState = 'idle' | 'listening' | 'port_conflict' | 'failed'

/** CS2 启动项 -allow_third_party_software 检测 */
export type Cs2LaunchOptionStatus = 'ok' | 'missing' | 'unknown'

export interface Cs2IntegrationStatus {
  recordingMode: RecordingMode
  gsiServerState: GsiServerState
  gsiPort: number
  gsiListenError?: string
  gsiPortAdjusted?: boolean
  cfgPath?: string
  cfgWritten: boolean
  cfgNeedsCs2Restart: boolean
  launchOptionStatus: Cs2LaunchOptionStatus
  launchOptions?: string
  launchOptionMessage?: string
  requiredLaunchOption?: string
  lastPayloadAt?: string
  lastMapPhase?: string
  lastMapName?: string
  lastKills?: number
  lastDeaths?: number
  recordingPhase: MockMatchPhase
  recordingMessage: string
  obsReady: boolean
  matchId?: string
  outputDir?: string
  bookmarkCount?: number
  clipCount?: number
  recordingError?: string
}

export interface MockMatchStatus {
  phase: MockMatchPhase
  message: string
  appDataRoot: string
  obsReady: boolean
  matchId?: string
  outputDir?: string
  outputVideo?: string
  matchJson?: string
  bookmarkCount?: number
  clipCount?: number
  error?: string
}
