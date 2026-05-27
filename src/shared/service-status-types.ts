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
  /** 卡片右侧短文案 */
  summary: string
  issues: ServiceStatusIssue[]
  /** 是否处于录制相关流程 */
  recordingActive: boolean
}
