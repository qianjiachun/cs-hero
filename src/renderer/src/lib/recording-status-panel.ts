import { resolveGsiMatchDisplay } from '../../../shared/gsi-connection'
import type { RecordingControlModel } from './recording-control-model'
import type { Cs2IntegrationStatus, GsiServerState } from '../../shared/recording-types'

export type RecordingStatusTone = 'ok' | 'warn' | 'danger' | 'busy' | 'muted'

export interface RecordingStatusItem {
  id: string
  label: string
  value: string
  tone: RecordingStatusTone
}

function gsiRow(state: GsiServerState): Pick<RecordingStatusItem, 'value' | 'tone'> {
  switch (state) {
    case 'listening':
      return { value: '监听中', tone: 'ok' }
    case 'failed':
      return { value: '异常', tone: 'danger' }
    case 'port_conflict':
      return { value: '端口冲突', tone: 'warn' }
    default:
      return { value: '未开启', tone: 'muted' }
  }
}

function manualOpHint(model: RecordingControlModel): string {
  const action = model.ringControl?.action
  if (action === 'start') return '点击圆环开始'
  if (action === 'stop') return '点击圆环结束'
  if (action === 'cancel') return '点击圆环取消'
  return '—'
}

export function buildRecordingStatusItems(
  model: RecordingControlModel,
  cs2: Cs2IntegrationStatus | null
): RecordingStatusItem[] {
  if (!cs2) {
    return [{ id: 'sync', label: '服务', value: '同步中…', tone: 'busy' }]
  }

  const items: RecordingStatusItem[] = []

  items.push({
    id: 'obs',
    label: '录制引擎',
    value: cs2.obsReady ? '就绪' : cs2.runtimeDownload?.message ? '初始化' : '准备中',
    tone: cs2.obsReady ? 'ok' : 'busy'
  })

  if (model.mode === 'auto') {
    const gsi = gsiRow(cs2.gsiServerState)
    items.push({ id: 'gsi', label: '游戏监听', ...gsi })

    if (cs2.gsiServerState === 'listening') {
      const match = resolveGsiMatchDisplay(cs2)
      items.push({
        id: 'match',
        label: '对局',
        value: match.value,
        tone: match.tone
      })
    }

    if (cs2.launchOptionStatus === 'missing') {
      items.push({ id: 'launch', label: '启动项', value: '未配置', tone: 'warn' })
    } else if (cs2.cfgNeedsCs2Restart) {
      items.push({ id: 'cfg', label: '游戏配置', value: '需重启 CS2', tone: 'warn' })
    }
  } else {
    if (model.isSessionActive) {
      items.push({
        id: 'phase',
        label: '进度',
        value: model.circle.subtitle || model.circle.title,
        tone: 'busy'
      })
    } else if (model.ringControl?.interactive) {
      items.push({
        id: 'op',
        label: '操作',
        value: manualOpHint(model),
        tone: 'muted'
      })
    } else {
      items.push({
        id: 'mode',
        label: '说明',
        value: '由你控制开始与结束',
        tone: 'muted'
      })
    }
  }

  if (cs2.recordingError) {
    items.push({
      id: 'err',
      label: '异常',
      value: cs2.recordingError.length > 16 ? '录制出错' : cs2.recordingError,
      tone: 'danger'
    })
  }

  return items.slice(0, 4)
}
