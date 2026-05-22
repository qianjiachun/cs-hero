/** CS2 GSI payload 最小子集（Mock 与真实 GSI 共用解析） */
export interface GsiPayload {
  provider?: { steamid?: string }
  map?: { phase?: string; name?: string }
  player?: {
    steamid?: string
    match_stats?: { kills?: number; deaths?: number }
  }
}

export const MOCK_STEAM_ID = '76561198000000001'
export const DEFAULT_GSI_PORT = 1340
