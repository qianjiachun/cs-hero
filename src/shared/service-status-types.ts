export type ServiceHealthLevel = 'ok' | 'warning' | 'critical' | 'busy'

export type ServiceStatusActionType =
  | 'navigate'
  | 'open-steam'
  | 'refresh-launch-option'
  | 'open-cfg-folder'
  | 'dismiss'

export interface ServiceStatusAction {
  type: ServiceStatusActionType
  label: string
  /** 导航目标：settings | home | recordings */
  target?: string
}

export interface ServiceStatusIssue {
  id: string
  title: string
  detail?: string
  level: 'warning' | 'critical' | 'info'
  action?: ServiceStatusAction
  actions?: ServiceStatusAction[]
}

export interface ServiceStatusSnapshot {
  level: ServiceHealthLevel
  /** 完整状态文案（详情面板、悬停提示） */
  summary: string
  /** 一切正常时右侧「正常」；非 OK 时不设，由 cardLabel 替换标题 */
  cardHeadline?: string
  /** 非 OK 时替换侧栏「服务状态」的短文案 */
  cardLabel?: string
  /** 下载中：左侧固定前缀（如「加载录制组件」） */
  cardLabelPrefix?: string
  issues: ServiceStatusIssue[]
  /** 是否处于录制相关流程 */
  recordingActive: boolean
  /** 下载录制依赖时用于卡片进度条 */
  progress?: number
  /** 下载进度条样式（与存储空间进度条区分） */
  progressTone?: 'download'
}
