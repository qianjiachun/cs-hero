import { isGsiGameConnected } from '../../../shared/gsi-connection'
import type {
  Cs2IntegrationStatus,
  MockMatchPhase,
  RecordingPocStatus
} from '../../../shared/recording-types'
import type { RuntimeDownloadStatus } from '../../../shared/runtime-download-types'
import type { ServiceHealthLevel, ServiceStatusIssue, ServiceStatusSnapshot } from '../../../shared/service-status-types'

const RUNTIME_LOAD_PREFIX: Record<RuntimeDownloadStatus['component'], string> = {
  osn: '加载录制组件',
  ffmpeg: '加载视频组件'
}

function runtimeDownloadSummary(runtimeDownload: RuntimeDownloadStatus): string {
  if (runtimeDownload.phase === 'extracting') {
    return `解压${runtimeDownload.label}`
  }
  const prefix = RUNTIME_LOAD_PREFIX[runtimeDownload.component]
  const progressLabel =
    runtimeDownload.progress !== undefined ? ` ${Math.round(runtimeDownload.progress)}%` : ''
  return `${prefix}${progressLabel}`
}

function runtimeDownloadCardFields(
  runtimeDownload: RuntimeDownloadStatus
): Pick<ServiceStatusSnapshot, 'cardLabel' | 'cardLabelPrefix' | 'cardHeadline'> {
  if (runtimeDownload.phase === 'extracting') {
    return { cardLabel: `解压${runtimeDownload.label}` }
  }
  return {
    cardLabelPrefix: RUNTIME_LOAD_PREFIX[runtimeDownload.component],
    cardHeadline:
      runtimeDownload.progress !== undefined
        ? `${Math.round(runtimeDownload.progress)}%`
        : undefined
  }
}

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

/** 侧栏卡片第二行：在窄宽度下更易读，详情仍用完整 summary */
const CARD_LINE_SHORT: Record<string, string> = {
  录制功能准备中: 'OBS 初始化中',
  录制功能未就绪: '录制未就绪',
  游戏状态监听未配置: 'GSI 未配置',
  找不到游戏配置位置: '找不到配置',
  无法监听游戏状态: '监听失败',
  'Steam 启动选项未设置': '启动项未设',
  等待进入对局: '等待对局',
  游戏配置已更新: '需重启游戏',
  监听端口被占用: '端口冲突',
  监听端口已变更: '端口已变更',
  未在监听游戏: '未在监听',
  启动选项尚未检测: '启动项待检'
}

function compactRuntimeSummary(summary: string): string {
  return summary.replace('视频处理组件', '视频组件')
}

function buildCardDisplay(
  summary: string,
  level: ServiceHealthLevel
): Pick<ServiceStatusSnapshot, 'cardHeadline' | 'cardLabel'> {
  if (level === 'ok' && summary === '正常') {
    return { cardHeadline: '正常' }
  }
  const mapped = CARD_LINE_SHORT[summary] ?? compactRuntimeSummary(summary)
  return { cardLabel: mapped }
}

function withCardDisplay(
  snapshot: Omit<ServiceStatusSnapshot, 'cardHeadline' | 'cardLabel'>
): ServiceStatusSnapshot {
  const display = buildCardDisplay(snapshot.summary, snapshot.level)
  return { ...snapshot, ...display }
}

export function buildServiceStatus(
  cs2: Cs2IntegrationStatus | null | undefined,
  poc: RecordingPocStatus | null | undefined
): ServiceStatusSnapshot {
  if (!cs2) {
    return withCardDisplay({
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
    })
  }

  const issues: ServiceStatusIssue[] = []
  const runtimeDownload = poc?.runtimeDownload
  const runtimeDownloading =
    runtimeDownload?.phase === 'downloading' || runtimeDownload?.phase === 'extracting'
  const obsWarming = poc?.obsWarming === true
  const recordingActive = isRecordingActive(cs2.recordingPhase)

  if (runtimeDownloading) {
    issues.push({
      id: `runtime-${runtimeDownload.component}`,
      title: `${runtimeDownload.label}准备中`,
      detail: runtimeDownload.message,
      level: 'info'
    })
    return {
      level: 'busy',
      summary: runtimeDownloadSummary(runtimeDownload),
      ...runtimeDownloadCardFields(runtimeDownload),
      issues,
      recordingActive: false,
      progress: runtimeDownload.progress,
      progressTone: 'download'
    }
  }

  if (runtimeDownload?.phase === 'failed') {
    issues.push({
      id: `runtime-${runtimeDownload.component}`,
      title: `${runtimeDownload.label}下载失败`,
      detail: runtimeDownload.error ?? runtimeDownload.message,
      level: 'critical'
    })
  }

  if (obsWarming && !cs2.obsReady) {
    const warmingDetail =
      poc?.message && /下载|解压|录制组件|视频处理组件/.test(poc.message)
        ? poc.message
        : '首次启动可能需要一点时间'
    issues.push({
      id: 'obs-warming',
      title: '录制功能准备中',
      detail: warmingDetail,
      level: 'info'
    })
  } else if (!cs2.obsReady) {
    const obsDetail =
      poc?.error?.trim() ||
      (poc?.message && poc.message !== '就绪' ? poc.message : undefined) ||
      '请稍后重试，或重启本软件。若仍失败，请查看安装目录下 logs/main.log'
    issues.push({
      id: 'obs-not-ready',
      title: '录制功能未就绪',
      detail: obsDetail,
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
    if (cs2.recordingMode === 'auto' && !isGsiGameConnected(cs2)) {
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
  const obsPreparing = obsWarming && !cs2.obsReady

  let level: ServiceHealthLevel = 'ok'
  if (criticalCount > 0) level = 'critical'
  else if (warningCount > 0) level = 'warning'
  else if (obsPreparing || recordingActive) level = 'busy'

  let summary: string
  if (!hasProblem) {
    if (obsPreparing) {
      summary = '录制功能准备中'
    } else if (recordingActive) {
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

  return withCardDisplay({
    level,
    summary,
    issues,
    recordingActive,
    progress: runtimeDownload?.phase === 'ready' ? 100 : undefined
  })
}
