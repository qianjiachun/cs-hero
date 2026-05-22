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
  | 'recording'
  | 'finalizing'
  | 'clipping'
  | 'completed'
  | 'failed'

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
  source?: 'mock' | 'cs2_gsi'
  source_mkv?: string
  bookmarks: Array<{ type: BookmarkType; time: number }>
  clips: ClipInfo[]
  clip_errors?: string[]
  ended_reason?: string
}

/** 第三条竖切：真实 CS2 GSI 集成状态 */
export type GsiServerState = 'idle' | 'listening' | 'port_conflict' | 'failed'

export interface Cs2IntegrationStatus {
  gsiServerState: GsiServerState
  gsiPort: number
  gsiListenError?: string
  gsiPortAdjusted?: boolean
  cfgPath?: string
  cfgWritten: boolean
  cfgNeedsCs2Restart: boolean
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
