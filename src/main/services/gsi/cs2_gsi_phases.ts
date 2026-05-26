/** CS2 GSI map.phase：应持续录制并统计击杀/死亡的阶段 */
const RECORDING_ACTIVE_PHASES = new Set(['warmup', 'live', 'freezetime'])

/** 对局结束，停止录制 */
const RECORDING_END_PHASES = new Set(['gameover', 'over', 'ended'])

export function normalizeMapPhase(phase?: string): string {
  return (phase ?? '').trim().toLowerCase()
}

export function isRecordingActivePhase(phase?: string): boolean {
  const p = normalizeMapPhase(phase)
  return p.length > 0 && RECORDING_ACTIVE_PHASES.has(p)
}

export function isRecordingEndPhase(phase?: string): boolean {
  const p = normalizeMapPhase(phase)
  return p.length > 0 && RECORDING_END_PHASES.has(p)
}
