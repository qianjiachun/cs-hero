import type { AppSettings, RecordingMode } from '../../../shared/settings'
import type { Cs2IntegrationStatus, MockMatchPhase, ObsRuntimeInfo } from '../../../shared/recording-types'

export type RecordingStatusTone = 'ok' | 'busy' | 'warn' | 'danger'

export type RingControlAction = 'start' | 'stop' | 'cancel'

const ACTIVE_PHASES: MockMatchPhase[] = ['waiting_cs2', 'recording', 'finalizing', 'clipping']

export interface RecordingCircleView {
  title: string
  subtitle: string
  showTimer: boolean
  timerSeconds: number
}

export interface RecordingParamChip {
  value: string
}

/** 手动模式下圆环作为主控：点击开始 / 结束 / 取消 */
export interface RingControlView {
  interactive: boolean
  action: RingControlAction | null
  disabled: boolean
  ariaLabel: string
}

export interface RecordingControlModel {
  mode: RecordingMode
  tone: RecordingStatusTone
  circle: RecordingCircleView
  params: RecordingParamChip[]
  isSessionActive: boolean
  canChangeMode: boolean
  ringControl: RingControlView | null
}

export function buildRecordingParams(
  settings: AppSettings | null,
  obsRuntime?: ObsRuntimeInfo | null
): RecordingParamChip[] {
  if (!settings) return [{ value: '—' }]
  const chips: RecordingParamChip[] = [
    { value: settings.recordingQuality },
    { value: `${settings.recordingFps}fps` }
  ]
  if (obsRuntime?.qualityModeLabel) {
    chips.push({ value: `${obsRuntime.qualityModeLabel}（质量优先）` })
  }
  return chips
}

function isActivePhase(phase: MockMatchPhase): boolean {
  return ACTIVE_PHASES.includes(phase)
}

function autoSubtitle(keepFullMatch: boolean, recording: boolean): string {
  if (recording) {
    return keepFullMatch ? '整局 + 片段' : '击杀片段'
  }
  return '进局开录'
}

function buildCircle(
  title: string,
  subtitle: string,
  showTimer: boolean,
  timerSeconds: number
): RecordingCircleView {
  return { title, subtitle, showTimer, timerSeconds }
}

export function buildRecordingControlModel(
  settings: AppSettings | null,
  cs2: Cs2IntegrationStatus | null,
  options?: {
    settingsBusy?: boolean
    manualActionBusy?: boolean
    obsRuntime?: ObsRuntimeInfo | null
  }
): RecordingControlModel {
  const mode = settings?.recordingMode ?? 'auto'
  const keepFullMatch = settings?.keepFullMatch ?? true
  const manualActionBusy = options?.manualActionBusy ?? false
  const params = buildRecordingParams(settings, options?.obsRuntime)
  const base = { mode, params }

  if (!cs2) {
    return {
      ...base,
      tone: 'busy',
      circle: buildCircle('连接中', '正在同步状态', false, 0),
      isSessionActive: false,
      canChangeMode: false,
      ringControl: null
    }
  }

  const phase = cs2.recordingPhase
  const sessionActive = isActivePhase(phase)
  const canChangeMode = !(options?.settingsBusy ?? false) && !sessionActive
  const ringControl = buildRingControl(mode, phase, manualActionBusy, !cs2.obsReady)
  const elapsed = cs2.recordingElapsedSeconds ?? 0
  const isRecording = phase === 'recording'

  if (cs2.recordingError) {
    return {
      ...base,
      tone: 'danger',
      circle: buildCircle('录制异常', cs2.recordingError, false, 0),
      isSessionActive: sessionActive,
      canChangeMode,
      ringControl
    }
  }

  if (!cs2.obsReady) {
    return {
      ...base,
      tone: 'busy',
      circle: buildCircle(
        '准备中',
        cs2.runtimeDownload?.message ?? '录制组件初始化',
        false,
        0
      ),
      isSessionActive: sessionActive,
      canChangeMode,
      ringControl
    }
  }

  if (sessionActive) {
    if (mode === 'manual') {
      const title =
        phase === 'waiting_cs2' ? '等待游戏' : phase === 'recording' ? '录制中' : '处理中'
      const subtitle =
        phase === 'finalizing' || phase === 'clipping'
          ? cs2.recordingMessage || '保存录像'
          : ''
      return {
        ...base,
        tone: 'busy',
        circle: buildCircle(title, subtitle, isRecording, elapsed),
        isSessionActive: true,
        canChangeMode: false,
        ringControl
      }
    }

    const title =
      phase === 'waiting_cs2'
        ? '等待对局'
        : phase === 'recording'
          ? '录制中'
          : phase === 'clipping'
            ? '生成片段'
            : '保存中'
    const subtitle =
      phase === 'recording'
        ? autoSubtitle(keepFullMatch, true)
        : phase === 'clipping'
          ? '裁剪击杀片段'
          : cs2.lastMapName && cs2.lastMapName !== 'unknown'
            ? cs2.lastMapName
            : '处理对局文件'

    return {
      ...base,
      tone: 'busy',
      circle: buildCircle(title, subtitle, isRecording, elapsed),
      isSessionActive: true,
      canChangeMode: false,
      ringControl: null
    }
  }

  if (mode === 'manual') {
    return {
      ...base,
      tone: 'ok',
      circle: buildCircle('手动录制', '', false, 0),
      isSessionActive: false,
      canChangeMode: true,
      ringControl
    }
  }

  if (cs2.gsiServerState !== 'listening') {
    return {
      ...base,
      tone: 'warn',
      circle: buildCircle('未就绪', autoNotReadyHint(cs2), false, 0),
      isSessionActive: false,
      canChangeMode: true,
      ringControl: null
    }
  }

  return {
    ...base,
    tone: 'ok',
    circle: buildCircle('自动录制', '', false, 0),
    isSessionActive: false,
    canChangeMode: true,
    ringControl: null
  }
}

function autoNotReadyHint(cs2: Cs2IntegrationStatus): string {
  if (cs2.gsiServerState === 'failed') {
    return cs2.gsiListenError ?? 'GSI 监听失败'
  }
  if (cs2.gsiServerState === 'port_conflict') return '请更换 GSI 端口'
  return '请检查 GSI 配置'
}

function buildRingControl(
  mode: RecordingMode,
  phase: MockMatchPhase,
  busy: boolean,
  obsNotReady: boolean
): RingControlView | null {
  if (mode !== 'manual') return null

  if (phase === 'idle' || phase === 'completed' || phase === 'failed') {
    const disabled = busy || obsNotReady
    return {
      interactive: true,
      action: 'start',
      disabled,
      ariaLabel: disabled ? '录制未就绪，无法开始' : '开始手动录制'
    }
  }
  if (phase === 'waiting_cs2') {
    return {
      interactive: true,
      action: 'cancel',
      disabled: busy,
      ariaLabel: busy ? '正在处理' : '取消等待并结束会话'
    }
  }
  if (phase === 'recording') {
    return {
      interactive: true,
      action: 'stop',
      disabled: busy,
      ariaLabel: busy ? '正在处理' : '结束手动录制'
    }
  }
  return null
}

export function formatRecordingTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}
