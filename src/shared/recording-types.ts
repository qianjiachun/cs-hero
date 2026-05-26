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
  /** @deprecated 仅兼容旧数据；新对局不写此字段，片段以 clips/ 目录扫描为准 */
  clips?: ClipInfo[]
  clip_errors?: string[]
  ended_reason?: string
  /** 对局内合并导出的视频（中性命名，非 highlight） */
  merged_video?: string
}

/** 最近对局分页列表 */
export interface ContentListMatchesResult {
  items: ContentMatchSummary[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export interface ContentListMatchesOptions {
  offset?: number
  limit?: number
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
  hasMergedVideo?: boolean
  parseError?: string
}

export interface ContentMatchDetail extends ContentMatchSummary {
  end_time?: string
  clips: ClipInfo[]
  bookmarks: Array<{ type: BookmarkType; time: number }>
  full_match_path?: string
  merged_video_path?: string
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

/** 第五条竖切：打开剪辑窗口 */
export interface EditorOpenRequest {
  matchId: string
  source: 'full_match' | 'clip'
  clipFile?: string
}

export interface VideoMetadata {
  durationSeconds: number
  width?: number
  height?: number
  fps?: number
  codec?: string
  probeError?: string
}

export interface TimelineMarker {
  type: BookmarkType
  time: number
  index: number
}

export interface EditorSession {
  matchId: string
  map: string
  source: 'full_match' | 'clip'
  clipFile?: string
  sourceVideoPath: string
  /** file:// URL，供 <video> 预览 */
  sourceVideoUrl: string
  displayName: string
  matchDir: string
  canDelete: boolean
  /** 当前预览源的元数据 */
  metadata?: VideoMetadata
  /** 整局维度事件锚点（时间轴用） */
  bookmarks: Array<{ type: BookmarkType; time: number }>
  hasFullMatch: boolean
  hasMergedVideo: boolean
  clipSecondsBefore: number
  clipSecondsAfter: number
}

export type FfmpegJobType = 'trim' | 'concat' | 'merge'
export type FfmpegJobPhase = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface FfmpegJobStatus {
  jobId: string
  type: FfmpegJobType
  phase: FfmpegJobPhase
  progress: number
  message: string
  outputPath?: string
  error?: string
}

export interface MergeClipCandidate {
  file: string
  type?: BookmarkType
  time?: number
  durationSeconds?: number
}

export interface MergeBookmarkCandidate {
  index: number
  type: BookmarkType
  time: number
}

export interface MergeCandidates {
  matchId: string
  hasFullMatch: boolean
  hasMergedVideo: boolean
  fullMatchPath?: string
  clips: MergeClipCandidate[]
  bookmarks: MergeBookmarkCandidate[]
  metadata?: VideoMetadata
}

export interface MergeSegmentSelection {
  kind: 'clip'
  clipFile: string
}

export interface MergeBookmarkSelection {
  kind: 'bookmark'
  bookmarkIndex: number
}

export type MergeSelectionItem = MergeSegmentSelection | MergeBookmarkSelection

export interface MergeCreateRequest {
  matchId: string
  selections: MergeSelectionItem[]
  /** true：仅写入 exports；false：写入对局目录 merged.mp4 */
  exportOnly?: boolean
}

export interface MergeResult {
  outputPath: string
  fileName: string
  durationSeconds?: number
  usedCompatMode?: boolean
}

export interface EditorExportTrimRequest {
  matchId: string
  source: 'full_match' | 'clip'
  clipFile?: string
  startSeconds: number
  endSeconds: number
}

export interface EditorExportTrimResult {
  outputPath: string
  fileName: string
  durationSeconds: number
}
