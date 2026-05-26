/** 手动录制在 UI / match.json 中展示的地图名 */
export const MANUAL_MATCH_MAP_LABEL = '手动录制'

export function isManualMatchId(matchId: string): boolean {
  return matchId.startsWith('manual_')
}

/** 最近对局列表/详情标题用的地图展示名 */
export function resolveMatchDisplayMap(
  matchId: string,
  map?: string,
  source?: string
): string {
  if (source === 'manual' || map === 'manual' || isManualMatchId(matchId)) {
    return MANUAL_MATCH_MAP_LABEL
  }
  if (map && map.trim() && map !== 'unknown') {
    return map
  }
  if (matchId.startsWith('mock_')) {
    return 'Mock 对局'
  }
  return map?.trim() || '未知对局'
}
