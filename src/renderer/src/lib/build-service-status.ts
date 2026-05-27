import type {
  Cs2IntegrationStatus,
  MockMatchPhase,
  RecordingPocStatus
} from '../../../shared/recording-types'
import type { ServiceHealthLevel, ServiceStatusIssue, ServiceStatusSnapshot } from '../../../shared/service-status-types'

const RECORDING_ACTIVE_PHASES: MockMatchPhase[] = [
  'waiting_cs2',
  'recording',
  'finalizing',
  'clipping'
]

const PHASE_SUMMARY: Partial<Record<MockMatchPhase, string>> = {
  waiting_cs2: '等待游戏',
  recording: '录制中',
  finalizing: '保存中',
  clipping: '处理片段'
}

function isRecordingActive(phase: MockMatchPhase): boolean {
  return RECORDING_ACTIVE_PHASES.includes(phase)
}

function recordingSummary(cs2: Cs2IntegrationStatus): string {
  return PHASE_SUMMARY[cs2.recordingPhase] ?? '录制中'
}

export function buildServiceStatus(
  cs2: Cs2IntegrationStatus | null | undefined,
  poc: RecordingPocStatus | null | undefined
): ServiceStatusSnapshot {
  if (!cs2) {
    return {
      level: 'warning',
      summary: '加载中',
      issues: [
        {
          id: 'bridge',
          title: '正在连接',
          detail: '请稍候',
          level: 'warning'
        }
      ],
      recordingActive: false
    }
  }

  const issues: ServiceStatusIssue[] = []
  const obsWarming = poc?.obsWarming === true
  const recordingActive = isRecordingActive(cs2.recordingPhase)

  if (obsWarming && !cs2.obsReady) {
    issues.push({
      id: 'obs-warming',
      title: '录制功能准备中',
      detail: '首次启动可能需要一点时间',
      level: 'info'
    })
  } else if (!cs2.obsReady) {
    issues.push({
      id: 'obs-not-ready',
      title: '录制功能未就绪',
      detail: '请稍后重试，或重启本软件',
      level: 'critical'
    })
  }

  if (!cs2.cfgPath) {
    issues.push({
      id: 'gsi-cfg-path',
      title: '找不到游戏配置位置',
      detail: '请确认已通过 Steam 安装 Counter-Strike 2',
      level: 'critical'
    })
  } else if (!cs2.cfgWritten) {
    issues.push({
      id: 'gsi-cfg-write',
      title: '游戏状态监听未配置',
      detail: '需要写入游戏配置文件后才能自动识别对局',
      level: 'critical',
      action: { type: 'open-cfg-folder', label: '打开配置文件夹' }
    })
  } else if (cs2.cfgNeedsCs2Restart) {
    issues.push({
      id: 'gsi-cfg-restart',
      title: '游戏配置已更新',
      detail: '请完全退出并重新打开 Counter-Strike 2',
      level: 'warning'
    })
  }

  if (cs2.gsiServerState === 'failed') {
    issues.push({
      id: 'gsi-server-failed',
      title: '无法监听游戏状态',
      detail: cs2.gsiListenError ?? '请检查网络或重启本软件',
      level: 'critical',
      action: { type: 'navigate', label: '前往设置', target: 'settings' }
    })
  } else if (cs2.gsiServerState === 'port_conflict') {
    issues.push({
      id: 'gsi-port-conflict',
      title: '监听端口被占用',
      detail: '与其他程序冲突，可在设置中更换端口',
      level: 'warning',
      action: { type: 'navigate', label: '前往设置', target: 'settings' }
    })
  } else if (cs2.gsiServerState === 'idle' && cs2.recordingMode === 'auto') {
    issues.push({
      id: 'gsi-server-idle',
      title: '未在监听游戏',
      detail: '自动录制需要游戏状态监听服务',
      level: 'warning'
    })
  } else if (cs2.gsiServerState === 'listening') {
    if (cs2.recordingMode === 'auto' && !cs2.lastPayloadAt) {
      issues.push({
        id: 'gsi-no-payload',
        title: '等待进入对局',
        detail: '监听已开启，启动游戏并进入比赛后会自动连接',
        level: 'info'
      })
    }
    if (cs2.gsiPortAdjusted) {
      issues.push({
        id: 'gsi-port-adjusted',
        title: '监听端口已变更',
        detail: '请完全退出并重新打开 Counter-Strike 2',
        level: 'warning'
      })
    }
  }

  if (cs2.launchOptionStatus === 'missing') {
    issues.push({
      id: 'launch-option-missing',
      title: 'Steam 启动选项未设置',
      detail:
        cs2.launchOptionMessage ??
        '需要在 Steam 中为 CS2 添加「允许第三方软件」相关启动参数',
      level: 'warning',
      actions: [
        { type: 'open-steam', label: '在 Steam 中打开' },
        { type: 'refresh-launch-option', label: '重新检测' }
      ]
    })
  } else if (cs2.launchOptionStatus === 'unknown') {
    issues.push({
      id: 'launch-option-unknown',
      title: '启动选项尚未检测',
      detail: '可点击重新检测确认是否已正确设置',
      level: 'info',
      action: { type: 'refresh-launch-option', label: '重新检测' }
    })
  }

  if (cs2.recordingError) {
    issues.push({
      id: 'recording-error',
      title: '录制出现问题',
      detail: cs2.recordingError,
      level: 'critical'
    })
  }

  const visibleIssues = issues.filter((i) => i.title)
  const criticalCount = visibleIssues.filter((i) => i.level === 'critical').length
  const warningCount = visibleIssues.filter((i) => i.level === 'warning').length
  const hasProblem = criticalCount > 0 || warningCount > 0

  let level: ServiceHealthLevel = 'ok'
  if (criticalCount > 0) level = 'critical'
  else if (warningCount > 0) level = 'warning'
  else if (recordingActive) level = 'busy'

  let summary: string
  if (!hasProblem) {
    if (recordingActive) {
      summary = recordingSummary(cs2)
    } else {
      summary = '正常'
    }
  } else if (criticalCount > 0) {
    const first = visibleIssues.find((i) => i.level === 'critical')
    summary = criticalCount === 1 && first ? first.title : `${criticalCount} 项异常`
  } else {
    const first = visibleIssues.find((i) => i.level === 'warning')
    summary = warningCount === 1 && first ? first.title : `${warningCount} 项待处理`
  }

  return {
    level,
    summary,
    issues,
    recordingActive
  }
}
