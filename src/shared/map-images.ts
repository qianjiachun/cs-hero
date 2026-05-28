/** CS 官服剪影地图图（与 csgo.com.cn jianying 目录命名一致） */
const MAP_IMAGE_BASE = 'https://www.csgo.com.cn/images/maps/jianying/map_'

const MAP_SLUG_ALIASES: Record<string, string> = {
  dust2: 'dust2',
  dust_2: 'dust2',
  mirage: 'mirage',
  inferno: 'inferno',
  anubis: 'anubis',
  nuke: 'nuke',
  overpass: 'overpass',
  ancient: 'ancient',
  vertigo: 'vertigo',
  train: 'train',
  cache: 'cache',
  cobblestone: 'cobblestone',
  cobble: 'cobblestone',
  tuscan: 'tuscan',
  office: 'office',
  italy: 'italy',
  aztec: 'aztec'
}

function normalizeMapSlug(raw: string): string | null {
  let s = raw.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^de[_-]?/, '')
  s = s.replace(/^cs[_-]?/, '')
  s = s.replace(/\s+/g, '_')
  if (MAP_SLUG_ALIASES[s]) return MAP_SLUG_ALIASES[s]
  if (/^[a-z0-9_]+$/.test(s)) return s
  return null
}

/** 将 GSI / match.json 地图名转为官服剪影图 URL；无法识别时返回 null */
export function getMapImageUrl(mapDisplayName: string): string | null {
  const slug = normalizeMapSlug(mapDisplayName)
  if (!slug) return null
  return `${MAP_IMAGE_BASE}${slug}.jpg`
}
