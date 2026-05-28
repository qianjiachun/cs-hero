import type { ContentMatchSummary } from '../../../shared/recording-types'
import { formatDurationSeconds, parseMatchTime } from './time-format'

export type StatsRangeDays = 7 | 30 | 90

export type TrendMetric = 'clips' | 'duration' | 'kills'

export interface HomeStatsSummary {
  recordingSeconds: number
  clipCount: number
  killClipCount: number
}

export interface TrendPoint {
  dateKey: string
  label: string
  clips: number
  durationSeconds: number
  killClips: number
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function filterMatchesInRange(
  matches: ContentMatchSummary[],
  rangeDays: StatsRangeDays,
  now = new Date()
): ContentMatchSummary[] {
  const end = startOfDay(now)
  const start = addDays(end, -(rangeDays - 1))
  return matches.filter((m) => {
    const t = parseMatchTime(m.start_time)
    if (!t) return false
    const day = startOfDay(t)
    return day >= start && day <= end
  })
}

export function summarizeHomeStats(matches: ContentMatchSummary[]): HomeStatsSummary {
  let recordingSeconds = 0
  let clipCount = 0
  let killClipCount = 0
  for (const m of matches) {
    recordingSeconds += m.duration ?? 0
    clipCount += m.clipCount ?? 0
    killClipCount += m.killClipCount ?? 0
  }
  return { recordingSeconds, clipCount, killClipCount }
}

export function buildTrendSeries(
  matches: ContentMatchSummary[],
  rangeDays: StatsRangeDays,
  now = new Date()
): TrendPoint[] {
  const end = startOfDay(now)
  const start = addDays(end, -(rangeDays - 1))
  const buckets = new Map<string, TrendPoint>()

  for (let i = 0; i < rangeDays; i++) {
    const day = addDays(start, i)
    const key = dateKey(day)
    const mo = String(day.getMonth() + 1).padStart(2, '0')
    const dd = String(day.getDate()).padStart(2, '0')
    buckets.set(key, {
      dateKey: key,
      label: `${mo}/${dd}`,
      clips: 0,
      durationSeconds: 0,
      killClips: 0
    })
  }

  for (const m of matches) {
    const t = parseMatchTime(m.start_time)
    if (!t) continue
    const day = startOfDay(t)
    if (day < start || day > end) continue
    const key = dateKey(day)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.clips += m.clipCount ?? 0
    bucket.durationSeconds += m.duration ?? 0
    bucket.killClips += m.killClipCount ?? 0
  }

  return [...buckets.values()]
}

export function trendMetricValue(point: TrendPoint, metric: TrendMetric): number {
  if (metric === 'duration') return point.durationSeconds / 3600
  if (metric === 'kills') return point.killClips
  return point.clips
}

export function trendMetricLabel(metric: TrendMetric): string {
  if (metric === 'duration') return '录制时长'
  if (metric === 'kills') return '击杀片段'
  return '片段数'
}

/** 趋势图 tooltip：与左侧指标卡一致，使用原始聚合值而非图表缩放后的 v */
export function formatTrendTooltip(point: TrendPoint, metric: TrendMetric): string {
  if (metric === 'duration') {
    const label = formatDurationSeconds(point.durationSeconds)
    return `${point.label} · ${label}`
  }
  if (metric === 'kills') {
    return `${point.label} · ${point.killClips} 击杀片段`
  }
  return `${point.label} · ${point.clips} 生成片段`
}
