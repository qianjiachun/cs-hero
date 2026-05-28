import type { Cs2IntegrationStatus } from './recording-types'

/**
 * CS2 GSI cfg：throttle 0.05s、heartbeat 30s。
 * 略大于常规推送间隔，用于判断「游戏仍在向本机推送状态」。
 */
export const GSI_PAYLOAD_STALE_MS = 8_000

export function isGsiPayloadFresh(
  lastPayloadAt: string | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!lastPayloadAt) return false
  const at = Date.parse(lastPayloadAt)
  if (Number.isNaN(at)) return false
  return nowMs - at <= GSI_PAYLOAD_STALE_MS
}

/** 是否视为 CS2 进程在运行（非 Windows 无法检测时返回 undefined） */
export type Cs2ProcessProbe = boolean | undefined

export function isGsiGameConnected(
  status: Pick<
    Cs2IntegrationStatus,
    'gsiServerState' | 'lastPayloadAt' | 'cs2ProcessRunning'
  >,
  nowMs: number = Date.now()
): boolean {
  if (status.gsiServerState !== 'listening') return false
  if (!isGsiPayloadFresh(status.lastPayloadAt, nowMs)) return false
  if (status.cs2ProcessRunning === false) return false
  return true
}

export interface GsiMatchDisplay {
  value: string
  tone: 'ok' | 'muted' | 'warn'
}

/** 自动录制侧栏「对局」文案 */
export function resolveGsiMatchDisplay(
  status: Pick<
    Cs2IntegrationStatus,
    'gsiServerState' | 'lastPayloadAt' | 'lastMapName' | 'cs2ProcessRunning'
  >,
  nowMs: number = Date.now()
): GsiMatchDisplay {
  if (status.gsiServerState !== 'listening') {
    return { value: '—', tone: 'muted' }
  }

  if (status.cs2ProcessRunning === false) {
    return { value: '游戏未启动', tone: 'muted' }
  }

  if (!isGsiPayloadFresh(status.lastPayloadAt, nowMs)) {
    return { value: '等待进局', tone: 'muted' }
  }

  const map = status.lastMapName
  if (map && map !== 'unknown') {
    return { value: map, tone: 'ok' }
  }

  return { value: '已连接', tone: 'ok' }
}
